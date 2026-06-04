import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { redactErrorMessage } from '../memory-sidecar/src/redaction/redactPaths.js'
import { isEnvTruthy } from './envUtils.js'

export type StructuredErrorCategory =
  | 'api'
  | 'network'
  | 'tool'
  | 'permission'
  | 'user_cancel'
  | 'unknown'

export type StructuredErrorSource = 'api' | 'tool' | 'runtime'

export type StructuredErrorEvent = {
  type: 'structured_error'
  category: StructuredErrorCategory
  message: string
  retryable?: boolean
  code?: string
  source?: StructuredErrorSource
  timestamp: string
  uuid: string
  session_id: string
}

const MAX_STRUCTURED_ERROR_MESSAGE_LENGTH = 1000
const SAFE_ASSISTANT_ERROR_CODES = new Set([
  'authentication_failed',
  'billing_error',
  'invalid_request',
  'rate_limit',
  'unknown',
])

export function shouldEmitStructuredErrorEvents(): boolean {
  return isEnvTruthy(process.env.MOSSEN_CODE_STRUCTURED_ERROR_EVENT)
}

export function redactStructuredErrorMessage(raw: string): string {
  const redacted = redactErrorMessage(raw)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return redacted.slice(0, MAX_STRUCTURED_ERROR_MESSAGE_LENGTH)
}

export function extractStructuredErrorText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(extractStructuredErrorText).filter(Boolean).join('\n')
  }
  if (!value || typeof value !== 'object') {
    return ''
  }
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') {
    return record.text
  }
  if ('content' in record) {
    return extractStructuredErrorText(record.content)
  }
  return ''
}

export function safeStructuredErrorCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_ASSISTANT_ERROR_CODES.has(code)
    ? code
    : undefined
}

export function categoryForAssistantError(
  code: unknown,
  message: string,
): StructuredErrorCategory {
  const lower = message.toLowerCase()
  if (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('connection') ||
    lower.includes('econnreset')
  ) {
    return 'network'
  }
  if (typeof code === 'string' && SAFE_ASSISTANT_ERROR_CODES.has(code)) {
    return 'api'
  }
  return 'unknown'
}

export function categoryForToolError(message: string): StructuredErrorCategory {
  const lower = message.toLowerCase()
  if (lower.includes('abort') || lower.includes('cancel')) {
    return 'user_cancel'
  }
  if (lower.includes('permission') || lower.includes('denied')) {
    return 'permission'
  }
  return 'tool'
}

export function buildStructuredErrorEvent(options: {
  category: StructuredErrorCategory
  message: string
  retryable?: boolean
  code?: string
  source?: StructuredErrorSource
  timestamp?: string
  uuid?: string
  sessionId?: string
}): StructuredErrorEvent | null {
  if (!shouldEmitStructuredErrorEvents()) {
    return null
  }

  const message =
    redactStructuredErrorMessage(options.message) || 'An error occurred'
  return {
    type: 'structured_error',
    category: options.category,
    message,
    retryable: options.retryable,
    code: options.code,
    source: options.source,
    timestamp: options.timestamp ?? new Date().toISOString(),
    uuid: options.uuid ?? randomUUID(),
    session_id: options.sessionId ?? getSessionId(),
  }
}

export function buildStructuredAssistantErrorEvent(options: {
  content: unknown
  errorCode: unknown
  uuid: string
}): StructuredErrorEvent | null {
  const message = extractStructuredErrorText(options.content)
  const category = categoryForAssistantError(options.errorCode, message)
  return buildStructuredErrorEvent({
    category,
    message,
    retryable: category === 'network' || options.errorCode === 'rate_limit',
    code: safeStructuredErrorCode(options.errorCode),
    source: 'api',
    uuid: options.uuid,
  })
}

export function buildStructuredToolResultErrorEvents(
  content: unknown,
  uuid: string,
): StructuredErrorEvent[] {
  if (!shouldEmitStructuredErrorEvents() || !Array.isArray(content)) {
    return []
  }

  const events: StructuredErrorEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }
    const record = block as Record<string, unknown>
    if (record.type !== 'tool_result' || record.is_error !== true) {
      continue
    }
    const message = extractStructuredErrorText(record.content)
    const event = buildStructuredErrorEvent({
      category: categoryForToolError(message),
      message,
      source: 'tool',
      uuid,
    })
    if (event) {
      events.push(event)
    }
  }
  return events
}
