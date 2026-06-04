import { randomUUID } from 'crypto'
import type {
  CanonicalStopReason,
  CanonicalStreamEvent,
  CanonicalTurnResult,
  OfficialSemanticCapabilities,
  CanonicalUsage,
} from '../canonical.js'
import type { ProviderModelPolicy } from '../providerPolicy.js'

export type OpenAICompatibleSemanticToolCall = {
  function?: {
    arguments?: string
    name?: string
  }
  id?: string
  index?: number
  type?: string
}

export type OpenAICompatibleSemanticChoice = {
  delta?: {
    content?: null | string | unknown[]
    role?: string
    tool_calls?: OpenAICompatibleSemanticToolCall[]
  }
  finish_reason?: null | string
  message?: {
    content?: null | string | unknown[]
    role?: string
    tool_calls?: OpenAICompatibleSemanticToolCall[]
  }
}

export type OpenAICompatibleSemanticResponse = {
  choices?: OpenAICompatibleSemanticChoice[]
  id?: string
  model?: string
  usage?: {
    completion_tokens?: number
    prompt_tokens?: number
  }
}

type OpenAICompatibleStreamToolState = {
  accumulatedJson: string
  closed: boolean
  emittedStart: boolean
  id: string
  name: null | string
  pendingJson: string
}

type SyntheticThinkingStreamEvent =
  | { type: 'text_end' | 'text_start' | 'thinking_end' | 'thinking_start' }
  | { text: string; type: 'text_delta' | 'thinking_delta' }

export const OPENAI_COMPATIBLE_SEMANTIC_CAPABILITIES: OfficialSemanticCapabilities = {
  mixedContentToolUse: false,
  nativeThinkingBlocks: false,
  reasoningBudget: false,
  streamingToolArgDeltas: true,
  structuredStopReasons: false,
  supportsAssistantPreludeBeforeToolUse: true,
  toolCallArgsEncoding: 'json_string',
  toolResultRoleStyle: 'openai_tool_role',
}

function isCompleteJsonPayload(value: string): boolean {
  if (!value.trim()) {
    return false
  }
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function flattenTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (!block || typeof block !== 'object') {
      continue
    }
    const typedBlock = block as {
      text?: unknown
      type?: string
    }
    if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
      parts.push(typedBlock.text)
    }
  }
  return parts.join('')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class SyntheticThinkingStreamParser {
  private buffer = ''
  private mode: 'await_response' | 'fallback_text' | 'response' | 'searching' | 'thinking' =
    'searching'
  private textOpen = false
  private thinkingOpen = false

  constructor(private readonly policy: ProviderModelPolicy) {}

  private flushText(events: SyntheticThinkingStreamEvent[], text: string) {
    if (!text) {
      return
    }
    if (!this.textOpen) {
      events.push({ type: 'text_start' })
      this.textOpen = true
    }
    events.push({ text, type: 'text_delta' })
  }

  private flushThinking(events: SyntheticThinkingStreamEvent[], text: string) {
    if (!text) {
      return
    }
    if (!this.thinkingOpen) {
      events.push({ type: 'thinking_start' })
      this.thinkingOpen = true
    }
    events.push({ text, type: 'thinking_delta' })
  }

  consume(chunk: string): SyntheticThinkingStreamEvent[] {
    const events: SyntheticThinkingStreamEvent[] = []
    if (!chunk) {
      return events
    }

    this.buffer += chunk
    const { thinkingOpen, thinkingClose, responseOpen, responseClose } =
      this.policy.syntheticTags

    while (this.buffer) {
      if (this.mode === 'fallback_text') {
        const next = this.buffer
        this.buffer = ''
        this.flushText(events, next)
        break
      }

      if (this.mode === 'searching') {
        const idx = this.buffer.indexOf(thinkingOpen)
        if (idx === 0) {
          this.buffer = this.buffer.slice(thinkingOpen.length)
          this.mode = 'thinking'
          continue
        }
        if (idx > 0) {
          const prefix = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx)
          if (prefix.trim()) {
            this.mode = 'fallback_text'
            this.flushText(events, prefix)
          }
          continue
        }
        if (thinkingOpen.startsWith(this.buffer)) {
          break
        }
        this.mode = 'fallback_text'
        continue
      }

      if (this.mode === 'thinking') {
        const idx = this.buffer.indexOf(thinkingClose)
        if (idx === -1) {
          const safeLength = Math.max(0, this.buffer.length - thinkingClose.length + 1)
          if (safeLength === 0) {
            break
          }
          const safe = this.buffer.slice(0, safeLength)
          this.buffer = this.buffer.slice(safeLength)
          this.flushThinking(events, safe)
          continue
        }
        const thinkingText = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + thinkingClose.length)
        this.flushThinking(events, thinkingText)
        if (this.thinkingOpen) {
          events.push({ type: 'thinking_end' })
          this.thinkingOpen = false
        }
        this.mode = 'await_response'
        continue
      }

      if (this.mode === 'await_response') {
        const idx = this.buffer.indexOf(responseOpen)
        if (idx === 0) {
          this.buffer = this.buffer.slice(responseOpen.length)
          this.mode = 'response'
          continue
        }
        if (idx > 0) {
          const prefix = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx)
          if (prefix.trim()) {
            this.mode = 'fallback_text'
            this.flushText(events, prefix)
          }
          continue
        }
        if (responseOpen.startsWith(this.buffer)) {
          break
        }
        this.mode = 'fallback_text'
        continue
      }

      const idx = this.buffer.indexOf(responseClose)
      if (idx === -1) {
        const safeLength = Math.max(0, this.buffer.length - responseClose.length + 1)
        if (safeLength === 0) {
          break
        }
        const safe = this.buffer.slice(0, safeLength)
        this.buffer = this.buffer.slice(safeLength)
        this.flushText(events, safe)
        continue
      }
      const responseText = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + responseClose.length)
      this.flushText(events, responseText)
      if (this.textOpen) {
        events.push({ type: 'text_end' })
        this.textOpen = false
      }
      this.mode = 'fallback_text'
    }

    return events
  }

  finish(): SyntheticThinkingStreamEvent[] {
    const events: SyntheticThinkingStreamEvent[] = []
    if (this.mode === 'fallback_text' || this.mode === 'response') {
      this.flushText(events, this.buffer)
      this.buffer = ''
      if (this.textOpen) {
        events.push({ type: 'text_end' })
        this.textOpen = false
      }
      return events
    }
    if (this.mode === 'thinking') {
      this.flushThinking(events, this.buffer)
      this.buffer = ''
      if (this.thinkingOpen) {
        events.push({ type: 'thinking_end' })
        this.thinkingOpen = false
      }
      return events
    }
    return events
  }
}

export function extractOpenAICompatibleThinkingParts(
  content: string,
  policy: ProviderModelPolicy,
): { thinkingText: string; visibleText: string } {
  if (!content || !policy.thinkingStrategy.startsWith('synthetic')) {
    return { thinkingText: '', visibleText: content }
  }

  const thinkingMatch = content.match(
    new RegExp(
      `${escapeRegExp(policy.syntheticTags.thinkingOpen)}([\\s\\S]*?)${escapeRegExp(policy.syntheticTags.thinkingClose)}`,
      'i',
    ),
  )
  const responseMatch = content.match(
    new RegExp(
      `${escapeRegExp(policy.syntheticTags.responseOpen)}([\\s\\S]*?)${escapeRegExp(policy.syntheticTags.responseClose)}`,
      'i',
    ),
  )

  if (!thinkingMatch && !responseMatch) {
    return { thinkingText: '', visibleText: content }
  }

  return {
    thinkingText: (thinkingMatch?.[1] ?? '').trim(),
    visibleText: (responseMatch?.[1] ?? '').trim(),
  }
}

function mapStopReason(
  finishReason: null | string | undefined,
  hasToolCalls: boolean,
): CanonicalStopReason {
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (finishReason === 'tool_calls' || hasToolCalls) {
    return 'tool_use'
  }
  return 'end_turn'
}

function getChoiceContentDelta(choice: OpenAICompatibleSemanticChoice): string {
  return flattenTextContent(choice.delta?.content ?? choice.message?.content)
}

function getChoiceToolCalls(
  choice: OpenAICompatibleSemanticChoice,
): OpenAICompatibleSemanticToolCall[] {
  const toolCalls = choice.delta?.tool_calls ?? choice.message?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

export class OpenAICompatibleStreamSemanticState {
  private readonly parityParser
  private readonly toolIndexById = new Map<string, number>()
  private readonly toolStates = new Map<number, OpenAICompatibleStreamToolState>()
  private emittedAnyContent = false
  private emittedMessageStart = false
  private messageId = `msg_${randomUUID()}`
  private messageModel: string
  private openText = false
  private openThinking = false
  private stopReason: CanonicalStopReason | null = null
  private usage: CanonicalUsage = {
    inputTokens: 0,
    outputTokens: 0,
  }

  constructor(
    fallbackModel: string,
    private readonly policy: ProviderModelPolicy,
  ) {
    this.messageModel = fallbackModel
    this.parityParser =
      policy.thinkingStrategy === 'synthetic_single_pass' ||
      policy.thinkingStrategy === 'synthetic_two_pass'
        ? new SyntheticThinkingStreamParser(policy)
        : null
  }

  private ensureMessageStart(events: CanonicalStreamEvent[]) {
    if (this.emittedMessageStart) {
      return
    }
    this.emittedMessageStart = true
    events.push({
      messageId: this.messageId,
      model: this.messageModel,
      type: 'message_start',
    })
  }

  private startThinking(events: CanonicalStreamEvent[]) {
    if (this.openThinking) {
      return
    }
    this.stopText(events)
    this.openThinking = true
    this.emittedAnyContent = true
    events.push({ type: 'thinking_start' })
  }

  private stopThinking(events: CanonicalStreamEvent[]) {
    if (!this.openThinking) {
      return
    }
    this.openThinking = false
    events.push({ type: 'thinking_end' })
  }

  private startText(events: CanonicalStreamEvent[]) {
    if (this.openText) {
      return
    }
    this.stopThinking(events)
    this.openText = true
    this.emittedAnyContent = true
    events.push({ type: 'text_start' })
  }

  private stopText(events: CanonicalStreamEvent[]) {
    if (!this.openText) {
      return
    }
    this.openText = false
    events.push({ type: 'text_end' })
  }

  private closeOpenContent(events: CanonicalStreamEvent[]) {
    this.stopText(events)
    this.stopThinking(events)
  }

  private applyParityEvent(
    parityEvent: SyntheticThinkingStreamEvent,
    events: CanonicalStreamEvent[],
  ) {
    if (parityEvent.type === 'thinking_start') {
      this.startThinking(events)
      return
    }
    if (parityEvent.type === 'thinking_end') {
      this.stopThinking(events)
      return
    }
    if (parityEvent.type === 'text_start') {
      this.startText(events)
      return
    }
    if (parityEvent.type === 'text_end') {
      this.stopText(events)
      return
    }
    if (parityEvent.type === 'thinking_delta') {
      this.startThinking(events)
      events.push({
        text: parityEvent.text,
        type: 'thinking_delta',
      })
      return
    }
    if (parityEvent.type === 'text_delta') {
      this.startText(events)
      events.push({
        text: parityEvent.text,
        type: 'text_delta',
      })
    }
  }

  private emitTextDelta(
    textDelta: string,
    events: CanonicalStreamEvent[],
  ) {
    if (!textDelta) {
      return
    }

    const parityEvents = this.parityParser
      ? this.parityParser.consume(textDelta)
      : [{ text: textDelta, type: 'text_delta' as const }]
    for (const parityEvent of parityEvents) {
      this.applyParityEvent(parityEvent, events)
    }
  }

  private closeCompletedToolBlocksBeforeIndex(
    nextOpenAIIndex: number,
    events: CanonicalStreamEvent[],
  ) {
    const orderedStates = [...this.toolStates.entries()].sort((a, b) => a[0] - b[0])

    for (const [openAIIndex, state] of orderedStates) {
      if (
        state.closed ||
        openAIIndex >= nextOpenAIIndex ||
        !state.emittedStart ||
        !isCompleteJsonPayload(state.accumulatedJson)
      ) {
        continue
      }
      state.closed = true
      events.push({
        id: state.id,
        type: 'tool_use_end',
      })
    }
  }

  private resolveToolStateIndex(toolCall: OpenAICompatibleSemanticToolCall): number {
    if (toolCall.id) {
      const knownIndex = this.toolIndexById.get(toolCall.id)
      if (knownIndex !== undefined) {
        return knownIndex
      }
    }

    const resolvedIndex =
      typeof toolCall.index === 'number' ? toolCall.index : this.toolStates.size
    if (toolCall.id) {
      this.toolIndexById.set(toolCall.id, resolvedIndex)
    }
    return resolvedIndex
  }

  private emitToolStartIfReady(
    state: OpenAICompatibleStreamToolState,
    events: CanonicalStreamEvent[],
  ) {
    if (state.emittedStart || !state.name) {
      return
    }
    this.closeOpenContent(events)
    state.emittedStart = true
    this.emittedAnyContent = true
    events.push({
      id: state.id,
      name: state.name,
      type: 'tool_use_start',
    })
    if (state.pendingJson) {
      events.push({
        id: state.id,
        partialJson: state.pendingJson,
        type: 'tool_use_args_delta',
      })
      state.pendingJson = ''
    }
  }

  private closeToolBlocks(events: CanonicalStreamEvent[]) {
    const orderedStates = [...this.toolStates.entries()].sort((a, b) => a[0] - b[0])
    for (const [, state] of orderedStates) {
      if (!state.emittedStart) {
        if (!state.name) {
          state.name = 'tool'
        }
        this.emitToolStartIfReady(state, events)
      }
      if (state.closed || !state.emittedStart) {
        continue
      }
      state.closed = true
      events.push({
        id: state.id,
        type: 'tool_use_end',
      })
    }
  }

  private applyToolCalls(
    toolCalls: OpenAICompatibleSemanticToolCall[],
    events: CanonicalStreamEvent[],
  ) {
    for (const toolCall of toolCalls) {
      const openAIIndex = this.resolveToolStateIndex(toolCall)
      let state = this.toolStates.get(openAIIndex)
      if (!state) {
        this.closeCompletedToolBlocksBeforeIndex(openAIIndex, events)
        state = {
          accumulatedJson: '',
          closed: false,
          emittedStart: false,
          id: toolCall.id ?? `toolu_${randomUUID()}`,
          name: null,
          pendingJson: '',
        }
        this.toolStates.set(openAIIndex, state)
      }

      if (state.closed) {
        continue
      }

      if (!state.emittedStart && toolCall.id) {
        state.id = toolCall.id
      }
      if (toolCall.function?.name && !state.name) {
        state.name = toolCall.function.name
      }
      if (typeof toolCall.function?.arguments === 'string') {
        state.accumulatedJson += toolCall.function.arguments
        state.pendingJson += toolCall.function.arguments
      }

      this.emitToolStartIfReady(state, events)
      if (state.emittedStart && state.pendingJson) {
        events.push({
          id: state.id,
          partialJson: state.pendingJson,
          type: 'tool_use_args_delta',
        })
        state.pendingJson = ''
      }
    }
  }

  consumeChunk(chunk: OpenAICompatibleSemanticResponse): CanonicalStreamEvent[] {
    const events: CanonicalStreamEvent[] = []

    if (chunk.id) {
      this.messageId = chunk.id
    }
    if (chunk.model) {
      this.messageModel = chunk.model
    }
    if (chunk.usage) {
      this.usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      }
    }

    this.ensureMessageStart(events)

    for (const choice of chunk.choices ?? []) {
      const textDelta = getChoiceContentDelta(choice)
      const toolCalls = getChoiceToolCalls(choice)

      this.emitTextDelta(textDelta, events)
      if (toolCalls.length > 0) {
        this.closeOpenContent(events)
        this.applyToolCalls(toolCalls, events)
      }

      if (choice.finish_reason) {
        this.stopReason = mapStopReason(choice.finish_reason, this.toolStates.size > 0)
      }
    }

    return events
  }

  finish(): CanonicalStreamEvent[] {
    const events: CanonicalStreamEvent[] = []
    if (!this.emittedMessageStart) {
      return events
    }

    if (this.parityParser) {
      for (const parityEvent of this.parityParser.finish()) {
        this.applyParityEvent(parityEvent, events)
      }
    }

    if (!this.emittedAnyContent) {
      this.startText(events)
    }
    this.closeOpenContent(events)
    this.closeToolBlocks(events)
    events.push({
      stopReason: this.stopReason ?? mapStopReason(null, this.toolStates.size > 0),
      type: 'message_stop',
      usage: this.usage,
    })
    return events
  }
}

export function openAICompatibleCompletionToCanonicalTurn(
  data: OpenAICompatibleSemanticResponse,
  policy: ProviderModelPolicy,
): CanonicalTurnResult {
  const choice = data.choices?.[0] ?? {}
  const message = choice.message ?? {}
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const textContent = flattenTextContent(message.content).trim()
  const thinkingParts = extractOpenAICompatibleThinkingParts(textContent, policy)

  const canonicalTurn: CanonicalTurnResult = {
    stopReason: mapStopReason(choice.finish_reason, toolCalls.length > 0),
    thinkingText: thinkingParts.thinkingText,
    toolRequests: [],
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    visibleText: thinkingParts.visibleText,
  }

  for (const toolCall of toolCalls) {
    const rawArguments = toolCall.function?.arguments ?? '{}'
    let parsedArguments: unknown = {}
    try {
      parsedArguments = JSON.parse(rawArguments)
    } catch {
      parsedArguments = {}
    }
    canonicalTurn.toolRequests.push({
      argumentsObject: parsedArguments as Record<string, unknown>,
      id: toolCall.id ?? randomUUID(),
      name: toolCall.function?.name ?? 'tool',
    })
  }

  if (
    !canonicalTurn.visibleText &&
    !canonicalTurn.thinkingText &&
    canonicalTurn.toolRequests.length === 0
  ) {
    canonicalTurn.visibleText = flattenTextContent(message.content)
  }

  return canonicalTurn
}
