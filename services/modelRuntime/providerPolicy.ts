import { getCustomBackendProtocol } from '../../utils/customBackend.js'
import type {
  OfficialSemanticCapabilities,
  ThinkingParityStrategy,
} from './canonical.js'

export type ProviderModelPolicy = {
  capabilities: OfficialSemanticCapabilities
  syntheticTags: {
    responseClose: string
    responseOpen: string
    thinkingClose: string
    thinkingOpen: string
  }
  thinkingStrategy: ThinkingParityStrategy
}

const MOSSEN_COMPATIBLE_CAPABILITIES: OfficialSemanticCapabilities = {
  mixedContentToolUse: true,
  nativeThinkingBlocks: true,
  reasoningBudget: true,
  streamingToolArgDeltas: true,
  structuredStopReasons: true,
  supportsAssistantPreludeBeforeToolUse: true,
  toolCallArgsEncoding: 'object',
  toolResultRoleStyle: 'mossen_user_tool_result',
}

const OPENAI_COMPATIBLE_CAPABILITIES: OfficialSemanticCapabilities = {
  mixedContentToolUse: false,
  nativeThinkingBlocks: false,
  reasoningBudget: false,
  streamingToolArgDeltas: true,
  structuredStopReasons: false,
  supportsAssistantPreludeBeforeToolUse: true,
  toolCallArgsEncoding: 'json_string',
  toolResultRoleStyle: 'openai_tool_role',
}

const DEFAULT_SYNTHETIC_TAGS = {
  thinkingOpen: '<assistant_thinking>',
  thinkingClose: '</assistant_thinking>',
  responseOpen: '<assistant_response>',
  responseClose: '</assistant_response>',
} as const

function resolveThinkingStrategy(
  requestedThinking: unknown,
  protocol: string,
): ThinkingParityStrategy {
  if (protocol === 'mossen-compatible') {
    return 'native'
  }

  if (
    requestedThinking &&
    typeof requestedThinking === 'object' &&
    'type' in requestedThinking &&
    (requestedThinking as { type?: string }).type === 'disabled'
  ) {
    return 'none'
  }

  const envStrategy =
    process.env.MOSSEN_CODE_CUSTOM_THINKING_PARITY_STRATEGY?.trim()
  if (envStrategy === 'synthetic_two_pass') {
    return 'synthetic_two_pass'
  }
  if (envStrategy === 'none') {
    return 'none'
  }

  return 'synthetic_single_pass'
}

export function getOfficialSemanticCapabilities(): OfficialSemanticCapabilities {
  return getCustomBackendProtocol() === 'openai-compatible'
    ? OPENAI_COMPATIBLE_CAPABILITIES
    : MOSSEN_COMPATIBLE_CAPABILITIES
}

export function resolveProviderModelPolicy({
  requestedThinking,
}: {
  requestedThinking: unknown
}): ProviderModelPolicy {
  const protocol = getCustomBackendProtocol()
  return {
    capabilities:
      protocol === 'openai-compatible'
        ? OPENAI_COMPATIBLE_CAPABILITIES
        : MOSSEN_COMPATIBLE_CAPABILITIES,
    syntheticTags: { ...DEFAULT_SYNTHETIC_TAGS },
    thinkingStrategy: resolveThinkingStrategy(requestedThinking, protocol),
  }
}
