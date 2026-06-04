/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import { randomUUID } from 'crypto'
import {
  MossenAPIError,
  type MossenBetaMessage,
  type MossenBetaMessageParam,
  type MossenBetaRawMessageStreamEvent,
  type MossenBetaToolChoice,
  type MossenBetaToolUnion,
  type MossenBetaUsage,
} from './mossenSdk.js'
import {
  MossenParityEventState,
  canonicalTurnToMossenMessage,
} from '../modelRuntime/mossenParityBridge.js'
import {
  OpenAICompatibleStreamSemanticState,
  openAICompatibleCompletionToCanonicalTurn,
} from '../modelRuntime/semanticAdapters/openaiCompatibleSemanticAdapter.js'
import {
  resolveProviderModelPolicy,
  type ProviderModelPolicy,
} from '../modelRuntime/providerPolicy.js'
import {
  createOpenAICompatibleVisionRequestError,
  createOpenAICompatibleVisionValidationState,
  getOpenAICompatibleVisionRequestLimits,
  validateOpenAICompatibleVisionImagePart,
} from './visionRequestGuard.js'

type OpenAICompatibleClientOptions = {
  baseUrl: string
  defaultHeaders: Record<string, string>
  fetch: typeof globalThis.fetch
  timeoutMs: number
}

type RequestOptions = {
  headers?: HeadersInit
  signal?: AbortSignal
  timeout?: number
}

type OpenAICompatibleToolCall = {
  function?: {
    arguments?: string
    name?: string
  }
  id?: string
  index?: number
  type?: string
}

type OpenAIChatCompletionChoice = {
  delta?: {
    content?: null | string | unknown[]
    role?: string
    tool_calls?: OpenAICompatibleToolCall[]
  }
  finish_reason?: string | null
  message?: {
    content?: null | string | unknown[]
    role?: string
    tool_calls?: OpenAICompatibleToolCall[]
  }
}

type OpenAIChatCompletionResponse = {
  choices?: OpenAIChatCompletionChoice[]
  id?: string
  model?: string
  usage?: {
    completion_tokens?: number
    prompt_tokens?: number
  }
}

type OpenAIStreamToolState = {
  accumulatedJson: string
  mossenIndex: number
  closed: boolean
  emittedStart: boolean
  id: string
  name: null | string
  pendingJson: string
}

type SSEFrame = {
  data?: string
  event?: string
  id?: string
}

type SyntheticThinkingParts = {
  thinkingText: string
  visibleText: string
}

type SyntheticThinkingStreamEvent =
  | { type: 'text_end' | 'text_start' | 'thinking_end' | 'thinking_start' }
  | { text: string; type: 'text_delta' | 'thinking_delta' }

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

function buildRequestHeaders(
  defaultHeaders: Record<string, string>,
  requestHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(defaultHeaders)
  const extraHeaders = new Headers(requestHeaders)
  extraHeaders.forEach((value, key) => {
    headers.set(key, value)
  })
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }
    const typedBlock = block as {
      content?: unknown
      is_error?: boolean
      text?: string
      type?: string
    }
    if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
      parts.push(typedBlock.text)
      continue
    }
    if (typedBlock.type === 'tool_result') {
      const nested = flattenContent(typedBlock.content)
      if (nested) {
        parts.push(typedBlock.is_error ? `Tool error: ${nested}` : nested)
      }
    }
  }
  return parts.join('\n\n')
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

function normalizeSystemPrompt(system: unknown): null | string {
  if (typeof system === 'string') {
    return system.trim() ? system : null
  }
  if (!Array.isArray(system)) {
    return null
  }
  const text = system
    .map(block =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('\n\n')
    .trim()
  return text || null
}

function buildSyntheticThinkingInstruction(
  policy: ProviderModelPolicy,
): string {
  return [
    'When responding, preserve Mossen-style reasoning semantics using these exact wrappers.',
    `Put hidden analysis inside ${policy.syntheticTags.thinkingOpen}...${policy.syntheticTags.thinkingClose}.`,
    `Put user-visible prose inside ${policy.syntheticTags.responseOpen}...${policy.syntheticTags.responseClose}.`,
    'If you call tools, keep any short pre-tool explanation inside the response wrapper and return tool calls normally.',
    'Do not mention the wrappers or explain the formatting.',
  ].join(' ')
}

function maybeAugmentSystemPromptForParity(
  systemPrompt: null | string,
  includeSyntheticThinking: boolean,
  policy: ProviderModelPolicy,
): null | string {
  if (!includeSyntheticThinking || policy.thinkingStrategy === 'none') {
    return systemPrompt
  }
  const instruction = buildSyntheticThinkingInstruction(policy)
  return systemPrompt
    ? `${systemPrompt}\n\n${instruction}`
    : instruction
}

function serializeSyntheticAssistantContent(
  content: string,
  thinking: string | undefined,
  policy: ProviderModelPolicy,
): string {
  if (!content && !thinking) {
    return ''
  }
  if (!thinking || !policy.thinkingStrategy.startsWith('synthetic')) {
    return content
  }
  return `${policy.syntheticTags.thinkingOpen}${thinking}${policy.syntheticTags.thinkingClose}${policy.syntheticTags.responseOpen}${content}${policy.syntheticTags.responseClose}`
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

function mossenMessagesToOpenAI(
  system: unknown,
  messages: MossenBetaMessageParam[],
  policy: ProviderModelPolicy,
  includeSyntheticThinking: boolean,
): Array<Record<string, unknown>> {
  const openAIMessages: Array<Record<string, unknown>> = []
  const systemPrompt = maybeAugmentSystemPromptForParity(
    normalizeSystemPrompt(system),
    includeSyntheticThinking,
    policy,
  )
  if (systemPrompt) {
    openAIMessages.push({ role: 'system', content: systemPrompt })
  }

  for (const message of messages) {
    const role = message.role
    const content = message.content

    if (typeof content === 'string') {
      openAIMessages.push({ role, content })
      continue
    }

    if (!Array.isArray(content)) {
      openAIMessages.push({ role, content: '' })
      continue
    }

    if (role === 'assistant') {
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []

      for (const block of content) {
        if (!block || typeof block !== 'object') {
          continue
        }
        const typedBlock = block as {
          id?: string
          input?: unknown
          name?: string
          signature?: string
          text?: string
          thinking?: string
          type?: string
        }
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          textParts.push(typedBlock.text)
          continue
        }
        if (
          typedBlock.type === 'thinking' &&
          typeof typedBlock.thinking === 'string'
        ) {
          thinkingParts.push(typedBlock.thinking)
          continue
        }
        if (typedBlock.type === 'tool_use' && typedBlock.name) {
          toolCalls.push({
            id: typedBlock.id ?? randomUUID(),
            type: 'function',
            function: {
              arguments: JSON.stringify(typedBlock.input ?? {}),
              name: typedBlock.name,
            },
          })
        }
      }

      openAIMessages.push({
        role: 'assistant',
        content:
          textParts.length > 0 || thinkingParts.length > 0
            ? serializeSyntheticAssistantContent(
                textParts.join('\n\n'),
                thinkingParts.join('\n\n') || undefined,
                policy,
              )
            : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    // OpenAI vision parts:
    //   text   → { type: 'text', text }
    //   image  → { type: 'image_url', image_url: { url: 'data:<mt>;base64,<b64>' } }
    // If a user turn has image parts, content must be an array (OpenAI vision
    // schema). If it's text-only, keep content as a single string for
    // back-compat with text-only providers that reject array content.
    type UserTextPart = { type: 'text'; text: string }
    type UserImageUrlPart = {
      type: 'image_url'
      image_url: { url: string }
    }
    let pendingUserParts: Array<UserTextPart | UserImageUrlPart> = []
    let visionValidationState = createOpenAICompatibleVisionValidationState()
    const visionLimits = getOpenAICompatibleVisionRequestLimits()
    const flushUserParts = () => {
      if (pendingUserParts.length === 0) {
        return
      }
      const hasImage = pendingUserParts.some(p => p.type === 'image_url')
      if (hasImage) {
        openAIMessages.push({
          role: 'user',
          content: pendingUserParts,
        })
      } else {
        openAIMessages.push({
          role: 'user',
          content: (pendingUserParts as UserTextPart[])
            .map(p => p.text)
            .join('\n\n'),
        })
      }
      pendingUserParts = []
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const typedBlock = block as {
        content?: unknown
        is_error?: boolean
        source?: {
          data?: string
          media_type?: string
          type?: string
        }
        text?: string
        tool_use_id?: string
        type?: string
      }
      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
        pendingUserParts.push({ type: 'text', text: typedBlock.text })
        continue
      }
      if (
        typedBlock.type === 'image' &&
        typedBlock.source?.type === 'base64' &&
        typeof typedBlock.source.data === 'string' &&
        typeof typedBlock.source.media_type === 'string'
      ) {
        const validation = validateOpenAICompatibleVisionImagePart(
          {
            base64Data: typedBlock.source.data,
            mediaType: typedBlock.source.media_type,
          },
          visionValidationState,
          visionLimits,
        )
        if (validation.ok === false) {
          throw createOpenAICompatibleVisionRequestError(validation.reason)
        }
        visionValidationState = validation.state
        const dataUrl = `data:${typedBlock.source.media_type};base64,${typedBlock.source.data}`
        pendingUserParts.push({
          type: 'image_url',
          image_url: { url: dataUrl },
        })
        continue
      }
      if (typedBlock.type === 'tool_result') {
        flushUserParts()
        openAIMessages.push({
          role: 'tool',
          tool_call_id: typedBlock.tool_use_id ?? randomUUID(),
          content: flattenContent(typedBlock.content),
          ...(typedBlock.is_error ? { name: 'tool_error' } : {}),
        })
      }
    }

    flushUserParts()
  }

  return openAIMessages
}

function mossenToolsToOpenAI(
  tools: undefined | MossenBetaToolUnion[],
): undefined | Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) {
    return undefined
  }

  const openAITools = tools
    .filter(tool => {
      return (
        tool &&
        typeof tool === 'object' &&
        'name' in tool &&
        'input_schema' in tool &&
        typeof tool.name === 'string'
      )
    })
    .map(tool => {
      const typedTool = tool as {
        description?: string
        input_schema?: unknown
        name: string
      }
      return {
        type: 'function',
        function: {
          name: typedTool.name,
          ...(typedTool.description ? { description: typedTool.description } : {}),
          parameters:
            typeof typedTool.input_schema === 'object' && typedTool.input_schema
              ? typedTool.input_schema
              : {
                  additionalProperties: true,
                  properties: {},
                  type: 'object',
                },
        },
      }
    })

  return openAITools.length > 0 ? openAITools : undefined
}

function mossenToolChoiceToOpenAI(
  toolChoice: MossenBetaToolChoice | undefined,
): Record<string, unknown> | string | undefined {
  if (!toolChoice || typeof toolChoice !== 'object') {
    return undefined
  }
  if (toolChoice.type === 'auto') {
    return 'auto'
  }
  if (toolChoice.type === 'tool' && 'name' in toolChoice) {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }
  return undefined
}

function mossenOutputFormatToOpenAI(
  params: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const format =
    (params.output_format as Record<string, unknown> | undefined) ??
    ((params.output_config as { format?: Record<string, unknown> } | undefined)
      ?.format ?? undefined)

  if (!format || format.type !== 'json_schema') {
    return undefined
  }

  const schema = format.schema
  if (!schema || typeof schema !== 'object') {
    return undefined
  }

  return {
    type: 'json_schema',
    json_schema: {
      name:
        typeof format.name === 'string' && format.name.trim()
          ? format.name
          : 'structured_output',
      schema,
      strict: true,
    },
  }
}

function mapStopReason(
  finishReason: null | string | undefined,
  hasToolCalls: boolean,
): MossenBetaMessage['stop_reason'] {
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (finishReason === 'tool_calls' || hasToolCalls) {
    return 'tool_use'
  }
  return 'end_turn'
}

function toMossenUsage(
  usage: OpenAIChatCompletionResponse['usage'],
): MossenBetaUsage {
  return {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  }
}

function completionToMossenMessage(
  data: OpenAIChatCompletionResponse,
  fallbackModel: string,
  policy: ProviderModelPolicy,
): MossenBetaMessage {
  const canonicalResult = openAICompatibleCompletionToCanonicalTurn(data, policy)
  return canonicalTurnToMossenMessage(
    canonicalResult,
    data.model ?? fallbackModel,
    data.id,
  )
}

function createMessageStart(message: MossenBetaMessage): MossenBetaRawMessageStreamEvent {
  return {
    message: {
      ...message,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        ...message.usage,
        output_tokens: 0,
      },
    },
    type: 'message_start',
  }
}

function buildSyntheticStreamEvents(
  message: MossenBetaMessage,
): MossenBetaRawMessageStreamEvent[] {
  const events: MossenBetaRawMessageStreamEvent[] = [createMessageStart(message)]

  message.content.forEach((block, index) => {
    if (block.type === 'thinking') {
      events.push({
        content_block: { signature: block.signature, thinking: '', type: 'thinking' },
        index,
        type: 'content_block_start',
      })
      events.push({
        delta: { thinking: block.thinking, type: 'thinking_delta' },
        index,
        type: 'content_block_delta',
      })
      events.push({ index, type: 'content_block_stop' })
      return
    }

    if (block.type === 'text') {
      events.push({
        content_block: { type: 'text', text: '' },
        index,
        type: 'content_block_start',
      })
      events.push({
        delta: { text: block.text, type: 'text_delta' },
        index,
        type: 'content_block_delta',
      })
      events.push({ index, type: 'content_block_stop' })
      return
    }

    if (block.type === 'tool_use') {
      events.push({
        content_block: {
          id: block.id,
          input: {},
          name: block.name,
          type: 'tool_use',
        },
        index,
        type: 'content_block_start',
      })
      events.push({
        delta: {
          partial_json: JSON.stringify(block.input ?? {}),
          type: 'input_json_delta',
        },
        index,
        type: 'content_block_delta',
      })
      events.push({ index, type: 'content_block_stop' })
    }
  })

  events.push({
    delta: {
      stop_reason: message.stop_reason,
      stop_sequence: message.stop_sequence,
    },
    type: 'message_delta',
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    },
  })
  events.push({ type: 'message_stop' })
  return events
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T, void, void> {
  for (const item of items) {
    yield item
  }
}

function parseSSEFrames(buffer: string): {
  frames: SSEFrame[]
  remaining: string
} {
  const frames: SSEFrame[] = []
  let pos = 0

  let idx: number
  while ((idx = buffer.indexOf('\n\n', pos)) !== -1) {
    const rawFrame = buffer.slice(pos, idx)
    pos = idx + 2

    if (!rawFrame.trim()) {
      continue
    }

    const frame: SSEFrame = {}
    let isComment = false
    for (const line of rawFrame.split('\n')) {
      if (line.startsWith(':')) {
        isComment = true
        continue
      }

      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) {
        continue
      }

      const field = line.slice(0, colonIdx)
      const value =
        line[colonIdx + 1] === ' '
          ? line.slice(colonIdx + 2)
          : line.slice(colonIdx + 1)

      switch (field) {
        case 'event':
          frame.event = value
          break
        case 'id':
          frame.id = value
          break
        case 'data':
          frame.data = frame.data ? `${frame.data}\n${value}` : value
          break
      }
    }

    if (frame.data || isComment) {
      frames.push(frame)
    }
  }

  return {
    frames,
    remaining: buffer.slice(pos),
  }
}

function getRequestId(headers: Headers): string {
  return (
    headers.get('request-id') ??
    headers.get('x-request-id') ??
    headers.get('openai-request-id') ??
    randomUUID()
  )
}

function createOpenAIRequestBody(
  params: Record<string, unknown>,
  stream: boolean,
): Record<string, unknown> {
  const policy = resolveProviderModelPolicy({
    requestedThinking: params.thinking,
  })
  const includeSyntheticThinking =
    policy.thinkingStrategy === 'synthetic_single_pass' ||
    policy.thinkingStrategy === 'synthetic_two_pass'
  const body: Record<string, unknown> = {
    model: params.model,
    messages: mossenMessagesToOpenAI(
      params.system,
      (params.messages as MossenBetaMessageParam[]) ?? [],
      policy,
      includeSyntheticThinking,
    ),
    max_tokens: params.max_tokens,
    stream,
    // Without this, streaming chunks omit usage and inputTokens/outputTokens
    // collapse to 0 for all OpenAI-compat providers (Qwen, DeepSeek, OpenRouter,
    // vLLM, ollama). Standard flag — providers that don't implement it are
    // required by the spec to ignore unknown fields, so this is zero-regression.
    ...(stream && { stream_options: { include_usage: true } }),
  }

  const tools = mossenToolsToOpenAI(params.tools as MossenBetaToolUnion[] | undefined)
  if (tools) {
    body.tools = tools
  }

  const toolChoice = mossenToolChoiceToOpenAI(
    params.tool_choice as MossenBetaToolChoice | undefined,
  )
  if (toolChoice) {
    body.tool_choice = toolChoice
  }

  const responseFormat = mossenOutputFormatToOpenAI(params)
  if (responseFormat) {
    body.response_format = responseFormat
  }

  if (typeof params.temperature === 'number') {
    body.temperature = params.temperature
  }
  if (Array.isArray(params.stop_sequences) && params.stop_sequences.length > 0) {
    body.stop = params.stop_sequences
  }

  return body
}

async function performOpenAICompatibleRequest(
  body: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: OpenAICompatibleClientOptions,
): Promise<{
  rawResponse: Response
  requestId: string
  response: Response
}> {
  const url = new URL('chat/completions', `${clientOptions.baseUrl}/`).toString()
  const headers = buildRequestHeaders(
    clientOptions.defaultHeaders,
    requestOptions.headers,
  )

  const controller = new AbortController()
  const timeoutMs = requestOptions.timeout ?? clientOptions.timeoutMs
  const timeoutHandle =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  if (requestOptions.signal) {
    requestOptions.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    })
  }

  let rawResponse: Response
  try {
    rawResponse = await clientOptions.fetch(url, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
      signal: controller.signal,
    })
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }

  const requestId = getRequestId(rawResponse.headers)
  const responseHeaders = new Headers(rawResponse.headers)
  responseHeaders.set('request-id', requestId)
  const response = new Response(null, {
    headers: responseHeaders,
    status: rawResponse.status,
    statusText: rawResponse.statusText,
  })

  if (!rawResponse.ok) {
    const errorBody = await readOpenAICompatibleErrorBody(rawResponse)
    throw MossenAPIError.generate(
      rawResponse.status,
      errorBody,
      undefined,
      response.headers,
    )
  }

  return {
    rawResponse,
    requestId,
    response,
  }
}

async function readOpenAICompatibleErrorBody(response: Response): Promise<unknown> {
  let rawText = ''
  try {
    rawText = await response.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: { message } }
  }

  if (!rawText.trim()) {
    return { error: { message: response.statusText || `HTTP ${response.status}` } }
  }

  try {
    return JSON.parse(rawText)
  } catch {
    return { error: { message: rawText } }
  }
}

function getChoiceContentDelta(choice: OpenAIChatCompletionChoice): string {
  return flattenTextContent(choice.delta?.content ?? choice.message?.content)
}

function getChoiceToolCalls(
  choice: OpenAIChatCompletionChoice,
): OpenAICompatibleToolCall[] {
  const toolCalls = choice.delta?.tool_calls ?? choice.message?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

function createStreamMessageSkeleton(
  id: string,
  model: string,
): MossenBetaMessage {
  return {
    id,
    content: [],
    model,
    role: 'assistant',
    stop_reason: null,
    stop_sequence: null,
    type: 'message',
    usage: toMossenUsage(undefined),
  }
}

async function* streamResponseToMossenEvents(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
  policy: ProviderModelPolicy,
): AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parityBridge = new MossenParityEventState()
  const semanticState = new OpenAICompatibleStreamSemanticState(
    fallbackModel,
    policy,
  )
  let buffer = ''
  let streamDone = false
  while (!streamDone) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSSEFrames(buffer)
    buffer = parsed.remaining

    for (const frame of parsed.frames) {
      if (!frame.data) {
        continue
      }
      if (frame.data === '[DONE]') {
        streamDone = true
        break
      }
      yield* parityBridge.consume(
        semanticState.consumeChunk(
          JSON.parse(frame.data) as OpenAIChatCompletionResponse,
        ),
      )
    }
  }

  const finalText = decoder.decode()
  if (finalText) {
    buffer += finalText
  }
  if (buffer.trim()) {
    const trailing = parseSSEFrames(`${buffer}\n\n`)
    for (const frame of trailing.frames) {
      if (!frame.data || frame.data === '[DONE]') {
        continue
      }
      yield* parityBridge.consume(
        semanticState.consumeChunk(
          JSON.parse(frame.data) as OpenAIChatCompletionResponse,
        ),
      )
    }
  }
  yield* parityBridge.consume(semanticState.finish())
}

async function requestOpenAICompatibleCompletion(
  params: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: OpenAICompatibleClientOptions,
): Promise<{
  mossenMessage: MossenBetaMessage
  requestId: string
  response: Response
}> {
  const request = await performOpenAICompatibleRequest(
    createOpenAIRequestBody(params, false),
    requestOptions,
    clientOptions,
  )
  const completion = (await request.rawResponse.json()) as OpenAIChatCompletionResponse
  const policy = resolveProviderModelPolicy({
    requestedThinking: params.thinking,
  })
  return {
    mossenMessage: completionToMossenMessage(
      completion,
      String(params.model ?? ''),
      policy,
    ),
    requestId: request.requestId,
    response: request.response,
  }
}

async function requestOpenAICompatibleStream(
  params: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: OpenAICompatibleClientOptions,
): Promise<{
  data: AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void>
  request_id: string
  response: Response
}> {
  const request = await performOpenAICompatibleRequest(
    createOpenAIRequestBody(params, true),
    requestOptions,
    clientOptions,
  )
  const contentType = request.rawResponse.headers.get('content-type') ?? ''

  if (
    !contentType.toLowerCase().includes('text/event-stream') ||
    !request.rawResponse.body
  ) {
    const completion = (await request.rawResponse.json()) as OpenAIChatCompletionResponse
    const policy = resolveProviderModelPolicy({
      requestedThinking: params.thinking,
    })
    return {
      data: toAsyncIterable(
        buildSyntheticStreamEvents(
          completionToMossenMessage(
            completion,
            String(params.model ?? ''),
            policy,
          ),
        ),
      ),
      request_id: request.requestId,
      response: request.response,
    }
  }

  return {
    data: streamResponseToMossenEvents(
      request.rawResponse.body,
      String(params.model ?? ''),
      resolveProviderModelPolicy({
        requestedThinking: params.thinking,
      }),
    ),
    request_id: request.requestId,
    response: request.response,
  }
}

export function createOpenAICompatibleClient(
  options: OpenAICompatibleClientOptions,
): {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        requestOptions?: RequestOptions,
      ) => Promise<MossenBetaMessage> | { withResponse: () => Promise<{
        data: AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void>
        request_id: string
        response: Response
      }> }
    }
  }
} {
  return {
    beta: {
      messages: {
        create: (
          params: Record<string, unknown>,
          requestOptions?: RequestOptions,
        ) => {
          const wantsStream = params.stream === true
          if (!wantsStream) {
            return requestOpenAICompatibleCompletion(
              params,
              requestOptions ?? {},
              options,
            ).then(result => result.mossenMessage)
          }

          return {
            withResponse: async () =>
              requestOpenAICompatibleStream(
                params,
                requestOptions ?? {},
                options,
              ),
          }
        },
      },
    },
  }
}
