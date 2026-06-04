/* eslint-disable @typescript-eslint/no-explicit-any */

import type { TaskStateBase } from '../../Task.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  agentId?: string
  isBackgrounded?: boolean
  [key: string]: any
}

export function killMonitorMcp(..._args: any[]): void {}

export function killMonitorMcpTasksForAgent(
  ..._args: any[]
): void {}
