import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { SetAppState, Task } from '../../Task.js'
import { createTaskStateBase } from '../../Task.js'
import type { RemoteAgentTaskState } from '../types.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import { getRemoteSessionUrl } from '../../constants/product.js'
import {
  registerTask,
  updateTaskState,
} from '../../utils/task/framework.js'

type RemoteSdkMessage = Record<string, unknown>

type RemotePollResult = {
  newEvents: RemoteSdkMessage[]
  lastEventId: string | null
  sessionStatus?: 'idle' | 'running' | 'requires_action' | 'archived'
}

export type RegisterRemoteAgentTaskInput = {
  taskId: string
  sessionId: string
  title: string
  description: string
  remoteTaskType: NonNullable<RemoteAgentTaskState['remoteTaskType']>
  command?: string
  sessionUrl?: string
  toolUseId?: string
  remoteTaskMetadata?: unknown
  setAppState: SetAppState
}

export type RemoteAgentTaskPollingDeps = {
  poll?: (
    sessionId: string,
    afterId: string | null,
  ) => Promise<RemotePollResult>
  archive?: (sessionId: string) => Promise<void>
  pollIntervalMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

async function defaultPollRemoteSession(
  sessionId: string,
  afterId: string | null,
): Promise<RemotePollResult> {
  const { pollRemoteSessionEvents } = await import('../../utils/teleport.js')
  return pollRemoteSessionEvents(sessionId, afterId) as Promise<RemotePollResult>
}

async function defaultArchiveRemoteSession(sessionId: string): Promise<void> {
  const { archiveRemoteSession } = await import('../../utils/teleport.js')
  await archiveRemoteSession(sessionId)
}

function remoteMessageType(message: RemoteSdkMessage): string | null {
  return typeof message.type === 'string' ? message.type : null
}

function remoteResultSubtype(message: RemoteSdkMessage | null): string | null {
  return typeof message?.subtype === 'string' ? message.subtype : null
}

function lastResultEvent(
  messages: readonly RemoteSdkMessage[],
): RemoteSdkMessage | null {
  return (
    messages.findLast(message => remoteMessageType(message) === 'result') ?? null
  )
}

function statusSummary(
  task: RemoteAgentTaskState,
  status: 'completed' | 'failed' | 'killed',
  fallback?: string,
): string {
  if (fallback) return fallback
  if (task.remoteTaskType === 'remote-workflow') {
    if (status === 'completed') return 'Remote dynamic workflow completed'
    if (status === 'killed') return 'Remote dynamic workflow stopped'
    return 'Remote dynamic workflow failed'
  }
  if (status === 'completed') return `Remote task "${task.title}" completed`
  if (status === 'killed') return `Remote task "${task.title}" stopped`
  return `Remote task "${task.title}" failed`
}

function enqueueRemoteTaskNotification(
  task: RemoteAgentTaskState,
  status: 'completed' | 'failed' | 'killed',
  summary: string,
): void {
  const toolUseIdLine = task.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${task.toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  const sessionLine = task.sessionUrl ? `\nSession: ${task.sessionUrl}` : ''
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${task.id}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>remote_agent</${TASK_TYPE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>${sessionLine}`

  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

export function registerRemoteAgentTask(
  input: RegisterRemoteAgentTaskInput,
): RemoteAgentTaskState {
  const task: RemoteAgentTaskState = {
    ...createTaskStateBase(
      input.taskId,
      'remote_agent',
      input.description,
      input.toolUseId,
    ),
    type: 'remote_agent',
    status: 'running',
    title: input.title,
    sessionId: input.sessionId,
    sessionUrl: input.sessionUrl ?? getRemoteSessionUrl(input.sessionId),
    remoteTaskType: input.remoteTaskType,
    command: input.command,
    log: [],
    pollStartedAt: Date.now(),
    remoteTaskMetadata: input.remoteTaskMetadata,
    isBackgrounded: true,
  }
  registerTask(task, input.setAppState)
  return task
}

export function finishRemoteAgentTask(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  setAppState: SetAppState,
  summary?: string,
): void {
  let finishedTask: RemoteAgentTaskState | null = null
  updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => {
    if (task.notified) return task
    const next: RemoteAgentTaskState = {
      ...task,
      status,
      endTime: Date.now(),
      notified: true,
    }
    finishedTask = next
    return next
  })
  if (!finishedTask) return
  const finalSummary = statusSummary(finishedTask, status, summary)
  enqueueRemoteTaskNotification(finishedTask, status, finalSummary)
  emitTaskTerminatedSdk(
    taskId,
    status === 'killed' ? 'stopped' : status,
    {
      toolUseId: finishedTask.toolUseId,
      summary: finalSummary,
    },
  )
}

export function startRemoteAgentTaskPolling(
  params: {
    taskId: string
    sessionId: string
    setAppState: SetAppState
  },
  deps: RemoteAgentTaskPollingDeps = {},
): () => void {
  const poll = deps.poll ?? defaultPollRemoteSession
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  const pollIntervalMs = deps.pollIntervalMs ?? 1000
  let active = true
  let afterId: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const collected: RemoteSdkMessage[] = []

  const schedule = () => {
    if (!active) return
    timer = setTimeoutFn(() => void tick(), pollIntervalMs)
  }

  const tick = async () => {
    if (!active) return
    try {
      const page = await poll(params.sessionId, afterId)
      afterId = page.lastEventId ?? afterId
      if (page.newEvents.length > 0) {
        collected.push(...page.newEvents)
        updateTaskState<RemoteAgentTaskState>(
          params.taskId,
          params.setAppState,
          task => {
            if (task.status !== 'running') return task
            return { ...task, log: [...(task.log ?? []), ...page.newEvents] }
          },
        )
      }

      const result = lastResultEvent(collected)
      if (result) {
        const subtype = remoteResultSubtype(result)
        finishRemoteAgentTask(
          params.taskId,
          subtype === 'success' ? 'completed' : 'failed',
          params.setAppState,
        )
        active = false
        return
      }

      if (page.sessionStatus === 'archived') {
        finishRemoteAgentTask(params.taskId, 'completed', params.setAppState)
        active = false
        return
      }
    } catch {
      // Keep polling. Transient CCR fetch failures are common; terminal state
      // comes from the session event stream or explicit TaskStop.
    }
    schedule()
  }

  void tick()

  return () => {
    active = false
    if (timer) clearTimeoutFn(timer)
  }
}

export const RemoteAgentTask: Task = {
  name: 'RemoteAgentTask',
  type: 'remote_agent',
  async kill(taskId: string, setAppState: SetAppState) {
    let sessionId: string | undefined
    updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') return task
      sessionId = task.sessionId
      return task
    })
    if (sessionId) {
      await defaultArchiveRemoteSession(sessionId)
    }
    finishRemoteAgentTask(taskId, 'killed', setAppState)
  },
}
