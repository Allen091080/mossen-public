import { redactMemoryText } from '../redaction/redact.js'

export type LlmProviderKind =
  | 'disabled'
  | 'openai-compatible'
  | 'mossen-profile'
  | 'external-command'

export type DisabledLlmProviderConfig = {
  kind: 'disabled'
  reason?: string
}

export type OpenAiCompatibleLlmProviderConfig = {
  kind: 'openai-compatible'
  baseUrl: string
  model: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export type MossenProfileLlmProviderConfig = {
  kind: 'mossen-profile'
  profileId?: string
  model?: string
  timeoutMs?: number
}

export type ExternalCommandLlmProviderConfig = {
  kind: 'external-command'
  command: string
  args?: string[]
  timeoutMs?: number
}

export type LlmProviderConfig =
  | DisabledLlmProviderConfig
  | OpenAiCompatibleLlmProviderConfig
  | MossenProfileLlmProviderConfig
  | ExternalCommandLlmProviderConfig

export type LlmProviderJobType =
  | 'classify_llm'
  | 'synthesize_profile'
  | 'detect_proposals'

export type LlmProviderConfigByJob = Partial<Record<LlmProviderJobType, LlmProviderConfig>>

export type LlmProviderOperation =
  | 'classify-observations'
  | 'synthesize-profile'
  | 'detect-proposals'

export type LlmCompletionRequest = {
  operation: LlmProviderOperation
  input: unknown
  systemPrompt?: string
  userPrompt?: string
  metadata?: Record<string, unknown>
}

export type LlmCompletionResult =
  | {
      status: 'completed'
      text: string
      json?: unknown
      metadata?: Record<string, unknown>
    }
  | {
      status: 'skipped'
      reason: string
      metadata?: Record<string, unknown>
    }
  | {
      status: 'failed'
      reason: string
      metadata?: Record<string, unknown>
    }

export type LlmProvider = {
  readonly kind: LlmProviderKind
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
}

const DEFAULT_DISABLED_REASON = 'memory-sidecar LLM provider is disabled'
const DEFAULT_TIMEOUT_MS = 30_000

type OpenAiRuntimeOptions = {
  apiKey?: string
  providerKind?: LlmProviderKind
  metadata?: Record<string, unknown>
}

/**
 * W121-A.1: deprecated diagnostic shape. The mossen-profile mode is fully
 * disabled; sidecar LLM does not read mossen active-profile / profiles /
 * profile api key from the user's mossen settings file, and does not honour
 * any of mossen's main-model custom env variables. Callers that previously
 * inspected `ResolvedMossenProfile.baseUrl` / `.model` / `.apiKey` get a
 * stripped record with `available: false` so the UI can surface the
 * deprecation without leaking any settings data.
 */
export type ResolvedMossenProfile = {
  source: 'deprecated'
  available: false
  reason: string
}

export function createDisabledLlmProvider(
  reason = DEFAULT_DISABLED_REASON,
): LlmProvider {
  return {
    kind: 'disabled',
    async complete(request) {
      return {
        status: 'skipped',
        reason,
        metadata: {
          operation: request.operation,
          providerKind: 'disabled',
        },
      }
    },
  }
}

export function createLlmProvider(
  config: LlmProviderConfig = { kind: 'disabled' },
): LlmProvider {
  if (config.kind === 'disabled') {
    return createDisabledLlmProvider(config.reason)
  }

  if (config.kind === 'openai-compatible') {
    return createOpenAiCompatibleLlmProvider(config)
  }

  // W119 H8: mossen-profile is rejected. Sidecar LLM must be configured
  // independently via /memory-sidecar llm config; following the user's
  // active mossen profile would silently couple sidecar to mossen's main
  // model selection, which violates the W109 independence contract.
  if (config.kind === 'mossen-profile') {
    return createDisabledLlmProvider(
      'sidecar LLM must use independent openai-compatible config; ' +
      'mossen-profile mode is disabled (W119 H8). ' +
      'Run: /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV>',
    )
  }

  return createDisabledLlmProvider(
    `memory-sidecar ${config.kind} provider config is recognized but not implemented`,
  )
}

export function isLlmProviderDisabled(provider: LlmProvider): boolean {
  return provider.kind === 'disabled'
}

function createOpenAiCompatibleLlmProvider(
  config: OpenAiCompatibleLlmProviderConfig,
  runtime: OpenAiRuntimeOptions = {},
): LlmProvider {
  const providerKind = runtime.providerKind ?? 'openai-compatible'
  return {
    kind: providerKind,
    async complete(request) {
      const apiKeyEnv = config.apiKeyEnv ?? 'MOSSEN_MEMORY_OPENAI_API_KEY'
      const apiKey = runtime.apiKey ?? process.env[apiKeyEnv]
      if (!apiKey) {
        return {
          status: 'failed',
          reason: runtime.apiKey === undefined
            ? `missing API key env: ${apiKeyEnv}`
            : 'missing API key',
          metadata: {
            operation: request.operation,
            providerKind,
            ...(runtime.metadata ?? {}),
          },
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )

      try {
        const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(config.headers ?? {}),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [
              {
                role: 'system',
                content: [
                  request.systemPrompt ?? 'Return valid JSON only.',
                  'You are a memory-sidecar classifier.',
                  'Return JSON only. For classify-observations, return {"observations":[...]} with fields type,kind,domain,lifecycle,retrievalPolicy,title,summary,evidenceEventIds,scope,tags,confidence.',
                  'Allowed observation types: preference, decision, instruction_candidate, blocker, handoff, fact, bugfix, feature, workflow_pattern, coding_convention, safety_rule, tool_preference, project_state, open_thread, skill_candidate, team_policy.',
                  'Allowed observation kinds: semantic, episodic, procedural, state, policy, candidate.',
                  'Allowed observation domains: code, workflow, model, mcp, skill, plugin, memory, safety, product, team, general.',
                  'Allowed observation lifecycles: active, candidate, superseded, stale, disputed.',
                  'Allowed retrieval policies: hint, search_only, never_inject, candidate_only.',
                  'Allowed scopes: session, project, user, team.',
                ].join('\n'),
              },
              {
                role: 'user',
                content: request.userPrompt ?? JSON.stringify(request.input),
              },
            ],
          }),
        })

        const raw = await response.text()
        if (!response.ok) {
          // W119 H7: error bodies may echo back Authorization headers, sk-
          // keys, JWTs, etc. from upstream providers. Redact before any
          // surface that lands in jobs.jsonl, telemetry, or status panels.
          return {
            status: 'failed',
            reason: redactReasonText(`HTTP ${response.status}: ${compact(raw, 300)}`),
            metadata: {
              operation: request.operation,
              providerKind,
              ...(runtime.metadata ?? {}),
            },
          }
        }

        const parsed = parseJsonOrUndefined(raw)
        const text = extractOpenAiText(parsed) ?? raw
        return {
          status: 'completed',
          text,
          json: parseJsonOrUndefined(text) ?? parseJsonOrUndefined(extractJsonText(text)),
          metadata: {
            operation: request.operation,
            providerKind,
            model: config.model,
            ...(runtime.metadata ?? {}),
          },
        }
      } catch (error) {
        // W119 H7: exception messages can also embed request URLs / tokens.
        return {
          status: 'failed',
          reason: redactReasonText(error instanceof Error ? error.message : String(error)),
          metadata: {
            operation: request.operation,
            providerKind,
            ...(runtime.metadata ?? {}),
          },
        }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

// W119 H8 + W121-A.1: createMossenProfileLlmProvider was removed and the
// factory at createLlmProvider() now returns a disabled provider when
// kind === 'mossen-profile'. resolveMossenProfile no longer reads any
// mossen settings (active-profile / profiles / profile api key) and does
// not honour any of mossen's main-model custom env variables. It remains
// exported as a hard-coded deprecation diagnostic so /memory-sidecar llm
// status can render a consistent "deprecated, configure independently"
// message without ever touching the settings file.

const MOSSEN_PROFILE_DEPRECATION_REASON =
  'mossen-profile mode is deprecated; configure sidecar LLM independently with ' +
  '/memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV>'

export function resolveMossenProfile(
  _config: MossenProfileLlmProviderConfig = { kind: 'mossen-profile' },
  _env: NodeJS.ProcessEnv = process.env,
): ResolvedMossenProfile {
  return {
    source: 'deprecated',
    available: false,
    reason: MOSSEN_PROFILE_DEPRECATION_REASON,
  }
}

function extractOpenAiText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const choices = value.choices
  if (!Array.isArray(choices)) return undefined
  const first = choices[0]
  if (!isRecord(first)) return undefined
  const message = first.message
  if (!isRecord(message)) return undefined
  return typeof message.content === 'string' ? message.content : undefined
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1)
  }

  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1)
  }

  return text
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}

/**
 * W119 H7: route every reason/error string through the shared
 * redactMemoryText pipeline before it can reach jobs.jsonl, status output,
 * or telemetry. Same pipeline used for archive text, so secret patterns
 * stay in one place.
 */
export function redactReasonText(text: string): string {
  if (!text) return text
  return redactMemoryText(text).text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
