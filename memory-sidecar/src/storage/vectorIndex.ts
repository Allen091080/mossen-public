import type { EmbeddingProviderConfig } from '../embedding/provider.js'

export type VectorIndexMode = 'disabled' | 'deterministic_fake' | 'openai-compatible'

export type VectorIndexConfig = {
  enabled?: boolean
  mode?: VectorIndexMode
  dimensions?: number
  provider?: EmbeddingProviderConfig
}

export type NormalizedVectorIndexConfig = {
  enabled: boolean
  mode: VectorIndexMode
  dimensions: number
  provider: EmbeddingProviderConfig
}

export type VectorIndexRecord = {
  id: string
  text: string
  embedding: number[]
  metadata?: Record<string, string | number | boolean | undefined>
}

export type VectorSearchResult = {
  id: string
  score: number
  metadata?: VectorIndexRecord['metadata']
}

export type DisabledVectorIndex = {
  config: NormalizedVectorIndexConfig
  upsert(record: VectorIndexRecord): Promise<void>
  search(query: string, options?: { limit?: number }): Promise<VectorSearchResult[]>
}

const DEFAULT_VECTOR_DIMENSIONS = 32

export function normalizeVectorIndexConfig(
  config: VectorIndexConfig = {},
): NormalizedVectorIndexConfig {
  const enabled = config.enabled === true
  const provider = config.provider ?? { kind: 'deterministic_fake' }
  const mode = enabled ? config.mode ?? provider.kind : 'disabled'
  const dimensions = config.dimensions ?? provider.dimensions ?? DEFAULT_VECTOR_DIMENSIONS

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('vectorIndex.dimensions must be a positive integer')
  }

  if (!isVectorEmbeddingProviderConfig({ ...provider, dimensions })) {
    throw new Error('vectorIndex.provider must be a valid embedding provider config')
  }

  if (!enabled && config.mode && config.mode !== 'disabled') {
    throw new Error('vectorIndex mode cannot be enabled while enabled=false')
  }

  if (enabled && mode === 'openai-compatible' && provider.kind !== 'openai-compatible') {
    throw new Error('vectorIndex.provider.kind must be openai-compatible for openai-compatible mode')
  }

  return {
    enabled,
    mode: enabled ? mode : 'disabled',
    dimensions,
    provider: enabled
      ? { ...provider, dimensions }
      : { kind: 'deterministic_fake', dimensions },
  }
}

export function isVectorIndexEnabled(config: VectorIndexConfig = {}): boolean {
  return normalizeVectorIndexConfig(config).enabled
}

export function createDisabledVectorIndex(
  config: VectorIndexConfig = {},
): DisabledVectorIndex {
  const normalized = normalizeVectorIndexConfig({ ...config, enabled: false, mode: 'disabled' })

  return {
    config: normalized,
    async upsert() {
      return undefined
    },
    async search() {
      return []
    },
  }
}

export function createDeterministicFakeEmbedding(
  input: string,
  dimensions = DEFAULT_VECTOR_DIMENSIONS,
): number[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('dimensions must be a positive integer')
  }

  const vector = new Array<number>(dimensions).fill(0)
  const normalizedInput = input.normalize('NFKC')

  for (let index = 0; index < normalizedInput.length; index += 1) {
    const charCode = normalizedInput.charCodeAt(index)
    const bucket = stableHash(`${index}:${charCode}`) % dimensions
    const sign = stableHash(`${charCode}:${index}`) % 2 === 0 ? 1 : -1
    vector[bucket] += sign * (1 + (charCode % 17))
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) return vector

  return vector.map(value => Number((value / magnitude).toFixed(8)))
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('vectors must have the same dimensions')
  }

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function isVectorEmbeddingProviderConfig(value: unknown): value is EmbeddingProviderConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Partial<EmbeddingProviderConfig>

  if (record.kind === 'deterministic_fake') {
    return record.dimensions === undefined || isPositiveInteger(record.dimensions)
  }

  if (record.kind === 'openai-compatible') {
    return (
      typeof record.baseUrl === 'string' &&
      record.baseUrl.length > 0 &&
      typeof record.model === 'string' &&
      record.model.length > 0 &&
      (record.apiKeyEnv === undefined || typeof record.apiKeyEnv === 'string') &&
      (record.dimensions === undefined || isPositiveInteger(record.dimensions)) &&
      (record.timeoutMs === undefined || typeof record.timeoutMs === 'number') &&
      (record.headers === undefined ||
        (typeof record.headers === 'object' &&
          record.headers !== null &&
          !Array.isArray(record.headers) &&
          Object.values(record.headers).every(item => typeof item === 'string')))
    )
  }

  return false
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
