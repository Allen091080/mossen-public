export type ToolResultRoleStyle =
  | 'mossen_user_tool_result'
  | 'openai_tool_role'

export type ToolCallArgsEncoding = 'json_string' | 'object'

export type ThinkingParityStrategy =
  | 'native'
  | 'none'
  | 'synthetic_single_pass'
  | 'synthetic_two_pass'

export type OfficialSemanticCapabilities = {
  mixedContentToolUse: boolean
  nativeThinkingBlocks: boolean
  reasoningBudget: boolean
  streamingToolArgDeltas: boolean
  structuredStopReasons: boolean
  supportsAssistantPreludeBeforeToolUse: boolean
  toolCallArgsEncoding: ToolCallArgsEncoding
  toolResultRoleStyle: ToolResultRoleStyle
}

export type CanonicalUsage = {
  inputTokens: number
  outputTokens: number
}

export type AssistantToolRequest = {
  argumentsObject: Record<string, unknown>
  id: string
  name: string
}

export type AssistantPrelude = {
  text: string
}

export type ToolExecutionResult = {
  content: string
  isError: boolean
  toolUseId: string
}

export type CanonicalConversationRound = {
  prelude: AssistantPrelude | null
  toolRequests: AssistantToolRequest[]
  toolResults: ToolExecutionResult[]
}

export type CanonicalHistoryMessage =
  | {
      content: string
      role: 'system' | 'user'
    }
  | {
      content: string
      role: 'assistant'
      thinking?: string
      toolCalls?: AssistantToolRequest[]
    }
  | {
      content: string
      isError?: boolean
      role: 'tool'
      toolCallId: string
    }

export type CanonicalTurnRequest = {
  maxTokens: number
  messages: CanonicalHistoryMessage[]
  metadata?: Record<string, unknown>
  model: string
  reasoning?: {
    budgetTokens?: number
    enabled: boolean
    mode?: string
  }
  stop?: string[]
  system: null | string
  temperature?: number
  toolChoice?: Record<string, unknown> | string
  tools?: Array<Record<string, unknown>>
}

export type CanonicalStopReason =
  | 'compaction'
  | 'end_turn'
  | 'max_tokens'
  | 'pause_turn'
  | 'refusal'
  | 'stop_sequence'
  | 'tool_use'

export type CanonicalStreamEvent =
  | {
      messageId: string
      model: string
      type: 'message_start'
    }
  | { type: 'thinking_start' }
  | {
      text: string
      type: 'thinking_delta'
    }
  | { type: 'thinking_end' }
  | { type: 'text_start' }
  | {
      text: string
      type: 'text_delta'
    }
  | { type: 'text_end' }
  | {
      id: string
      name: string
      type: 'tool_use_start'
    }
  | {
      id: string
      partialJson: string
      type: 'tool_use_args_delta'
    }
  | {
      id: string
      type: 'tool_use_end'
    }
  | {
      stopReason: CanonicalStopReason
      type: 'message_stop'
      usage: CanonicalUsage
    }
  | {
      error: string
      type: 'provider_error'
    }

export type CanonicalTurnResult = {
  providerDiagnostics?: Record<string, unknown>
  stopReason: CanonicalStopReason
  thinkingText: string
  toolRequests: AssistantToolRequest[]
  usage: CanonicalUsage
  visibleText: string
}

export type MossenStopSideEffects = {
  isContextWindowExceeded: boolean
  isMaxTokens: boolean
  isRefusal: boolean
}

export type ObservedMossenStopState = {
  canonicalStopReason: CanonicalStopReason | null
  stopReason: unknown | null
}

export function isMossenContextWindowExceededStopReason(
  stopReason: unknown,
): boolean {
  return stopReason === 'model_context_window_exceeded'
}

export function isMossenRefusalStopReason(stopReason: unknown): boolean {
  return stopReason === 'refusal'
}

export function isCanonicalMaxTokensStopReason(
  stopReason: CanonicalStopReason | null | undefined,
): boolean {
  return stopReason === 'max_tokens'
}

export function didMossenStreamTerminateWithoutCanonicalStopReason(
  hasPartialMessage: boolean,
  yieldedAssistantMessageCount: number,
  canonicalStopReason: CanonicalStopReason | null | undefined,
): boolean {
  return (
    !hasPartialMessage ||
    (yieldedAssistantMessageCount === 0 && canonicalStopReason === null)
  )
}

export function canonicalStopReasonFromMossen(
  stopReason: unknown,
): CanonicalStopReason {
  if (stopReason === 'tool_use') {
    return 'tool_use'
  }
  if (stopReason === 'refusal') {
    return 'refusal'
  }
  if (stopReason === 'stop_sequence') {
    return 'stop_sequence'
  }
  if (stopReason === 'pause_turn') {
    return 'pause_turn'
  }
  if (stopReason === 'compaction') {
    return 'compaction'
  }
  if (stopReason === 'max_tokens' || isMossenContextWindowExceededStopReason(stopReason)) {
    return 'max_tokens'
  }
  return 'end_turn'
}

export function classifyMossenStopSideEffects(
  stopReason: unknown,
  canonicalStopReason: CanonicalStopReason | null | undefined,
): MossenStopSideEffects {
  return {
    isContextWindowExceeded:
      isMossenContextWindowExceededStopReason(stopReason),
    isMaxTokens: isCanonicalMaxTokensStopReason(canonicalStopReason),
    isRefusal: isMossenRefusalStopReason(stopReason),
  }
}

export function observeMossenStopState(
  stopReason: unknown | null,
): ObservedMossenStopState {
  return {
    canonicalStopReason:
      stopReason === null ? null : canonicalStopReasonFromMossen(stopReason),
    stopReason,
  }
}

export function classifyObservedMossenStopState(
  observedStopState: ObservedMossenStopState | null | undefined,
): MossenStopSideEffects {
  return classifyMossenStopSideEffects(
    observedStopState?.stopReason ?? null,
    observedStopState?.canonicalStopReason,
  )
}

export function didMossenStreamTerminateWithoutObservedStopState(
  hasPartialMessage: boolean,
  yieldedAssistantMessageCount: number,
  observedStopState: ObservedMossenStopState | null | undefined,
): boolean {
  return didMossenStreamTerminateWithoutCanonicalStopReason(
    hasPartialMessage,
    yieldedAssistantMessageCount,
    observedStopState?.canonicalStopReason,
  )
}
