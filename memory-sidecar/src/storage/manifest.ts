import { basename } from 'node:path'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../schema/scope'
import {
  listArchiveSessionFilesWithGzipFallback,
  readArchiveEventsTolerant,
} from './jsonlArchiveStore'

export type ArchiveStoreManifestStats = {
  schemaVersion: number
  archiveEventCount: number
  sessionFileCount: number
  badLineCount: number
  lastEventAt?: string
}

export type ArchiveStoreManifest = {
  projectId: string
  archiveDir: string
  sessionsDir: string
  stats: ArchiveStoreManifestStats
}

export async function getArchiveStoreManifest(
  options: MemoryRootOptions,
): Promise<ArchiveStoreManifest> {
  const memoryDir = getProjectMemoryDir(options)
  const archiveDir = `${memoryDir}/archive`
  const sessionsDir = `${archiveDir}/sessions`
  const sessionFiles = await listArchiveSessionFiles(sessionsDir)

  let archiveEventCount = 0
  let badLineCount = 0
  let lastEventAt: string | undefined

  for (const file of sessionFiles) {
    const result = await readArchiveEventsTolerant({
      ...options,
      sessionId: basename(file, '.jsonl'),
    })
    archiveEventCount += result.events.length
    badLineCount += result.corruptLines.length

    for (const entry of result.events) {
      if (!lastEventAt || entry.event.createdAt > lastEventAt) {
        lastEventAt = entry.event.createdAt
      }
    }
  }

  return {
    projectId: options.projectId,
    archiveDir,
    sessionsDir,
    stats: {
      schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
      archiveEventCount,
      sessionFileCount: sessionFiles.length,
      badLineCount,
      lastEventAt,
    },
  }
}

export async function listArchiveSessionFiles(sessionsDir: string): Promise<string[]> {
  return listArchiveSessionFilesWithGzipFallback(sessionsDir)
}
