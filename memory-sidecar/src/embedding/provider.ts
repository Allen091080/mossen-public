import { createDeterministicFakeEmbedding } from '../storage/vectorIndex.js'

export type EmbeddingProviderKind = 'deterministic_fake' | 'openai-compatible'

export type DeterministicFakeEmbeddingProviderConfig = {
  kind: 'deterministic_fake'
  dimensions?: number
}

export type OpenAiCompatibleEmbeddingProviderConfig = {
  kind: 'openai-compatible'
  baseUrl: string
  model: string
  apiKeyEnv?: string
  dimensions?: number
  timeoutMs?: number
  headers?: Record<string, string>
}

export type EmbeddingProviderConfig =
  | DeterministicFakeEmbeddingProviderConfig
  | OpenAiCompatibleEmbeddingProviderConfig

export type EmbeddingProvider = {
  readonly kind: EmbeddingProviderKind
  readonly dimensions: number
  embed(input: string): Promise<number[]>
}

const DEFAULT_EMBEDDING_DIMENSIONS = 32
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_API_KEY_ENV = 'MOSSEN_MEMORY_OPENAI_EMBEDDING_API_KEY'

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig = { kind: 'deterministic_fake' },
): EmbeddingProvider {
  const dimensions = config.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  assertDimensions(dimensions)

  if (config.kind === 'deterministic_fake') {
    return {
      kind: 'deterministic_fake',
      dimensions,
      async embed(input) {
        return createDeterministicFakeEmbedding(input, dimensions)
      },
    }
  }

  return createOpenAiCompatibleEmbeddingProvider({ ...config, dimensions })
}

export function isEmbeddingProviderConfig(value: unknown): value is EmbeddingProviderConfig {
  if (!isRecord(value) || typeof value.kind !== 'string') return false

  if (value.kind === 'deterministic_fake') {
    return (
      (value.dimensions === undefined || isPositiveInteger(value.dimensions))
    )
  }

  if (value.kind === 'openai-compatible') {
    return (
      typeof value.baseUrl === 'string' &&
      value.baseUrl.length > 0 &&
      typeof value.model === 'string' &&
      value.model.length > 0 &&
      (value.apiKeyEnv === undefined || typeof value.apiKeyEnv === 'string') &&
      (value.dimensions === undefined || isPositiveInteger(value.dimensions)) &&
      (value.timeoutMs === undefined || typeof value.timeoutMs === 'number') &&
      (value.headers === undefined || isStringRecord(value.headers))
    )
  }

  return false
}

function createOpenAiCompatibleEmbeddingProvider(
  config: OpenAiCompatibleEmbeddingProviderConfig & { dimensions: number },
): EmbeddingProvider {
  return {
    kind: 'openai-compatible',
    dimensions: config.dimensions,
    async embed(input) {
      const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
      const apiKey = process.env[apiKeyEnv]
      if (!apiKey) {
        throw new Error(`missing embedding API key env: ${apiKeyEnv}`)
      }

      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )

      try {
        const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/embeddings`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(config.headers ?? {}),
          },
          body: JSON.stringify({
            model: config.model,
            input,
          }),
        })

        const raw = await response.text()
        if (!response.ok) {
          throw new Error(`embedding request failed: HTTP ${response.status}: ${compact(raw)}`)
        }

        const embedding = parseOpenAiEmbedding(raw)
        if (embedding.length !== config.dimensions) {
          throw new Error(
            `embedding dimensions mismatch: expected ${config.dimensions}, got ${embedding.length}`,
          )
        }
        return embedding
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function parseOpenAiEmbedding(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
    throw new Error('embedding response must include data array')
  }

  const first = parsed.data[0]
  if (!isRecord(first) || !Array.isArray(first.embedding)) {
    throw new Error('embedding response data[0].embedding is required')
  }

  if (!first.embedding.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('embedding values must be finite numbers')
  }

  return first.embedding
}

function assertDimensions(dimensions: number): void {
  if (!isPositiveInteger(dimensions)) {
    throw new Error('embedding dimensions must be a positive integer')
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function compact(value: string, maxLength = 300): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}
