import type { AssistantToolRequest } from './canonical.js'

export type OfficialAssistantToolRequest = AssistantToolRequest & {
  input: Record<string, unknown>
  type: 'tool_use'
}

export type OfficialToolResultBlock = {
  content: unknown
  is_error?: boolean
  tool_use_id: string
  type: 'tool_result'
}

type MessageWithContentLike = {
  message: {
    content: unknown
  }
}

export type AssistantToolRequestWithMessage<
  TMessage extends MessageWithContentLike = MessageWithContentLike,
> = {
  message: TMessage
  toolRequest: OfficialAssistantToolRequest
}

export type OfficialAssistantToolRound = {
  assistantVisibleText: string | undefined
  toolRequests: OfficialAssistantToolRequest[]
  toolResultsByToolUseId: Map<string, OfficialToolResultBlock>
}

export function extractAssistantToolRequests(
  content: unknown,
): OfficialAssistantToolRequest[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap(block => {
    if (
      !block ||
      typeof block !== 'object' ||
      !('type' in block) ||
      (block as { type?: string }).type !== 'tool_use'
    ) {
      return []
    }

    const typedBlock = block as {
      id?: unknown
      input?: unknown
      name?: unknown
    }
    if (
      typeof typedBlock.id !== 'string' ||
      typeof typedBlock.name !== 'string' ||
      !typedBlock.input ||
      typeof typedBlock.input !== 'object' ||
      Array.isArray(typedBlock.input)
    ) {
      return []
    }

    return [
      {
        argumentsObject: typedBlock.input as Record<string, unknown>,
        id: typedBlock.id,
        input: typedBlock.input as Record<string, unknown>,
        name: typedBlock.name,
        type: 'tool_use',
      },
    ]
  })
}

export function countAssistantToolRequests(content: unknown): number {
  return extractAssistantToolRequests(content).length
}

export function hasAssistantToolRequests(content: unknown): boolean {
  return countAssistantToolRequests(content) > 0
}

export function findAssistantToolRequestByName(
  content: unknown,
  toolName: string,
): OfficialAssistantToolRequest | undefined {
  return extractAssistantToolRequests(content).find(
    toolRequest => toolRequest.name === toolName,
  )
}

export function hasAssistantToolRequestNamed(
  content: unknown,
  toolName: string,
): boolean {
  return findAssistantToolRequestByName(content, toolName) !== undefined
}

export function extractAssistantToolRequestIds(content: unknown): string[] {
  return extractAssistantToolRequests(content).map(toolRequest => toolRequest.id)
}

export function countAssistantToolRequestsInMessages(
  messages: ReadonlyArray<{ message: { content: unknown } }>,
): number {
  return messages.reduce(
    (total, message) => total + countAssistantToolRequests(message.message.content),
    0,
  )
}

export function extractAssistantToolRequestsInMessages(
  messages: ReadonlyArray<MessageWithContentLike | null | undefined>,
): OfficialAssistantToolRequest[] {
  return messages.flatMap(message =>
    message ? extractAssistantToolRequests(message.message.content) : [],
  )
}

export function extractAssistantToolRequestsWithMessages<
  TMessage extends MessageWithContentLike,
>(
  messages: ReadonlyArray<TMessage | null | undefined>,
): AssistantToolRequestWithMessage<TMessage>[] {
  return messages.flatMap(message =>
    message
      ? extractAssistantToolRequests(message.message.content).map(toolRequest => ({
          message,
          toolRequest,
        }))
      : [],
  )
}

export function findMostRecentAssistantToolRequest(
  messages: ReadonlyArray<MessageWithContentLike | null | undefined>,
  toolName: string,
): OfficialAssistantToolRequest | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) {
      continue
    }
    const toolRequest = findAssistantToolRequestByName(
      message.message.content,
      toolName,
    )
    if (toolRequest) {
      return toolRequest
    }
  }
  return undefined
}

export function hasAssistantToolRequestNamedInMessages(
  messages: ReadonlyArray<MessageWithContentLike | null | undefined>,
  toolName: string,
): boolean {
  return findMostRecentAssistantToolRequest(messages, toolName) !== undefined
}

export function extractOfficialToolResultIds(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap(block =>
    isOfficialToolResultBlock(block) ? [block.tool_use_id] : [],
  )
}

export function extractOfficialToolResultBlocks(
  content: unknown,
): OfficialToolResultBlock[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap(block => (isOfficialToolResultBlock(block) ? [block] : []))
}

export function hasOfficialToolResultBlocks(content: unknown): boolean {
  return extractOfficialToolResultBlocks(content).length > 0
}

export function stripOfficialToolResultBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content
  }

  const stripped = content.filter(block => !isOfficialToolResultBlock(block))
  return stripped.length === content.length ? content : stripped
}

export function findOfficialToolResultInMessages(
  messages: ReadonlyArray<{ message: { content: unknown }; type: string }>,
  toolUseId: string,
): OfficialToolResultBlock | undefined {
  for (const message of messages) {
    if (message.type !== 'user') {
      continue
    }
    const block = findOfficialToolResultBlock(message.message.content, toolUseId)
    if (block) {
      return block
    }
  }
  return undefined
}

export function extractAssistantVisibleText(content: unknown): string {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .flatMap(block =>
      block &&
      typeof block === 'object' &&
      'type' in block &&
      (block as { type?: string }).type === 'text' &&
      'text' in block &&
      typeof (block as { text?: unknown }).text === 'string'
        ? [(block as { text: string }).text]
        : [],
    )
    .join('')
}

export function findMostRecentAssistantVisibleTextInMessages(
  messages: ReadonlyArray<MessageWithContentLike | null | undefined>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) {
      continue
    }
    const text = extractAssistantVisibleText(message.message.content)
    if (text) {
      return text
    }
  }
  return undefined
}

export function buildOfficialAssistantToolRound(
  assistantMessages: ReadonlyArray<MessageWithContentLike | null | undefined>,
  toolResultMessages: ReadonlyArray<{ message: { content: unknown }; type: string }>,
): OfficialAssistantToolRound {
  const toolRequests = extractAssistantToolRequestsInMessages(assistantMessages)
  const toolResultsByToolUseId = new Map<string, OfficialToolResultBlock>()
  for (const toolRequest of toolRequests) {
    const toolResult = findOfficialToolResultInMessages(
      toolResultMessages,
      toolRequest.id,
    )
    if (toolResult) {
      toolResultsByToolUseId.set(toolRequest.id, toolResult)
    }
  }
  return {
    assistantVisibleText:
      findMostRecentAssistantVisibleTextInMessages(assistantMessages),
    toolRequests,
    toolResultsByToolUseId,
  }
}

export function mapAssistantToolRequestInputs(
  content: unknown,
  mapper: (
    toolRequest: OfficialAssistantToolRequest,
  ) => Record<string, unknown>,
): unknown {
  if (!Array.isArray(content)) {
    return content
  }

  let clonedContent: unknown[] | undefined
  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    const toolRequest = extractAssistantToolRequests([block])[0]
    if (!toolRequest) {
      continue
    }

    const mappedInput = mapper(toolRequest)
    if (mappedInput === toolRequest.input) {
      continue
    }

    clonedContent ??= [...content]
    clonedContent[i] = {
      ...(block as Record<string, unknown>),
      input: mappedInput,
    }
  }

  return clonedContent ?? content
}

export function createOfficialToolResultBlock(
  toolUseId: string,
  content: unknown,
  isError = false,
): OfficialToolResultBlock {
  return {
    content,
    ...(isError ? { is_error: true } : {}),
    tool_use_id: toolUseId,
    type: 'tool_result',
  }
}

export function isOfficialToolResultBlock(
  block: unknown,
): block is OfficialToolResultBlock {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type?: string }).type === 'tool_result' &&
    'tool_use_id' in block &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
  )
}

export function findOfficialToolResultBlock(
  content: unknown,
  toolUseId: string,
): OfficialToolResultBlock | undefined {
  if (!Array.isArray(content)) {
    return undefined
  }

  return content.find(
    block =>
      isOfficialToolResultBlock(block) && block.tool_use_id === toolUseId,
  )
}

export function findFirstOfficialToolResultBlock(
  content: unknown,
): OfficialToolResultBlock | undefined {
  return extractOfficialToolResultBlocks(content)[0]
}
