import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteJsonSync } from '../../utils/atomicWriteJson.js'
import { lock } from '../../utils/lockfile.js'
import { getMossenHome } from '../../utils/mossenHome.js'

const GENERATION_CACHE_DIR = 'workflow-generation'
const GENERATION_CACHE_FILE = 'cache-v1.json'
const GENERATION_CACHE_LOCK = '.cache-v1.lock'
const MAX_GENERATION_RECORDS = 500

export type StoredWorkflowGenerationRecord = {
  fingerprint: string
  inputDigest: string
  catalogDigest: string
  chainDigest: string
  status: 'needs_clarification' | 'proposed' | 'rejected'
  generatedAt: string
  result: unknown
}

export type WorkflowGenerationCache = {
  version: 1
  updatedAt: string
  order: string[]
  idempotency: Record<string, StoredWorkflowGenerationRecord>
  inputContexts: Record<
    string,
    {
      idempotencyKey: string
      catalogDigest: string
      chainDigest: string
      status: StoredWorkflowGenerationRecord['status']
    }
  >
}

function emptyCache(): WorkflowGenerationCache {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    order: [],
    idempotency: {},
    inputContexts: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStoredRecord(value: unknown): value is StoredWorkflowGenerationRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.fingerprint === 'string' &&
    typeof value.inputDigest === 'string' &&
    typeof value.catalogDigest === 'string' &&
    typeof value.chainDigest === 'string' &&
    (value.status === 'needs_clarification' ||
      value.status === 'proposed' ||
      value.status === 'rejected') &&
    typeof value.generatedAt === 'string' &&
    value.result !== undefined
  )
}

function normalizeCache(value: unknown): WorkflowGenerationCache {
  if (!isRecord(value) || value.version !== 1) return emptyCache()
  const rawIdempotency = isRecord(value.idempotency) ? value.idempotency : {}
  const idempotency = Object.fromEntries(
    Object.entries(rawIdempotency).filter((entry): entry is [string, StoredWorkflowGenerationRecord] =>
      isStoredRecord(entry[1]),
    ),
  )
  const knownKeys = new Set(Object.keys(idempotency))
  const order = Array.isArray(value.order)
    ? value.order.filter(
        (key): key is string => typeof key === 'string' && knownKeys.has(key),
      )
    : []
  for (const key of knownKeys) {
    if (!order.includes(key)) order.push(key)
  }
  const inputContexts: WorkflowGenerationCache['inputContexts'] = {}
  for (const [idempotencyKey, record] of Object.entries(idempotency)) {
    inputContexts[record.inputDigest] = {
      idempotencyKey,
      catalogDigest: record.catalogDigest,
      chainDigest: record.chainDigest,
      status: record.status,
    }
  }
  return {
    version: 1,
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt
        : new Date(0).toISOString(),
    order,
    idempotency,
    inputContexts,
  }
}

export function workflowGenerationCachePath(): string {
  return join(getMossenHome(), GENERATION_CACHE_DIR, GENERATION_CACHE_FILE)
}

function workflowGenerationCacheLockPath(): string {
  return join(getMossenHome(), GENERATION_CACHE_DIR, GENERATION_CACHE_LOCK)
}

export function loadWorkflowGenerationCache(): WorkflowGenerationCache {
  const path = workflowGenerationCachePath()
  if (!existsSync(path)) return emptyCache()
  try {
    return normalizeCache(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return emptyCache()
  }
}

export function inspectWorkflowGenerationCache(input: {
  idempotencyKey: string
  fingerprint: string
  previousInputDigest: string | null
  catalogDigest: string
  chainDigest: string
  answerQuestionIds: string[]
}):
  | { kind: 'miss' }
  | { kind: 'replay'; result: unknown }
  | { kind: 'idempotency-conflict' }
  | { kind: 'clarification-context-conflict' } {
  const cache = loadWorkflowGenerationCache()
  const prior = cache.idempotency[input.idempotencyKey]
  if (prior) {
    return prior.fingerprint === input.fingerprint
      ? { kind: 'replay', result: prior.result }
      : { kind: 'idempotency-conflict' }
  }
  if (input.previousInputDigest !== null) {
    const context = cache.inputContexts[input.previousInputDigest]
    if (
      !context ||
      context.status !== 'needs_clarification' ||
      context.catalogDigest !== input.catalogDigest ||
      context.chainDigest !== input.chainDigest
    ) {
      return { kind: 'clarification-context-conflict' }
    }
    const priorResult = cache.idempotency[context.idempotencyKey]?.result
    const priorQuestions = isRecord(priorResult) && Array.isArray(priorResult.questions)
      ? priorResult.questions
      : []
    const requiredQuestionIds = priorQuestions.flatMap(question =>
      isRecord(question) &&
      question.required !== false &&
      typeof question.id === 'string'
        ? [question.id]
        : [],
    )
    const answered = new Set(input.answerQuestionIds)
    if (requiredQuestionIds.some(questionId => !answered.has(questionId))) {
      return { kind: 'clarification-context-conflict' }
    }
  }
  return { kind: 'miss' }
}

export async function commitWorkflowGenerationRecord(input: {
  idempotencyKey: string
  record: StoredWorkflowGenerationRecord
}): Promise<
  | { kind: 'stored' }
  | { kind: 'replay'; result: unknown }
  | { kind: 'idempotency-conflict' }
> {
  const cachePath = workflowGenerationCachePath()
  const lockPath = workflowGenerationCacheLockPath()
  mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 })
  writeFileSync(lockPath, '', { encoding: 'utf8', flag: 'a', mode: 0o600 })
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(lockPath, {
      realpath: false,
      stale: 5_000,
      retries: {
        retries: 4,
        factor: 1,
        minTimeout: 25,
        maxTimeout: 100,
      },
    })
    const cache = loadWorkflowGenerationCache()
    const prior = cache.idempotency[input.idempotencyKey]
    if (prior) {
      return prior.fingerprint === input.record.fingerprint
        ? { kind: 'replay', result: prior.result }
        : { kind: 'idempotency-conflict' }
    }
    cache.idempotency[input.idempotencyKey] = input.record
    cache.order.push(input.idempotencyKey)
    cache.inputContexts[input.record.inputDigest] = {
      idempotencyKey: input.idempotencyKey,
      catalogDigest: input.record.catalogDigest,
      chainDigest: input.record.chainDigest,
      status: input.record.status,
    }
    while (cache.order.length > MAX_GENERATION_RECORDS) {
      const oldestKey = cache.order.shift()
      if (!oldestKey) break
      const oldest = cache.idempotency[oldestKey]
      delete cache.idempotency[oldestKey]
      if (
        oldest &&
        cache.inputContexts[oldest.inputDigest]?.idempotencyKey === oldestKey
      ) {
        delete cache.inputContexts[oldest.inputDigest]
      }
    }
    cache.updatedAt = input.record.generatedAt
    atomicWriteJsonSync(cachePath, cache, { defaultMode: 0o600 })
    return { kind: 'stored' }
  } finally {
    await release?.().catch(() => {})
  }
}
