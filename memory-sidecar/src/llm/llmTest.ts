/**
 * W122-B Agent D: Categorized LLM probe for /memory-sidecar llm test.
 *
 * This module performs a single-shot probe against the *independent* sidecar
 * LLM provider config (openai-compatible only). It classifies the outcome
 * into one of 11 LlmTestErrorClass values and returns a sanitized result.
 *
 * Hard rules:
 *  - Never reads mossen active-profile / mossen-profile / mossen main config.
 *  - Never persists to disk.
 *  - Never returns raw response bodies, headers, prompts, completions, or
 *    api keys. errorMessage is run through redactMemoryText() and capped 200.
 *  - The function only fetches when explicitly invoked from the
 *    `/memory-sidecar llm test` slash path.
 */
import type { MemoryRootOptions } from '../index.js'
import {
  getDefaultMemorySidecarConfigPath,
  getMemorySidecarLlmStatus,
  hasIndependentLlmConfig,
  loadMemorySidecarConfig,
  type MemorySidecarConfig,
  type OpenAiCompatibleLlmProviderConfigFromConfig,
} from '../config/config.js'
import { redactMemoryText } from '../redaction/redact.js'

export type LlmTestErrorClass =
  | 'success'
  | 'disabled'
  | 'no-config'
  | 'apiKeyEnv-missing'
  | 'invalid-base-url'
  | 'timeout'
  | 'network-error'
  | 'http-4xx'
  | 'http-5xx'
  | 'invalid-json'
  | 'schema-invalid'

export type LlmTestProviderKind =
  | 'disabled'
  | 'openai-compatible'
  | 'mossen-profile'
  | 'external-command'

export type LlmTestResult = {
  startedAt: string
  finishedAt: string
  durationMs: number
  status: LlmTestErrorClass
  httpStatus: number | null
  /** Redacted via redactMemoryText, sliced to ≤200 chars. May be empty. */
  errorMessage: string
  /** Bilingual one-liner describing the next action to fix this class. */
  recommendedAction: string
  providerKind: LlmTestProviderKind
  /** Hostname only — never query/path/full URL. */
  baseUrlHost: string | null
  model: string | null
  /** Environment variable name only. Never contains the secret value. */
  apiKeyEnv: string | null
}

export type LlmTestOptions = MemoryRootOptions & {
  /** Default 5000. */
  timeoutMs?: number
  /**
   * Smoke-only override that replaces the persisted baseUrl with a test
   * endpoint (e.g. http://127.0.0.1:<ephemeral-port>). Production callers
   * MUST NOT pass this. When provided, classification re-validates the
   * override URL with the same `new URL()` rules as a configured baseUrl.
   */
  baseUrlOverride?: string
}

const DEFAULT_TIMEOUT_MS = 5000
const ERROR_MESSAGE_MAX = 200

const RECOMMENDED_ACTIONS: Record<LlmTestErrorClass, string> = {
  'success':
    'sidecar LLM probe succeeded / 旁车 LLM 探针成功',
  'disabled':
    '/memory-sidecar llm enable (after config) / 配置后再启用',
  'no-config':
    '/memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV> / 先配置独立 LLM',
  'apiKeyEnv-missing':
    'export <ENV>=<key> in your shell and restart / 在 shell 中导出 API Key 后重启',
  'invalid-base-url':
    '/memory-sidecar llm config --base-url <http(s)://host/v1> / 检查 baseUrl 协议与格式',
  'timeout':
    'increase timeoutMs or check upstream latency / 增大超时或检查上游响应',
  'network-error':
    'check network/DNS/firewall to baseUrl host / 检查网络/DNS/防火墙',
  'http-4xx':
    'verify api key, model id, and request shape / 检查 API Key、模型 id 与请求体',
  'http-5xx':
    'upstream provider error; retry or check provider status / 上游错误，稍后重试',
  'invalid-json':
    'upstream returned non-JSON; verify baseUrl points to chat-completions / 返回非 JSON，确认 baseUrl 指向 chat-completions',
  'schema-invalid':
    'response shape lacks choices[0].message.content / 响应不包含 choices[0].message.content',
}

function redactAndTrim(input: string): string {
  if (!input) return ''
  const redacted = redactMemoryText(input).text
  return redacted.length <= ERROR_MESSAGE_MAX
    ? redacted
    : redacted.slice(0, ERROR_MESSAGE_MAX)
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function build(
  options: {
    startedAt: string
    status: LlmTestErrorClass
    providerKind: LlmTestProviderKind
    httpStatus?: number | null
    errorMessage?: string
    baseUrlHost?: string | null
    model?: string | null
    apiKeyEnv?: string | null
  },
): LlmTestResult {
  const finishedAt = new Date()
  const startedAtDate = new Date(options.startedAt)
  return {
    startedAt: options.startedAt,
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAtDate.getTime()),
    status: options.status,
    httpStatus: options.httpStatus ?? null,
    errorMessage: redactAndTrim(options.errorMessage ?? ''),
    recommendedAction: RECOMMENDED_ACTIONS[options.status],
    providerKind: options.providerKind,
    baseUrlHost: options.baseUrlHost ?? null,
    model: options.model ?? null,
    apiKeyEnv: options.apiKeyEnv ?? null,
  }
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

function classifyFetchError(error: unknown): 'timeout' | 'network-error' {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'timeout'
    // Bun/Node fetch surfaces network errors as TypeError("fetch failed") with
    // a `cause` of ConnectionRefused / ENOTFOUND etc. Anything not an
    // AbortError that happens during fetch is treated as network-error.
    return 'network-error'
  }
  return 'network-error'
}

function pickProviderKind(config: MemorySidecarConfig): LlmTestProviderKind {
  const kind = config.classification.llmProviderConfig?.kind
    ?? config.classification.llmProvider
  return kind as LlmTestProviderKind
}

function pickOpenAiConfig(
  config: MemorySidecarConfig,
): OpenAiCompatibleLlmProviderConfigFromConfig | null {
  const providerConfig = config.classification.llmProviderConfig
  if (!providerConfig || providerConfig.kind !== 'openai-compatible') return null
  return providerConfig as OpenAiCompatibleLlmProviderConfigFromConfig
}

/**
 * Run a single probe against the configured sidecar LLM provider and
 * categorize the outcome. See module docstring for safety rules.
 *
 * Decision tree:
 *   1. classification.llm === false                 -> 'disabled'
 *   2. !hasIndependentLlmConfig(config)             -> 'no-config'
 *   3. apiKeyConfigured === false                   -> 'apiKeyEnv-missing'
 *   4. baseUrl (or override) fails URL parse / non-http(s) -> 'invalid-base-url'
 *   5. fetch AbortError                             -> 'timeout'
 *   6. fetch TypeError / ECONNREFUSED / etc.        -> 'network-error'
 *   7. response.status 400-499                      -> 'http-4xx'
 *   8. response.status 500-599                      -> 'http-5xx'
 *   9. 2xx but JSON.parse fails                     -> 'invalid-json'
 *  10. 2xx JSON missing choices[0].message.content  -> 'schema-invalid'
 *  11. 2xx with valid shape                         -> 'success'
 */
export async function runMemorySidecarLlmTest(
  options: LlmTestOptions,
): Promise<LlmTestResult> {
  const startedAt = new Date().toISOString()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 1) Load config + status. Any load error is surfaced as no-config rather
  //    than crashing the slash command.
  let config: MemorySidecarConfig
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    return build({
      startedAt,
      status: 'no-config',
      providerKind: 'disabled',
      errorMessage:
        error instanceof Error ? error.message : 'failed to load sidecar config',
    })
  }

  const providerKind = pickProviderKind(config)
  const llmStatus = getMemorySidecarLlmStatus(config)

  // 2) classification.llm === false
  if (config.classification.llm === false) {
    return build({
      startedAt,
      status: 'disabled',
      providerKind,
      errorMessage: 'memory-sidecar llm classification is disabled',
    })
  }

  // 3) no independent llm config (covers mossen-profile and disabled provider)
  if (!hasIndependentLlmConfig(config)) {
    return build({
      startedAt,
      status: 'no-config',
      providerKind,
      errorMessage:
        'no independent sidecar LLM config; mossen-profile is deprecated',
    })
  }

  const oc = pickOpenAiConfig(config)
  if (!oc) {
    return build({
      startedAt,
      status: 'no-config',
      providerKind,
      errorMessage:
        `provider kind "${providerKind}" is not supported by llm test; ` +
        `expected openai-compatible`,
    })
  }

  // 4) apiKeyEnv missing in process.env. errorMessage names the env var,
  //    which is itself a NAME (not a key) per W119 M7 validation.
  if (llmStatus.apiKeyConfigured === false) {
    return build({
      startedAt,
      status: 'apiKeyEnv-missing',
      providerKind,
      errorMessage: oc.apiKeyEnv
        ? `apiKeyEnv ${oc.apiKeyEnv} is not set in process.env`
        : `apiKeyEnv is not configured`,
      baseUrlHost: safeHostname(oc.baseUrl),
      model: oc.model ?? null,
      apiKeyEnv: oc.apiKeyEnv ?? null,
    })
  }

  // 5) baseUrl validation. baseUrlOverride wins for smoke; same checks apply.
  const rawBaseUrl = options.baseUrlOverride ?? oc.baseUrl
  let parsedBase: URL
  try {
    parsedBase = new URL(rawBaseUrl)
  } catch {
    return build({
      startedAt,
      status: 'invalid-base-url',
      providerKind,
      errorMessage: `baseUrl is not a valid URL`,
      model: oc.model ?? null,
    })
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    return build({
      startedAt,
      status: 'invalid-base-url',
      providerKind,
      errorMessage: `baseUrl protocol must be http or https`,
      baseUrlHost: parsedBase.hostname || null,
      model: oc.model ?? null,
    })
  }

  const baseUrlHost = parsedBase.hostname || null
  const apiKey = oc.apiKeyEnv ? process.env[oc.apiKeyEnv] : undefined

  // 6-11) actual probe. Build /chat/completions URL by trimming any trailing
  //       slash from baseUrl (matches provider.ts behavior).
  const probeUrl = `${trimTrailingSlash(rawBaseUrl)}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(probeUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: oc.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    })
  } catch (error) {
    const cls = classifyFetchError(error)
    return build({
      startedAt,
      status: cls,
      providerKind,
      errorMessage: error instanceof Error ? error.message : String(error),
      baseUrlHost,
      model: oc.model ?? null,
    })
  } finally {
    clearTimeout(timer)
  }

  const httpStatus = response.status

  if (httpStatus >= 400 && httpStatus < 500) {
    let body = ''
    try { body = await response.text() } catch { body = '' }
    return build({
      startedAt,
      status: 'http-4xx',
      providerKind,
      httpStatus,
      errorMessage: body || `HTTP ${httpStatus}`,
      baseUrlHost,
      model: oc.model ?? null,
    })
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    let body = ''
    try { body = await response.text() } catch { body = '' }
    return build({
      startedAt,
      status: 'http-5xx',
      providerKind,
      httpStatus,
      errorMessage: body || `HTTP ${httpStatus}`,
      baseUrlHost,
      model: oc.model ?? null,
    })
  }

  // 2xx
  let raw = ''
  try {
    raw = await response.text()
  } catch (error) {
    return build({
      startedAt,
      status: 'invalid-json',
      providerKind,
      httpStatus,
      errorMessage: error instanceof Error ? error.message : 'read body failed',
      baseUrlHost,
      model: oc.model ?? null,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return build({
      startedAt,
      status: 'invalid-json',
      providerKind,
      httpStatus,
      errorMessage: error instanceof Error ? error.message : 'JSON parse failed',
      baseUrlHost,
      model: oc.model ?? null,
    })
  }

  if (!hasOpenAiContent(parsed)) {
    return build({
      startedAt,
      status: 'schema-invalid',
      providerKind,
      httpStatus,
      errorMessage: 'response missing choices[0].message.content',
      baseUrlHost,
      model: oc.model ?? null,
    })
  }

  return build({
    startedAt,
    status: 'success',
    providerKind,
    httpStatus,
    errorMessage: '',
    baseUrlHost,
    model: oc.model ?? null,
  })
}

function hasOpenAiContent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const choices = (value as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return false
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return false
  const message = (first as Record<string, unknown>).message
  if (typeof message !== 'object' || message === null) return false
  return typeof (message as Record<string, unknown>).content === 'string'
}
