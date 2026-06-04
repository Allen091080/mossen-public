/* eslint-disable @typescript-eslint/no-explicit-any */

export type MessageOrigin =
  | 'local'
  | 'remote'
  | 'system'
  | string
  | { kind: string; server?: string }

export function isStructuredMessageOrigin(
  origin: MessageOrigin | undefined,
): origin is { kind: string; server?: string } {
  return typeof origin === 'object' && origin !== null && 'kind' in origin
}
export type SystemMessageLevel = 'info' | 'warning' | 'error' | string
export type PartialCompactDirection = 'from' | 'to' | 'up_to' | string

export type LooseMessageRecord = any
export type StopHookInfo = any
export type CompactMetadata = any
export type RequestStartEvent = any
export type StreamEvent = any

export type Message = any
export type NormalizedMessage = any
export type RenderableMessage = any

export type UserMessage = any
export type NormalizedUserMessage = any
export type AssistantMessage = any
export type NormalizedAssistantMessage<T = any> = any & {
  __assistantContentType?: T
}

export type SystemMessage = any
export type SystemInformationalMessage = any
export type SystemAPIErrorMessage = any
export type SystemApiMetricsMessage = any
export type SystemAgentsKilledMessage = any
export type SystemAwaySummaryMessage = any
export type SystemBridgeStatusMessage = any
export type SystemCompactBoundaryMessage = any
export type SystemFileSnapshotMessage = any
export type SystemLocalCommandMessage = {
  type: 'system'
  subtype: 'local_command'
  [key: string]: any
}
export type SystemMemorySavedMessage = any
export type SystemMicrocompactBoundaryMessage = any
export type SystemPermissionRetryMessage = any
export type SystemScheduledTaskFireMessage = any
export type SystemStopHookSummaryMessage = any
export type SystemThinkingMessage = any
export type SystemTurnDurationMessage = any

export type AttachmentMessage<T = any> = {
  type?: string
  attachment?: T
  [key: string]: any
}
export type HookResultMessage = any
export type ProgressMessage<T = any> = {
  type: 'progress'
  data: T
  [key: string]: any
}
export type ToolUseSummaryMessage = any
export type GroupedToolUseMessage = any
export type CollapsedReadSearchGroup = any
export type CollapsibleMessage = any
export type TombstoneMessage = any
