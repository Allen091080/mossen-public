/* eslint-disable @typescript-eslint/no-explicit-any */
export type QueueOperation =
  | 'enqueue'
  | 'dequeue'
  | 'clear'
  | 'recheck'
  | 'replace'
  | string

export type QueueOperationMessage = any
