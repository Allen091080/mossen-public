import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import type { Observation, ObservationType } from '../schema/observation'
import { isObservation, normalizeObservation } from '../schema/observation'
import type { MemoryScope } from '../schema/scope'
import { appendJsonlLine } from './jsonlAppend'

export type AppendObservationOptions = MemoryRootOptions & {
  observation: Observation
}

export type AppendObservationsOptions = MemoryRootOptions & {
  observations: Observation[]
}

export type AppendObservationResult = {
  observation: Observation
  jsonlPath: string
  byteOffset?: number
  byteLength?: number
  skipped: boolean
  reason?: 'duplicate_observation_id' | 'duplicate_evidence_type_scope'
}

export type ObservationWithLocation = {
  observation: Observation
  jsonlPath: string
  byteOffset: number
  byteLength: number
}

export type ReadObservationOptions = MemoryRootOptions & {
  observationId: string
}

export type ReviewObservationOptions = MemoryRootOptions & {
  observationId: string
  lifecycle?: Extract<Observation['lifecycle'], 'active' | 'candidate' | 'disputed' | 'stale'>
  retrievalPolicy?: Observation['retrievalPolicy']
  promotionStatus?: Observation['promotionStatus']
  reviewedAt?: string
}

export type ListObservationsOptions = MemoryRootOptions & {
  scope?: MemoryScope
  type?: ObservationType
  projectId?: string
  sessionId?: string
  limit?: number
}

export type RecentObservationsOptions = MemoryRootOptions & {
  scope?: MemoryScope
  type?: ObservationType
  projectId?: string
  sessionId?: string
  limit?: number
}

export function getObservationsPath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/observations.jsonl`
}

export async function appendObservation(
  options: AppendObservationOptions,
): Promise<AppendObservationResult> {
  const [result] = await appendObservations({
    ...options,
    observations: [options.observation],
  })

  return result
}

export async function appendObservations(
  options: AppendObservationsOptions,
): Promise<AppendObservationResult[]> {
  const jsonlPath = getObservationsPath(options)
  await mkdir(getProjectMemoryDir(options), { recursive: true })

  const existing = await readObservationsFromPath(jsonlPath)
  const seenObservationIds = new Set<string>()
  const seenEvidenceKeys = new Set<string>()

  for (const { observation } of existing) {
    seenObservationIds.add(observation.observationId)
    seenEvidenceKeys.add(observationEvidenceKey(observation))
  }

  const results: AppendObservationResult[] = []

  for (const observation of options.observations) {
    assertObservationForProject(observation, options.projectId)

    if (seenObservationIds.has(observation.observationId)) {
      results.push({
        observation,
        jsonlPath,
        skipped: true,
        reason: 'duplicate_observation_id',
      })
      continue
    }

    const evidenceKey = observationEvidenceKey(observation)
    if (seenEvidenceKeys.has(evidenceKey)) {
      results.push({
        observation,
        jsonlPath,
        skipped: true,
        reason: 'duplicate_evidence_type_scope',
      })
      continue
    }

    const { byteOffset, byteLength } = await appendJsonlLine(jsonlPath, observation)

    seenObservationIds.add(observation.observationId)
    seenEvidenceKeys.add(evidenceKey)
    results.push({
      observation,
      jsonlPath,
      byteOffset,
      byteLength,
      skipped: false,
    })
  }

  return results
}

export async function readObservation(
  options: ReadObservationOptions,
): Promise<ObservationWithLocation | undefined> {
  const observations = await readObservationsFromPath(getObservationsPath(options))
  return observations.find(
    ({ observation }) => observation.observationId === options.observationId,
  )
}

export async function reviewObservation(
  options: ReviewObservationOptions,
): Promise<AppendObservationResult> {
  const latest = await readObservation(options)
  if (!latest) {
    throw new Error(`observation not found: ${options.observationId}`)
  }

  const observation: Observation = {
    ...latest.observation,
    lifecycle: options.lifecycle ?? latest.observation.lifecycle,
    retrievalPolicy: options.retrievalPolicy ?? latest.observation.retrievalPolicy,
    promotionStatus: options.promotionStatus ?? latest.observation.promotionStatus,
    updatedAt: options.reviewedAt ?? new Date().toISOString(),
  }

  return appendObservationRevision({ ...options, observation })
}

export async function suppressObservation(
  options: MemoryRootOptions & {
    observationId: string
    reviewedAt?: string
  },
): Promise<AppendObservationResult> {
  return reviewObservation({
    ...options,
    lifecycle: 'disputed',
    retrievalPolicy: 'never_inject',
    promotionStatus: 'rejected',
  })
}

export async function listObservations(
  options: ListObservationsOptions,
): Promise<ObservationWithLocation[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (limit <= 0) return []

  const observations = await readObservationsFromPath(getObservationsPath(options))
  return observations
    .filter(({ observation }) => matchesObservationFilter(observation, options))
    .slice(0, limit)
}

export async function recentObservations(
  options: RecentObservationsOptions,
): Promise<ObservationWithLocation[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  const observations = await readObservationsFromPath(getObservationsPath(options))
  return observations
    .filter(({ observation }) => matchesObservationFilter(observation, options))
    .sort((a, b) => b.observation.createdAt.localeCompare(a.observation.createdAt))
    .slice(0, limit)
}

async function readObservationsFromPath(jsonlPath: string): Promise<ObservationWithLocation[]> {
  const contents = await readFile(jsonlPath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  const observations: ObservationWithLocation[] = []
  let byteOffset = 0
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trimEnd()
    const byteLength = Buffer.byteLength(`${rawLine}\n`)
    if (line.trim()) {
      const parsed = JSON.parse(line) as unknown
      const observation = normalizeObservation(parsed)
      if (!observation) {
        throw new Error(`invalid observation record at byte offset ${byteOffset}`)
      }
      observations.push({
        observation,
        jsonlPath,
        byteOffset,
        byteLength,
      })
    }
    byteOffset += byteLength
  }

  return latestObservationRecords(observations)
}

async function appendObservationRevision(
  options: MemoryRootOptions & { observation: Observation },
): Promise<AppendObservationResult> {
  assertObservationForProject(options.observation, options.projectId)
  const jsonlPath = getObservationsPath(options)
  await mkdir(getProjectMemoryDir(options), { recursive: true })

  const { byteOffset, byteLength } = await appendJsonlLine(jsonlPath, options.observation)
  return {
    observation: options.observation,
    jsonlPath,
    byteOffset,
    byteLength,
    skipped: false,
  }
}

function latestObservationRecords(
  records: ObservationWithLocation[],
): ObservationWithLocation[] {
  const latest = new Map<string, ObservationWithLocation>()
  for (const record of records) {
    const current = latest.get(record.observation.observationId)
    if (!current || observationSortKey(record.observation) >= observationSortKey(current.observation)) {
      latest.set(record.observation.observationId, record)
    }
  }
  return [...latest.values()]
}

function observationSortKey(observation: Observation): string {
  return observation.updatedAt ?? observation.createdAt
}

function assertObservationForProject(observation: Observation, projectId: string): void {
  if (!isObservation(observation)) {
    throw new Error('observation must match Observation schema')
  }

  if (observation.projectId && observation.projectId !== projectId) {
    throw new Error('observation.projectId must match append projectId')
  }
}

function observationEvidenceKey(observation: Observation): string {
  return [
    observation.type,
    observation.scope,
    ...observation.evidenceEventIds.slice().sort(),
  ].join('\u001f')
}

function matchesObservationFilter(
  observation: Observation,
  options: ListObservationsOptions,
): boolean {
  return (
    (!options.scope || observation.scope === options.scope) &&
    (!options.type || observation.type === options.type) &&
    (!options.projectId || observation.projectId === options.projectId) &&
    (!options.sessionId || observation.sessionId === options.sessionId)
  )
}
