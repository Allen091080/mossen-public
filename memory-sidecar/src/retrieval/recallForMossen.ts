import type { MemoryRootOptions, LightweightMemoryResult } from '../index'
import { memoryContext, normalizeQueryTerms } from './context'

export type RecallForMossenOptions = MemoryRootOptions & {
  query: string
  limit?: number
  maxTokens?: number
  // W143-C: when true, include per-layer hit counts and normalised
  // terms in the result. Default false so production payloads stay lean.
  debug?: boolean
}

export type ParsedRecallForMossenArgs = {
  query: string
  limit?: number
  maxTokens?: number
  // W143-C: --debug flag from `/memory-sidecar recall <query> --debug`.
  debug?: boolean
  // W310: --explain renders operator-friendly explanation text in the
  // slash command. Parsing lives here so CLI/tests share one contract.
  explain?: boolean
  warnings: string[]
}

export type RecallItem = {
  id: string
  source: string
  score: number
  scope: string
  tokenEstimate: number
  title: string
  summary: string
  evidenceIds: string[]
}

// W143-C: per-layer hit-count shape returned only when debug=true. Old
// callers ignore this field, so it is safe to add.
//
// W143.1: archiveHits previously aggregated SQLite + JSONL fallback into
// a single number, hiding which retrieval path actually carried the
// query. archiveSqliteHits / archiveJsonlFallbackHits split that count
// so reviewers can see whether FTS / LIKE worked or whether the JSONL
// fallback was the only thing that survived. The two new fields sum to
// archiveHits when no further trimming has happened (i.e. when the
// archive section is not also dropped by token-budget pressure).
export type RecallDebug = {
  query: string
  normalizedFullQuery: string
  normalizedTerms: string[]
  normalizedStrongTerms: string[]
  requestedProjectId?: string
  resolvedProjectId?: string
  searchedProjectIds: string[]
  observationHits: number
  proposalHits: number
  profileHits: number
  archiveHits: number
  archiveSqliteHits: number
  archiveJsonlFallbackHits: number
  filteredControlPlaneCount: number
  finalResultCount: number
  warnings: string[]
}

export type RecallResult = {
  query: string
  limit: number
  maxTokens: number
  totalResults: number
  estimatedTokens: number
  items: RecallItem[]
  warnings: string[]
  resolvedProjectId?: string
  requestedProjectId?: string
  searchedProjectIds?: string[]
  filteredControlPlaneCount: number
  // W143-C: only populated when options.debug === true.
  debug?: RecallDebug
}

export async function recallForMossen(
  options: RecallForMossenOptions,
): Promise<RecallResult> {
  const query = options.query.trim()
  const limit = options.limit ?? 5
  const maxTokens = options.maxTokens ?? 1200
  const warnings: string[] = []

  if (!query) {
    return {
      query: '',
      limit,
      maxTokens,
      totalResults: 0,
      estimatedTokens: 0,
      items: [],
      warnings: ['empty query'],
      filteredControlPlaneCount: 0,
    }
  }

  try {
    const contextBundle = await memoryContext({
      ...options,
      query,
      scopeFilter: {
        scope: 'project',
        projectId: options.projectId,
      },
      limit,
      maxTokens,
    })

    const items: RecallItem[] = contextBundle.results.map(
      (result: LightweightMemoryResult) => ({
        id: result.id,
        source: result.source,
        score: Math.round(result.score * 100) / 100,
        scope: result.scope,
        tokenEstimate: result.tokenEstimate,
        title: compactTitle(result.title ?? result.textPreview ?? ''),
        summary: compactSummary(result.summary ?? result.textPreview ?? ''),
        evidenceIds: (result.evidenceEventIds ?? result.evidenceIds ?? []).slice(0, 3),
      }),
    )

    if (items.length === 0) {
      warnings.push('no results found — consider running conversations or check trial-report')
    }

    const filteredCount = contextBundle.filteredControlPlaneCount
    if (filteredCount > 0) {
      warnings.push(`filtered ${filteredCount} control-plane memor${filteredCount === 1 ? 'y' : 'ies'}`)
    }

    // W143-C: assemble debug payload from the bundle's per-section
    // results. We deliberately use the post-rank sections (which is what
    // the operator actually sees) rather than the raw pre-rank counts —
    // the goal is to answer "did my query hit any layer at all" and
    // "where did it hit", not to expose tuning internals.
    // W143.1: archiveSqliteHits / archiveJsonlFallbackHits come from the
    // bundle's archiveLayerCounts (captured AFTER content filtering and
    // control-plane drop, BEFORE token-budget trimming) so the operator
    // sees what each retrieval layer actually contributed.
    let debug: RecallDebug | undefined
    if (options.debug) {
      const normalized = normalizeQueryTerms(query)
      const layerCounts = contextBundle.archiveLayerCounts ?? {
        sqlite: 0,
        jsonlFallback: 0,
      }
      debug = {
        query,
        normalizedFullQuery: normalized.fullQuery,
        normalizedTerms: normalized.terms,
        normalizedStrongTerms: normalized.strongTerms,
        requestedProjectId: contextBundle.requestedProjectId,
        resolvedProjectId: contextBundle.resolvedProjectId,
        searchedProjectIds: contextBundle.searchedProjectIds ?? [],
        observationHits: contextBundle.sections.observations.length,
        proposalHits: contextBundle.sections.proposals.length,
        profileHits: contextBundle.sections.profile.length,
        archiveHits: contextBundle.sections.archive.length,
        archiveSqliteHits: layerCounts.sqlite,
        archiveJsonlFallbackHits: layerCounts.jsonlFallback,
        filteredControlPlaneCount: filteredCount,
        finalResultCount: items.length,
        warnings,
      }
    }

    return {
      query,
      limit,
      maxTokens,
      totalResults: items.length,
      estimatedTokens: contextBundle.totalTokenEstimate,
      items,
      warnings,
      resolvedProjectId: contextBundle.resolvedProjectId,
      requestedProjectId: contextBundle.requestedProjectId,
      searchedProjectIds: contextBundle.searchedProjectIds,
      filteredControlPlaneCount: filteredCount,
      debug,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ENOENT') || message.includes('SQLITE') || message.includes('does not exist')) {
      return {
        query,
        limit,
        maxTokens,
        totalResults: 0,
        estimatedTokens: 0,
        items: [],
        warnings: ['sidecar not initialized — run `bun memory-sidecar/src/cli/index.ts init --home ~/.mossen` first'],
        filteredControlPlaneCount: 0,
      }
    }
    return {
      query,
      limit,
      maxTokens,
      totalResults: 0,
      estimatedTokens: 0,
      items: [],
      warnings: [`recall error: ${message}`],
      filteredControlPlaneCount: 0,
    }
  }
}

export function parseRecallForMossenArgs(input: string): ParsedRecallForMossenArgs {
  const parts = input.trim().split(/\s+/).filter(Boolean)
  const queryParts: string[] = []
  const warnings: string[] = []
  let limit: number | undefined
  let maxTokens: number | undefined
  // W143-C: --debug enables per-layer hit count + normalised terms in
  // the result. Position-agnostic — works as `recall foo --debug` or
  // `recall --debug foo`. Defaults off.
  let debug = false
  let explain = false

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '--limit') {
      const value = parts[index + 1]
      const parsed = Number(value)
      if (Number.isInteger(parsed) && parsed > 0) {
        limit = Math.min(parsed, 20)
      } else {
        warnings.push(`ignored invalid --limit value: ${value ?? ''}`)
      }
      index += 1
      continue
    }
    if (part === '--max-tokens') {
      const value = parts[index + 1]
      const parsed = Number(value)
      if (Number.isInteger(parsed) && parsed > 0) {
        maxTokens = Math.min(Math.max(parsed, 100), 4000)
      } else {
        warnings.push(`ignored invalid --max-tokens value: ${value ?? ''}`)
      }
      index += 1
      continue
    }
    if (part === '--debug') {
      debug = true
      continue
    }
    if (part === '--explain') {
      explain = true
      continue
    }
    queryParts.push(part)
  }

  return {
    query: queryParts.join(' ').trim(),
    limit,
    maxTokens,
    debug,
    explain,
    warnings,
  }
}

function compactTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= 80) return collapsed
  return `${collapsed.slice(0, 77)}...`
}

function compactSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= 200) return collapsed
  return `${collapsed.slice(0, 197)}...`
}
