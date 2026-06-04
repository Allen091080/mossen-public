/* eslint-disable @typescript-eslint/no-explicit-any */

import type { TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  summary?: string
  isBackgrounded?: boolean
  [key: string]: any
}

export function killWorkflowTask(..._args: any[]): void {}
export function skipWorkflowAgent(..._args: any[]): void {}
export function retryWorkflowAgent(..._args: any[]): void {}
