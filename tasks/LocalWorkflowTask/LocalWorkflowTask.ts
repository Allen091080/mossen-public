import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { SetAppState, TaskStateBase, TaskStatus } from '../../Task.js'
import { createTaskStateBase } from '../../Task.js'
import type { SdkWorkflowProgress } from '../../types/tools.js'
import {
  WORKFLOW_AGENT_RETRY_ABORT_REASON,
  WORKFLOW_AGENT_SKIP_ABORT_REASON,
  type WorkflowAgentControlAction,
  type WorkflowPhaseMeta,
  type WorkflowProgressEvent,
  type WorkflowRecentToolCall,
} from '../../tools/WorkflowTool/engine/types.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import {
  appendTaskOutput,
  evictTaskOutput,
  getTaskOutputPath,
  initTaskOutput,
} from '../../utils/task/diskOutput.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { emitTaskProgress } from '../../utils/task/sdkProgress.js'

export type WorkflowAgentTaskProgress = {
  agentNumber: number
  label: string
  phase: string | null
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'retry_requested'
    | 'cached'
  tokens: number
  toolCalls: number
  durationMs?: number
  agentType?: string
  model?: string
  isolation?: 'worktree' | 'remote'
  promptPreview?: string
  queuedAt?: number
  startedAt?: number
  lastProgressAt?: number
  remoteSessionId?: string
  lastAttemptReason?: string
  lastToolName?: string
  lastToolSummary?: string
  recentToolCalls?: WorkflowRecentToolCall[]
  resultPreview?: string
  error?: string
}

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  runId: string
  workflowRunId: string
  workflowName: string
  script?: string
  prompt?: string
  scriptPath?: string
  args?: unknown
  title?: string
  phaseDefinitions?: WorkflowPhaseMeta[]
  transcriptDir?: string
  summary?: string
  defaultModel?: string
  isBackgrounded: true
  abortController?: AbortController
  agentCount: number
  totalToolCalls: number
  tokensSpent: number
  failures?: string[]
  durationMs?: number
  currentPhase?: string
  phases: string[]
  workflowProgress: SdkWorkflowProgress[]
  progressVersion: number
  agents: WorkflowAgentTaskProgress[]
  log: string[]
  logs: string[]
  paused?: boolean
  pauseStartedAt?: number
  error?: string
}

const controlRequests = new Map<
  string,
  Map<number, WorkflowAgentControlAction>
>()

const agentControllers = new Map<string, Map<number, AbortController>>()
const pausedWorkflowTasks = new Map<string, { startedAt: number }>()
const pauseWaiters = new Map<
  string,
  Set<{
    resolve: () => void
    reject: (err: Error) => void
    cleanup: () => void
  }>
>()

const MAX_TASK_LOG_LINES = 200
export const WORKFLOW_PAUSE_ABORT_REASON = 'workflow_paused'

type WorkflowTaskFinishPatch = {
  agentCount?: number
  totalToolCalls?: number
  tokensSpent?: number
  failures?: string[]
  durationMs?: number
  error?: string
}

type TaskLike = {
  type?: string
  status?: string
}

export function isPendingWorkflowTask(
  task: unknown,
): task is LocalWorkflowTaskState {
  const candidate = task as TaskLike | null | undefined
  return (
    candidate?.type === 'local_workflow' &&
    (candidate.status === 'pending' || candidate.status === 'running')
  )
}

export function pendingWorkflowCount(
  tasks: Record<string, unknown> | null | undefined,
): number {
  if (!tasks) return 0
  let count = 0
  for (const task of Object.values(tasks)) {
    if (isPendingWorkflowTask(task)) count++
  }
  return count
}

export function hasPendingWorkflows(
  tasks: Record<string, unknown> | null | undefined,
): boolean {
  if (!tasks) return false
  return Object.values(tasks).some(isPendingWorkflowTask)
}

function appendLogLine(taskId: string, line: string): void {
  appendTaskOutput(taskId, `${line}\n`)
}

function formatWorkflowArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args)
    return json === undefined ? String(args) : json
  } catch {
    return String(args)
  }
}

type WorkflowResumePromptSource = {
  scriptPath?: string
  runId?: string
  workflowRunId?: string
  args?: unknown
}

export function buildWorkflowResumePrompt(
  task: WorkflowResumePromptSource,
): string | null {
  const workflowRunId = task.workflowRunId ?? task.runId
  if (!task.scriptPath || !workflowRunId) return null
  const args = task.args !== undefined ? `, args: ${formatWorkflowArgs(task.args)}` : ''
  return `Resume the workflow run by calling: Workflow({scriptPath: '${task.scriptPath}', resumeFromRunId: '${workflowRunId}'${args}}) — completed agents return cached results.`
}

function buildWorkflowRecoveryPrompt(
  task: LocalWorkflowTaskState,
): string | null {
  if (!task.scriptPath || !task.runId) return null
  const args = task.args !== undefined ? `, args: ${formatWorkflowArgs(task.args)}` : ''
  return `To resume after editing the script, call: Workflow({scriptPath: '${task.scriptPath}', resumeFromRunId: '${task.runId}'${args}})`
}

function releasePauseWaiters(taskId: string, err?: Error): void {
  const waiters = pauseWaiters.get(taskId)
  if (!waiters) return
  pauseWaiters.delete(taskId)
  for (const waiter of waiters) {
    waiter.cleanup()
    if (err) waiter.reject(err)
    else waiter.resolve()
  }
}

function progressLine(event: WorkflowProgressEvent): string {
  switch (event.kind) {
    case 'phase':
      return `phase: ${event.title}`
    case 'log':
      return event.message
    case 'agent_queued':
      return `agent #${event.agentNumber} queued: ${event.label}`
    case 'agent_start':
      return `agent #${event.agentNumber} started: ${event.label}`
    case 'agent_progress': {
      const detail = event.lastToolSummary ?? event.lastToolName
        ?? event.recentToolCalls?.at(-1)?.summary
        ?? event.recentToolCalls?.at(-1)?.name
      return detail
        ? `agent #${event.agentNumber} progress: ${event.label} (${detail})`
        : `agent #${event.agentNumber} progress: ${event.label}`
    }
    case 'agent_end': {
      const status =
        event.status ?? (event.ok ? 'completed' : 'failed')
      return `agent #${event.agentNumber} ${status}: ${event.label} (${event.tokens} tokens)`
    }
  }
}

function nextLogState(
  task: LocalWorkflowTaskState,
  line: string,
): Pick<LocalWorkflowTaskState, 'log' | 'logs'> {
  const prior = task.logs ?? task.log
  const next = [...prior, line].slice(-MAX_TASK_LOG_LINES)
  return { log: next, logs: next }
}

function setWorkflowAgent(
  agents: WorkflowAgentTaskProgress[],
  next: WorkflowAgentTaskProgress,
): WorkflowAgentTaskProgress[] {
  const index = agents.findIndex(
    agent => agent.agentNumber === next.agentNumber,
  )
  if (index === -1) return [...agents, next]
  return agents.map(agent =>
    agent.agentNumber === next.agentNumber ? { ...agent, ...next } : agent,
  )
}

function phaseIndexFor(
  task: LocalWorkflowTaskState,
  phase: string | null,
): number | undefined {
  if (!phase) return undefined
  const index = task.phases.indexOf(phase)
  return index >= 0 ? index + 1 : undefined
}

function seedPhaseTitles(
  phaseDefinitions: WorkflowPhaseMeta[] | undefined,
): string[] {
  const titles: string[] = []
  for (const phase of phaseDefinitions ?? []) {
    const title = phase.title.trim()
    if (title && !titles.includes(title)) titles.push(title)
  }
  return titles
}

function workflowPhaseProgressForTitles(
  phases: readonly string[],
): SdkWorkflowProgress[] {
  return phases.map((title, index) => ({
    type: 'workflow_phase',
    index: index + 1,
    title,
    state: 'start',
  }))
}

function hasWorkflowPhaseProgress(
  task: LocalWorkflowTaskState,
  title: string,
): boolean {
  return task.workflowProgress.some(
    progress => progress?.type === 'workflow_phase' && progress.title === title,
  )
}

function workflowProgressForSdk(
  event: WorkflowProgressEvent,
  task: LocalWorkflowTaskState,
): SdkWorkflowProgress[] | undefined {
  switch (event.kind) {
    case 'phase':
      if (hasWorkflowPhaseProgress(task, event.title)) return undefined
      return [
        {
          type: 'workflow_phase',
          index: phaseIndexFor(task, event.title) ?? task.phases.length,
          title: event.title,
          state: 'start',
        },
      ]
    case 'log':
      return undefined
    case 'agent_queued':
      return [
        {
          type: 'workflow_agent',
          index: event.agentNumber,
          label: event.label,
          phaseTitle: event.phase,
          phaseIndex: phaseIndexFor(task, event.phase),
          state: 'start',
          ...workflowAgentProgressMetadata(event),
        },
      ]
    case 'agent_start':
      return [
        {
          type: 'workflow_agent',
          index: event.agentNumber,
          label: event.label,
          phaseTitle: event.phase,
          phaseIndex: phaseIndexFor(task, event.phase),
          state: 'start',
          ...workflowAgentProgressMetadata(event),
        },
      ]
    case 'agent_progress':
      return [
        {
          type: 'workflow_agent',
          index: event.agentNumber,
          label: event.label,
          phaseTitle: event.phase,
          phaseIndex: phaseIndexFor(task, event.phase),
          state: 'progress',
          ...(typeof event.tokens === 'number' ? { tokens: event.tokens } : {}),
          ...(typeof event.toolCalls === 'number'
            ? { toolCalls: event.toolCalls }
            : {}),
          ...workflowAgentProgressMetadata(event),
        },
      ]
    case 'agent_end':
      return [
        {
          type: 'workflow_agent',
          index: event.agentNumber,
          label: event.label,
          phaseTitle: event.phase,
          phaseIndex: phaseIndexFor(task, event.phase),
          state: workflowAgentSdkState(event),
          tokens: event.tokens,
          toolCalls: event.toolCalls ?? 0,
          ...workflowAgentProgressMetadata(event),
          ...workflowAgentSdkStatusMetadata(event),
          ...(event.durationMs !== undefined
            ? { durationMs: event.durationMs }
            : {}),
        },
      ]
  }
}

function workflowAgentProgressMetadata(
  event: Extract<
    WorkflowProgressEvent,
    { kind: 'agent_queued' | 'agent_start' | 'agent_progress' | 'agent_end' }
  >,
  ): Record<string, unknown> {
  return {
    ...(event.agentType ? { agentType: event.agentType } : {}),
    ...(event.model ? { model: event.model } : {}),
    ...(event.isolation ? { isolation: event.isolation } : {}),
    ...(event.promptPreview ? { promptPreview: event.promptPreview } : {}),
    ...(typeof event.queuedAt === 'number' ? { queuedAt: event.queuedAt } : {}),
    ...(typeof event.startedAt === 'number' ? { startedAt: event.startedAt } : {}),
    ...(typeof event.lastProgressAt === 'number'
      ? { lastProgressAt: event.lastProgressAt }
      : {}),
    ...(event.remoteSessionId ? { remoteSessionId: event.remoteSessionId } : {}),
    ...(event.lastAttemptReason
      ? { lastAttemptReason: event.lastAttemptReason }
      : {}),
    ...(event.lastToolName ? { lastToolName: event.lastToolName } : {}),
    ...(event.lastToolSummary ? { lastToolSummary: event.lastToolSummary } : {}),
    ...(event.recentToolCalls?.length
      ? { recentToolCalls: event.recentToolCalls }
      : {}),
    ...(event.resultPreview ? { resultPreview: event.resultPreview } : {}),
  }
  }

function workflowAgentSdkState(
  event: Extract<WorkflowProgressEvent, { kind: 'agent_end' }>,
): 'done' | 'error' {
  if (event.status === 'skipped' || event.status === 'failed' || !event.ok) {
    return 'error'
  }
  return 'done'
}

function workflowAgentSdkStatusMetadata(
  event: Extract<WorkflowProgressEvent, { kind: 'agent_end' }>,
): Record<string, unknown> {
  if (event.status === 'cached') return { cached: true }
  if (event.status === 'skipped') {
    return {
      skipped: true,
      error: event.error ?? 'skipped by user',
    }
  }
  if (event.status === 'failed' || !event.ok) {
    return { error: event.error ?? 'failed' }
  }
  return {}
}

function applyWorkflowProgress(
  task: LocalWorkflowTaskState,
  event: WorkflowProgressEvent,
): {
  task: LocalWorkflowTaskState
  workflowProgress?: SdkWorkflowProgress[]
} {
  const workflowProgress = workflowProgressForSdk(event, task)
  if (!workflowProgress?.length) return { task }
  return {
    task: {
      ...task,
      workflowProgress: [...task.workflowProgress, ...workflowProgress],
      progressVersion: task.progressVersion + 1,
    },
    workflowProgress,
  }
}

function emitWorkflowTaskProgress(
  task: LocalWorkflowTaskState,
  event: WorkflowProgressEvent,
  workflowProgress?: SdkWorkflowProgress[],
): void {
  emitTaskProgress({
    taskId: task.id,
    toolUseId: task.toolUseId,
    description: task.description,
    startTime: task.startTime,
    totalTokens: task.tokensSpent,
    toolUses: task.totalToolCalls,
    summary: task.summary,
    workflowProgress: workflowProgress ?? workflowProgressForSdk(event, task),
  })
}

function enqueueWorkflowNotification(
  task: LocalWorkflowTaskState,
  status: 'completed' | 'failed' | 'killed',
): void {
  const summary =
    status === 'completed'
      ? `Workflow "${task.workflowName}" completed`
      : status === 'killed'
        ? `Workflow "${task.workflowName}" was stopped`
        : `Workflow "${task.workflowName}" failed${task.error ? `: ${task.error}` : ''}`
  const toolUseIdLine = task.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${task.toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  const usage = `\n<usage><total_tokens>${task.tokensSpent}</total_tokens><tool_uses>${task.totalToolCalls}</tool_uses></usage>`
  const reason = task.error ? `\n<reason>${task.error}</reason>` : ''
  const recoveryItems =
    status === 'failed' || status === 'killed'
      ? [
          buildWorkflowRecoveryPrompt(task),
          task.transcriptDir ? `Agent transcripts: ${task.transcriptDir}` : null,
        ].filter((item): item is string => Boolean(item))
      : []
  const recovery =
    recoveryItems.length > 0
      ? `\n<recovery>${recoveryItems.join('\n')}</recovery>`
      : ''
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${task.id}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>${task.type}</${TASK_TYPE_TAG}>
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(task.id)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>${reason}${usage}${recovery}
</${TASK_NOTIFICATION_TAG}>`
  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

export function registerWorkflowTask(params: {
  taskId?: string
  runId: string
  workflowRunId?: string
  workflowName: string
  description: string
  script?: string
  scriptPath?: string
  args?: unknown
  title?: string
  phaseDefinitions?: WorkflowPhaseMeta[]
  transcriptDir?: string
  defaultModel?: string
  toolUseId?: string
  abortController: AbortController
  setAppState: SetAppState
}): void {
  const taskId = params.taskId ?? params.runId
  const workflowRunId = params.workflowRunId ?? params.runId
  const base = createTaskStateBase(
    taskId,
    'local_workflow',
    params.description,
    params.toolUseId,
  )
  const seededPhases = seedPhaseTitles(params.phaseDefinitions)
  const seededWorkflowProgress = workflowPhaseProgressForTitles(seededPhases)
  const task: LocalWorkflowTaskState = {
    ...base,
    type: 'local_workflow',
    status: 'running',
    runId: workflowRunId,
    workflowRunId,
    workflowName: params.workflowName,
    script: params.script,
    prompt: params.script,
    scriptPath: params.scriptPath,
    args: params.args,
    title: params.title,
    phaseDefinitions: params.phaseDefinitions,
    transcriptDir: params.transcriptDir,
    summary: params.workflowName,
    defaultModel: params.defaultModel,
    isBackgrounded: true,
    abortController: params.abortController,
    agentCount: 0,
    totalToolCalls: 0,
    tokensSpent: 0,
    phases: seededPhases,
    workflowProgress: seededWorkflowProgress,
    progressVersion: seededWorkflowProgress.length,
    agents: [],
    log: [],
    logs: [],
    paused: false,
  }
  pausedWorkflowTasks.delete(taskId)
  releasePauseWaiters(taskId)
  void initTaskOutput(taskId)
  appendLogLine(taskId, `workflow started: ${params.workflowName}`)
  registerTask(task, params.setAppState)
  if (seededWorkflowProgress.length > 0) {
    emitTaskProgress({
      taskId,
      toolUseId: task.toolUseId,
      description: task.description,
      startTime: task.startTime,
      totalTokens: task.tokensSpent,
      toolUses: task.totalToolCalls,
      summary: task.summary,
      workflowProgress: seededWorkflowProgress,
    })
  }
}

export function updateWorkflowTaskProgress(
  runId: string,
  event: WorkflowProgressEvent,
  setAppState: SetAppState,
): void {
  const line = progressLine(event)
  appendLogLine(runId, line)
  let taskForSdkProgress: LocalWorkflowTaskState | null = null
  let workflowProgressForEvent: SdkWorkflowProgress[] | undefined
  updateTaskState<LocalWorkflowTaskState>(runId, setAppState, task => {
    if (task.status !== 'running') return task
    const logState = nextLogState(task, line)
    switch (event.kind) {
      case 'phase': {
        const progressed = applyWorkflowProgress({
          ...task,
          currentPhase: event.title,
          phases: task.phases.includes(event.title)
            ? task.phases
            : [...task.phases, event.title],
          summary: event.title,
          ...logState,
        }, event)
        workflowProgressForEvent = progressed.workflowProgress
        taskForSdkProgress = progressed.task
        return progressed.task
      }
      case 'log': {
        const next = { ...task, summary: event.message, ...logState }
        taskForSdkProgress = next
        return next
      }
        case 'agent_queued': {
          const progressed = applyWorkflowProgress({
            ...task,
            agentCount: Math.max(task.agentCount, event.agentNumber),
          agents: setWorkflowAgent(task.agents, {
            agentNumber: event.agentNumber,
            label: event.label,
            phase: event.phase,
            status: 'queued',
            tokens: 0,
            toolCalls: 0,
            ...workflowAgentProgressMetadata(event),
          }),
          summary: `${event.label} queued`,
          ...logState,
        }, event)
        workflowProgressForEvent = progressed.workflowProgress
        taskForSdkProgress = progressed.task
        return progressed.task
      }
      case 'agent_start': {
        const progressed = applyWorkflowProgress({
          ...task,
          agentCount: Math.max(task.agentCount, event.agentNumber),
          agents: setWorkflowAgent(task.agents, {
            agentNumber: event.agentNumber,
            label: event.label,
            phase: event.phase,
            status: 'running',
            tokens: 0,
            toolCalls: 0,
            ...workflowAgentProgressMetadata(event),
          }),
          summary: event.label,
          ...logState,
        }, event)
        workflowProgressForEvent = progressed.workflowProgress
        taskForSdkProgress = progressed.task
        return progressed.task
      }
      case 'agent_progress': {
        const prior = task.agents.find(
          agent => agent.agentNumber === event.agentNumber,
        )
        const tokens = event.tokens ?? prior?.tokens ?? 0
        const toolCalls = event.toolCalls ?? prior?.toolCalls ?? 0
        const progressed = applyWorkflowProgress({
          ...task,
          agentCount: Math.max(task.agentCount, event.agentNumber),
          agents: setWorkflowAgent(task.agents, {
            agentNumber: event.agentNumber,
            label: event.label,
            phase: event.phase,
            status: 'running',
            tokens,
            toolCalls,
            ...workflowAgentProgressMetadata(event),
          }),
          summary:
            event.lastToolSummary ??
            event.lastToolName ??
            event.recentToolCalls?.at(-1)?.summary ??
            event.recentToolCalls?.at(-1)?.name ??
            event.label,
          ...logState,
        }, event)
        workflowProgressForEvent = progressed.workflowProgress
        taskForSdkProgress = progressed.task
        return progressed.task
      }
      case 'agent_end': {
        const status =
          event.status ?? (event.ok ? 'completed' : 'failed')
        const toolCalls = event.toolCalls ?? 0
        const progressed = applyWorkflowProgress({
        ...task,
        tokensSpent: task.tokensSpent + event.tokens,
        totalToolCalls: task.totalToolCalls + toolCalls,
        agents: setWorkflowAgent(task.agents, {
          agentNumber: event.agentNumber,
          label: event.label,
          phase: event.phase,
          status,
          tokens: event.tokens,
          toolCalls,
          ...workflowAgentProgressMetadata(event),
          ...(event.error ? { error: event.error } : {}),
          ...(event.durationMs !== undefined
            ? { durationMs: event.durationMs }
            : {}),
        }),
        summary: `${event.label} ${status}`,
        ...logState,
      }, event)
      workflowProgressForEvent = progressed.workflowProgress
      taskForSdkProgress = progressed.task
      return progressed.task
    }
    }
  })
  if (taskForSdkProgress) {
    emitWorkflowTaskProgress(taskForSdkProgress, event, workflowProgressForEvent)
  }
}

export function finishWorkflowTask(
  taskId: string,
  status: Extract<TaskStatus, 'completed' | 'failed' | 'killed'>,
  setAppState: SetAppState,
  patch: WorkflowTaskFinishPatch = {},
): void {
  let taskForNotification: LocalWorkflowTaskState | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.notified && task.status !== 'paused') return task
    const next: LocalWorkflowTaskState = {
      ...task,
      ...patch,
      status,
      endTime: Date.now(),
      abortController: undefined,
      notified: true,
      paused: false,
      pauseStartedAt: undefined,
      summary:
        status === 'completed'
          ? 'completed'
          : status === 'killed'
            ? 'stopped'
            : patch.error ?? task.error ?? 'failed',
    }
    taskForNotification = next
    return next
  })
  if (taskForNotification) {
    appendLogLine(taskId, `workflow ${status}`)
    enqueueWorkflowNotification(taskForNotification, status)
    void evictTaskOutput(taskId)
  }
  pausedWorkflowTasks.delete(taskId)
  releasePauseWaiters(taskId, new Error(`workflow task ${status}`))
  controlRequests.delete(taskId)
  agentControllers.delete(taskId)
}

export function completeWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  patch: Omit<WorkflowTaskFinishPatch, 'error'> = {},
): void {
  finishWorkflowTask(taskId, 'completed', setAppState, patch)
}

export function failWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  patch: WorkflowTaskFinishPatch = {},
): void {
  finishWorkflowTask(taskId, 'failed', setAppState, patch)
}

export function isWorkflowTaskPaused(taskId: string): boolean {
  return pausedWorkflowTasks.has(taskId)
}

export function waitForWorkflowTaskResume(
  taskId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!isWorkflowTaskPaused(taskId)) return Promise.resolve()
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error(String(signal.reason ?? 'workflow aborted')),
    )
  }
  return new Promise<void>((resolve, reject) => {
    const waiterSet = pauseWaiters.get(taskId) ?? new Set()
    let waiter: {
      resolve: () => void
      reject: (err: Error) => void
      cleanup: () => void
    }
    const onAbort = () => {
      waiterSet.delete(waiter)
      if (waiterSet.size === 0) pauseWaiters.delete(taskId)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error(String(signal?.reason ?? 'workflow aborted')),
      )
    }
    waiter = {
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    }
    waiterSet.add(waiter)
    pauseWaiters.set(taskId, waiterSet)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function pauseWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  const now = Date.now()
  const line = 'workflow paused'
  let paused = false
  let controller: AbortController | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' || task.paused) return task
    controller = task.abortController
    paused = true
    return {
      ...task,
      status: 'paused',
      endTime: now,
      notified: true,
      paused: true,
      pauseStartedAt: now,
      summary: 'paused',
      abortController: undefined,
      ...nextLogState(task, line),
    }
  })
  if (!paused) return false
  pausedWorkflowTasks.set(taskId, { startedAt: now })
  appendLogLine(taskId, line)
  controller?.abort(WORKFLOW_PAUSE_ABORT_REASON)
  releasePauseWaiters(taskId, new Error('workflow task paused'))
  controlRequests.delete(taskId)
  agentControllers.delete(taskId)
  return true
}

export function resumeWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  const now = Date.now()
  const line = 'workflow resumed'
  let resumed = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' || !task.paused) return task
    const startedAt =
      task.pauseStartedAt ?? pausedWorkflowTasks.get(taskId)?.startedAt ?? now
    const pausedFor = Math.max(0, now - startedAt)
    resumed = true
    return {
      ...task,
      paused: false,
      pauseStartedAt: undefined,
      totalPausedMs: (task.totalPausedMs ?? 0) + pausedFor,
      summary: 'resumed',
      ...nextLogState(task, line),
    }
  })
  if (!resumed) return false
  pausedWorkflowTasks.delete(taskId)
  appendLogLine(taskId, line)
  releasePauseWaiters(taskId)
  return true
}

export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let controller: AbortController | undefined
  let killed = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' && task.status !== 'paused') return task
    controller = task.abortController
    killed = true
    return task
  })
  if (!killed) return
  controller?.abort('workflow_killed')
  finishWorkflowTask(taskId, 'killed', setAppState)
}

function parseAgentNumber(agentId: string | number): number | null {
  const parsed =
    typeof agentId === 'number' ? agentId : Number.parseInt(agentId, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function rememberControl(
  taskId: string,
  agentNumber: number,
  action: WorkflowAgentControlAction,
): void {
  const perTask = controlRequests.get(taskId) ?? new Map()
  perTask.set(agentNumber, action)
  controlRequests.set(taskId, perTask)
}

export function consumeWorkflowAgentControl(
  taskId: string,
  agentNumber: number,
): WorkflowAgentControlAction | null {
  const perTask = controlRequests.get(taskId)
  const action = perTask?.get(agentNumber) ?? null
  if (action) {
    perTask!.delete(agentNumber)
    if (perTask!.size === 0) controlRequests.delete(taskId)
  }
  return action
}

export function consumeWorkflowAgentSkip(
  taskId: string,
  agentNumber: number,
): boolean {
  const perTask = controlRequests.get(taskId)
  if (perTask?.get(agentNumber) !== 'skip') return false
  perTask.delete(agentNumber)
  if (perTask.size === 0) controlRequests.delete(taskId)
  return true
}

export function registerWorkflowAgentController(
  taskId: string,
  agentNumber: number,
  controller: AbortController,
): () => void {
  const perTask = agentControllers.get(taskId) ?? new Map()
  perTask.set(agentNumber, controller)
  agentControllers.set(taskId, perTask)
  return () => {
    const current = agentControllers.get(taskId)
    if (current?.get(agentNumber) === controller) {
      current.delete(agentNumber)
      if (current.size === 0) agentControllers.delete(taskId)
    }
  }
}

function abortWorkflowAgent(
  taskId: string,
  agentNumber: number,
  reason: string,
): boolean {
  const controller = agentControllers.get(taskId)?.get(agentNumber)
  if (!controller || controller.signal.aborted) return false
  controller.abort(reason)
  return true
}

export function skipWorkflowAgent(
  taskId: string,
  agentId: string | number,
  setAppState: SetAppState,
): void {
  const agentNumber = parseAgentNumber(agentId)
  if (!agentNumber) return
  const aborted = abortWorkflowAgent(
    taskId,
    agentNumber,
    WORKFLOW_AGENT_SKIP_ABORT_REASON,
  )
  if (!aborted) rememberControl(taskId, agentNumber, 'skip')
  const line = `skip requested for agent #${agentNumber}`
  appendLogLine(taskId, line)
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => ({
    ...task,
    agents: task.agents.map(agent =>
      agent.agentNumber === agentNumber && agent.status === 'running'
        ? { ...agent, status: 'skipped' }
        : agent,
    ),
    ...nextLogState(task, line),
    summary: `skip requested for agent #${agentNumber}`,
  }))
}

export function retryWorkflowAgent(
  taskId: string,
  agentId: string | number,
  setAppState: SetAppState,
): void {
  const agentNumber = parseAgentNumber(agentId)
  if (!agentNumber) return
  const aborted = abortWorkflowAgent(
    taskId,
    agentNumber,
    WORKFLOW_AGENT_RETRY_ABORT_REASON,
  )
  if (!aborted) rememberControl(taskId, agentNumber, 'retry')
  const line = `retry requested for agent #${agentNumber}`
  appendLogLine(taskId, line)
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => ({
    ...task,
    agents: task.agents.map(agent =>
      agent.agentNumber === agentNumber
        ? { ...agent, status: 'retry_requested' }
        : agent,
    ),
    ...nextLogState(task, line),
    summary: `retry requested for agent #${agentNumber}`,
  }))
}
