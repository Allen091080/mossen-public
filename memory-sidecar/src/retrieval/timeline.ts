import type { LightweightMemoryResult, MemoryRootOptions, ScopeFilter } from '../index'
import { assertScopeFilter } from '../index'
import { searchArchiveEvents } from '../storage/sqliteIndex'

export type MemoryTimelineOptions = MemoryRootOptions & {
  scopeFilter: ScopeFilter
  topic?: string
  file?: string
  limit?: number
}

export async function memoryTimeline(
  options: MemoryTimelineOptions,
): Promise<LightweightMemoryResult[]> {
  assertScopeFilter(options.scopeFilter)

  const query = [options.topic, options.file].filter(Boolean).join(' ').trim()
  const archiveResults = await searchArchiveEvents({
    ...options,
    query,
    limit: options.limit ?? 20,
  })

  return archiveResults
    .map(result => ({
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
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}
