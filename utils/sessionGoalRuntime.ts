import { existsSync, readFileSync } from 'node:fs'
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
  launchActiveSessionGoalWorkflowAfterTurn,
  type SessionGoalPostTurnAction,
  waitForActiveSessionGoalWorkflowAfterTurn,
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
import { evaluateSessionGoalWorkflowPolicy } from './sessionGoalWorkflowPolicy.js'

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

function compactEvidenceList(value: unknown, maxItems = 3): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = compactTaskEvidence(item, 120)
    if (!text || out.includes(text)) continue
    out.push(text)
    if (out.length >= maxItems) break
  }
  return out
}

type WorkflowFinalReportSummary = {
  evidenceState?: unknown
  evidence?: unknown
  validationCommands?: unknown
  artifacts?: unknown
  failures?: unknown
  missingChecks?: unknown
  openQuestions?: unknown
  reportPath?: unknown
}

type WorkflowFinalReportEvidence = {
  positive?: string
  negative?: string
}

function workflowLabelForEvidence(candidate: {
  workflowName?: string
  workflowRunId?: string
  runId?: string
}, taskId: string): string {
  const runId = candidate.workflowRunId ?? candidate.runId ?? taskId
  return `Workflow ${candidate.workflowName ?? runId} (${runId})`
}

function loadWorkflowFinalReport(
  path: unknown,
): WorkflowFinalReportSummary | 'missing' | 'unreadable' | null {
  if (typeof path !== 'string' || !path.trim()) return null
  try {
    if (!existsSync(path)) return 'missing'
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as WorkflowFinalReportSummary
      : 'unreadable'
  } catch {
    return 'unreadable'
  }
}

function summarizeWorkflowFinalReportEvidence(
  taskId: string,
  candidate: {
    workflowName?: string
    workflowRunId?: string
    runId?: string
    finalReportPath?: string
  },
): WorkflowFinalReportEvidence | null {
  if (!candidate.finalReportPath) return null
  const label = workflowLabelForEvidence(candidate, taskId)
  const report = loadWorkflowFinalReport(candidate.finalReportPath)
  if (report === null) return null
  if (report === 'missing') {
    return {
      negative: `${label} needs verification: final report is missing at ${candidate.finalReportPath}`,
    }
  }
  if (report === 'unreadable') {
    return {
      negative: `${label} needs verification: final report is unreadable at ${candidate.finalReportPath}`,
    }
  }
  const evidence = compactEvidenceList(report.evidence)
  const validationCommands = compactEvidenceList(report.validationCommands)
  const artifacts = compactEvidenceList(report.artifacts)
  const failures = compactEvidenceList(report.failures)
  const missingChecks = compactEvidenceList(report.missingChecks)
  const openQuestions = compactEvidenceList(report.openQuestions)
  const explicitFacts = [
    evidence.length ? `evidence: ${evidence.join('; ')}` : null,
    validationCommands.length
      ? `validation: ${validationCommands.join('; ')}`
      : null,
    artifacts.length ? `artifact: ${artifacts.join('; ')}` : null,
  ].filter((part): part is string => part !== null)
  const reportPath =
    compactTaskEvidence(report.reportPath, 160) ?? candidate.finalReportPath
  if (report.evidenceState === 'verified' && explicitFacts.length > 0) {
    return {
      positive: [
        `${label} completed with verified final report`,
        ...explicitFacts,
        `report: ${reportPath}`,
      ].join('; '),
    }
  }
  const gaps = [
    failures.length ? `failures: ${failures.join('; ')}` : null,
    missingChecks.length ? `missing checks: ${missingChecks.join('; ')}` : null,
    openQuestions.length ? `open questions: ${openQuestions.join('; ')}` : null,
  ].filter((part): part is string => part !== null)
  let reason = 'final report has no explicit evidence'
  if (gaps.length) {
    reason = gaps.join('; ')
  } else if (report.evidenceState === 'failed') {
    reason = 'final report failed'
  }
  return {
    negative: `${label} needs verification: ${reason}; report: ${reportPath}`,
  }
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
      finalReportPath?: string
      failures?: string[]
      error?: string
      title?: string
      sessionId?: string
    }
    switch (candidate.type) {
      case 'local_workflow': {
        if (candidate.status === 'completed') {
          const reportEvidence = summarizeWorkflowFinalReportEvidence(
            taskId,
            candidate,
          )
          if (reportEvidence?.negative) evidence.push(reportEvidence.negative)
          break
        }
        if (candidate.status !== 'failed' && candidate.status !== 'killed') {
          break
        }
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
        if (candidate.status !== 'failed' && candidate.status !== 'killed') {
          break
        }
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
      finalReportPath?: string
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
    const reportEvidence = summarizeWorkflowFinalReportEvidence(taskId, candidate)
    if (reportEvidence) {
      if (reportEvidence.positive) evidence.push(reportEvidence.positive)
      continue
    }
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
  const initialGoal = getSessionGoalState()
  const initialWorkflowPolicy =
    initialGoal?.status === 'active'
      ? evaluateSessionGoalWorkflowPolicy(initialGoal, options.tasks)
      : null
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
  const currentGoal = getSessionGoalState()
  const workflowPolicy =
    !pendingReason && currentGoal?.status === 'active'
      ? evaluateSessionGoalWorkflowPolicy(currentGoal, options.tasks)
      : initialWorkflowPolicy
  let action: SessionGoalPostTurnAction
  if (pendingReason) {
    action = workflowPolicy?.type === 'wait_for_workflow'
      ? waitForActiveSessionGoalWorkflowAfterTurn(workflowPolicy.reason)
      : deferActiveSessionGoalAfterTurn(pendingReason)
  } else if (workflowPolicy?.type === 'launch_workflow') {
    action = launchActiveSessionGoalWorkflowAfterTurn(workflowPolicy)
  } else {
    action = await evaluateActiveSessionGoalAfterTurn(
      options.messages,
      options.signal,
    )
  }
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
  if (action.type !== 'continue' && action.type !== 'launch_workflow') return
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
