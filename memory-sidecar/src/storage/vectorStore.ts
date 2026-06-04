import { mkdir, open, readFile } from 'node:fs/promises'
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding/provider.js'
import type { LightweightMemoryResult, MemoryRootOptions } from '../index.js'
import { estimateTokens, getProjectMemoryDir } from '../index.js'
import {
  cosineSimilarity,
  normalizeVectorIndexConfig,
  type VectorIndexConfig,
  type VectorIndexMode,
  type VectorIndexRecord,
} from './vectorIndex.js'
import { recentArchiveEvents } from './jsonlArchiveStore.js'

export type VectorStoreRecord = VectorIndexRecord & {
  schemaVersion: 1
  source: 'archive'
  projectId: string
  sessionId?: string
  createdAt: string
}

export type RebuildVectorStoreResult = {
  enabled: boolean
  mode: VectorIndexMode
  dimensions: number
  recordsWritten: number
  jsonlPath: string
}

export type SearchVectorStoreOptions = MemoryRootOptions & {
  query: string
  limit?: number
  vectorIndex?: VectorIndexConfig
  embeddingProvider?: EmbeddingProvider
}

export type RebuildVectorStoreOptions = MemoryRootOptions & {
  limit?: number
  vectorIndex?: VectorIndexConfig
  embeddingProvider?: EmbeddingProvider
}

export function getVectorStorePath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/vectors/vectors.jsonl`
}

export async function rebuildVectorStore(
  options: RebuildVectorStoreOptions,
): Promise<RebuildVectorStoreResult> {
  const provider = resolveEmbeddingProvider(options)
  const jsonlPath = getVectorStorePath(options)
  await mkdir(`${getProjectMemoryDir(options)}/vectors`, { recursive: true })
  const events = await recentArchiveEvents({
    ...options,
    limit: options.limit ?? 100000,
  })
  const records: VectorStoreRecord[] = []
  for (const { event } of events) {
    records.push({
      schemaVersion: 1,
      id: event.eventId,
      source: 'archive',
      projectId: event.projectId,
      sessionId: event.sessionId,
      createdAt: event.createdAt,
      text: event.text,
      embedding: await provider.embed(event.text),
      metadata: {
        role: event.role,
        kind: event.kind,
        tokenEstimate: event.tokenEstimate,
        embeddingProvider: provider.kind,
      },
    })
  }

  const file = await open(jsonlPath, 'w')
  try {
    for (const record of records) {
      await file.write(`${JSON.stringify(record)}\n`)
    }
  } finally {
    await file.close()
  }

  return {
    enabled: true,
    mode: provider.kind,
    dimensions: provider.dimensions,
    recordsWritten: records.length,
    jsonlPath,
  }
}

export async function searchVectorStore(
  options: SearchVectorStoreOptions,
): Promise<LightweightMemoryResult[]> {
  const provider = resolveEmbeddingProvider(options)
  const records = await readVectorStore(options)
  const queryEmbedding = await provider.embed(options.query)
  return records
    .filter(record => record.embedding.length === queryEmbedding.length)
    .map(record => ({
      record,
      score: cosineSimilarity(queryEmbedding, record.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit ?? 10)
    .map(({ record, score }) => ({
      id: record.id,
      source: 'archive',
      scope: 'project',
      score,
      tokenEstimate: estimateTokens(record.text),
      textPreview: record.text.slice(0, 240),
      createdAt: record.createdAt,
      projectId: record.projectId,
      sessionId: record.sessionId,
    }))
}

function resolveEmbeddingProvider(options: {
  vectorIndex?: VectorIndexConfig
  embeddingProvider?: EmbeddingProvider
}): EmbeddingProvider {
  if (options.embeddingProvider) return options.embeddingProvider
  const config = normalizeVectorIndexConfig({
    enabled: true,
    ...(options.vectorIndex ?? {}),
  })
  return createEmbeddingProvider(config.provider)
}

export async function readVectorStore(
  options: MemoryRootOptions,
): Promise<VectorStoreRecord[]> {
  const contents = await readFile(getVectorStorePath(options), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  return contents
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as VectorStoreRecord)
    .filter(isVectorStoreRecord)
}

function isVectorStoreRecord(value: unknown): value is VectorStoreRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as VectorStoreRecord).schemaVersion === 1 &&
    (value as VectorStoreRecord).source === 'archive' &&
    typeof (value as VectorStoreRecord).id === 'string' &&
    typeof (value as VectorStoreRecord).text === 'string' &&
    Array.isArray((value as VectorStoreRecord).embedding) &&
    (value as VectorStoreRecord).embedding.every(item => typeof item === 'number') &&
    typeof (value as VectorStoreRecord).projectId === 'string' &&
    typeof (value as VectorStoreRecord).createdAt === 'string'
  )
}
