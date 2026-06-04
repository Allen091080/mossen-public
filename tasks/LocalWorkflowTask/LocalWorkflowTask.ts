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
import {
  WORKFLOW_AGENT_RETRY_ABORT_REASON,
  WORKFLOW_AGENT_SKIP_ABORT_REASON,
  type WorkflowAgentControlAction,
  type WorkflowProgressEvent,
} from '../../tools/WorkflowTool/engine/types.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import {
  appendTaskOutput,
  evictTaskOutput,
  getTaskOutputPath,
  initTaskOutput,
} from '../../utils/task/diskOutput.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'

export type WorkflowAgentTaskProgress = {
  agentNumber: number
  label: string
  phase: string | null
  status: 'running' | 'completed' | 'failed' | 'skipped' | 'retry_requested'
  tokens: number
}

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  runId: string
  workflowName: string
  summary?: string
  isBackgrounded: true
  abortController?: AbortController
  agentCount: number
  tokensSpent: number
  currentPhase?: string
  phases: string[]
  agents: WorkflowAgentTaskProgress[]
  log: string[]
  error?: string
}

const controlRequests = new Map<
  string,
  Map<number, WorkflowAgentControlAction>
>()

const agentControllers = new Map<string, Map<number, AbortController>>()

const MAX_TASK_LOG_LINES = 200

function appendLogLine(taskId: string, line: string): void {
  appendTaskOutput(taskId, `${line}\n`)
}

function progressLine(event: WorkflowProgressEvent): string {
  switch (event.kind) {
    case 'phase':
      return `phase: ${event.title}`
    case 'log':
      return event.message
    case 'agent_start':
      return `agent #${event.agentNumber} started: ${event.label}`
    case 'agent_end': {
      const status =
        event.status ?? (event.ok ? 'completed' : 'failed')
      return `agent #${event.agentNumber} ${status}: ${event.label} (${event.tokens} tokens)`
    }
  }
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
  const usage = `\n<usage><total_tokens>${task.tokensSpent}</total_tokens><tool_uses>${task.agentCount}</tool_uses></usage>`
  const reason = task.error ? `\n<reason>${task.error}</reason>` : ''
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${task.id}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>${task.type}</${TASK_TYPE_TAG}>
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(task.id)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>${reason}${usage}
</${TASK_NOTIFICATION_TAG}>`
  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

export function registerWorkflowTask(params: {
  runId: string
  workflowName: string
  description: string
  toolUseId?: string
  abortController: AbortController
  setAppState: SetAppState
}): void {
  const base = createTaskStateBase(
    params.runId,
    'local_workflow',
    params.description,
    params.toolUseId,
  )
  const task: LocalWorkflowTaskState = {
    ...base,
    type: 'local_workflow',
    status: 'running',
    runId: params.runId,
    workflowName: params.workflowName,
    summary: params.workflowName,
    isBackgrounded: true,
    abortController: params.abortController,
    agentCount: 0,
    tokensSpent: 0,
    phases: [],
    agents: [],
    log: [],
  }
  void initTaskOutput(params.runId)
  appendLogLine(params.runId, `workflow started: ${params.workflowName}`)
  registerTask(task, params.setAppState)
}

export function updateWorkflowTaskProgress(
  runId: string,
  event: WorkflowProgressEvent,
  setAppState: SetAppState,
): void {
  const line = progressLine(event)
  appendLogLine(runId, line)
  updateTaskState<LocalWorkflowTaskState>(runId, setAppState, task => {
    if (task.status !== 'running') return task
    const log = [...task.log, line].slice(-MAX_TASK_LOG_LINES)
    switch (event.kind) {
      case 'phase':
        return {
          ...task,
          currentPhase: event.title,
          phases: task.phases.includes(event.title)
            ? task.phases
            : [...task.phases, event.title],
          summary: event.title,
          log,
        }
      case 'log':
        return { ...task, summary: event.message, log }
      case 'agent_start':
        return {
          ...task,
          agentCount: Math.max(task.agentCount, event.agentNumber),
          agents: setWorkflowAgent(task.agents, {
            agentNumber: event.agentNumber,
            label: event.label,
            phase: event.phase,
            status: 'running',
            tokens: 0,
          }),
          summary: event.label,
          log,
        }
      case 'agent_end': {
        const status =
          event.status ?? (event.ok ? 'completed' : 'failed')
        return {
          ...task,
          tokensSpent: task.tokensSpent + event.tokens,
          agents: setWorkflowAgent(task.agents, {
            agentNumber: event.agentNumber,
            label: event.label,
            phase: event.phase,
            status,
            tokens: event.tokens,
          }),
          summary: `${event.label} ${status}`,
          log,
        }
      }
    }
  })
}

export function finishWorkflowTask(
  taskId: string,
  status: Extract<TaskStatus, 'completed' | 'failed' | 'killed'>,
  setAppState: SetAppState,
  patch: {
    agentCount?: number
    tokensSpent?: number
    error?: string
  } = {},
): void {
  let taskForNotification: LocalWorkflowTaskState | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.notified) return task
    const next: LocalWorkflowTaskState = {
      ...task,
      ...patch,
      status,
      endTime: Date.now(),
      abortController: undefined,
      notified: true,
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
  controlRequests.delete(taskId)
  agentControllers.delete(taskId)
}

export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let controller: AbortController | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    controller = task.abortController
    return task
  })
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
  appendLogLine(taskId, `skip requested for agent #${agentNumber}`)
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => ({
    ...task,
    agents: task.agents.map(agent =>
      agent.agentNumber === agentNumber && agent.status === 'running'
        ? { ...agent, status: 'skipped' }
        : agent,
    ),
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
  appendLogLine(taskId, `retry requested for agent #${agentNumber}`)
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => ({
    ...task,
    agents: task.agents.map(agent =>
      agent.agentNumber === agentNumber
        ? { ...agent, status: 'retry_requested' }
        : agent,
    ),
    summary: `retry requested for agent #${agentNumber}`,
  }))
}
