import type { LightweightMemoryResult, MemoryRootOptions, ScopeFilter } from '../index'
import { assertScopeFilter } from '../index'
import { getArchiveEventsById } from '../storage/sqliteIndex'

export type MemoryGetOptions = MemoryRootOptions & {
  ids: string[]
  scopeFilter: ScopeFilter
}

export type MemoryArchiveGetOptions = MemoryRootOptions & {
  eventIds: string[]
  scopeFilter: ScopeFilter
}

export async function memoryGet(options: MemoryGetOptions): Promise<LightweightMemoryResult[]> {
  assertScopeFilter(options.scopeFilter)
  return memoryArchiveGet({
    ...options,
    eventIds: options.ids,
  })
}

export async function memoryArchiveGet(
  options: MemoryArchiveGetOptions,
): Promise<LightweightMemoryResult[]> {
  assertScopeFilter(options.scopeFilter)

  const archiveResults = await getArchiveEventsById(options)
  return archiveResults.map(result => ({
    id: result.eventId,
    source: result.source,
    scope: result.scope,
    score: result.score,
    tokenEstimate: result.tokenEstimate,
    textPreview: result.textPreview,
    createdAt: result.createdAt,
    projectId: result.event.projectId,
    sessionId: result.event.sessionId,
  }))
}
