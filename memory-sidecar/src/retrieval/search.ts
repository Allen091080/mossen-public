import type { ObservationType } from '../schema/observation'
import type { LightweightMemoryResult, MemoryRootOptions, ScopeFilter } from '../index'
import { assertScopeFilter } from '../index'
import { searchArchiveEvents } from '../storage/sqliteIndex'

export type MemorySearchOptions = MemoryRootOptions & {
  query: string
  scopeFilter: ScopeFilter
  type?: ObservationType
  limit?: number
}

export async function memorySearch(options: MemorySearchOptions): Promise<LightweightMemoryResult[]> {
  assertScopeFilter(options.scopeFilter)

  const archiveResults = await searchArchiveEvents({
    ...options,
    limit: options.limit ?? 10,
  })

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
