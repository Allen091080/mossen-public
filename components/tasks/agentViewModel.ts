import { isTerminalTaskStatus } from '../../Task.js'
import type { TaskStatus } from '../../Task.js'
import { isInProcessTeammateTask } from '../../tasks/InProcessTeammateTask/types.js'
import { isLocalAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import type { RemoteAgentTaskState, TaskState } from '../../tasks/types.js'

export type AgentViewStatus =
  | 'needs_input'
  | 'working'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'

export type AgentViewItem = {
  id: string
  kind: 'local_agent' | 'session' | 'teammate'
  title: string
  status: AgentViewStatus
  cwd?: string
  updatedAt?: number
  canReply: boolean
  canAttach: boolean
  canStop: boolean
  canDismiss: boolean
  canDeleteWorktree: boolean
}

export type AgentViewTaskState =
  | LocalAgentTaskState
  | InProcessTeammateTaskState
  | RemoteAgentTaskState

function mapTaskStatus(status: TaskStatus): AgentViewStatus {
  if (status === 'running' || status === 'pending') return 'working'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'stopped'
}

function isRemoteAgentTask(task: unknown): task is RemoteAgentTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'remote_agent'
  )
}

function shouldKeepLocalAgent(task: LocalAgentTaskState): boolean {
  return task.evictAfter !== 0
}

function shouldKeepTeammate(task: InProcessTeammateTaskState): boolean {
  return !isTerminalTaskStatus(task.status) || task.awaitingPlanApproval
}

function shouldKeepRemoteAgent(task: RemoteAgentTaskState): boolean {
  return task.isBackgrounded !== false && !isTerminalTaskStatus(task.status)
}

export function isAgentViewTaskState(task: unknown): task is AgentViewTaskState {
  if (isLocalAgentTask(task)) return shouldKeepLocalAgent(task)
  if (isInProcessTeammateTask(task)) return shouldKeepTeammate(task)
  if (isRemoteAgentTask(task)) return shouldKeepRemoteAgent(task)
  return false
}

function localAgentToItem(task: LocalAgentTaskState): AgentViewItem {
  const terminal = isTerminalTaskStatus(task.status)
  return {
    id: task.id,
    kind: 'local_agent',
    title: task.description,
    status: mapTaskStatus(task.status),
    updatedAt: task.endTime ?? task.startTime,
    canReply: true,
    canAttach: true,
    canStop: task.status === 'running',
    canDismiss: terminal,
    canDeleteWorktree: false,
  }
}

function teammateToItem(task: InProcessTeammateTaskState): AgentViewItem {
  return {
    id: task.id,
    kind: 'teammate',
    title: `@${task.identity.agentName}`,
    status: task.awaitingPlanApproval ? 'needs_input' : mapTaskStatus(task.status),
    updatedAt: task.endTime ?? task.startTime,
    canReply: true,
    canAttach: true,
    canStop: task.status === 'running',
    canDismiss: isTerminalTaskStatus(task.status),
    canDeleteWorktree: false,
  }
}

function remoteAgentToItem(task: RemoteAgentTaskState): AgentViewItem {
  return {
    id: task.id,
    kind: 'session',
    title: task.title,
    status: mapTaskStatus(task.status),
    updatedAt: task.endTime ?? task.startTime,
    canReply: false,
    canAttach: false,
    canStop: false,
    canDismiss: false,
    canDeleteWorktree: false,
  }
}

export function deriveAgentViewItems(
  tasks: Record<string, TaskState> | undefined,
): AgentViewItem[] {
  return Object.values(tasks ?? {})
    .filter(isAgentViewTaskState)
    .map(task => {
      if (isLocalAgentTask(task)) return localAgentToItem(task)
      if (isInProcessTeammateTask(task)) return teammateToItem(task)
      return remoteAgentToItem(task)
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}
