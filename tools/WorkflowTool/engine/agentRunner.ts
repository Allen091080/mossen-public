/**
 * runAgent-backed implementation of the engine's agent() primitive.
 *
 * This is the bridge from the workflow engine to Mossen's real subagent system:
 * each agent() call resolves an agent definition, assembles that agent's own
 * tool pool, runs it to completion via runAgent(), and returns the final text —
 * or, when a JSON Schema was supplied, injects a schema-specific
 * StructuredOutput tool and returns the tool-provided object (retrying when the
 * agent fails to call the tool or the result is rejected).
 *
 * The pure parse/validate/retry-decision logic lives in schemaValidate.ts and
 * is unit-tested there; this module is the thin I/O-bound wiring that can only
 * be exercised end-to-end via the workflow smoke test.
 */

import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext, Tools } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import { createChildAbortController } from '../../../utils/abortController.js'
import type { ModelAlias } from '../../../utils/model/aliases.js'
import { assembleToolPool } from '../../../tools.js'
import { createUserMessage, extractTextContent } from '../../../utils/messages.js'
import { createAgentId } from '../../../utils/uuid.js'
import { getQuerySourceForAgent } from '../../../utils/promptCategory.js'
import { runWithCwdOverride } from '../../../utils/cwd.js'
import { logForDebugging } from '../../../utils/debug.js'
import { getRemoteSessionUrl } from '../../../constants/product.js'
import {
  createAgentWorktree,
  hasWorktreeChanges,
  removeAgentWorktree,
} from '../../../utils/worktree.js'
import { runAgent } from '../../AgentTool/runAgent.js'
import { AGENT_TOOL_NAME } from '../../AgentTool/constants.js'
import { finalizeAgentTool } from '../../AgentTool/agentToolUtils.js'
import {
  isBuiltInAgent,
  resolveAgentTypeFlexible,
  type AgentDefinition,
} from '../../AgentTool/loadAgentsDir.js'
import { GENERAL_PURPOSE_AGENT } from '../../AgentTool/built-in/generalPurposeAgent.js'
import {
  filterDeniedAgents,
  getDenyRuleForAgent,
} from '../../../utils/permissions/permissions.js'
import {
  createSyntheticOutputTool,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '../../SyntheticOutputTool/SyntheticOutputTool.js'
import {
  extractJson,
  formatIssues,
  stripLiteralThinking,
  validateAgainstSchema,
} from './schemaValidate.js'
import type {
  AgentCallOptions,
  AgentRunResult,
  WorkflowAgentProgressUpdate,
} from './types.js'
import {
  WORKFLOW_AGENT_RETRY_ABORT_REASON,
  WORKFLOW_AGENT_SKIP_ABORT_REASON,
  WORKFLOW_AGENT_STALL_ABORT_REASON,
} from './types.js'
import type { RunOneAgent } from './runtime.js'

/** How many times to re-prompt an agent whose output fails schema validation. */
export const MAX_SCHEMA_RETRIES = 2
export const DEFAULT_REMOTE_AGENT_TIMEOUT_MS = 30 * 60 * 1000
export const DEFAULT_REMOTE_AGENT_POLL_INTERVAL_MS = 5 * 1000
export const DEFAULT_LOCAL_AGENT_STALL_TIMEOUT_MS = 60 * 1000

export class WorkflowSchemaError extends Error {
  constructor(message: string)
  constructor(label: string, detail: string)
  constructor(labelOrMessage: string, detail?: string) {
    super(
      detail === undefined
        ? labelOrMessage
        : `agent "${labelOrMessage}" did not return schema-valid output: ${detail}`,
    )
    this.name = 'WorkflowSchemaError'
  }
}

type WorkflowAgentWorktreeInfo = Awaited<ReturnType<typeof createAgentWorktree>>

type RemoteSessionStatus = 'idle' | 'running' | 'requires_action' | 'archived'

type RemoteSdkMessage = Record<string, unknown>

type RemotePollResult = {
  newEvents: RemoteSdkMessage[]
  lastEventId: string | null
  sessionStatus?: RemoteSessionStatus
  metadataFetchError?: string
}

type RemoteLaunchResult = {
  id: string
  title?: string
} | null

export type WorkflowRemoteAgentRunner = (
  prompt: string,
  opts: AgentCallOptions,
  meta: { agentNumber: number; phase: string | null; label: string },
  signal?: AbortSignal,
) => Promise<AgentRunResult>

export type WorkflowRemoteAgentRunnerDeps = {
  launch?: (options: {
    initialMessage: string
    description: string
    title: string
    model?: string
    signal: AbortSignal
  }) => Promise<RemoteLaunchResult>
  poll?: (
    sessionId: string,
    afterId: string | null,
  ) => Promise<RemotePollResult>
  archive?: (sessionId: string) => Promise<void>
  getSessionUrl?: (sessionId: string) => string
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  timeoutMs?: number
  pollIntervalMs?: number
}

export type WorkflowAgentRunnerDeps = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  /** Groups subagent transcripts under subagents/workflows/<runId>/. */
  runId: string
  /**
   * Optional abort controller for the run. When the workflow runs in the
   * background (S2), this is an UNLINKED controller so spawned subagents keep
   * running after the originating tool call returns; if omitted, subagents
   * inherit the parent turn's controller (foreground behaviour).
   */
  abortController?: AbortController
  registerAgentController?: (
    agentNumber: number,
    controller: AbortController,
  ) => () => void
  remoteAgentRunner?: WorkflowRemoteAgentRunner
  runAgentImpl?: typeof runAgent
  localAgentStallTimeoutMs?: number | null
}

type WorkflowAgentStallWatch = {
  reset(): void
  dispose(): void
}

type WorkflowRunOneAgentMeta = Parameters<RunOneAgent>[2]

const TOOL_INPUT_SUMMARY_KEYS = [
  'command',
  'file_path',
  'path',
  'pattern',
  'query',
  'prompt',
  'url',
]

function compactWorkflowText(value: unknown, maxLength = 160): string | undefined {
  const raw =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return undefined
          }
        })()
  const compact = raw?.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 1))}…`
    : compact
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numericField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageTokenCount(usage: unknown): number {
  const record = asRecord(usage)
  if (!record) return 0
  return (
    numericField(record, 'input_tokens') +
    numericField(record, 'output_tokens') +
    numericField(record, 'cache_creation_input_tokens') +
    numericField(record, 'cache_read_input_tokens') +
    numericField(record, 'inputTokens') +
    numericField(record, 'outputTokens') +
    numericField(record, 'cacheCreationInputTokens') +
    numericField(record, 'cacheReadInputTokens')
  )
}

function summarizeToolInput(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const parsed = (() => {
      try {
        return JSON.parse(input) as unknown
      } catch {
        return input
      }
    })()
    if (parsed !== input) return summarizeToolInput(parsed)
    return compactWorkflowText(input, 80)
  }

  const record = asRecord(input)
  if (!record) return compactWorkflowText(input, 80)
  for (const key of TOOL_INPUT_SUMMARY_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return compactWorkflowText(value, 80)
    }
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim()) {
      return compactWorkflowText(value, 80)
    }
  }
  return compactWorkflowText(record, 80)
}

function messageContent(message: Message): unknown {
  return (message as { message?: { content?: unknown } }).message?.content
}

function messageUsage(message: Message): unknown {
  return (message as { message?: { usage?: unknown }; usage?: unknown }).message
    ?.usage ?? (message as { usage?: unknown }).usage
}

function workflowProgressFromMessage(
  message: Message,
  prior: { tokens: number; toolCalls: number },
): WorkflowAgentProgressUpdate | null {
  if ((message as { type?: unknown }).type !== 'assistant') return null
  const content = messageContent(message)
  const usageTokens = usageTokenCount(messageUsage(message))
  if (usageTokens > 0) prior.tokens = usageTokens

  let lastToolName: string | undefined
  let lastToolSummary: string | undefined
  let toolUses = 0
  if (Array.isArray(content)) {
    for (const block of content) {
      const record = asRecord(block)
      if (record?.type !== 'tool_use') continue
      toolUses++
      if (typeof record.name === 'string' && record.name.trim()) {
        lastToolName = record.name
      }
      const summary = summarizeToolInput(record.input)
      if (summary) lastToolSummary = summary
    }
  }
  prior.toolCalls += toolUses

  const resultPreview = stripLiteralThinking(
    extractTextContent(content, '\n'),
  ).trim()
  if (
    prior.tokens === 0 &&
    prior.toolCalls === 0 &&
    !lastToolName &&
    !resultPreview
  ) {
    return null
  }
  return {
    ...(prior.tokens > 0 ? { tokens: prior.tokens } : {}),
    ...(prior.toolCalls > 0 ? { toolCalls: prior.toolCalls } : {}),
    ...(lastToolName ? { lastToolName } : {}),
    ...(lastToolSummary ? { lastToolSummary } : {}),
    ...(resultPreview ? { resultPreview: compactWorkflowText(resultPreview) } : {}),
  }
}

function resolveAgentDefinition(
  toolUseContext: ToolUseContext,
  requested: string | undefined,
): AgentDefinition {
  const wanted = requested?.trim() || GENERAL_PURPOSE_AGENT.agentType
  const allAgents = toolUseContext.options.agentDefinitions.activeAgents
  const { allowedAgentTypes } = toolUseContext.options.agentDefinitions
  const permissionContext = toolUseContext.getAppState().toolPermissionContext
  const allowedAgents = allowedAgentTypes
    ? allAgents.filter(agent => allowedAgentTypes.includes(agent.agentType))
    : allAgents
  const agents = filterDeniedAgents(
    allowedAgents,
    permissionContext,
    AGENT_TOOL_NAME,
  )
  const resolved = resolveAgentTypeFlexible(agents, wanted)
  if (resolved.kind === 'found') return resolved.agent
  if (wanted === GENERAL_PURPOSE_AGENT.agentType) return GENERAL_PURPOSE_AGENT
  const deniedResolution = resolveAgentTypeFlexible(allowedAgents, wanted)
  if (deniedResolution.kind === 'found') {
    const deniedAgent = deniedResolution.agent
    const denyRule = getDenyRuleForAgent(
      permissionContext,
      AGENT_TOOL_NAME,
      deniedAgent.agentType,
    )
    if (denyRule) {
      throw new Error(
        `agent({agentType}): '${wanted}' is denied by permission rule '${AGENT_TOOL_NAME}(${deniedAgent.agentType})' from ${denyRule.source ?? 'settings'}.`,
      )
    }
  }
  if (resolved.kind === 'ambiguous') {
    throw new Error(
      `agent({agentType}): agent type '${wanted}' is ambiguous after case/separator normalization. Matching agents: ${resolved.matches.map(agent => agent.agentType).join(', ')}`,
    )
  }
  const known = agents.map(a => a.agentType).join(', ')
  throw new Error(
    `agent({agentType}): agent type '${wanted}' not found. Available agents: ${known || '(none)'}`,
  )
}

function buildSchemaInstruction(schema: Record<string, unknown>): string {
  return (
    `\n\nIMPORTANT: Complete this task by calling the ${SYNTHETIC_OUTPUT_TOOL_NAME} ` +
    'tool exactly once with data conforming to this JSON Schema. Do not return ' +
    'the structured result as prose or raw JSON text.\n\n' +
    `JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  )
}

function buildRemoteSchemaInstruction(schema: Record<string, unknown>): string {
  return (
    '\n\nIMPORTANT: Complete this remote workflow agent task by returning ' +
    `structured output conforming to this JSON Schema. If a ${SYNTHETIC_OUTPUT_TOOL_NAME} ` +
    'tool is available, call it exactly once. Otherwise return only JSON and ' +
    'do not wrap the JSON in prose.\n\n' +
    `JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  )
}

export function buildRemoteWorkflowAgentPrompt(
  prompt: string,
  opts: AgentCallOptions,
  meta: { agentNumber: number; phase: string | null; label: string },
): string {
  const header = [
    'You are running as a remote workflow agent.',
    `Workflow agent: #${meta.agentNumber} ${meta.label}`,
    meta.phase ? `Workflow phase: ${meta.phase}` : null,
    opts.agentType ? `Requested agent type: ${opts.agentType}` : null,
  ].filter((line): line is string => line !== null)
  return `${header.join('\n')}\n\n${prompt}${
    opts.schema ? buildRemoteSchemaInstruction(opts.schema) : ''
  }`
}

function remoteMessageType(message: RemoteSdkMessage): string | null {
  return typeof message.type === 'string' ? message.type : null
}

function asRemoteRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function lastRemoteResultMessage(
  messages: readonly RemoteSdkMessage[],
): RemoteSdkMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (remoteMessageType(message) === 'result') return message
  }
  return null
}

function remoteResultSubtype(message: RemoteSdkMessage | null): string | null {
  return typeof message?.subtype === 'string' ? message.subtype : null
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractRemoteAssistantText(messages: readonly RemoteSdkMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (remoteMessageType(message) !== 'assistant') continue
    const text = extractTextFromContent(
      (message as { message?: { content?: unknown } }).message?.content,
    ).trim()
    if (text) return text
  }
  return ''
}

function remoteResultError(message: RemoteSdkMessage): string | null {
  if (remoteMessageType(message) !== 'result') return null
  const subtype = remoteResultSubtype(message)
  if (subtype === 'success') return null
  const errors = (message as { errors?: unknown }).errors
  if (Array.isArray(errors)) {
    const text = errors.filter((err): err is string => typeof err === 'string')
    if (text.length > 0) return text.join(', ')
  }
  const result = (message as { result?: unknown }).result
  return typeof result === 'string' && result.trim()
    ? result
    : `remote session ended with subtype '${String(subtype)}'`
}

function extractRemoteResultText(messages: readonly RemoteSdkMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (remoteMessageType(message) !== 'result') continue
    const result = (message as { result?: unknown }).result
    if (
      (message as { subtype?: unknown }).subtype === 'success' &&
      typeof result === 'string' &&
      result.trim()
    ) {
      return result.trim()
    }
  }
  return extractRemoteAssistantText(messages)
}

function extractRemoteStructuredOutput(
  messages: readonly RemoteSdkMessage[],
): unknown | undefined {
  const result = lastRemoteResultMessage(messages)
  if (remoteResultSubtype(result) !== 'success') return undefined
  if (result && Object.hasOwn(result, 'structured_output')) {
    return (result as { structured_output?: unknown }).structured_output
  }
  if (result && Object.hasOwn(result, 'structuredOutput')) {
    return (result as { structuredOutput?: unknown }).structuredOutput
  }
  return undefined
}

function numericProperty(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function remoteUsageTokens(messages: readonly RemoteSdkMessage[]): number {
  const result = lastRemoteResultMessage(messages)
  const usage = asRemoteRecord(result?.usage)
  if (usage) {
    return (
      numericProperty(usage, 'input_tokens') +
      numericProperty(usage, 'output_tokens') +
      numericProperty(usage, 'cache_creation_input_tokens') +
      numericProperty(usage, 'cache_read_input_tokens')
    )
  }

  const modelUsage = asRemoteRecord(result?.modelUsage)
  if (!modelUsage) return 0
  let total = 0
  for (const value of Object.values(modelUsage)) {
    const usageRecord = asRemoteRecord(value)
    if (!usageRecord) continue
    total +=
      numericProperty(usageRecord, 'inputTokens') +
      numericProperty(usageRecord, 'outputTokens') +
      numericProperty(usageRecord, 'cacheCreationInputTokens') +
      numericProperty(usageRecord, 'cacheReadInputTokens')
  }
  return total
}

function remoteToolCallCount(messages: readonly RemoteSdkMessage[]): number {
  let contentToolUses = 0
  for (const message of messages) {
    if (remoteMessageType(message) === 'tool_use') contentToolUses++
    const content = (message as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'tool_use'
      ) {
        contentToolUses++
      }
    }
  }

  const result = lastRemoteResultMessage(messages)
  const directToolCalls =
    typeof result?.toolCalls === 'number'
      ? result.toolCalls
      : typeof result?.tool_calls === 'number'
        ? result.tool_calls
        : typeof result?.total_tool_use_count === 'number'
          ? result.total_tool_use_count
          : 0
  return Math.max(contentToolUses, directToolCalls)
}

function remoteMissingStructuredOutputReason(
  messages: readonly RemoteSdkMessage[],
): string {
  const subtype = remoteResultSubtype(lastRemoteResultMessage(messages))
  if (subtype === 'error_max_structured_output_retries') {
    return 'the remote agent called StructuredOutput but every attempt failed schema validation'
  }
  if (subtype && subtype !== 'success') {
    return `the remote turn ended with result subtype '${subtype}'`
  }
  return 'the remote agent never called the StructuredOutput tool'
}

export function coerceRemoteWorkflowAgentResult(
  messages: readonly RemoteSdkMessage[],
  opts: AgentCallOptions,
  label: string,
): AgentRunResult {
  const tokens = remoteUsageTokens(messages)
  const toolCalls = remoteToolCallCount(messages)

  const text = extractRemoteResultText(messages)
  if (!opts.schema) {
    for (const message of messages) {
      const error = remoteResultError(message)
      if (error) {
        throw new Error(`remote session returned an error: ${error}`)
      }
    }
    return { value: stripLiteralThinking(text), tokens, toolCalls, ok: true }
  }

  const structuredOutput = extractRemoteStructuredOutput(messages)
  if (structuredOutput !== undefined) {
    const validation = validateAgainstSchema(structuredOutput, opts.schema)
    if (!validation.ok) {
      throw new WorkflowSchemaError(label, formatIssues(validation.errors))
    }
    return {
      value: validation.value,
      tokens,
      toolCalls,
      ok: true,
    }
  }

  const result = lastRemoteResultMessage(messages)
  if (result && remoteResultSubtype(result) !== 'success') {
    throw new Error(
      `agent({isolation:'remote', schema}) completed without structured output: ${remoteMissingStructuredOutputReason(messages)}.`,
    )
  }

  let value: unknown
  try {
    value = extractJson(text)
  } catch (err) {
    throw new WorkflowSchemaError(
      label,
      `the remote agent did not return JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const validation = validateAgainstSchema(value, opts.schema)
  if (!validation.ok) {
    throw new WorkflowSchemaError(label, formatIssues(validation.errors))
  }
  return {
    value: validation.value,
    tokens,
    toolCalls,
    ok: true,
  }
}

async function defaultRemoteLaunch(options: {
  initialMessage: string
  description: string
  title: string
  model?: string
  signal: AbortSignal
}): Promise<RemoteLaunchResult> {
  const { teleportToRemote } = await import('../../../utils/teleport.js')
  return teleportToRemote({
    initialMessage: options.initialMessage,
    description: options.description,
    title: options.title,
    ...(options.model ? { model: options.model } : {}),
    permissionMode: 'acceptEdits',
    signal: options.signal,
  })
}

async function defaultRemotePoll(
  sessionId: string,
  afterId: string | null,
): Promise<RemotePollResult> {
  const { pollRemoteSessionEvents } = await import('../../../utils/teleport.js')
  return pollRemoteSessionEvents(sessionId, afterId) as Promise<RemotePollResult>
}

async function defaultRemoteArchive(sessionId: string): Promise<void> {
  const { archiveRemoteSession } = await import('../../../utils/teleport.js')
  await archiveRemoteSession(sessionId)
}

function defaultRemoteSessionUrl(sessionId: string): string {
  return getRemoteSessionUrl(sessionId)
}

function withRemoteSessionId(
  result: AgentRunResult,
  remoteSessionId: string,
): AgentRunResult {
  return { ...result, remoteSessionId }
}

function workflowWorkerToolUseContext(
  toolUseContext: ToolUseContext,
): ToolUseContext {
  return {
    ...toolUseContext,
    getAppState: () => {
      const appState = toolUseContext.getAppState()
      return {
        ...appState,
        toolPermissionContext: {
          ...appState.toolPermissionContext,
          mode: 'acceptEdits',
        },
      }
    },
  }
}

function deriveRemoteLabel(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  const trimmed = firstLine.slice(0, 48)
  return trimmed.length < firstLine.length ? `${trimmed}…` : trimmed || 'agent'
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Workflow aborted.'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('Workflow aborted.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runHostedRemoteWorkflowAgent(
  prompt: string,
  opts: AgentCallOptions,
  meta: { agentNumber: number; phase: string | null; label: string },
  signal?: AbortSignal,
  deps: WorkflowRemoteAgentRunnerDeps = {},
): Promise<AgentRunResult> {
  const controller = signal ? null : new AbortController()
  const effectiveSignal = signal ?? controller!.signal
  const launch = deps.launch ?? defaultRemoteLaunch
  const poll = deps.poll ?? defaultRemotePoll
  const archive = deps.archive ?? defaultRemoteArchive
  const sleep = deps.sleep ?? delay
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REMOTE_AGENT_TIMEOUT_MS
  const pollIntervalMs =
    deps.pollIntervalMs ?? DEFAULT_REMOTE_AGENT_POLL_INTERVAL_MS
  const sessionUrlFor = deps.getSessionUrl ?? defaultRemoteSessionUrl
  const initialMessage = buildRemoteWorkflowAgentPrompt(prompt, opts, meta)
  const label = meta.label || deriveRemoteLabel(prompt)
  const launched = await launch({
    initialMessage,
    description: `Remote workflow agent: ${label}`,
    title: `workflow-remote-agent: ${label}`,
    ...(typeof opts.model === 'string' ? { model: opts.model } : {}),
    signal: effectiveSignal,
  })
  if (!launched?.id) {
    throw new Error('Failed to create remote workflow agent session.')
  }

  const events: RemoteSdkMessage[] = []
  let afterId: string | null = null
  let idleEmptyPolls = 0
  let metadataFetchFailures = 0
  const deadline = now() + timeoutMs
  try {
    while (now() <= deadline) {
      if (effectiveSignal.aborted) throw new Error('Workflow aborted.')
      const page = await poll(launched.id, afterId)
      events.push(...page.newEvents)
      afterId = page.lastEventId ?? afterId

      if (page.sessionStatus === undefined) {
        metadataFetchFailures++
        if (metadataFetchFailures >= 10) {
          throw new Error(
            `Remote session ${launched.id}: fetchSession failed 10 times in a row (last error: ${page.metadataFetchError ?? 'unknown'}). Bailing instead of polling to the 30-min timeout.`,
          )
        }
      } else {
        metadataFetchFailures = 0
      }

      const resultEvent = events.findLast(
        event => remoteMessageType(event) === 'result',
      )
      if (resultEvent) {
        return withRemoteSessionId(
          coerceRemoteWorkflowAgentResult(events, opts, label),
          launched.id,
        )
      }

      if (page.sessionStatus === 'requires_action') {
        throw new Error(
          `Remote session ${launched.id} entered 'requires_action' (likely a permission prompt) with no client to answer it. Ensure the remote agent's allowed_tools cover what it needs, or set a permissive mode.`,
        )
      }

      if (page.sessionStatus === 'idle') {
        const text = extractRemoteResultText(events)
        if (text.trim()) {
          return withRemoteSessionId(
            coerceRemoteWorkflowAgentResult(events, opts, label),
            launched.id,
          )
        }
        if (page.newEvents.length === 0) {
          idleEmptyPolls++
          if (idleEmptyPolls >= 5) {
            throw new Error(
              `remote session returned an error: idle before producing output (${sessionUrlFor(launched.id)})`,
            )
          }
        } else {
          idleEmptyPolls = 0
        }
      } else {
        idleEmptyPolls = 0
      }

      if (page.sessionStatus === 'archived') {
        throw new Error(
          `remote session returned an error: archived before producing output (${sessionUrlFor(launched.id)})`,
        )
      }

      await sleep(pollIntervalMs, effectiveSignal)
    }
  } catch (err) {
    if (effectiveSignal.aborted) {
      await archive(launched.id)
    }
    throw err
  }

  await archive(launched.id)
  throw new Error(`remote session exceeded 30 minutes: ${sessionUrlFor(launched.id)}`)
}

export function withStructuredOutputTool(
  availableTools: Tools,
  schema: Record<string, unknown>,
): Tools {
  const created = createSyntheticOutputTool(schema)
  if ('error' in created) {
    throw invalidWorkflowAgentSchemaError(created.error)
  }
  return [
    ...availableTools.filter(tool => tool.name !== SYNTHETIC_OUTPUT_TOOL_NAME),
    created.tool,
  ]
}

function invalidWorkflowAgentSchemaError(detail: string): WorkflowSchemaError {
  return new WorkflowSchemaError(
    `agent({schema}) received an invalid JSON Schema: ${detail}`,
  )
}

export function assertWorkflowAgentSchema(schema: Record<string, unknown>): void {
  const created = createSyntheticOutputTool(schema)
  if ('error' in created) {
    throw invalidWorkflowAgentSchemaError(created.error)
  }
}

export function formatMissingStructuredOutputAfterNudges(
  nudges = MAX_SCHEMA_RETRIES,
): string {
  return `agent({schema}): subagent completed without calling ${SYNTHETIC_OUTPUT_TOOL_NAME} (after ${nudges} in-conversation nudges)`
}

export function withStructuredOutputAllowed(
  agentDefinition: AgentDefinition,
): AgentDefinition {
  const tools = agentDefinition.tools
  if (
    tools === undefined ||
    (tools.length === 1 && tools[0] === '*') ||
    tools.includes(SYNTHETIC_OUTPUT_TOOL_NAME)
  ) {
    return agentDefinition
  }
  return {
    ...agentDefinition,
    tools: [...tools, SYNTHETIC_OUTPUT_TOOL_NAME],
  }
}

export function extractStructuredOutputFromMessages(
  messages: Message[],
): unknown | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (
      message?.type === 'attachment' &&
      message.attachment?.type === 'structured_output'
    ) {
      return message.attachment.data
    }
  }
  return undefined
}

function workflowAgentWorktreeSlug(runId: string, agentNumber: number): string {
  const safeRunId =
    runId
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'wf'
  return `${safeRunId}-${agentNumber}`
}

async function cleanupWorkflowAgentWorktree(
  worktreeInfo: WorkflowAgentWorktreeInfo | null,
): Promise<void> {
  if (!worktreeInfo) return
  const { worktreePath, worktreeBranch, headCommit, gitRoot, hookBased } =
    worktreeInfo

  if (hookBased) {
    logForDebugging(`Hook-based workflow agent worktree kept at: ${worktreePath}`)
    return
  }

  if (headCommit) {
    const changed = await hasWorktreeChanges(worktreePath, headCommit)
    if (!changed) {
      await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot)
      return
    }
  }

  logForDebugging(`Workflow agent worktree has changes, keeping: ${worktreePath}`)
}

/** Create the engine's RunOneAgent backed by the real subagent runtime. */
export function createWorkflowAgentRunner(
  deps: WorkflowAgentRunnerDeps,
): RunOneAgent {
  const {
    toolUseContext,
    canUseTool,
    runId,
    abortController,
    registerAgentController,
    remoteAgentRunner = runHostedRemoteWorkflowAgent,
    runAgentImpl = runAgent,
    localAgentStallTimeoutMs = DEFAULT_LOCAL_AGENT_STALL_TIMEOUT_MS,
  } = deps

  function createStallWatch(
    agentAbortController: AbortController | undefined,
  ): WorkflowAgentStallWatch | null {
    if (
      !agentAbortController ||
      localAgentStallTimeoutMs == null ||
      localAgentStallTimeoutMs <= 0
    ) {
      return null
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const dispose = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const reset = () => {
      dispose()
      if (agentAbortController.signal.aborted) return
      timer = setTimeout(() => {
        if (!agentAbortController.signal.aborted) {
          agentAbortController.abort(WORKFLOW_AGENT_STALL_ABORT_REASON)
        }
      }, localAgentStallTimeoutMs)
    }
    reset()
    return {
      reset,
      dispose,
    }
  }

  /** Run a single agent turn to completion; return its final text + tokens. */
  async function runOnce(
    agentDefinition: AgentDefinition,
    availableTools: Tools,
    workerToolUseContext: ToolUseContext,
    promptText: string,
    model: ModelAlias | undefined,
    label: string,
    worktreePath: string | undefined,
    agentAbortController: AbortController | undefined,
    onProgress: WorkflowRunOneAgentMeta['onProgress'],
  ): Promise<{
    text: string
    tokens: number
    toolCalls: number
    structuredOutput?: unknown
  }> {
    const startTime = Date.now()
    const agentId = createAgentId()
    const promptMessages: Message[] = [createUserMessage({ content: promptText })]
    const messages: Message[] = []
    const liveProgressTotals = { tokens: 0, toolCalls: 0 }
    const stallWatch = createStallWatch(agentAbortController)
    const run = () =>
      runAgentImpl({
        agentDefinition,
        promptMessages,
        toolUseContext: workerToolUseContext,
        canUseTool,
        isAsync: false,
        availableTools,
        querySource: getQuerySourceForAgent(
          agentDefinition.agentType,
          isBuiltInAgent(agentDefinition),
        ),
        model,
        description: label,
        worktreePath,
        // Thread the (optionally unlinked) abort controller so background runs'
        // subagents survive the originating tool call returning.
        override: agentAbortController
          ? { agentId, abortController: agentAbortController }
          : { agentId },
        transcriptSubdir: `workflows/${runId}`,
        onQueryProgress: stallWatch?.reset,
      })
    const stream = worktreePath
      ? runWithCwdOverride(worktreePath, run)
      : run()
    try {
      for await (const message of stream) {
        messages.push(message)
        const update = workflowProgressFromMessage(message, liveProgressTotals)
        if (update) onProgress?.(update)
      }
    } finally {
      stallWatch?.dispose()
    }
    const structuredOutput = extractStructuredOutputFromMessages(messages)
    const result = finalizeAgentTool(messages, agentId, {
      prompt: promptText,
      resolvedAgentModel: model ?? agentDefinition.model ?? 'inherit',
      isBuiltInAgent: isBuiltInAgent(agentDefinition),
      startTime,
      agentType: agentDefinition.agentType,
      isAsync: false,
    })
    return {
      // Strip any literal <think>…</think> the model emitted as plain text, so
      // the workflow's return value (and any downstream schema parse) sees clean
      // output. Structured thinking blocks are already dropped by
      // extractTextContent; this catches the text-literal variant.
      text: stripLiteralThinking(extractTextContent(result.content, '\n')),
      tokens: result.totalTokens,
      toolCalls: result.totalToolUseCount,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    }
  }

  return async function runOneAgent(
    prompt: string,
    opts: AgentCallOptions,
    meta: WorkflowRunOneAgentMeta,
  ): Promise<AgentRunResult> {
    if (opts.schema) {
      assertWorkflowAgentSchema(opts.schema)
    }

    const agentAbortController = abortController
      ? createChildAbortController(abortController)
      : undefined
    const unregisterAgentController = agentAbortController
      ? registerAgentController?.(meta.agentNumber, agentAbortController)
      : undefined
    if (opts.isolation === 'remote') {
      try {
        return await remoteAgentRunner(
          prompt,
          opts,
          meta,
          agentAbortController?.signal,
        )
      } catch (err) {
        if (agentAbortController?.signal.aborted) {
          if (
            agentAbortController.signal.reason ===
            WORKFLOW_AGENT_SKIP_ABORT_REASON
          ) {
            return {
              value: null,
              tokens: 0,
              toolCalls: 0,
              ok: false,
              status: 'skipped',
            }
          }
          if (
            agentAbortController.signal.reason ===
            WORKFLOW_AGENT_RETRY_ABORT_REASON
          ) {
            return {
              value: null,
              tokens: 0,
              toolCalls: 0,
              ok: false,
              status: 'retry_requested',
            }
          }
          if (
            agentAbortController.signal.reason ===
            WORKFLOW_AGENT_STALL_ABORT_REASON
          ) {
            return {
              value: null,
              tokens: 0,
              toolCalls: 0,
              ok: false,
              status: 'stalled',
              stallTimeoutMs: localAgentStallTimeoutMs ?? 0,
            }
          }
        }
        throw err
      } finally {
        unregisterAgentController?.()
      }
    }

    const agentDefinition = resolveAgentDefinition(toolUseContext, opts.agentType)
    const worktreeInfo =
      opts.isolation === 'worktree'
        ? await createAgentWorktree(
            workflowAgentWorktreeSlug(runId, meta.agentNumber),
          )
        : null
    const appState = toolUseContext.getAppState()
    const workerToolUseContext = workflowWorkerToolUseContext(toolUseContext)
    const workerAppState = workerToolUseContext.getAppState()
    const workerPermissionContext = {
      ...workerAppState.toolPermissionContext,
      mode: 'acceptEdits' as const,
    }
    const baseAvailableTools = assembleToolPool(
      workerPermissionContext,
      appState.mcp.tools,
    )
    const model = opts.model as ModelAlias | undefined

    try {
      // No schema → return the agent's final text verbatim.
      if (!opts.schema) {
        const { text, tokens, toolCalls } = await runOnce(
          agentDefinition,
          baseAvailableTools,
          workerToolUseContext,
          prompt,
          model,
          meta.label,
          worktreeInfo?.worktreePath,
          agentAbortController,
          meta.onProgress,
        )
        return { value: text, tokens, toolCalls, ok: true }
      }

      // Schema → require the StructuredOutput tool, then validate+retry on failure.
      // promptText carries the schema instruction (and, on retry, the rejection
      // feedback) — runOnce must receive promptText, not the bare prompt.
      const schemaAgentDefinition = withStructuredOutputAllowed(agentDefinition)
      const schemaTools = withStructuredOutputTool(
        baseAvailableTools,
        opts.schema,
      )
      let promptText = prompt + buildSchemaInstruction(opts.schema)
      let totalTokens = 0
      let totalToolCalls = 0
      let lastDetail = ''
      for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
        const { tokens, toolCalls, structuredOutput } = await runOnce(
          schemaAgentDefinition,
          schemaTools,
          workerToolUseContext,
          promptText,
          model,
          meta.label,
          worktreeInfo?.worktreePath,
          agentAbortController,
          meta.onProgress,
        )
        totalTokens += tokens
        totalToolCalls += toolCalls
        if (structuredOutput === undefined) {
          lastDetail = `the agent never called the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool`
        } else {
          const validation = validateAgainstSchema(structuredOutput, opts.schema)
          if (validation.ok) {
            return {
              value: validation.value,
              tokens: totalTokens,
              toolCalls: totalToolCalls,
              ok: true,
            }
          }
          lastDetail = formatIssues(validation.errors)
        }
        // Re-prompt with the specific failure so the model can correct itself.
        promptText =
          prompt +
          buildSchemaInstruction(opts.schema) +
          `\n\nYour previous response was rejected:\n${lastDetail}\n` +
          `Call ${SYNTHETIC_OUTPUT_TOOL_NAME} with corrected data only.`
      }
      if (
        lastDetail ===
        `the agent never called the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool`
      ) {
        throw new WorkflowSchemaError(formatMissingStructuredOutputAfterNudges())
      }
      throw new WorkflowSchemaError(meta.label, lastDetail)
    } catch (err) {
      if (agentAbortController?.signal.aborted) {
        if (agentAbortController.signal.reason === WORKFLOW_AGENT_SKIP_ABORT_REASON) {
          return {
            value: null,
            tokens: 0,
            toolCalls: 0,
            ok: false,
            status: 'skipped',
          }
        }
        if (agentAbortController.signal.reason === WORKFLOW_AGENT_RETRY_ABORT_REASON) {
          return {
            value: null,
            tokens: 0,
            toolCalls: 0,
            ok: false,
            status: 'retry_requested',
          }
        }
        if (agentAbortController.signal.reason === WORKFLOW_AGENT_STALL_ABORT_REASON) {
          return {
            value: null,
            tokens: 0,
            toolCalls: 0,
            ok: false,
            status: 'stalled',
            stallTimeoutMs: localAgentStallTimeoutMs ?? 0,
          }
        }
      }
      throw err
    } finally {
      unregisterAgentController?.()
      await cleanupWorkflowAgentWorktree(worktreeInfo)
    }
  }
}
