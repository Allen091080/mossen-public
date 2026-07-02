import type { TaskState } from '../tasks/types.js'
import type { Message } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'
import {
  getSessionGoalActualTokenUsage,
  getSessionGoalState,
  recordSessionGoalEvidence,
  recordSessionGoalNegativeEvidence,
} from '../bootstrap/state.js'
import {
  deferActiveSessionGoalAfterTurn,
  evaluateActiveSessionGoalAfterTurn,
  getSessionGoalPostTurnEvents,
  type SessionGoalPostTurnAction,
} from './sessionGoalEvaluator.js'
import {
  createSessionGoalEventMessage,
  type SessionGoalEvent,
  type SessionGoalEventMessage,
} from './sessionGoalEvents.js'
import { persistCurrentSessionGoalSnapshot } from './sessionGoalStore.js'
import {
  GOAL_CONTINUATION_ENQUEUED_METRIC,
  observeSessionGoalMetric,
} from './sessionGoalMetrics.js'
import { t } from './i18n/index.js'
import { logForDebugging } from './debug.js'
import { extractTextContent } from './messages.js'

export type SessionGoalRuntimeResult = {
  action: SessionGoalPostTurnAction
  events: SessionGoalEvent[]
  eventMessages: SessionGoalEventMessage[]
}

export type SessionGoalTaskBudget = {
  total: number
  remaining?: number
}

export function getSessionGoalTaskBudgetForRequest(
  workload: string | undefined,
): SessionGoalTaskBudget | undefined {
  if (workload !== 'goal') return undefined
  const goal = getSessionGoalState()
  if (
    !goal ||
    goal.status !== 'active' ||
    goal.tokenBudget === undefined ||
    goal.tokenBudget === null
  ) {
    return undefined
  }
  const actualTokensUsed = getSessionGoalActualTokenUsage(goal)
  return {
    total: goal.tokenBudget,
    ...(actualTokensUsed !== null
      ? { remaining: Math.max(0, goal.tokenBudget - actualTokensUsed) }
      : {}),
  }
}

function isActiveTaskStatus(status: unknown): boolean {
  return status === 'running' || status === 'pending' || status === 'paused'
}

function compactTaskEvidence(value: unknown, maxLength = 240): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]?.trim() || null
}

function isTaskNotificationMessage(message: Message): boolean {
  const origin = message.origin
  if (origin && typeof origin === 'object' && origin.kind === 'task-notification') {
    return true
  }
  return taskNotificationText(message).includes('<task-notification>')
}

function taskNotificationText(message: Message): string {
  const content = message?.message?.content ?? message?.content
  return extractTextContent(content, '\n').trim()
}

function workflowNotificationLabel(
  rawSummary: string | null,
  runId: string | null,
): string {
  const label = compactTaskEvidence(rawSummary ?? runId ?? 'local workflow', 120) ??
    'local workflow'
  const withoutPrefix = label.startsWith('Workflow ')
    ? label.slice('Workflow '.length).trim()
    : label
  return withoutPrefix.endsWith(' completed')
    ? withoutPrefix.slice(0, -' completed'.length).trim() || withoutPrefix
    : withoutPrefix
}

export function getSessionGoalTerminalNotificationEvidence(
  messages: Message[],
): {
  positive: string[]
  negative: string[]
} {
  const positive: string[] = []
  const negative: string[] = []
  for (const message of messages) {
    if (!isTaskNotificationMessage(message)) continue
    const text = taskNotificationText(message)
    if (
      !text.includes('<task-notification>') ||
      extractXmlTag(text, 'task-type') !== 'local_workflow'
    ) {
      continue
    }
    const status = extractXmlTag(text, 'status')
    if (status !== 'completed' && status !== 'failed' && status !== 'killed') {
      continue
    }
    const label = workflowNotificationLabel(
      extractXmlTag(text, 'summary'),
      extractXmlTag(text, 'task-id'),
    )
    const result = compactTaskEvidence(extractXmlTag(text, 'result'), 180)
    const artifact = compactTaskEvidence(extractXmlTag(text, 'output-file'), 120)
    if (status === 'completed') {
      positive.push(
        [
          `Workflow ${label} completed`,
          result ? `result: ${result}` : null,
          artifact ? `artifact: ${artifact}` : null,
        ].filter((part): part is string => part !== null).join('; '),
      )
      continue
    }
    const reason = compactTaskEvidence(extractXmlTag(text, 'reason'), 160) ??
      result ??
      'no failure detail captured'
    negative.push(`Workflow ${label} ended ${status}: ${reason}`)
  }
  return { positive, negative }
}

export function getSessionGoalTerminalWorkNegativeEvidence(
  tasks: Record<string, unknown> | undefined,
): string[] {
  if (!tasks) return []
  const evidence: string[] = []
  for (const [taskId, task] of Object.entries(tasks)) {
    const candidate = task as Partial<TaskState> & {
      workflowName?: string
      workflowRunId?: string
      runId?: string
      failures?: string[]
      error?: string
      title?: string
      sessionId?: string
    }
    if (candidate.status !== 'failed' && candidate.status !== 'killed') continue
    switch (candidate.type) {
      case 'local_workflow': {
        const runId = candidate.workflowRunId ?? candidate.runId ?? taskId
        const failures = (candidate.failures ?? [])
          .map(item => compactTaskEvidence(item, 160))
          .filter((item): item is string => item !== null)
        const detail = compactTaskEvidence(candidate.error) ??
          failures[0] ??
          'no failure detail captured'
        evidence.push(
          `Workflow ${candidate.workflowName ?? runId} (${runId}) ended ${candidate.status}: ${detail}`,
        )
        break
      }
      case 'local_agent':
      case 'remote_agent':
      case 'in_process_teammate': {
        const label = compactTaskEvidence(candidate.title) ??
          compactTaskEvidence(candidate.description) ??
          candidate.sessionId ??
          taskId
        const detail = compactTaskEvidence(candidate.error) ??
          'no failure detail captured'
        evidence.push(
          `Agent task ${label} (${taskId}) ended ${candidate.status}: ${detail}`,
        )
        break
      }
    }
  }
  return evidence
}

export function getSessionGoalTerminalWorkEvidence(
  tasks: Record<string, unknown> | undefined,
): string[] {
  if (!tasks) return []
  const evidence: string[] = []
  for (const [taskId, task] of Object.entries(tasks)) {
    const candidate = task as Partial<TaskState> & {
      workflowName?: string
      workflowRunId?: string
      runId?: string
      failures?: string[]
      error?: string
      result?: string
      scriptPath?: string
      transcriptDir?: string
      agentCount?: number
      totalToolCalls?: number
      tokensSpent?: number
    }
    if (candidate.type !== 'local_workflow' || candidate.status !== 'completed') {
      continue
    }
    if (candidate.error || candidate.failures?.length) continue
    const runId = candidate.workflowRunId ?? candidate.runId ?? taskId
    const parts = [
      `Workflow ${candidate.workflowName ?? runId} (${runId}) completed`,
      typeof candidate.agentCount === 'number'
        ? `${candidate.agentCount} agent(s)`
        : null,
      typeof candidate.totalToolCalls === 'number'
        ? `${candidate.totalToolCalls} tool call(s)`
        : null,
      typeof candidate.tokensSpent === 'number'
        ? `${candidate.tokensSpent} token(s)`
        : null,
    ].filter((part): part is string => part !== null)
    const result = compactTaskEvidence(candidate.result, 180)
    const path = compactTaskEvidence(candidate.scriptPath ?? candidate.transcriptDir, 120)
    evidence.push(
      [
        parts.join(', '),
        result ? `result: ${result}` : null,
        path ? `artifact: ${path}` : null,
      ].filter((part): part is string => part !== null).join('; '),
    )
  }
  return evidence
}

export function getSessionGoalPendingWorkReason(
  tasks: Record<string, unknown> | undefined,
): string | null {
  if (!tasks) return null
  for (const task of Object.values(tasks)) {
    const candidate = task as Partial<TaskState>
    if (!isActiveTaskStatus(candidate.status)) continue
    switch (candidate.type) {
      case 'local_bash':
        return t('cmd.goal.defer.backgroundShell')
      case 'local_agent':
      case 'remote_agent':
        return t('cmd.goal.defer.backgroundAgent')
      case 'in_process_teammate':
        return t('cmd.goal.defer.teammate')
      case 'local_workflow':
        return t('cmd.goal.defer.backgroundWorkflow')
      case 'monitor_mcp':
        return t('cmd.goal.defer.mcp')
      case 'dream':
        return t('cmd.goal.defer.backgroundTask')
    }
  }
  return null
}

export async function evaluateSessionGoalRuntimeAfterTurn(options: {
  messages: Message[]
  signal: AbortSignal
  tasks?: Record<string, unknown>
}): Promise<SessionGoalRuntimeResult> {
  const pendingReason = getSessionGoalPendingWorkReason(options.tasks)
  if (!pendingReason) {
    for (const evidence of getSessionGoalTerminalWorkEvidence(options.tasks)) {
      recordSessionGoalEvidence(evidence)
    }
    for (const evidence of getSessionGoalTerminalWorkNegativeEvidence(options.tasks)) {
      recordSessionGoalNegativeEvidence(evidence)
    }
    const notificationEvidence = getSessionGoalTerminalNotificationEvidence(
      options.messages,
    )
    for (const evidence of notificationEvidence.positive) {
      recordSessionGoalEvidence(evidence)
    }
    for (const evidence of notificationEvidence.negative) {
      recordSessionGoalNegativeEvidence(evidence)
    }
  }
  const action = pendingReason
    ? deferActiveSessionGoalAfterTurn(pendingReason)
    : await evaluateActiveSessionGoalAfterTurn(options.messages, options.signal)
  const events = getSessionGoalPostTurnEvents(action)
  if (action.type !== 'none') {
    const goal = getSessionGoalState()
    logForDebugging(
      `[goal] runtime action=${action.type} events=${events.length} turns=${goal?.turnCount ?? 0}`,
    )
    logMossenEvent('mossen.goal.runtime.action', {
      continue: action.type === 'continue',
      completed: action.type === 'completed',
      paused: action.type === 'paused',
      deferred: action.type === 'deferred',
      maxTurns: action.type === 'max_turns',
      error: action.type === 'error',
      eventCount: events.length,
      turnCount: goal?.turnCount ?? 0,
      active: goal?.status === 'active',
      blocked: goal?.status === 'blocked',
      budgetLimited: goal?.status === 'budget_limited',
    })
    persistCurrentSessionGoalSnapshot()
  }
  return {
    action,
    events,
    eventMessages: events.map(createSessionGoalEventMessage),
  }
}

export function isSessionGoalContinuationCommand(cmd: QueuedCommand): boolean {
  return cmd.workload === 'goal' &&
    cmd.isMeta === true &&
    typeof cmd.value === 'string' &&
    cmd.value.includes('<session-goal-continuation>')
}

export function enqueueSessionGoalContinuation(
  action: SessionGoalPostTurnAction,
  queue: {
    enqueue(command: QueuedCommand): void
    removeByFilter(predicate: (cmd: QueuedCommand) => boolean): void
    workload?: string
  },
): void {
  if (action.type !== 'continue') return
  queue.removeByFilter(isSessionGoalContinuationCommand)
  queue.enqueue({
    mode: 'prompt',
    value: action.prompt,
    isMeta: true,
    skipSlashCommands: true,
    priority: 'later',
    workload: queue.workload ?? 'goal',
  })
  observeSessionGoalMetric(GOAL_CONTINUATION_ENQUEUED_METRIC)
}
