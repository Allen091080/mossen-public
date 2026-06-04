import { feature } from 'bun:bundle'
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js'
import { isExtractModeActive } from '../memdir/paths.js'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import type { ToolUseContext } from '../Tool.js'
import type { HookProgress } from '../types/hooks.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StopHookInfo,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../types/message.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import {
  executeStopHooks,
  executeTaskCompletedHooks,
  executeTeammateIdleHooks,
  getStopHookMessage,
  getTaskCompletedHookMessage,
  getTeammateIdleHookMessage,
} from '../utils/hooks.js'
import {
  createStopHookSummaryMessage,
  createSystemMessage,
  createUserInterruptionMessage,
  createUserMessage,
} from '../utils/messages.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import {
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  prioritizeTasksForDisplay,
  type Task,
} from '../utils/tasks.js'
import { getAgentName, getTeamName, isTeammate } from '../utils/teammate.js'
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const extractMemoriesModule =
  require('../services/extractMemories/extractMemories.js') as typeof import('../services/extractMemories/extractMemories.js')
const jobClassifierModule = feature('TEMPLATES')
  ? (require('../jobs/classifier.js') as typeof import('../jobs/classifier.js'))
  : null

/* eslint-enable @typescript-eslint/no-require-imports */

import type { QuerySource } from '../constants/querySource.js'
import { executeAutoDream } from '../services/autoDream/autoDream.js'
import { captureTurnForMemorySidecar } from '../services/memorySidecar/turnCapture.js'
import { executePromptSuggestion } from '../services/PromptSuggestion/promptSuggestion.js'
import { isBareMode, isEnvDefinedFalsy } from '../utils/envUtils.js'
import { isCustomBackendEnabled } from '../utils/customBackend.js'
import {
  createCacheSafeParams,
  saveCacheSafeParams,
} from '../utils/forkedAgent.js'

type StopHookResult = {
  blockingErrors: Message[]
  preventContinuation: boolean
}

const UNFINISHED_TASK_GUARD_MARKER = 'MOSSEN_UNFINISHED_TASK_GUARD'
const MAX_UNFINISHED_TASK_GUARD_ATTEMPTS = 3

function getMessageContentForTaskGuard(message: Message): string {
  const content = (
    message as {
      message?: {
        content?: unknown
      }
    }
  ).message?.content

  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const maybeText = (block as { text?: unknown }).text
      return typeof maybeText === 'string' ? maybeText : ''
    })
    .filter(Boolean)
    .join('\n')
}

function getTaskOwnerAliases(toolUseContext: ToolUseContext): Set<string> {
  const aliases = new Set<string>()
  const agentName = getAgentName()
  const teamName = getTeamName()

  if (toolUseContext.agentId) aliases.add(toolUseContext.agentId)
  if (agentName) aliases.add(agentName)
  if (agentName && teamName) aliases.add(`${agentName}@${teamName}`)

  return aliases
}

function isRelevantUnfinishedTask(
  task: Task,
  toolUseContext: ToolUseContext,
  ownerAliases: Set<string>,
): boolean {
  if (task.status === 'completed') return false
  if (toolUseContext.agentId) {
    return task.owner !== undefined && ownerAliases.has(task.owner)
  }
  return (
    !task.owner || (task.owner !== undefined && ownerAliases.has(task.owner))
  )
}

function createUnfinishedTaskDigest(tasks: Task[]): string {
  return tasks
    .map(task => `${task.id}:${task.status}:${task.owner ?? 'main'}`)
    .join('|')
}

function countUnfinishedTaskGuardMessages(
  messages: Message[],
  digest: string,
): number {
  const marker = `${UNFINISHED_TASK_GUARD_MARKER}:${digest}`
  return messages.filter(message =>
    getMessageContentForTaskGuard(message).includes(marker),
  ).length
}

function formatUnfinishedTaskForGuard(task: Task): string {
  const owner = task.owner ? ` owner=${task.owner}` : ''
  return `- #${task.id} [${task.status}${owner}] ${task.subject}`
}

async function createUnfinishedTaskBlockingMessage(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
): Promise<Message | undefined> {
  if (
    (!querySource.startsWith('repl_main_thread') &&
      !querySource.startsWith('agent:')) ||
    toolUseContext.options.isNonInteractiveSession ||
    !isTodoV2Enabled()
  ) {
    return undefined
  }

  let tasks: Task[]
  try {
    tasks = await listTasks(getTaskListId())
  } catch (error) {
    logForDebugging(
      `[Tasks] Failed to read task list for unfinished-task guard: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return undefined
  }

  const ownerAliases = getTaskOwnerAliases(toolUseContext)
  const unresolvedTasks = prioritizeTasksForDisplay(tasks).filter(
    task => isRelevantUnfinishedTask(task, toolUseContext, ownerAliases),
  )

  if (unresolvedTasks.length === 0) return undefined

  const digest = createUnfinishedTaskDigest(unresolvedTasks)
  const guardAttempts = countUnfinishedTaskGuardMessages(
    [...messagesForQuery, ...assistantMessages],
    digest,
  )
  if (guardAttempts >= MAX_UNFINISHED_TASK_GUARD_ATTEMPTS) {
    return undefined
  }

  const visibleTasks = unresolvedTasks.slice(0, 8)
  const overflowCount = unresolvedTasks.length - visibleTasks.length
  const taskLines = [
    ...visibleTasks.map(formatUnfinishedTaskForGuard),
    ...(overflowCount > 0 ? [`- ... and ${overflowCount} more`] : []),
  ].join('\n')

  return createUserMessage({
    content:
      `<system-reminder>\n` +
      `${UNFINISHED_TASK_GUARD_MARKER}:${digest}\n` +
      `Attempt ${guardAttempts + 1}/${MAX_UNFINISHED_TASK_GUARD_ATTEMPTS}.\n` +
      `You are about to end the turn while the task list still has unresolved items:\n` +
      `${taskLines}\n\n` +
      `Do not end silently. Continue by calling tools for the unfinished work, or give the user a clear partial/failure report that explains what remains blocked. If the task list is stale or intentionally abandoned, say that explicitly instead of leaving the user at an idle prompt.\n` +
      `</system-reminder>`,
    isMeta: true,
  })
}

export async function* handleStopHooks(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  systemPrompt: SystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
  stopHookActive?: boolean,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  StopHookResult
> {
  const hookStartTime = Date.now()

  const stopHookContext: REPLHookContext = {
    messages: [...messagesForQuery, ...assistantMessages],
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  }
  // Only save params for main session queries — subagents must not overwrite.
  // Outside the prompt-suggestion gate: the REPL /btw command and the
  // side_question SDK control_request both read this snapshot, and neither
  // depends on prompt suggestions being enabled.
  if (querySource === 'repl_main_thread' || querySource === 'sdk') {
    saveCacheSafeParams(createCacheSafeParams(stopHookContext))
  }

  // Template job classification: when running as a dispatched job, classify
  // state after each turn. Gate on repl_main_thread so background forks
  // (extract-memories, auto-dream) don't pollute the timeline with their own
  // assistant messages. Await the classifier so state.json is written before
  // the turn returns — otherwise `mossen list` shows stale state for the gap.
  // Env key hardcoded (vs importing JOB_ENV_KEY from jobs/state) to match the
  // require()-gated jobs/ import pattern above; spawn.test.ts asserts the
  // string matches.
  if (
    feature('TEMPLATES') &&
    process.env.MOSSEN_JOB_DIR &&
    querySource.startsWith('repl_main_thread') &&
    !toolUseContext.agentId
  ) {
    // Full turn history — assistantMessages resets each queryLoop iteration,
    // so tool calls from earlier iterations (Agent spawn, then summary) need
    // messagesForQuery to be visible in the tool-call summary.
    const turnAssistantMessages = stopHookContext.messages.filter(
      (m): m is AssistantMessage => m.type === 'assistant',
    )
    const p = jobClassifierModule!
      .classifyAndWriteState(process.env.MOSSEN_JOB_DIR, turnAssistantMessages)
      .catch(err => {
        logForDebugging(`[job] classifier error: ${errorMessage(err)}`, {
          level: 'error',
        })
      })
    await Promise.race([
      p,
      // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
      new Promise<void>(r => setTimeout(r, 60_000).unref()),
    ])
  }
  // --bare / SIMPLE: skip background bookkeeping (prompt suggestion,
  // memory extraction, auto-dream). Scripted -p calls don't want auto-memory
  // or forked agents contending for resources during shutdown.
  if (!isBareMode()) {
    // Inline env check for dead code elimination in external builds
    if (!isEnvDefinedFalsy(process.env.MOSSEN_CODE_ENABLE_PROMPT_SUGGESTION)) {
      void executePromptSuggestion(stopHookContext)
    }
    if (
      !toolUseContext.agentId &&
      isExtractModeActive()
    ) {
      // Fire-and-forget in both interactive and non-interactive. For -p/SDK,
      // print.ts drains the in-flight promise after flushing the response
      // but before gracefulShutdownSync (see drainPendingExtraction).
      void extractMemoriesModule!.executeExtractMemories(
        stopHookContext,
        toolUseContext.appendSystemMessage,
      )
    }
    if (!toolUseContext.agentId) {
      void captureTurnForMemorySidecar(stopHookContext)
      void executeAutoDream(stopHookContext, toolUseContext.appendSystemMessage)
    }
  }

  const unfinishedTaskBlockingMessage =
    await createUnfinishedTaskBlockingMessage(
      messagesForQuery,
      assistantMessages,
      toolUseContext,
      querySource,
    )
  if (unfinishedTaskBlockingMessage) {
    toolUseContext.addNotification?.({
      key: 'unfinished-task-guard',
      text: 'Unfinished tasks remain; continuing or reporting the blocker.',
      priority: 'immediate',
    })
    return {
      blockingErrors: [unfinishedTaskBlockingMessage],
      preventContinuation: false,
    }
  }

  if (
    isCustomBackendEnabled() &&
    process.env.MOSSEN_CODE_ENABLE_CUSTOM_BACKEND_STOP_HOOKS !== '1'
  ) {
    return { blockingErrors: [], preventContinuation: false }
  }

  // chicago MCP: auto-unhide + lock release at turn end.
  // Main thread only — the CU lock is a process-wide module-level variable,
  // so a subagent's stopHooks releasing it leaves the main thread's cleanup
  // seeing isLockHeldLocally()===false → no exit notification, and unhides
  // mid-turn. Subagents don't start CU sessions so this is a pure skip.
  if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
    try {
      const { cleanupComputerUseAfterTurn } = await import(
        '../utils/computerUse/cleanup.js'
      )
      await cleanupComputerUseAfterTurn(toolUseContext)
    } catch {
      // Failures are silent — this is dogfooding cleanup, not critical path
    }
  }

  try {
    const blockingErrors = []
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    const generator = executeStopHooks(
      permissionMode,
      toolUseContext.abortController.signal,
      undefined,
      stopHookActive ?? false,
      toolUseContext.agentId,
      toolUseContext,
      [...messagesForQuery, ...assistantMessages],
      toolUseContext.agentType,
    )

    // Consume all progress messages and get blocking errors
    let stopHookToolUseID = ''
    let hookCount = 0
    let preventedContinuation = false
    let stopReason = ''
    let hasOutput = false
    const hookErrors: string[] = []
    const hookInfos: StopHookInfo[] = []

    for await (const result of generator) {
      if (result.message) {
        yield result.message
        // Track toolUseID from progress messages and count hooks
        if (result.message.type === 'progress' && result.message.toolUseID) {
          stopHookToolUseID = result.message.toolUseID
          hookCount++
          // Extract hook command and prompt text from progress data
          const progressData = result.message.data as HookProgress
          if (progressData.command) {
            hookInfos.push({
              command: progressData.command,
              promptText: progressData.promptText,
            })
          }
        }
        // Track errors and output from attachments
        if (result.message.type === 'attachment') {
          const attachment = result.message.attachment
          if (
            'hookEvent' in attachment &&
            (attachment.hookEvent === 'Stop' ||
              attachment.hookEvent === 'SubagentStop')
          ) {
            if (attachment.type === 'hook_non_blocking_error') {
              hookErrors.push(
                attachment.stderr || `Exit code ${attachment.exitCode}`,
              )
              // Non-blocking errors always have output
              hasOutput = true
            } else if (attachment.type === 'hook_error_during_execution') {
              hookErrors.push(attachment.content)
              hasOutput = true
            } else if (attachment.type === 'hook_success') {
              // Check if successful hook produced any stdout/stderr
              if (
                (attachment.stdout && attachment.stdout.trim()) ||
                (attachment.stderr && attachment.stderr.trim())
              ) {
                hasOutput = true
              }
            }
            // Extract per-hook duration for timing visibility.
            // Hooks run in parallel; match by command + first unassigned entry.
            if ('durationMs' in attachment && 'command' in attachment) {
              const info = hookInfos.find(
                i =>
                  i.command === attachment.command &&
                  i.durationMs === undefined,
              )
              if (info) {
                info.durationMs = attachment.durationMs
              }
            }
          }
        }
      }
      if (result.blockingError) {
        const userMessage = createUserMessage({
          content: getStopHookMessage(result.blockingError),
          isMeta: true, // Hide from UI (shown in summary message instead)
        })
        blockingErrors.push(userMessage)
        yield userMessage
        hasOutput = true
        // Add to hookErrors so it appears in the summary
        hookErrors.push(result.blockingError.blockingError)
      }
      // Check if hook wants to prevent continuation
      if (result.preventContinuation) {
        preventedContinuation = true
        stopReason = result.stopReason || 'Stop hook prevented continuation'
        // Create attachment to track the stopped continuation (for structured data)
        yield createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message: stopReason,
          hookName: 'Stop',
          toolUseID: stopHookToolUseID,
          hookEvent: 'Stop',
        })
      }

      // Check if we were aborted during hook execution
      if (toolUseContext.abortController.signal.aborted) {
        logMossenEvent('mossen.stopHooks.preCancelled', {
          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,

          queryDepth: toolUseContext.queryTracking?.depth,
        })
        yield createUserInterruptionMessage({
          toolUse: false,
        })
        return { blockingErrors: [], preventContinuation: true }
      }
    }
    // Create summary system message if hooks ran
    if (hookCount > 0) {
      yield createStopHookSummaryMessage(
        hookCount,
        hookInfos,
        hookErrors,
        preventedContinuation,
        stopReason,
        hasOutput,
        'suggestion',
        stopHookToolUseID,
      )

      // Send notification about errors (shown in verbose/transcript mode via ctrl+o)
      if (hookErrors.length > 0) {
        const expandShortcut = getShortcutDisplay(
          'app:toggleTranscript',
          'Global',
          'ctrl+o',
        )
        toolUseContext.addNotification?.({
          key: 'stop-hook-error',
          text: `Stop hook error occurred \u00b7 ${expandShortcut} to see`,
          priority: 'immediate',
        })
      }
    }

    if (preventedContinuation) {
      return { blockingErrors: [], preventContinuation: true }
    }

    // Collect blocking errors from stop hooks
    if (blockingErrors.length > 0) {
      return { blockingErrors, preventContinuation: false }
    }

    // After Stop hooks pass, run TeammateIdle and TaskCompleted hooks if this is a teammate
    if (isTeammate()) {
      const teammateName = getAgentName() ?? ''
      const teamName = getTeamName() ?? ''
      const teammateBlockingErrors: Message[] = []
      let teammatePreventedContinuation = false
      let teammateStopReason: string | undefined
      // Each hook executor generates its own toolUseID — capture from progress
      // messages (same pattern as stopHookToolUseID at L142), not the Stop ID.
      let teammateHookToolUseID = ''

      // Run TaskCompleted hooks for any in-progress tasks owned by this teammate
      const taskListId = getTaskListId()
      const tasks = await listTasks(taskListId)
      const inProgressTasks = tasks.filter(
        t => t.status === 'in_progress' && t.owner === teammateName,
      )

      for (const task of inProgressTasks) {
        const taskCompletedGenerator = executeTaskCompletedHooks(
          task.id,
          task.subject,
          task.description,
          teammateName,
          teamName,
          permissionMode,
          toolUseContext.abortController.signal,
          undefined,
          toolUseContext,
        )

        for await (const result of taskCompletedGenerator) {
          if (result.message) {
            if (
              result.message.type === 'progress' &&
              result.message.toolUseID
            ) {
              teammateHookToolUseID = result.message.toolUseID
            }
            yield result.message
          }
          if (result.blockingError) {
            const userMessage = createUserMessage({
              content: getTaskCompletedHookMessage(result.blockingError),
              isMeta: true,
            })
            teammateBlockingErrors.push(userMessage)
            yield userMessage
          }
          // Match Stop hook behavior: allow preventContinuation/stopReason
          if (result.preventContinuation) {
            teammatePreventedContinuation = true
            teammateStopReason =
              result.stopReason || 'TaskCompleted hook prevented continuation'
            yield createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message: teammateStopReason,
              hookName: 'TaskCompleted',
              toolUseID: teammateHookToolUseID,
              hookEvent: 'TaskCompleted',
            })
          }
          if (toolUseContext.abortController.signal.aborted) {
            return { blockingErrors: [], preventContinuation: true }
          }
        }
      }

      // Run TeammateIdle hooks
      const teammateIdleGenerator = executeTeammateIdleHooks(
        teammateName,
        teamName,
        permissionMode,
        toolUseContext.abortController.signal,
      )

      for await (const result of teammateIdleGenerator) {
        if (result.message) {
          if (result.message.type === 'progress' && result.message.toolUseID) {
            teammateHookToolUseID = result.message.toolUseID
          }
          yield result.message
        }
        if (result.blockingError) {
          const userMessage = createUserMessage({
            content: getTeammateIdleHookMessage(result.blockingError),
            isMeta: true,
          })
          teammateBlockingErrors.push(userMessage)
          yield userMessage
        }
        // Match Stop hook behavior: allow preventContinuation/stopReason
        if (result.preventContinuation) {
          teammatePreventedContinuation = true
          teammateStopReason =
            result.stopReason || 'TeammateIdle hook prevented continuation'
          yield createAttachmentMessage({
            type: 'hook_stopped_continuation',
            message: teammateStopReason,
            hookName: 'TeammateIdle',
            toolUseID: teammateHookToolUseID,
            hookEvent: 'TeammateIdle',
          })
        }
        if (toolUseContext.abortController.signal.aborted) {
          return { blockingErrors: [], preventContinuation: true }
        }
      }

      if (teammatePreventedContinuation) {
        return { blockingErrors: [], preventContinuation: true }
      }

      if (teammateBlockingErrors.length > 0) {
        return {
          blockingErrors: teammateBlockingErrors,
          preventContinuation: false,
        }
      }
    }

    return { blockingErrors: [], preventContinuation: false }
  } catch (error) {
    const durationMs = Date.now() - hookStartTime
    logMossenEvent('mossen.stopHooks.error', {
      duration: durationMs,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
    })
    // Yield a system message that is not visible to the model for the user
    // to debug their hook.
    yield createSystemMessage(
      `Stop hook failed: ${errorMessage(error)}`,
      'warning',
    )
    return { blockingErrors: [], preventContinuation: false }
  }
}
