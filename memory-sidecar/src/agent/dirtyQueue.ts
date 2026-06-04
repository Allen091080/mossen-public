import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { isNonEmptyString, isRecord } from '../schema/scope.js'
import { appendJsonlLine } from '../storage/jsonlAppend.js'
import { parseJsonlLinesTolerant } from '../storage/jsonlParse.js'

export type DirtyMarkerReason = 'archive_append' | 'manual_rebuild'
export type DirtyCheckpointReason = 'worker_completed'

export type DirtyMarker = {
  schemaVersion: 1
  dirtyId: string
  projectId: string
  sessionId: string
  eventIds: string[]
  reason: DirtyMarkerReason
  createdAt: string
}

export type AppendDirtyMarkerOptions = MemoryRootOptions & {
  marker: DirtyMarker
}

export type DirtyCheckpoint = {
  schemaVersion: 1
  dirtyId: string
  projectId: string
  consumedAt: string
  reason: DirtyCheckpointReason
}

export type AppendDirtyCheckpointOptions = MemoryRootOptions & {
  checkpoint: DirtyCheckpoint
}

export function getDirtyQueuePath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/agent/dirty.jsonl`
}

export function getDirtyCheckpointPath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/agent/dirty-checkpoints.jsonl`
}

export async function appendDirtyMarker(
  options: AppendDirtyMarkerOptions,
): Promise<DirtyMarker> {
  if (!isDirtyMarker(options.marker)) {
    throw new Error('marker must match DirtyMarker schema')
  }
  if (options.marker.projectId !== options.projectId) {
    throw new Error('dirty marker projectId must match append projectId')
  }

  const jsonlPath = getDirtyQueuePath(options)
  await mkdir(`${getProjectMemoryDir(options)}/agent`, { recursive: true })
  await appendJsonlLine(jsonlPath, options.marker)
  return options.marker
}

export async function listDirtyMarkers(
  options: MemoryRootOptions,
): Promise<DirtyMarker[]> {
  const contents = await readFile(getDirtyQueuePath(options), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  return parseJsonlLinesTolerant(contents, { context: 'dirty-markers' })
    .filter(isDirtyMarker)
}

export async function appendDirtyCheckpoint(
  options: AppendDirtyCheckpointOptions,
): Promise<DirtyCheckpoint> {
  if (!isDirtyCheckpoint(options.checkpoint)) {
    throw new Error('dirty checkpoint must match DirtyCheckpoint schema')
  }
  if (options.checkpoint.projectId !== options.projectId) {
    throw new Error('dirty checkpoint projectId must match append projectId')
  }

  const jsonlPath = getDirtyCheckpointPath(options)
  await mkdir(`${getProjectMemoryDir(options)}/agent`, { recursive: true })
  await appendJsonlLine(jsonlPath, options.checkpoint)
  return options.checkpoint
}

export async function listDirtyCheckpoints(
  options: MemoryRootOptions,
): Promise<DirtyCheckpoint[]> {
  const contents = await readFile(getDirtyCheckpointPath(options), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  return parseJsonlLinesTolerant(contents, { context: 'dirty-checkpoints' })
    .filter(isDirtyCheckpoint)
}

export async function listUnconsumedDirtyMarkers(
  options: MemoryRootOptions,
): Promise<DirtyMarker[]> {
  const checkpoints = new Set(
    (await listDirtyCheckpoints(options)).map(checkpoint => checkpoint.dirtyId),
  )
  return (await listDirtyMarkers(options)).filter(marker => !checkpoints.has(marker.dirtyId))
}

export function isDirtyMarker(value: unknown): value is DirtyMarker {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.dirtyId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.sessionId) &&
    Array.isArray(value.eventIds) &&
    value.eventIds.every(isNonEmptyString) &&
    (value.reason === 'archive_append' || value.reason === 'manual_rebuild') &&
    isNonEmptyString(value.createdAt)
  )
}

export function isDirtyCheckpoint(value: unknown): value is DirtyCheckpoint {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.dirtyId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.consumedAt) &&
    value.reason === 'worker_completed'
  )
}
