/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import { MossenAPIConnectionError, MossenAPIConnectionTimeoutError, MossenAPIError, type MossenBetaMessage, type MossenBetaStopReason, } from './mossenSdk.js'
import { AFK_MODE_BETA_HEADER } from 'src/constants/betas.js'
import type { SDKAssistantMessageError } from 'src/entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage, Message, UserMessage, } from 'src/types/message.js'
import {
  getMossenApiKeyWithSource, getHostedOAuthTokens, getOauthAccountInfo, isHostedSubscriber, } from 'src/utils/auth.js'
import {
  createAssistantAPIErrorMessage, NO_RESPONSE_REQUESTED, } from 'src/utils/messages.js'
import {
  getDefaultMainLoopModelSetting, isNonCustomOpusModel, } from 'src/utils/model/model.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getCustomBackendBaseUrl, getCustomBackendName, getCustomBackendModel, getCustomBackendProtocol, hasCustomBackendAuth, isCustomBackendEnabled, isMessagesCompatibleProtocol, looksLikeMessagesCompatibleBaseUrl, } from 'src/utils/customBackend.js'
import { getProductDisplayName } from '../../constants/product.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  API_PDF_MAX_PAGES, PDF_TARGET_RAW_SIZE, } from '../../constants/apiLimits.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
import { ImageResizeError } from '../../utils/imageResizer.js'
import { ImageSizeError } from '../../utils/imageValidation.js'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/index.js'
import { logMossenEvent } from '../analytics/mossenEventLogger.js'
import {
  type HostedLimits,
  getRateLimitErrorMessage,
  type OverageDisabledReason,
} from '../hostedLimits.js'
import { isMossenRefusalStopReason } from '../modelRuntime/canonical.js'
import { shouldProcessRateLimits } from '../rateLimitMocking.js' // Used for /mock-limits command
import { extractConnectionErrorDetails } from './errorUtils.js'
import { t } from 'src/utils/i18n/index.js'

export const API_ERROR_MESSAGE_PREFIX = 'API Error'

export function startsWithApiErrorPrefix(text: string): boolean {
  return text.startsWith(API_ERROR_MESSAGE_PREFIX)
}
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  if (!msg.isApiErrorMessage) {
    return false
  }
  const content = msg.message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block =>
      block.type === 'text' &&
      block.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
  )
}

/**
 * Parse actual/limit token counts from a raw prompt-too-long API error
 * message like "prompt is too long: 137500 tokens > 135000 maximum".
 * The raw string may be wrapped in SDK prefixes or JSON envelopes, or
 * have different casing (Vertex), so this is intentionally lenient.
 */
export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  }
}

/**
 * Returns how many tokens over the limit a prompt-too-long error reports,
 * or undefined if the message isn't PTL or its errorDetails are unparseable.
 * Reactive compact uses this gap to jump past multiple groups in one retry
 * instead of peeling one-at-a-time.
 */
export function getPromptTooLongTokenGap(
  msg: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(msg) || !msg.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    msg.errorDetails,
  )
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined
  }
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

/**
 * Is this raw API error text a media-size rejection that stripImagesFromMessages
 * can fix? Reactive compact's summarize retry uses this to decide whether to
 * strip and retry (media error) or bail (anything else).
 *
 * Patterns MUST stay in sync with the getAssistantMessageFromError branches
 * that populate errorDetails (~L523 PDF, ~L560 image, ~L573 many-image) and
 * the classifyAPIError branches (~L929-946). The closed loop: errorDetails is
 * only set after those branches already matched these same substrings, so
 * isMediaSizeError(errorDetails) is tautologically true for that path. API
 * wording drift causes graceful degradation (errorDetails stays undefined,
 * caller short-circuits), not a false negative.
 */
export function isMediaSizeError(raw: string): boolean {
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

/**
 * Message-level predicate: is this assistant message a media-size rejection?
 * Parallel to isPromptTooLongMessage. Checks errorDetails (the raw API error
 * string populated by the getAssistantMessageFromError branches at ~L523/560/573)
 * rather than content text, since media errors have per-variant content strings.
 */
export function isMediaSizeErrorMessage(msg: AssistantMessage): boolean {
  return (
    msg.isApiErrorMessage === true &&
    msg.errorDetails !== undefined &&
    isMediaSizeError(msg.errorDetails)
  )
}
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE =
  'Authentication missing · Configure Mossen backend credentials'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid API key · Fix external API key'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH =
  'The configured provider API key belongs to a disabled organization · Unset it to use Mossen-managed backend credentials instead'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY =
  'The configured provider API key belongs to a disabled organization · Update or unset it'
export const TOKEN_REVOKED_ERROR_MESSAGE =
  'Hosted adapter token revoked · Refresh external hosted credentials'
export const CCR_AUTH_ERROR_MESSAGE =
  'Authentication error · This may be a temporary network issue, please try again'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const CUSTOM_OFF_SWITCH_MESSAGE =
  'The configured backend is experiencing high load. Use /model to switch profiles or retry later.'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'
export function getPdfTooLargeErrorMessage(): string {
  const limits = `max ${API_PDF_MAX_PAGES} pages, ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `PDF too large (${limits}). Try reading the file a different way (e.g., extract text with pdftotext).`
    : `PDF too large (${limits}). Double press esc to go back and try again, or use pdftotext to convert to text first.`
}
export function getPdfPasswordProtectedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'PDF is password protected. Try using a CLI tool to extract or convert the PDF.'
    : 'PDF is password protected. Please double press esc to edit your message and try again.'
}
export function getPdfInvalidErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'The PDF file was not valid. Try converting it to text first (e.g., pdftotext).'
    : 'The PDF file was not valid. Double press esc to go back and try again with a different file.'
}
export function getImageTooLargeErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Image was too large. Try resizing the image or using a different approach.'
    : 'Image was too large. Double press esc to go back and try again with a smaller image.'
}
export function getRequestTooLargeErrorMessage(): string {
  const limits = `max ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `Request too large (${limits}). Try with a smaller file.`
    : `Request too large (${limits}). Double press esc to go back and try with a smaller file.`
}
export const OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE =
  `The external hosted adapter account does not have access to ${getProductDisplayName()}. Refresh or replace the adapter credentials.`

// W146.4 P1-4 / W147 P2-1: 429 detail sanitizer.
//
// When the configured backend returns a 429 with no quota headers, the SDK
// hands us a free-text body. Backends sometimes embed identifiers (org IDs,
// request fingerprints, OAuth subject claims, internal trace IDs) in that
// body, and pre-W146.4 we passed it straight through to the operator-visible
// "Request rejected (429) · ..." message. That created two real problems:
//
//   1. Information leakage — internal IDs ended up in the chat panel and
//      session transcripts, which are sometimes shared with third parties.
//   2. Confusing UX — the operator sees a wall of JSON instead of an
//      actionable "you've been rate-limited and here's when to retry".
//
// W146.4's first cut used a coarse substring match on words like `org`,
// `user`, `token`, `account` to drop anything suspicious. W147 found that
// rule fired on common provider rate-limit prose ("User rate limit
// exceeded", "rate limit reached for organization on tokens per min")
// because the offending words sit inside legitimate English. The rule is
// now split into two strict patterns:
//
//   - RATE_LIMIT_TOKEN_LIKE_PATTERN drops the entire value when it
//     contains a token-shaped substring (Bearer, sk-, AKIA, eyJ JWT,
//     long-hex blob).
//   - RATE_LIMIT_INTERNAL_ID_PATTERN drops the entire value when an
//     internal identifier in the form `prefix(_|-)alnum{3,}` is
//     present, e.g. `org-abc12`, `user_9f1c`, `req_abc123`. Word-
//     boundary anchored on both sides so plain English words like
//     `organization` / `tokens per minute` are untouched.
//
// JSON detail still goes through a strict whitelist (reason, retry_after_*)
// to avoid surfacing arbitrary fields the backend chose to embed.
const RATE_LIMIT_SAFE_FIELDS: readonly string[] = [
  'reason',
  'retry_after_seconds',
  'retry_after_ms',
  'retryAfterSeconds',
  'retryAfterMs',
  'retry_after',
  'retryAfter',
]

const RATE_LIMIT_TOKEN_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{8,})|(eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|(AKIA[A-Z0-9]{12,})|(\b[a-f0-9]{32,}\b)|(\bBearer\s+[A-Za-z0-9._-]{8,})/

// W147 P2-1: internal-id shape (prefix + separator + opaque suffix).
// Word-boundary anchored on both sides so `organization`, `tokens per
// minute`, and other plain English never match. Common provider prefixes
// only — keeping the list narrow avoids surprise drops on arbitrary
// words.
const RATE_LIMIT_INTERNAL_ID_PATTERN =
  /\b(?:org|user|account|project|team|customer|tenant|req|request|trace|session|fingerprint|claim|subject)[_-][A-Za-z0-9]{3,}\b/i

const RATE_LIMIT_DETAIL_MAX_LEN = 240

export function sanitizeRateLimitDetail(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''

  // 1. Try parsing as JSON. When the body is structured, project to the
  //    safe-field whitelist and discard everything else.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const parts: string[] = []
        for (const field of RATE_LIMIT_SAFE_FIELDS) {
          const value = obj[field]
          if (typeof value === 'string') {
            const safe = sanitizeRateLimitProseValue(value)
            if (safe) parts.push(`${field}=${safe}`)
          } else if (typeof value === 'number' && Number.isFinite(value)) {
            parts.push(`${field}=${value}`)
          }
        }
        return truncateRateLimitDetail(parts.join(' · '))
      }
    } catch {
      // not JSON — fall through to prose handling
    }
  }

  // 2. Plain text. Reject if it contains a token-shape or internal-id
  //    shape; otherwise pass through after control-char scrubbing +
  //    truncation.
  return truncateRateLimitDetail(sanitizeRateLimitProseValue(trimmed))
}

function sanitizeRateLimitProseValue(value: string): string {
  if (RATE_LIMIT_TOKEN_LIKE_PATTERN.test(value)) {
    return ''
  }
  if (RATE_LIMIT_INTERNAL_ID_PATTERN.test(value)) {
    return ''
  }
  // Drop control / non-printable characters that backends sometimes embed.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

function truncateRateLimitDetail(value: string): string {
  if (value.length <= RATE_LIMIT_DETAIL_MAX_LEN) return value
  return value.slice(0, RATE_LIMIT_DETAIL_MAX_LEN - 1) + '…'
}

function getCustomBackendAuthSummary(): string {
  return hasCustomBackendAuth()
    ? `${getCustomBackendName()} authentication failed · Check custom backend credentials`
    : `${getCustomBackendName()} auth missing · Configure custom backend credentials`
}

function getCustomBackendTroubleshooting(errorMessage?: string): string {
  const baseUrl = getCustomBackendBaseUrl()
  const model = getCustomBackendModel()
  const protocol = getCustomBackendProtocol()
  const isMessagesProtocol = isMessagesCompatibleProtocol(protocol)
  const protocolLabel =
    protocol === 'openai-compatible'
      ? 'OpenAI-compatible'
      : isMessagesProtocol
        ? 'messages-compatible'
        : 'custom'
  const baseUrlHint =
    protocol === 'openai-compatible'
      ? 'usually the provider API root ending in /v1'
      : isMessagesProtocol
        ? 'usually the provider messages-compatible API root'
        : 'must match the configured backend protocol'
  const lines = [
    `For ${protocolLabel} backends, verify all three pieces match the same provider account:`,
    `baseURL=${baseUrl ?? '<not configured>'} (${baseUrlHint})`,
    `model=${model ?? '<not configured>'} (must be enabled for this key)`,
    'apiKey=<masked> (must belong to the same provider/account as baseURL)',
    'Run /model doctor and /model test <profile> after updating the profile.',
  ]
  if (
    protocol === 'openai-compatible' &&
    looksLikeMessagesCompatibleBaseUrl(baseUrl)
  ) {
    lines.push(
      'Protocol mismatch hint: this baseURL looks messages-compatible; update the profile provider to messages-compatible.',
    )
  }
  if (errorMessage?.trim()) {
    lines.push(`Provider message: ${errorMessage.trim()}`)
  }
  return lines.join(' · ')
}

function extractProviderErrorMessageFromBody(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  if (typeof record.error === 'string') return record.error
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
    if (typeof nested.code === 'string') return nested.code
    if (typeof nested.type === 'string') return nested.type
  }
  if (typeof record.detail === 'string') return record.detail
  return undefined
}

function stripHtmlForProviderMessage(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateProviderMessage(value: string): string {
  const clean = stripHtmlForProviderMessage(value)
  if (clean.length <= 260) return clean
  return `${clean.slice(0, 259)}…`
}

function looksLikeHtmlOrWafBlock(value: string, headers?: Headers): boolean {
  const contentType = headers?.get('content-type')?.toLowerCase() ?? ''
  const lower = value.toLowerCase()
  return (
    contentType.includes('text/html') ||
    /<html\b|<!doctype html|<title\b|<body\b/i.test(value) ||
    lower.includes('cloudflare') ||
    lower.includes('cf-ray') ||
    lower.includes('web application firewall') ||
    lower.includes('request blocked') ||
    lower.includes('access denied') ||
    lower.includes('attention required')
  )
}

function looksLikeUnsupportedModel(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower.includes('model') &&
    (lower.includes('not found') ||
      lower.includes('does not exist') ||
      lower.includes('not exist') ||
      lower.includes('unsupported') ||
      lower.includes('not supported') ||
      lower.includes('invalid model') ||
      lower.includes('model_not_found'))
  )
}

function looksLikePayloadRejected(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower.includes('payload') ||
    lower.includes('request body') ||
    lower.includes('invalid request') ||
    lower.includes('invalid json') ||
    lower.includes('schema') ||
    lower.includes('max_tokens') ||
    lower.includes('tool') ||
    lower.includes('stream')
  )
}

function getProviderDetail(error: MossenAPIError): string {
  return truncateProviderMessage(
    extractProviderErrorMessageFromBody(error.body) || error.message,
  )
}

function getCustomBackendAttributedErrorMessage(
  error: MossenAPIError,
  model: string,
): { content: string; error: SDKAssistantMessageError } | undefined {
  if (!isCustomBackendEnabled()) return undefined

  const detail = getProviderDetail(error)
  const status = error.status
  const baseUrl = getCustomBackendBaseUrl() ?? '<not configured>'

  if (looksLikeHtmlOrWafBlock(detail, error.headers)) {
    return {
      content: t('api.provider.error.gatewayBlock', {
        name: getCustomBackendName(),
        status,
        baseUrl,
        detail,
      }),
      error: 'invalid_request',
    }
  }

  if (looksLikeUnsupportedModel(detail)) {
    return {
      content: t('api.provider.error.unsupportedModel', {
        name: getCustomBackendName(),
        status,
        model,
        detail,
      }),
      error: 'invalid_request',
    }
  }

  if (status >= 500) {
    return {
      content: t('api.provider.error.server', {
        name: getCustomBackendName(),
        status,
        detail,
      }),
      error: 'unknown',
    }
  }

  if (status === 400 || status === 413 || status === 422) {
    return {
      content: t('api.provider.error.payloadRejected', {
        name: getCustomBackendName(),
        status,
        detail,
      }),
      error: 'invalid_request',
    }
  }

  if (status === 401 || status === 403) {
    return {
      content: getAuthenticationFailedErrorMessage(detail),
      error: 'authentication_failed',
    }
  }

  if (status >= 400) {
    return {
      content: t('api.provider.error.client', {
        name: getCustomBackendName(),
        status,
        detail,
      }),
      error: 'invalid_request',
    }
  }

  return undefined
}

export function getInvalidApiKeyErrorMessage(): string {
  return isCustomBackendEnabled()
    ? `${API_ERROR_MESSAGE_PREFIX}: ${getCustomBackendAuthSummary()} · ${getCustomBackendTroubleshooting()}`
    : INVALID_API_KEY_ERROR_MESSAGE
}

export function getAuthenticationFailedErrorMessage(
  errorMessage: string,
): string {
  if (isCustomBackendEnabled()) {
    return `${API_ERROR_MESSAGE_PREFIX}: ${getCustomBackendAuthSummary()} · ${getCustomBackendTroubleshooting(errorMessage)}`
  }
  return getIsNonInteractiveSession()
    ? `Failed to authenticate. ${API_ERROR_MESSAGE_PREFIX}: ${errorMessage}`
    : `Configure Mossen backend credentials · ${API_ERROR_MESSAGE_PREFIX}: ${errorMessage}`
}

export function getTokenRevokedErrorMessage(): string {
  if (isCustomBackendEnabled()) {
    return `${API_ERROR_MESSAGE_PREFIX}: ${getCustomBackendName()} auth token expired · Refresh custom backend credentials`
  }
  return getIsNonInteractiveSession()
    ? 'Your external hosted adapter account does not have access to Mossen. Refresh credentials or contact your administrator.'
    : TOKEN_REVOKED_ERROR_MESSAGE
}

export function getOauthOrgNotAllowedErrorMessage(): string {
  if (isCustomBackendEnabled()) {
    return `${API_ERROR_MESSAGE_PREFIX}: ${getCustomBackendName()} rejected the request · Check backend access policy or credentials`
  }
  return getIsNonInteractiveSession()
    ? 'Your external hosted adapter organization does not have access to Mossen. Refresh credentials or contact your administrator.'
    : OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE
}

/**
 * Check if we're in CCR (Mossen Web) mode.
 * In CCR mode, auth is handled via JWTs provided by the infrastructure,
 * not via a built-in account flow. Transient auth errors should suggest retrying.
 */
function isCCRMode(): boolean {
  return isEnvTruthy(process.env.MOSSEN_CODE_REMOTE)
}

// Temp helper to log tool_use/tool_result mismatch errors
function logToolUseToolResultMismatch(
  toolUseId: string,
  messages: Message[],
  messagesForAPI: (UserMessage | AssistantMessage)[],
): void {
  try {
    // Find tool_use in normalized messages
    let normalizedIndex = -1
    for (let i = 0; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            'id' in block &&
            block.id === toolUseId
          ) {
            normalizedIndex = i
            break
          }
        }
      }
      if (normalizedIndex !== -1) break
    }

    // Find tool_use in original messages
    let originalIndex = -1
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue
      if (msg.type === 'assistant' && 'message' in msg) {
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block.type === 'tool_use' &&
              'id' in block &&
              block.id === toolUseId
            ) {
              originalIndex = i
              break
            }
          }
        }
      }
      if (originalIndex !== -1) break
    }

    // Build normalized sequence
    const normalizedSeq: string[] = []
    for (let i = normalizedIndex + 1; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const role = msg.message.role
          if (block.type === 'tool_use' && 'id' in block) {
            normalizedSeq.push(`${role}:tool_use:${block.id}`)
          } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
            normalizedSeq.push(`${role}:tool_result:${block.tool_use_id}`)
          } else if (block.type === 'text') {
            normalizedSeq.push(`${role}:text`)
          } else if (block.type === 'thinking') {
            normalizedSeq.push(`${role}:thinking`)
          } else if (block.type === 'image') {
            normalizedSeq.push(`${role}:image`)
          } else {
            normalizedSeq.push(`${role}:${block.type}`)
          }
        }
      } else if (typeof content === 'string') {
        normalizedSeq.push(`${msg.message.role}:string_content`)
      }
    }

    // Build pre-normalized sequence
    const preNormalizedSeq: string[] = []
    for (let i = originalIndex + 1; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue

      switch (msg.type) {
        case 'user':
        case 'assistant': {
          if ('message' in msg) {
            const content = msg.message.content
            if (Array.isArray(content)) {
              for (const block of content) {
                const role = msg.message.role
                if (block.type === 'tool_use' && 'id' in block) {
                  preNormalizedSeq.push(`${role}:tool_use:${block.id}`)
                } else if (
                  block.type === 'tool_result' &&
                  'tool_use_id' in block
                ) {
                  preNormalizedSeq.push(
                    `${role}:tool_result:${block.tool_use_id}`,
                  )
                } else if (block.type === 'text') {
                  preNormalizedSeq.push(`${role}:text`)
                } else if (block.type === 'thinking') {
                  preNormalizedSeq.push(`${role}:thinking`)
                } else if (block.type === 'image') {
                  preNormalizedSeq.push(`${role}:image`)
                } else {
                  preNormalizedSeq.push(`${role}:${block.type}`)
                }
              }
            } else if (typeof content === 'string') {
              preNormalizedSeq.push(`${msg.message.role}:string_content`)
            }
          }
          break
        }
        case 'attachment':
          if ('attachment' in msg) {
            preNormalizedSeq.push(`attachment:${msg.attachment.type}`)
          }
          break
        case 'system':
          if ('subtype' in msg) {
            preNormalizedSeq.push(`system:${msg.subtype}`)
          }
          break
        case 'progress':
          if (
            'progress' in msg &&
            msg.progress &&
            typeof msg.progress === 'object' &&
            'type' in msg.progress
          ) {
            preNormalizedSeq.push(`progress:${msg.progress.type ?? 'unknown'}`)
          } else {
            preNormalizedSeq.push('progress:unknown')
          }
          break
      }
    }

    // Log to Statsig
    logMossenEvent('mossen.api.toolUseToolResultMismatchError', {
      toolUseId:
        toolUseId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedSequence: normalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      preNormalizedSequence: preNormalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedMessageCount: messagesForAPI.length,
      originalMessageCount: messages.length,
      normalizedToolUseIndex: normalizedIndex,
      originalToolUseIndex: originalIndex,
    })
  } catch (_) {
    // Ignore errors in debug logging
  }
}

/**
 * Type guard to check if a value is a valid Message response from the API
 */
export function isValidAPIMessage(value: unknown): value is MossenBetaMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    'model' in value &&
    'usage' in value &&
    Array.isArray((value as MossenBetaMessage).content) &&
    typeof (value as MossenBetaMessage).model === 'string' &&
    typeof (value as MossenBetaMessage).usage === 'object'
  )
}

/** Lower-level error that AWS can return. */
type AmazonError = {
  Output?: {
    __type?: string
  }
  Version?: string
}

/**
 * Given a response that doesn't look quite right, see if it contains any known error types we can extract.
 */
export function extractUnknownErrorFormat(value: unknown): string | undefined {
  // Check if value is a valid object first
  if (!value || typeof value !== 'object') {
    return undefined
  }

  // Amazon Bedrock routing errors
  if ((value as AmazonError).Output?.__type) {
    return (value as AmazonError).Output!.__type
  }

  return undefined
}

export function getAssistantMessageFromError(
  error: unknown,
  model: string,
  options?: {
    messages?: Message[]
    messagesForAPI?: (UserMessage | AssistantMessage)[]
  },
): AssistantMessage {
  // Check for SDK timeout errors
  if (
    error instanceof MossenAPIConnectionTimeoutError ||
    (error instanceof MossenAPIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return createAssistantAPIErrorMessage({
      content: API_TIMEOUT_ERROR_MESSAGE,
      error: 'unknown',
    })
  }

  // Check for image size/resize errors (thrown before API call during validation)
  // Use getImageTooLargeErrorMessage() to show "esc esc" hint for CLI users
  // but a generic message for SDK users (non-interactive mode)
  if (error instanceof ImageSizeError || error instanceof ImageResizeError) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
    })
  }

  // Check for emergency capacity off switch for Opus PAYG users
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return createAssistantAPIErrorMessage({
      content: CUSTOM_OFF_SWITCH_MESSAGE,
      error: 'rate_limit',
    })
  }

  if (
    error instanceof MossenAPIError &&
    error.status === 429 &&
    shouldProcessRateLimits(isHostedSubscriber())
  ) {
    // Check if this is the new API with multiple rate limit headers
    const rateLimitType = error.headers?.get?.(
      'mossen-ratelimit-unified-representative-claim',
    ) as 'five_hour' | 'seven_day' | 'seven_day_opus' | null

    const overageStatus = error.headers?.get?.(
      'mossen-ratelimit-unified-overage-status',
    ) as 'allowed' | 'allowed_warning' | 'rejected' | null

    // If we have the new headers, use the new message generation
    if (rateLimitType || overageStatus) {
      // Build limits object from error headers to determine the appropriate message
      const limits: HostedLimits = {
        status: 'rejected',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }

      // Extract rate limit information from headers
      const resetHeader = error.headers?.get?.(
        'mossen-ratelimit-unified-reset',
      )
      if (resetHeader) {
        limits.resetsAt = Number(resetHeader)
      }

      if (rateLimitType) {
        limits.rateLimitType = rateLimitType
      }

      if (overageStatus) {
        limits.overageStatus = overageStatus
      }

      const overageResetHeader = error.headers?.get?.(
        'mossen-ratelimit-unified-overage-reset',
      )
      if (overageResetHeader) {
        limits.overageResetsAt = Number(overageResetHeader)
      }

      const overageDisabledReason = error.headers?.get?.(
        'mossen-ratelimit-unified-overage-disabled-reason',
      ) as OverageDisabledReason | null
      if (overageDisabledReason) {
        limits.overageDisabledReason = overageDisabledReason
      }

      // Use the new message format for all new API rate limits
      const specificErrorMessage = getRateLimitErrorMessage(limits, model)
      if (specificErrorMessage) {
        return createAssistantAPIErrorMessage({
          content: specificErrorMessage,
          error: 'rate_limit',
        })
      }

      // If getRateLimitErrorMessage returned null, it means the fallback mechanism
      // will handle this silently (e.g., Opus -> Sonnet fallback for eligible users).
      // Return NO_RESPONSE_REQUESTED so no error is shown to the user, but the
      // message is still recorded in conversation history for Mossen to see.
      return createAssistantAPIErrorMessage({
        content: NO_RESPONSE_REQUESTED,
        error: 'rate_limit',
      })
    }

    // No quota headers — this is NOT a quota limit. Surface what the API actually
    // said instead of a generic "Rate limit reached". Entitlement rejections
    // (e.g. 1M context without Extra Usage) and infra capacity 429s land here.
    if (error.message.includes('Extra usage is required for long context')) {
      const hint = getIsNonInteractiveSession()
        ? 'enable extra usage in hosted billing settings, or use --model to switch to standard context'
        : 'run /extra-usage to enable, or /model to switch to standard context'
      return createAssistantAPIErrorMessage({
        content: `${API_ERROR_MESSAGE_PREFIX}: Extra usage is required for 1M context · ${hint}`,
        error: 'rate_limit',
      })
    }
    // SDK's MossenAPIError.makeMessage prepends "429 " and JSON-stringifies the body
    // when there's no top-level .message — extract the inner error.message.
    const stripped = error.message.replace(/^429\s+/, '')
    const innerMessage = stripped.match(/"message"\s*:\s*"([^"]*)"/)?.[1]
    // W146.4 P1-4: backend can return arbitrary JSON in the 429 body (org IDs,
    // request fingerprints, OAuth subject claims, etc.). Pre-W146.4 we
    // concatenated `detail` straight into the user-visible message, leaking
    // those identifiers into the panel + transcript. Now we apply a safe-
    // field whitelist + token-shape scrubber. Generic "you've been rate-
    // limited and here's when to retry" text still flows through unchanged.
    const detail = sanitizeRateLimitDetail(innerMessage || stripped)
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: Request rejected (429) · ${detail || 'this may be a temporary capacity issue with the configured backend'}`,
      error: 'rate_limit',
    })
  }

  // Handle prompt too long errors (Vertex returns 413, direct API returns 400)
  // Use case-insensitive check since Vertex returns "Prompt is too long" (capitalized)
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('prompt is too long')
  ) {
    // Content stays generic (UI matches on exact string). The raw error with
    // token counts goes into errorDetails — reactive compact's retry loop
    // parses the gap from there via getPromptTooLongTokenGap.
    return createAssistantAPIErrorMessage({
      content: PROMPT_TOO_LONG_ERROR_MESSAGE,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for PDF page limit errors
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfTooLargeErrorMessage(),
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for password-protected PDF errors
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfPasswordProtectedErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for invalid PDF errors (e.g., HTML file renamed to .pdf)
  // Without this handler, invalid PDF document blocks persist in conversation
  // context and cause every subsequent API call to fail with 400.
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified was not valid')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfInvalidErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for image size errors (e.g., "image exceeds 5 MB maximum: 5316852 bytes > 5242880 bytes")
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
      errorDetails: error.message,
    })
  }

  // Check for many-image dimension errors (API enforces stricter 2000px limit for many-image requests)
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return createAssistantAPIErrorMessage({
      content: getIsNonInteractiveSession()
        ? 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Start a new session with fewer images.'
        : 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Run /compact to remove old images from context, or start a new session.',
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Server rejected the afk-mode beta header (plan does not include auto
  // mode). AFK_MODE_BETA_HEADER is '' in non-TRANSCRIPT_CLASSIFIER builds,
  // so the truthy guard keeps this inert there.
  if (
    AFK_MODE_BETA_HEADER &&
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes(AFK_MODE_BETA_HEADER) &&
    error.message.includes('mossen-beta')
  ) {
    return createAssistantAPIErrorMessage({
      content: 'Auto mode is unavailable for your plan',
      error: 'invalid_request',
    })
  }

  // Check for request too large errors (413 status)
  // This typically happens when a large PDF + conversation context exceeds the 32MB API limit
  if (error instanceof MossenAPIError && error.status === 413) {
    return createAssistantAPIErrorMessage({
      content: getRequestTooLargeErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for tool_use/tool_result concurrency error
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    // Log to Statsig if we have the message context
    if (options?.messages && options?.messagesForAPI) {
      const toolUseIdMatch = error.message.match(/toolu_[a-zA-Z0-9]+/)
      const toolUseId = toolUseIdMatch ? toolUseIdMatch[0] : null
      if (toolUseId) {
        logToolUseToolResultMismatch(
          toolUseId,
          options.messages,
          options.messagesForAPI,
        )
      }
    }

    if (process.env.USER_TYPE === ('a' + 'nt')) {
      const baseMessage = `API Error: 400 ${error.message}\n\nRun /share and post the JSON file to ${MACRO.FEEDBACK_CHANNEL}.`
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Then, use /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    } else {
      const baseMessage = 'API Error: 400 due to tool use concurrency issues.'
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Run /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    }
  }

  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    logMossenEvent('mossen.api.unexpectedToolResult', {})
  }

  // Duplicate tool_use IDs (CC-1212). ensureToolResultPairing strips these
  // before send, so hitting this means a new corruption path slipped through.
  // Log for root-causing, and give users a recovery path instead of deadlock.
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    logMossenEvent('mossen.api.duplicateToolUseId', {})
    const rewindInstruction = getIsNonInteractiveSession()
      ? ''
      : ' Run /rewind to recover the conversation.'
    return createAssistantAPIErrorMessage({
      content: `API Error: 400 duplicate tool_use ID in conversation history.${rewindInstruction}`,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for invalid model name error for subscription users trying to use Opus
  if (
    isHostedSubscriber() &&
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name') &&
    (isNonCustomOpusModel(model) || model === 'opus')
  ) {
    return createAssistantAPIErrorMessage({
      content:
        'Opus is not available with the Mossen Pro plan. If your subscription changed recently, refresh the external hosted adapter credentials before retrying.',
      error: 'invalid_request',
    })
  }

  // Check for invalid model name errors for internal users. Mossen may be
  // defaulting to a custom internal-only model, and there might be
  // users with new or unknown org IDs that haven't been gated in.
  if (
    process.env.USER_TYPE === ('a' + 'nt') &&
    !process.env.MOSSEN_CODE_MODEL &&
    error instanceof Error &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    // Get organization ID from config only when explicit hosted adapter data is active.
    const orgId = getOauthAccountInfo()?.organizationUuid
    const baseMsg = `[MOSSEN-INTERNAL] Your org isn't gated into the \`${model}\` model. Either run \`mossen\` with \`MOSSEN_CODE_MODEL=sonnet\``
    const msg = orgId
      ? `${baseMsg} or share your orgId (${orgId}) in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`
      : `${baseMsg} or reach out in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`

    return createAssistantAPIErrorMessage({
      content: msg,
      error: 'invalid_request',
    })
  }

  if (
    error instanceof Error &&
    error.message.includes('Your credit balance is too low')
  ) {
    return createAssistantAPIErrorMessage({
      content: CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
      error: 'billing_error',
    })
  }

  if (error instanceof MossenAPIError) {
    const attributed = getCustomBackendAttributedErrorMessage(error, model)
    if (attributed) {
      return createAssistantAPIErrorMessage(attributed)
    }
  }

  // "Organization has been disabled" - commonly a stale provider API key
  // from a previous employer/project overriding subscription auth. Only handle
  // the env-var case; apiKeyHelper and hosted-managed keys mean the active
  // auth's org is genuinely disabled with no dormant fallback to point at.
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('organization has been disabled')
  ) {
    const { source } = getMossenApiKeyWithSource()
    // getMossenApiKeyWithSource conflates the env var with FD-passed keys
    // under the same source value, and in CCR mode hosted adapter auth stays
    // active despite the env var. The three guards ensure we only blame the env var when it's
    // actually set and actually on the wire.
    if (
      source === 'MOSSEN_CODE_API_KEY' &&
      process.env.MOSSEN_CODE_API_KEY &&
      !isHostedSubscriber()
    ) {
      const hasStoredOAuth = getHostedOAuthTokens()?.accessToken != null
      // Not 'authentication_failed' - that triggers credential UI, but UI can't
      // fix this (approved env var keeps overriding backend auth). The fix
      // is configuration-based (unset the var), so invalid_request is correct.
      return createAssistantAPIErrorMessage({
        error: 'invalid_request',
        content: hasStoredOAuth
          ? ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH
          : ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
      })
    }
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    // In CCR mode, auth is via JWTs - this is likely a transient network issue
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    // Check if the API key is from an external source
    const { source } = getMossenApiKeyWithSource()
    const isExternalSource =
      source === 'MOSSEN_CODE_API_KEY' || source === 'apiKeyHelper'

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: isCustomBackendEnabled()
        ? getInvalidApiKeyErrorMessage()
        : isExternalSource
          ? INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL
          : INVALID_API_KEY_ERROR_MESSAGE,
    })
  }

  // Check for OAuth token revocation error
  if (
    error instanceof MossenAPIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getTokenRevokedErrorMessage(),
    })
  }

  // Check for OAuth organization not allowed error
  if (
    error instanceof MossenAPIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getOauthOrgNotAllowedErrorMessage(),
    })
  }

  // Generic handler for other 401/403 authentication errors
  if (
    error instanceof MossenAPIError &&
    (error.status === 401 || error.status === 403)
  ) {
    // In CCR mode, auth is via JWTs - this is likely a transient network issue
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getAuthenticationFailedErrorMessage(error.message),
    })
  }

  // Bedrock errors like "403 You don't have access to the model with the specified model ID."
  // don't contain the actual model ID
  if (
    isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Try ${switchCmd} to switch to ${fallbackSuggestion}.`
        : `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  // 404 Not Found — usually means the selected model doesn't exist or isn't
  // available. Guide the user to /model so they can pick a valid one.
  // For 3P users, suggest a specific fallback model they can try.
  if (error instanceof MossenAPIError && error.status === 404) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    if (isCustomBackendEnabled()) {
      const protocol = getCustomBackendProtocol()
      const protocolLabel =
        protocol === 'openai-compatible'
          ? 'OpenAI-compatible'
          : isMessagesCompatibleProtocol(protocol)
            ? 'messages-compatible'
            : 'custom'
      return createAssistantAPIErrorMessage({
        content:
          `The configured ${protocolLabel} endpoint returned 404 for model ${model}. ` +
          getCustomBackendTroubleshooting(error.message),
        error: 'invalid_request',
      })
    }
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `The model ${model} is not available on your ${getAPIProvider()} deployment. Try ${switchCmd} to switch to ${fallbackSuggestion}, or ask your admin to enable this model.`
        : `There's an issue with the selected model (${model}). It may not exist or you may not have access to it. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  // Connection errors (non-timeout) — use formatAPIError for detailed messages
  if (error instanceof MossenAPIConnectionError) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${extractConnectionErrorDetails(error)}`,
      error: 'unknown',
    })
  }

  if (error instanceof Error) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
      error: 'unknown',
    })
  }
  return createAssistantAPIErrorMessage({
    content: API_ERROR_MESSAGE_PREFIX,
    error: 'unknown',
  })
}

/**
 * For 3P users, suggest a fallback model when the selected model is unavailable.
 * Returns a model name suggestion, or undefined if no suggestion is applicable.
 */
function get3PModelFallbackSuggestion(model: string): string | undefined {
  if (getAPIProvider() === 'firstParty') {
    return undefined
  }
  // @[MODEL LAUNCH]: Add a fallback suggestion chain for the new model → previous version for 3P
  const m = model.toLowerCase()
  // If the failing model looks like an Opus 4.6 variant, suggest the default Opus (4.1 for 3P)
  if (m.includes('opus-4-6') || m.includes('opus_4_6')) {
    return getModelStrings().opus41
  }
  // If the failing model looks like a Sonnet 4.6 variant, suggest Sonnet 4.5
  if (m.includes('sonnet-4-6') || m.includes('sonnet_4_6')) {
    return getModelStrings().sonnet45
  }
  // If the failing model looks like a Sonnet 4.5 variant, suggest Sonnet 4
  if (m.includes('sonnet-4-5') || m.includes('sonnet_4_5')) {
    return getModelStrings().sonnet40
  }
  return undefined
}

/**
 * Classifies an API error into a specific error type for analytics tracking.
 * Returns a standardized error type string suitable for Datadog tagging.
 */
export function classifyAPIError(error: unknown): string {
  // Aborted requests
  if (error instanceof Error && error.message === 'Request was aborted.') {
    return 'aborted'
  }

  // Timeout errors
  if (
    error instanceof MossenAPIConnectionTimeoutError ||
    (error instanceof MossenAPIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return 'api_timeout'
  }

  // Check for repeated 529 errors
  if (
    error instanceof Error &&
    error.message.includes(REPEATED_529_ERROR_MESSAGE)
  ) {
    return 'repeated_529'
  }

  // Check for emergency capacity off switch
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return 'capacity_off_switch'
  }

  // Rate limiting
  if (error instanceof MossenAPIError && error.status === 429) {
    return 'rate_limit'
  }

  // Server overload (529)
  if (
    error instanceof MossenAPIError &&
    (error.status === 529 ||
      error.message?.includes('"type":"overloaded_error"'))
  ) {
    return 'server_overload'
  }

  // Prompt/content size errors
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(PROMPT_TOO_LONG_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'prompt_too_long'
  }

  // PDF errors
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return 'pdf_too_large'
  }

  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return 'pdf_password_protected'
  }

  // Image size errors
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return 'image_too_large'
  }

  // Many-image dimension errors
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return 'image_too_large'
  }

  // Tool use errors (400)
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    return 'tool_use_mismatch'
  }

  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    return 'unexpected_tool_result'
  }

  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    return 'duplicate_tool_use_id'
  }

  // Invalid model errors (400)
  if (
    error instanceof MossenAPIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    return 'invalid_model'
  }

  // Credit/billing errors
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'credit_balance_low'
  }

  // Authentication errors
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    return 'invalid_api_key'
  }

  if (
    error instanceof MossenAPIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return 'token_revoked'
  }

  if (
    error instanceof MossenAPIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return 'oauth_org_not_allowed'
  }

  // Generic auth errors
  if (
    error instanceof MossenAPIError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'auth_error'
  }

  // Bedrock-specific errors
  if (
    isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    return 'bedrock_model_access'
  }

  // Status code based fallbacks
  if (error instanceof MossenAPIError) {
    const status = error.status
    if (status >= 500) return 'server_error'
    if (status >= 400) return 'client_error'
  }

  // Connection errors - check for SSL/TLS issues first
  if (error instanceof MossenAPIConnectionError) {
    const connectionDetails = extractConnectionErrorDetails(error)
    if (connectionDetails?.isSSLError) {
      return 'ssl_cert_error'
    }
    return 'connection_error'
  }

  return 'unknown'
}

export function categorizeRetryableAPIError(
  error: MossenAPIError,
): SDKAssistantMessageError {
  if (
    error.status === 529 ||
    error.message?.includes('"type":"overloaded_error"')
  ) {
    return 'rate_limit'
  }
  if (error.status === 429) {
    return 'rate_limit'
  }
  if (error.status === 401 || error.status === 403) {
    return 'authentication_failed'
  }
  if (error.status !== undefined && error.status >= 408) {
    return 'server_error'
  }
  return 'unknown'
}

export function getErrorMessageIfRefusal(
  stopReason: MossenBetaStopReason | null,
  model: string,
): AssistantMessage | undefined {
  if (!isMossenRefusalStopReason(stopReason)) {
    return
  }

  logMossenEvent('mossen.api.refusalResponse', {})

  const baseMessage = getIsNonInteractiveSession()
    ? `${API_ERROR_MESSAGE_PREFIX}: ${getProductDisplayName()} is unable to respond to this request, which appears to violate the configured backend usage policy. Try rephrasing the request or attempting a different approach.`
    : `${API_ERROR_MESSAGE_PREFIX}: ${getProductDisplayName()} is unable to respond to this request, which appears to violate the configured backend usage policy. Please double press esc to edit your last message or start a new session for ${getProductDisplayName()} to assist with a different task.`

  const modelSuggestion =
    !isCustomBackendEnabled() && model !== 'mossen-sonnet-4-20250514'
      ? ' If you are seeing this refusal repeatedly, try running /model sonnet to switch models.'
      : ''

  return createAssistantAPIErrorMessage({
    content: baseMessage + modelSuggestion,
    error: 'invalid_request',
  })
}
