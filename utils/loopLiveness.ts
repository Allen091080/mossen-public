import type { TaskStatus } from '../Task.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalWorkflowTaskState } from '../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { RemoteAgentTaskState, TaskState } from '../tasks/types.js'

export const DEFAULT_LOOP_STALE_AFTER_MS = 15 * 60 * 1000

export type LoopVerdict =
  | 'idle'
  | 'wait'
  | 'stale'
  | 'failed'
  | 'verify'
  | 'complete'

export type LoopWorkKind = 'workflow' | 'agent' | 'remote_agent'

export type LoopWorkStatus =
  | 'active'
  | 'paused'
  | 'stale'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'unverifiable'

export type LoopWorkIssue =
  | 'missing_controller'
  | 'stale_progress'
  | 'missing_recovery_artifact'
  | 'terminal_failure'
  | 'terminal_killed'
  | 'missing_terminal_evidence'

export type LoopWorkItem = {
  taskId: string
  kind: LoopWorkKind
  status: LoopWorkStatus
  label: string
  attachedToGoal: boolean
  goalId?: string | null
  runId?: string
  workflowName?: string
  parentWorkflowId?: string
  lastProgressAt?: number
  ageMs?: number
  issue?: LoopWorkIssue
  evidence: string[]
  nextAction: 'wait' | 'inspect' | 'verify' | 'resume' | 'review_failure' | 'none'
}

export type LoopRun = {
  goalId?: string
  verdict: LoopVerdict
  generatedAt: number
  works: LoopWorkItem[]
}

export type LoopLivenessReport = LoopRun & {
  counts: Record<LoopWorkStatus, number>
}

export type LoopLivenessOptions = {
  goalId?: string
  now?: number
  staleAfterMs?: number
  includeUnattached?: boolean
}

function isActiveStatus(status: TaskStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'paused'
}

function compact(value: unknown, maxChars = 120): string | undefined {
  if (value == null) return undefined
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  let max: number | undefined
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    max = max === undefined ? value : Math.max(max, value)
  }
  return max
}

function taskGoalId(task: Partial<LocalWorkflowTaskState | LocalAgentTaskState>): string | null {
  return typeof task.parentGoalId === 'string' && task.parentGoalId
    ? task.parentGoalId
    : null
}

function shouldIncludeTask(
  task: Partial<LocalWorkflowTaskState | LocalAgentTaskState>,
  options: Required<Pick<LoopLivenessOptions, 'includeUnattached'>> & {
    goalId?: string
  },
): boolean {
  if (!options.goalId) return true
  const parentGoalId = taskGoalId(task)
  return parentGoalId === options.goalId ||
    (options.includeUnattached && parentGoalId === null)
}

function classifyActiveTask(params: {
  status: TaskStatus
  hasCurrentController: boolean
  lastProgressAt?: number
  now: number
  staleAfterMs: number
  hasRecoveryArtifact: boolean
}): Pick<LoopWorkItem, 'status' | 'issue' | 'nextAction' | 'ageMs'> {
  if (params.status === 'paused') {
    return params.hasRecoveryArtifact
      ? { status: 'paused', nextAction: 'resume' }
      : {
          status: 'stale',
          issue: 'missing_recovery_artifact',
          nextAction: 'inspect',
        }
  }
  if (!params.hasCurrentController) {
    return {
      status: 'stale',
      issue: 'missing_controller',
      nextAction: 'inspect',
    }
  }
  const ageMs = params.lastProgressAt === undefined
    ? undefined
    : Math.max(0, params.now - params.lastProgressAt)
  if (ageMs !== undefined && ageMs >= params.staleAfterMs) {
    return {
      status: 'stale',
      issue: 'stale_progress',
      nextAction: 'inspect',
      ageMs,
    }
  }
  return { status: 'active', nextAction: 'wait', ageMs }
}

function classifyTerminalTask(
  task: Pick<TaskState, 'status'> & {
    error?: string
    failures?: string[]
    result?: string
  },
): Pick<LoopWorkItem, 'status' | 'issue' | 'nextAction'> {
  if (task.status === 'failed') {
    return {
      status: 'failed',
      issue: 'terminal_failure',
      nextAction: 'review_failure',
    }
  }
  if (task.status === 'killed') {
    return {
      status: 'killed',
      issue: 'terminal_killed',
      nextAction: 'review_failure',
    }
  }
  if (task.status === 'completed') {
    if (task.error || task.failures?.length) {
      return {
        status: 'failed',
        issue: 'terminal_failure',
        nextAction: 'review_failure',
      }
    }
    if (!compact(task.result)) {
      return {
        status: 'unverifiable',
        issue: 'missing_terminal_evidence',
        nextAction: 'verify',
      }
    }
    return { status: 'completed', nextAction: 'verify' }
  }
  return { status: 'unverifiable', nextAction: 'inspect' }
}

function workflowLastProgressAt(task: LocalWorkflowTaskState): number | undefined {
  return maxNumber([
    task.pauseStartedAt,
    ...task.agents.map(agent => agent.lastProgressAt),
    task.startTime,
  ])
}

function workflowEvidence(task: LocalWorkflowTaskState): string[] {
  return [
    compact(task.scriptPath),
    compact(task.transcriptDir),
    compact(task.outputFile),
    compact(task.result),
  ].filter((value): value is string => value !== undefined)
}

function workflowHasRecoveryArtifact(task: LocalWorkflowTaskState): boolean {
  return Boolean(task.scriptPath && (task.workflowRunId || task.runId))
}

function buildWorkflowItem(
  task: LocalWorkflowTaskState,
  options: Required<Pick<LoopLivenessOptions, 'now' | 'staleAfterMs'>>,
): LoopWorkItem {
  const lastProgressAt = workflowLastProgressAt(task)
  const status = isActiveStatus(task.status)
    ? classifyActiveTask({
        status: task.status,
        hasCurrentController: Boolean(task.abortController),
        lastProgressAt,
        now: options.now,
        staleAfterMs: options.staleAfterMs,
        hasRecoveryArtifact: workflowHasRecoveryArtifact(task),
      })
    : classifyTerminalTask(task)
  const goalId = taskGoalId(task)
  return {
    taskId: task.id,
    kind: 'workflow',
    label: task.title ?? task.workflowName ?? task.description,
    attachedToGoal: Boolean(goalId),
    goalId,
    runId: task.workflowRunId ?? task.runId,
    workflowName: task.workflowName,
    lastProgressAt,
    evidence: workflowEvidence(task),
    ...status,
  }
}

function buildLocalAgentItem(
  task: LocalAgentTaskState,
  options: Required<Pick<LoopLivenessOptions, 'now' | 'staleAfterMs'>>,
): LoopWorkItem {
  const lastProgressAt = task.startTime
  const resultText = task.result?.content
    ?.map(block => block.text)
    .join('\n')
  const status = isActiveStatus(task.status)
    ? classifyActiveTask({
        status: task.status,
        hasCurrentController: Boolean(task.abortController),
        lastProgressAt,
        now: options.now,
        staleAfterMs: options.staleAfterMs,
        hasRecoveryArtifact: Boolean(task.outputFile),
      })
    : classifyTerminalTask({
        status: task.status,
        error: task.error,
        result: compact(resultText),
      })
  const goalId = taskGoalId(task)
  return {
    taskId: task.id,
    kind: 'agent',
    label: task.agentType || task.description,
    attachedToGoal: Boolean(goalId),
    goalId,
    parentWorkflowId: task.parentWorkflowId,
    lastProgressAt,
    evidence: [compact(task.outputFile), compact(resultText)].filter(
      (value): value is string => value !== undefined,
    ),
    ...status,
  }
}

function buildRemoteAgentItem(
  task: RemoteAgentTaskState,
  options: Required<Pick<LoopLivenessOptions, 'now' | 'staleAfterMs'>>,
): LoopWorkItem {
  const lastProgressAt = task.pollStartedAt ?? task.startTime
  const status = isActiveStatus(task.status)
    ? classifyActiveTask({
        status: task.status,
        hasCurrentController: Boolean(task.sessionId || task.sessionUrl),
        lastProgressAt,
        now: options.now,
        staleAfterMs: options.staleAfterMs,
        hasRecoveryArtifact: Boolean(task.sessionId || task.sessionUrl),
      })
    : classifyTerminalTask(task)
  return {
    taskId: task.id,
    kind: 'remote_agent',
    label: task.title || task.description,
    attachedToGoal: false,
    runId: task.sessionId,
    lastProgressAt,
    evidence: [compact(task.sessionUrl), compact(task.outputFile)].filter(
      (value): value is string => value !== undefined,
    ),
    ...status,
  }
}

function reportVerdict(items: LoopWorkItem[]): LoopVerdict {
  if (items.length === 0) return 'idle'
  if (items.some(item => item.status === 'stale')) return 'stale'
  if (items.some(item => item.status === 'failed' || item.status === 'killed')) {
    return 'failed'
  }
  if (items.some(item => item.status === 'active' || item.status === 'paused')) {
    return 'wait'
  }
  if (items.some(item => item.status === 'unverifiable')) return 'verify'
  return 'complete'
}

function emptyCounts(): Record<LoopWorkStatus, number> {
  return {
    active: 0,
    paused: 0,
    stale: 0,
    completed: 0,
    failed: 0,
    killed: 0,
    unverifiable: 0,
  }
}

export function buildLoopLivenessReport(
  tasks: Record<string, unknown> | undefined | null,
  options: LoopLivenessOptions = {},
): LoopLivenessReport {
  const now = options.now ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOOP_STALE_AFTER_MS
  const includeUnattached = options.includeUnattached ?? false
  const items: LoopWorkItem[] = []
  for (const value of Object.values(tasks ?? {})) {
    const task = value as Partial<TaskState> | undefined
    if (!task || typeof task !== 'object') continue
    if (
      task.type === 'local_workflow' &&
      shouldIncludeTask(task, { goalId: options.goalId, includeUnattached })
    ) {
      items.push(buildWorkflowItem(task as LocalWorkflowTaskState, {
        now,
        staleAfterMs,
      }))
      continue
    }
    if (
      task.type === 'local_agent' &&
      (task as Partial<LocalAgentTaskState>).parentWorkflowId &&
      shouldIncludeTask(task as Partial<LocalAgentTaskState>, {
        goalId: options.goalId,
        includeUnattached,
      })
    ) {
      items.push(buildLocalAgentItem(task as LocalAgentTaskState, {
        now,
        staleAfterMs,
      }))
      continue
    }
    if (
      task.type === 'remote_agent' &&
      (task as Partial<RemoteAgentTaskState>).remoteTaskType === 'remote-workflow' &&
      includeUnattached
    ) {
      items.push(buildRemoteAgentItem(task as RemoteAgentTaskState, {
        now,
        staleAfterMs,
      }))
    }
  }
  const counts = emptyCounts()
  for (const item of items) counts[item.status] += 1
  return {
    goalId: options.goalId,
    verdict: reportVerdict(items),
    generatedAt: now,
    works: items,
    counts,
  }
}
