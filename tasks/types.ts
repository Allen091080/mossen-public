// Union of all concrete task state types
// Use this for components that need to work with any task type

import type { DreamTaskState } from './DreamTask/DreamTask.js'
import type { InProcessTeammateTaskState } from './InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from './LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from './LocalShellTask/guards.js'
import type { LocalWorkflowTaskState } from './LocalWorkflowTask/LocalWorkflowTask.js'
import type { MonitorMcpTaskState } from './MonitorMcpTask/MonitorMcpTask.js'
import type { TaskStateBase } from '../Task.js'

export type RemoteAgentTaskState = TaskStateBase & {
  type: 'remote_agent'
  title: string
  isBackgrounded?: boolean
}

export type TaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | InProcessTeammateTaskState
  | RemoteAgentTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState

// Task types that can appear in the background tasks indicator
export type BackgroundTaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | InProcessTeammateTaskState
  | RemoteAgentTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState

/**
 * Check if a task should be shown in the background tasks indicator.
 * A task is considered a background task if:
 * 1. It is running or pending
 * 2. It has been explicitly backgrounded (not a foreground task)
 */
export function isBackgroundTask(task: unknown): task is BackgroundTaskState {
  const candidate = task as { status?: string; isBackgrounded?: boolean }
  if (candidate.status !== 'running' && candidate.status !== 'pending') {
    return false
  }
  // Foreground tasks (isBackgrounded === false) are not yet "background tasks"
  if (candidate.isBackgrounded === false) {
    return false
  }
  return true
}
