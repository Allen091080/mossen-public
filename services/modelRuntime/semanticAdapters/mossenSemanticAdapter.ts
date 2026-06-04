import type {
  MossenBetaMessage,
  MossenBetaRawMessageStreamEvent,
} from '../../api/mossenSdk.js'
import type {
  CanonicalStreamEvent,
  CanonicalTurnResult,
  OfficialSemanticCapabilities,
} from '../canonical.js'
import { canonicalStopReasonFromMossen } from '../canonical.js'

export const MOSSEN_SEMANTIC_CAPABILITIES: OfficialSemanticCapabilities = {
  mixedContentToolUse: true,
  nativeThinkingBlocks: true,
  reasoningBudget: true,
  streamingToolArgDeltas: true,
  structuredStopReasons: true,
  supportsAssistantPreludeBeforeToolUse: true,
  toolCallArgsEncoding: 'object',
  toolResultRoleStyle: 'mossen_user_tool_result',
}

export function mossenMessageToCanonicalTurn(
  message: MossenBetaMessage,
): CanonicalTurnResult {
  return {
    stopReason: canonicalStopReasonFromMossen(message.stop_reason),
    thinkingText: message.content
      .filter(block => block.type === 'thinking')
      .map(block => block.thinking)
      .join(''),
    toolRequests: message.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        argumentsObject: block.input,
        id: block.id,
        name: block.name,
      })),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    visibleText: message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(''),
  }
}

export class MossenSemanticEventState {
  private readonly toolUseIds = new Map<number, string>()
  private readonly contentBlockTypes = new Map<number, string>()

  consume(event: MossenBetaRawMessageStreamEvent): CanonicalStreamEvent[] {
    switch (event.type) {
      case 'message_start':
        return [
          {
            messageId: event.message.id,
            model: event.message.model,
            type: 'message_start',
          },
        ]
      case 'content_block_start':
        this.contentBlockTypes.set(event.index, event.content_block.type)
        if (event.content_block.type === 'thinking') {
          return [{ type: 'thinking_start' }]
        }
        if (event.content_block.type === 'text') {
          return [{ type: 'text_start' }]
        }
        if (event.content_block.type === 'tool_use') {
          this.toolUseIds.set(event.index, event.content_block.id)
          return [
            {
              id: event.content_block.id,
              name: event.content_block.name,
              type: 'tool_use_start',
            },
          ]
        }
        return []
      case 'content_block_delta':
        if (event.delta.type === 'thinking_delta') {
          return [{ text: event.delta.thinking, type: 'thinking_delta' }]
        }
        if (event.delta.type === 'text_delta') {
          return [{ text: event.delta.text, type: 'text_delta' }]
        }
        if (event.delta.type === 'input_json_delta') {
          const toolUseId = this.toolUseIds.get(event.index)
          return toolUseId
            ? [
                {
                  id: toolUseId,
                  partialJson: event.delta.partial_json,
                  type: 'tool_use_args_delta',
                },
              ]
            : []
        }
        return []
      case 'content_block_stop': {
        const contentBlockType = this.contentBlockTypes.get(event.index)
        if (contentBlockType === 'thinking') {
          return [{ type: 'thinking_end' }]
        }
        if (contentBlockType === 'text') {
          return [{ type: 'text_end' }]
        }
        if (contentBlockType === 'tool_use') {
          const toolUseId = this.toolUseIds.get(event.index)
          this.toolUseIds.delete(event.index)
          return toolUseId ? [{ id: toolUseId, type: 'tool_use_end' }] : []
        }
        return []
      }
      case 'message_delta':
        return [
          {
            stopReason: canonicalStopReasonFromMossen(
              event.delta.stop_reason,
            ),
            type: 'message_stop',
            usage: {
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
            },
          },
        ]
      default:
        return []
    }
  }
}

export function mossenEventToCanonicalEvents(
  event: MossenBetaRawMessageStreamEvent,
): CanonicalStreamEvent[] {
  return new MossenSemanticEventState().consume(event)
}
