import {
  MossenAPIConnectionError,
  MossenAPIConnectionTimeoutError,
  MossenAPIError,
  MossenAPIUserAbortError,
  type MossenBetaMessage,
  type MossenBetaRawMessageStreamEvent,
} from './mossenSdk.js'
import {
  MESSAGES_PROTOCOL_VERSION_HEADER,
  MESSAGES_PROTOCOL_VERSION_VALUE,
} from './messagesProtocolConstants.js'
export {
  MESSAGES_PROTOCOL_VERSION_HEADER,
  MESSAGES_PROTOCOL_VERSION_VALUE,
} from './messagesProtocolConstants.js'

type MessagesCompatibleClientOptions = {
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

type TimedSignal = {
  cleanup: () => void
  signal: AbortSignal
  timedOut: () => boolean
}

type SSEFrame = {
  data?: string
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
  // W440: This file is a protocol-compat facade — mossen acts as a
  // client of messages-compatible APIs. The version header constant is
  // isolated at the API boundary because the server expects it verbatim.
  if (!headers.has(MESSAGES_PROTOCOL_VERSION_HEADER)) {
    headers.set(MESSAGES_PROTOCOL_VERSION_HEADER, MESSAGES_PROTOCOL_VERSION_VALUE)
  }
  return headers
}

function buildMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return '/v1/messages'

  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    if (pathname.endsWith('/v1/messages') || pathname.endsWith('/messages')) {
      return parsed.toString()
    }
    if (pathname.endsWith('/v1')) {
      parsed.pathname = `${pathname}/messages`
      return parsed.toString()
    }
    parsed.pathname = `${pathname}/v1/messages`
    return parsed.toString()
  } catch {
    if (trimmed.endsWith('/v1/messages') || trimmed.endsWith('/messages')) {
      return trimmed
    }
    if (trimmed.endsWith('/v1')) {
      return `${trimmed}/messages`
    }
    return `${trimmed}/v1/messages`
  }
}

function createTimedSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): TimedSignal {
  const controller = new AbortController()
  let timeoutFired = false

  const onAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }

  const timer = setTimeout(() => {
    timeoutFired = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function parseSSEFrame(frame: string): SSEFrame {
  const parsed: SSEFrame = {}
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'data') {
      data.push(value)
    }
  }
  if (data.length > 0) {
    parsed.data = data.join('\n')
  }
  return parsed
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let frameBoundary = buffer.match(/\r?\n\r?\n/)
    while (frameBoundary?.index !== undefined) {
      const boundary = frameBoundary.index
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + frameBoundary[0].length)
      const parsed = parseSSEFrame(frame)
      if (parsed.data && parsed.data !== '[DONE]') {
        yield JSON.parse(parsed.data) as MossenBetaRawMessageStreamEvent
      }
      frameBoundary = buffer.match(/\r?\n\r?\n/)
    }
  }

  const tail = buffer.trim()
  if (tail) {
    const parsed = parseSSEFrame(tail)
    if (parsed.data && parsed.data !== '[DONE]') {
      yield JSON.parse(parsed.data) as MossenBetaRawMessageStreamEvent
    }
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function performMessagesRequest(
  params: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: MessagesCompatibleClientOptions,
): Promise<Response> {
  const timeoutMs = requestOptions.timeout ?? clientOptions.timeoutMs
  const timedSignal = createTimedSignal(requestOptions.signal, timeoutMs)
  try {
    const response = await clientOptions.fetch(buildMessagesUrl(clientOptions.baseUrl), {
      method: 'POST',
      headers: buildRequestHeaders(
        clientOptions.defaultHeaders,
        requestOptions.headers,
      ),
      body: JSON.stringify(params),
      signal: timedSignal.signal,
    })
    if (!response.ok) {
      const body = await parseErrorBody(response)
      throw MossenAPIError.generate(
        response.status,
        body,
        extractErrorMessage(body) ?? `API request failed with status ${response.status}`,
        response.headers,
      )
    }
    return response
  } catch (error) {
    if (error instanceof MossenAPIError) throw error
    if (timedSignal.timedOut()) {
      throw new MossenAPIConnectionTimeoutError()
    }
    if (requestOptions.signal?.aborted) {
      throw new MossenAPIUserAbortError()
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MossenAPIUserAbortError()
    }
    throw new MossenAPIConnectionError({
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    timedSignal.cleanup()
  }
}

async function requestMessagesCompatibleMessage(
  params: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: MessagesCompatibleClientOptions,
): Promise<MossenBetaMessage> {
  const response = await performMessagesRequest(params, requestOptions, clientOptions)
  const message = (await response.json()) as MossenBetaMessage
  const requestId =
    response.headers.get('request-id') ??
    response.headers.get('x-request-id') ??
    undefined
  return Object.assign(message, {
    _request_id: requestId,
    asResponse: () => ({ ...message, headers: response.headers }),
  })
}

async function requestMessagesCompatibleStream(
  params: Record<string, unknown>,
  requestOptions: RequestOptions,
  clientOptions: MessagesCompatibleClientOptions,
): Promise<{
  data: AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void>
  request_id: string
  response: Response
}> {
  const response = await performMessagesRequest(params, requestOptions, clientOptions)
  if (!response.body) {
    throw new MossenAPIConnectionError({
      message: 'Messages-compatible streaming response body is empty',
    })
  }
  return {
    data: parseSSEStream(response.body),
    request_id:
      response.headers.get('request-id') ??
      response.headers.get('x-request-id') ??
      '',
    response,
  }
}

export function createMessagesCompatibleClient(
  options: MessagesCompatibleClientOptions,
): {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        requestOptions?: RequestOptions,
      ) => Promise<MossenBetaMessage> | {
        withResponse: () => Promise<{
          data: AsyncGenerator<MossenBetaRawMessageStreamEvent, void, void>
          request_id: string
          response: Response
        }>
      }
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
            return requestMessagesCompatibleMessage(
              params,
              requestOptions ?? {},
              options,
            )
          }

          return {
            withResponse: async () =>
              requestMessagesCompatibleStream(
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
