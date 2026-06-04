import { randomUUID } from 'crypto'
import type {
  MossenBetaMessage,
  MossenBetaRawMessageStreamEvent,
  MossenBetaUsage,
} from '../api/mossenSdk.js'
import type {
  CanonicalStopReason,
  CanonicalStreamEvent,
  CanonicalTurnResult,
  CanonicalUsage,
} from './canonical.js'

function toMossenUsage(usage: CanonicalUsage): MossenBetaUsage {
  return {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  }
}

function toMossenStopReason(
  stopReason: CanonicalStopReason,
): MossenBetaMessage['stop_reason'] {
  if (stopReason === 'compaction') {
    return 'compaction'
  }
  if (stopReason === 'max_tokens') {
    return 'max_tokens'
  }
  if (stopReason === 'pause_turn') {
    return 'pause_turn'
  }
  if (stopReason === 'refusal') {
    return 'refusal'
  }
  if (stopReason === 'stop_sequence') {
    return 'stop_sequence'
  }
  if (stopReason === 'tool_use') {
    return 'tool_use'
  }
  return 'end_turn'
}

export function canonicalTurnToMossenMessage(
  result: CanonicalTurnResult,
  fallbackModel: string,
  messageId?: string,
): MossenBetaMessage {
  const content: MossenBetaMessage['content'] = []

  if (result.thinkingText) {
    content.push({
      signature: `synthetic-thinking:${messageId ?? randomUUID()}`,
      thinking: result.thinkingText,
      type: 'thinking',
    })
  }

  if (result.visibleText) {
    content.push({
      text: result.visibleText,
      type: 'text',
    })
  }

  for (const toolRequest of result.toolRequests) {
    content.push({
      id: toolRequest.id,
      input: toolRequest.argumentsObject,
      name: toolRequest.name,
      type: 'tool_use',
    })
  }

  if (content.length === 0) {
    content.push({
      text: '',
      type: 'text',
    })
  }

  return {
    content,
    id: messageId ?? `msg_${randomUUID()}`,
    model: fallbackModel,
    role: 'assistant',
    stop_reason: toMossenStopReason(result.stopReason),
    stop_sequence: null,
    type: 'message',
    usage: toMossenUsage(result.usage),
  }
}

export class MossenParityEventState {
  private nextIndex = 0
  private openTextIndex: number | null = null
  private openThinkingIndex: number | null = null
  private readonly toolIndices = new Map<string, number>()

  consume(
    events: Iterable<CanonicalStreamEvent>,
  ): MossenBetaRawMessageStreamEvent[] {
    const emitted: MossenBetaRawMessageStreamEvent[] = []

    for (const event of events) {
      switch (event.type) {
        case 'message_start':
          emitted.push({
            message: {
              content: [],
              id: event.messageId,
              model: event.model,
              role: 'assistant',
              stop_reason: null,
              stop_sequence: null,
              type: 'message',
              usage: toMossenUsage({ inputTokens: 0, outputTokens: 0 }),
            },
            type: 'message_start',
          })
          break
        case 'thinking_start':
          this.openThinkingIndex = this.nextIndex++
          emitted.push({
            content_block: {
              signature: '',
              thinking: '',
              type: 'thinking',
            },
            index: this.openThinkingIndex,
            type: 'content_block_start',
          })
          break
        case 'thinking_delta':
          if (this.openThinkingIndex !== null) {
            emitted.push({
              delta: {
                thinking: event.text,
                type: 'thinking_delta',
              },
              index: this.openThinkingIndex,
              type: 'content_block_delta',
            })
          }
          break
        case 'thinking_end':
          if (this.openThinkingIndex !== null) {
            emitted.push({
              index: this.openThinkingIndex,
              type: 'content_block_stop',
            })
            this.openThinkingIndex = null
          }
          break
        case 'text_start':
          this.openTextIndex = this.nextIndex++
          emitted.push({
            content_block: {
              text: '',
              type: 'text',
            },
            index: this.openTextIndex,
            type: 'content_block_start',
          })
          break
        case 'text_delta':
          if (this.openTextIndex !== null) {
            emitted.push({
              delta: {
                text: event.text,
                type: 'text_delta',
              },
              index: this.openTextIndex,
              type: 'content_block_delta',
            })
          }
          break
        case 'text_end':
          if (this.openTextIndex !== null) {
            emitted.push({
              index: this.openTextIndex,
              type: 'content_block_stop',
            })
            this.openTextIndex = null
          }
          break
        case 'tool_use_start': {
          const toolIndex = this.nextIndex++
          this.toolIndices.set(event.id, toolIndex)
          emitted.push({
            content_block: {
              id: event.id,
              input: {},
              name: event.name,
              type: 'tool_use',
            },
            index: toolIndex,
            type: 'content_block_start',
          })
          break
        }
        case 'tool_use_args_delta': {
          const toolIndex = this.toolIndices.get(event.id)
          if (toolIndex !== undefined) {
            emitted.push({
              delta: {
                partial_json: event.partialJson,
                type: 'input_json_delta',
              },
              index: toolIndex,
              type: 'content_block_delta',
            })
          }
          break
        }
        case 'tool_use_end': {
          const toolIndex = this.toolIndices.get(event.id)
          if (toolIndex !== undefined) {
            emitted.push({
              index: toolIndex,
              type: 'content_block_stop',
            })
            this.toolIndices.delete(event.id)
          }
          break
        }
        case 'message_stop':
          emitted.push({
            delta: {
              stop_reason: toMossenStopReason(event.stopReason),
              stop_sequence: null,
            },
            type: 'message_delta',
            usage: {
              input_tokens: event.usage.inputTokens,
              output_tokens: event.usage.outputTokens,
            },
          })
          emitted.push({ type: 'message_stop' })
          break
        case 'provider_error':
          break
      }
    }

    return emitted
  }
}

export function canonicalEventsToMossenEventList(
  events: Iterable<CanonicalStreamEvent>,
): MossenBetaRawMessageStreamEvent[] {
  return new MossenParityEventState().consume(events)
}

export async function* canonicalEventsToMossenEvents(
  events: AsyncIterable<CanonicalStreamEvent>,
): AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void> {
  const state = new MossenParityEventState()
  for await (const event of events) {
    yield* state.consume([event])
  }
}
