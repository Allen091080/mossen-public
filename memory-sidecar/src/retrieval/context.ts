import type {
  LightweightMemoryResult,
  MemoryRootOptions,
  ScopeFilter,
} from '../index'
import { assertScopeFilter, estimateTokens } from '../index'
import { projectIdAliases, resolveProjectId } from '../projectId.js'
import { recentObservations } from '../storage/observationStore.js'
import { recentProfileSnapshots } from '../storage/profileStore.js'
import { recentProposals } from '../storage/proposalStore.js'
import { searchArchiveJsonlFallback } from '../storage/jsonlArchiveStore.js'
import { searchArchiveEvents, type ArchiveIndexSearchResult } from '../storage/sqliteIndex.js'
import type { Proposal } from '../schema/proposal.js'

export type MemoryContextOptions = MemoryRootOptions & {
  query: string
  scopeFilter: ScopeFilter
  limit?: number
  maxTokens?: number
}

export type MemoryContextBundle = {
  query: string
  scopeFilter: ScopeFilter
  maxTokens: number
  totalTokenEstimate: number
  resolvedProjectId?: string
  requestedProjectId?: string
  searchedProjectIds?: string[]
  results: LightweightMemoryResult[]
  sections: {
    profile: LightweightMemoryResult[]
    observations: LightweightMemoryResult[]
    proposals: LightweightMemoryResult[]
    archive: LightweightMemoryResult[]
  }
  filteredControlPlaneCount: number
  // W143.1: per-layer hit counts for the archive search, captured
  // BEFORE control-plane filtering / token budgeting so debug callers
  // see what each retrieval layer actually returned. Optional and
  // populated unconditionally — `recallForMossen` only surfaces it
  // when the operator passes --debug.
  archiveLayerCounts?: {
    sqlite: number
    jsonlFallback: number
  }
}

type MemoryContextCandidate = LightweightMemoryResult & {
  observationSource?: 'rule' | 'llm' | 'manual'
  proposalStatus?: Proposal['status']
  dedupeKey?: string
  // W120 M5: strongMatch is the relevance gate. Items without a strong
  // match never receive policy/confidence boosts and rank below items
  // that DO have a strong match, regardless of policyPriority.
  strongMatch?: boolean
  // W143.1: which underlying retrieval layer produced this archive
  // candidate (sqlite vs jsonl-fallback). Stripped by
  // stripCandidateMetadata before reaching plain output; only the
  // bundle-level archiveLayerCounts carries it through to the debug
  // payload so we never change the canonical result shape.
  retrievalLayer?: 'sqlite' | 'jsonl-fallback'
}

const PROFILE_RESULT_LIMIT = 1
const PROFILE_PREVIEW_CHARS = 480
const PROFILE_TOKEN_BUDGET_RATIO = 0.15
const PROPOSAL_RESULT_LIMIT = 100
const PROPOSAL_PREVIEW_CHARS = 520

// W120 M5: extracted constants so smoke can lock the values and so any
// future tuning happens in one place.
const EXACT_PHRASE_BOOST = 0.5
const STRONG_TERM_BOOST = 0.3

// W120 M4 + M6: small set of high-frequency CJK function words. A CJK
// query that is *only* one of these characters returns 0 results — these
// chars match nearly every text and would otherwise flood recall with
// noise. Multi-char CJK phrases that *contain* a stopword still flow
// through normally; we only gate the single-char-only case.
const CJK_STOPWORDS = new Set([
  '的', '了', '是', '我', '你', '它', '他', '她', '这', '那',
  '和', '或', '在', '就', '也', '都', '吗', '呢', '啊', '吧',
  '把', '被', '让', '给', '又', '还', '才', '会', '能', '要',
])

// W120 M4: detect single CJK ideograph (BMP and extension A). A 1-char
// CJK query is treated as too coarse regardless of stopword membership;
// recall returns 0 unless the user types at least 2 chars or an ASCII
// id-shape token.
const SINGLE_CJK_CHAR = /^[㐀-䶿一-鿿]$/u
const HAS_CJK = /[㐀-䶿一-鿿]/u

// W120 M5: a "strong term" is a multi-char ASCII identifier (length ≥ 3,
// e.g. `W98`, `memory-capture-live-test`) OR a multi-char CJK substring.
// hasStrongMatch requires AT LEAST one strong term to match the text;
// without it, no boost may apply.
const STRONG_ASCII_TERM = /^[A-Za-z][A-Za-z0-9_-]{2,}$/u
const ARCHIVE_SEARCH_VARIANT = /^[A-Za-z0-9_.@/-]+$/u

const QUERY_TERM_ALIASES = new Map<string, string[]>([
  ['捕获', ['capture', 'captured', 'ingest', 'ingestion']],
  ['管线', ['pipeline', 'flow', 'chain']],
  ['归档', ['archive', 'jsonl']],
  ['画像', ['profile', 'profiles', 'synthesize_profile']],
  ['记忆', ['memory', 'memory-sidecar', 'sidecar']],
  ['证据', ['evidence', 'evidenceeventids', 'archive']],
  ['召回', ['recall', 'retrieval', 'retrieve', 'memorycontext', 'memorycontexttool']],
  ['提案', ['proposal', 'proposals']],
  ['持久化', ['storage', 'persistence', 'persisted', 'persistent', 'archive', 'jsonl', 'sqlite', 'fts']],
  ['索引', ['index', 'indexed', 'sqlite', 'fts', 'vector']],
  ['质量', ['quality', 'benchmark', 'metrics', 'mrr']],
  ['向量', ['vector', 'embedding', 'embeddings']],
])

export type QueryTermGroup = {
  term: string
  variants: string[]
}

export type NormalizedQuery = {
  rawQuery: string
  fullQuery: string
  terms: string[]
  strongTerms: string[]
  termGroups: QueryTermGroup[]
}

export function normalizeQueryTerms(query: string): NormalizedQuery {
  const trimmed = query.trim()
  if (!trimmed) {
    return { rawQuery: query, fullQuery: '', terms: [], strongTerms: [], termGroups: [] }
  }

  // M4 gate: single CJK character (whether stopword or not) is rejected.
  if (SINGLE_CJK_CHAR.test(trimmed)) {
    return { rawQuery: query, fullQuery: trimmed, terms: [], strongTerms: [], termGroups: [] }
  }

  // M4 gate: bare CJK stopword string (e.g. exactly "的" or "了"); the
  // SINGLE_CJK_CHAR test above already covers length-1 cases, but we
  // also reject any query that is purely one stopword.
  if (CJK_STOPWORDS.has(trimmed)) {
    return { rawQuery: query, fullQuery: trimmed, terms: [], strongTerms: [], termGroups: [] }
  }

  const lower = trimmed.toLowerCase()
  const terms = lower.split(/\s+/).filter(Boolean)
  const strongTerms = terms.filter(term => isStrongTerm(term))
  const termGroups = terms.map(term => ({
    term,
    variants: termVariants(term),
  }))
  return { rawQuery: query, fullQuery: lower, terms, strongTerms, termGroups }
}

function termVariants(term: string): string[] {
  return [...new Set([
    term,
    ...(QUERY_TERM_ALIASES.get(term) ?? []),
  ].map(variant => variant.toLowerCase()))]
}

function isStrongTerm(term: string): boolean {
  if (STRONG_ASCII_TERM.test(term)) return true
  // Multi-char CJK substring counts as strong (≥ 2 CJK chars present).
  if (HAS_CJK.test(term) && term.length >= 2) return true
  return false
}

function hasNoQuery(normalized: NormalizedQuery): boolean {
  return normalized.terms.length === 0
}

export async function memoryContext(
  options: MemoryContextOptions,
): Promise<MemoryContextBundle> {
  assertScopeFilter(options.scopeFilter)
  const maxTokens = options.maxTokens ?? 1200
  const limit = options.limit ?? 10
  const query = options.query.trim()
  const normalized = normalizeQueryTerms(query)

  // W120 M4 + M6: query that normalises to nothing (empty / pure
  // whitespace / single CJK char / bare stopword) gets a fast 0-result
  // bundle. We do NOT call sqlite or jsonl in this case — the user's
  // query is too coarse to surface anything meaningful, and recalling
  // hundreds of unrelated events would flood the context.
  if (query && hasNoQuery(normalized)) {
    return {
      query,
      scopeFilter: options.scopeFilter,
      maxTokens,
      totalTokenEstimate: 0,
      requestedProjectId: options.scopeFilter.projectId,
      results: [],
      sections: { profile: [], observations: [], proposals: [], archive: [] },
      filteredControlPlaneCount: 0,
    }
  }

  // Resolve projectId alias — try alias project dirs if primary has no data
  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    projectId: options.scopeFilter.projectId,
  })

  // W108: Build candidate projectIds — always include both the requested
  // primary and all aliases so that newly captured events (written under the
  // canonical projectId) are never hidden when an alias has older data.
  // W119 H3: also merge `resolved.aliases` which now contains
  // bidirectionally-discovered sanitized↔bare matches from
  // discoverProjectIdAliases. Without this merge, recall on the bare form
  // (e.g. "mossensrc") could not see data written under the sanitized form.
  const requested = options.scopeFilter.projectId
  const aliases = projectIdAliases(requested)
  const discoveredAliases = resolved.aliases.filter(a => a !== requested && !aliases.includes(a))
  const candidateIds = [requested, ...aliases.filter(a => a !== requested), ...discoveredAliases]
  const dedupedIds = [...new Set(candidateIds)]

  const effectiveProjectId = resolved.projectId
  const effectiveScopeFilter: ScopeFilter = {
    ...options.scopeFilter,
    projectId: effectiveProjectId,
  }

  // W111: Search profiles and observations across ALL candidate projectIds,
  // not just the resolved one. This ensures observations written under the
  // canonical projectId are found even when an alias has older data.
  const [profiles, observations, proposals] = await Promise.all([
    searchProfilesMultiProject(options, dedupedIds, effectiveScopeFilter),
    searchObservationsMultiProject(options, dedupedIds, effectiveScopeFilter),
    searchProposalsMultiProject(options, dedupedIds, effectiveScopeFilter),
  ])

  // W108: Search archive across ALL candidate projectIds, not just resolved.
  // This ensures newly captured events under the canonical projectId are found
  // even when an alias projectId has older data that caused resolution away.
  const allArchiveResults = await searchArchiveMultiProject(
    options,
    dedupedIds,
    query,
    normalized,
    limit,
  )

  let filteredControlPlaneCount = 0
  const dropControlPlane = <T extends Pick<LightweightMemoryResult, 'title' | 'summary' | 'textPreview'>>(arr: T[]): T[] => {
    const out: T[] = []
    for (const item of arr) {
      if (isRetrievalControlPlaneResult(item)) {
        filteredControlPlaneCount += 1
        continue
      }
      out.push(item)
    }
    return out
  }

  const profileResults = dropControlPlane(
    profiles
      .map(entry => profileToResult(entry.profile, normalized))
      .filter(result => result.score > 0),
  )
  const observationResults = dropControlPlane(
    observations
      .map(entry => observationToResult(entry.observation, normalized))
      .filter(result => result.score > 0),
  )
  const proposalResults = dropControlPlane(
    proposals
      .map(entry => proposalToResult(entry.proposal, normalized))
      .filter(result => result.score > 0),
  )
  // W143-B1: the archive's stored `text_preview` is just the first 280
  // chars of `event.text` (sqliteIndex.previewText). Filtering on that
  // truncated prefix drops events where the entity token (e.g.
  // `rust-analyzer`, `app_services`, `mac.rs`) appears later in the
  // event body — the FTS / LIKE / JSONL fallback already matched, but
  // this filter then silently rejected the hit. Match against the FULL
  // `event.text` here; W120 strong-match / stopword / empty-query gates
  // are unchanged.
  // W143-B2: re-center the textPreview around the query hit so the
  // recall payload actually shows the matched region, not just the head
  // of the event. Mirrors `searchArchiveJsonlFallback`'s makePreview.
  const archive = dropControlPlane(
    allArchiveResults
      .filter(result => !query || hasQueryMatch(result.event.text, normalized))
      .map(result => {
        const fullText = result.event.text
        const strongMatch = !query || hasStrongMatch(fullText, normalized)
        const exactBoost = strongMatch && hasExactPhraseMatch(fullText, normalized)
          ? EXACT_PHRASE_BOOST
          : 0
        const termBoost = strongMatch ? scoreText(fullText, normalized) * STRONG_TERM_BOOST : 0
        const centeredPreview = query
          ? makeQueryCenteredPreview(fullText, normalized, result.textPreview)
          : result.textPreview
        return {
          id: result.eventId,
          source: result.source,
          scope: result.scope,
          score: result.score + exactBoost + termBoost,
          tokenEstimate: result.tokenEstimate,
          textPreview: centeredPreview,
          createdAt: result.createdAt,
          projectId: result.event.projectId,
          sessionId: result.event.sessionId,
          strongMatch,
          // W143.1: forward the layer tag from searchArchiveMultiProject
          // so the bundle-level counts reflect post-filter survivors.
          retrievalLayer: result.retrievalLayer,
        } satisfies MemoryContextCandidate
      }),
  )

  // W143.1: per-layer counts captured AFTER content-relevance filtering
  // (textPreview/event.text match + control-plane drop) but BEFORE
  // ranking and token-budget trimming. This is the most useful number
  // for debug ("did the layer surface anything that survived filters?")
  // — the post-budget result.length is already exposed as archiveHits.
  let archiveSqliteHits = 0
  let archiveJsonlFallbackHits = 0
  for (const candidate of archive) {
    if (candidate.retrievalLayer === 'sqlite') archiveSqliteHits += 1
    else if (candidate.retrievalLayer === 'jsonl-fallback') archiveJsonlFallbackHits += 1
  }

  const ranked = rankMemoryCandidates([
    ...dedupeObservationResults(observationResults),
    ...dedupeProposalResults(proposalResults),
    ...archive,
    ...profileResults,
  ])

  const results = stripCandidateMetadata(
    fitTokenBudget(ranked, maxTokens).slice(0, limit),
  )

  return {
    query,
    scopeFilter: options.scopeFilter,
    maxTokens,
    totalTokenEstimate: results.reduce((sum, result) => sum + result.tokenEstimate, 0),
    resolvedProjectId: effectiveProjectId,
    requestedProjectId: resolved.requestedProjectId,
    searchedProjectIds: dedupedIds,
    results,
    sections: {
      profile: results.filter(result => result.source === 'profile'),
      observations: results.filter(result => result.source === 'observation'),
      proposals: results.filter(result => result.source === 'proposal'),
      archive: results.filter(result => result.source === 'archive'),
    },
    filteredControlPlaneCount,
    archiveLayerCounts: {
      sqlite: archiveSqliteHits,
      jsonlFallback: archiveJsonlFallbackHits,
    },
  }
}

function profileToResult(
  profile: {
    projectId: string
    scope: LightweightMemoryResult['scope']
    generatedAt: string
    preferences: string[]
    habits: string[]
    constraints: string[]
    projectFacts: string[]
    confidence: number
  },
  normalized: NormalizedQuery,
): MemoryContextCandidate {
  const lines = [
    ...profile.preferences.map(item => `Preference: ${item}`),
    ...profile.habits.map(item => `Habit: ${item}`),
    ...profile.constraints.map(item => `Constraint: ${item}`),
    ...profile.projectFacts.map(item => `Project fact: ${item}`),
  ]
  const text = lines.join('\n')

  // W120 M5: confidence boost is gated by hasStrongMatch — confidence on
  // its own (no query match, weak query) must not promote a profile.
  const hasQuery = !hasNoQuery(normalized)
  const textScore = scoreText(text, normalized)
  const matched = !hasQuery || hasQueryMatch(text, normalized)
  const strongMatch = !hasQuery || hasStrongMatch(text, normalized)
  const confidenceBoost = matched && strongMatch ? Math.min(profile.confidence, 0.35) : 0

  return {
    id: `profile:${profile.projectId}:${profile.generatedAt}`,
    source: 'profile',
    scope: profile.scope,
    score: textScore + confidenceBoost,
    tokenEstimate: Math.min(
      estimateTokens(text),
      estimateTokens(compact(text, PROFILE_PREVIEW_CHARS)),
    ),
    title: 'Profile snapshot',
    summary: compact(text, PROFILE_PREVIEW_CHARS),
    textPreview: compact(text, PROFILE_PREVIEW_CHARS),
    createdAt: profile.generatedAt,
    projectId: profile.projectId,
    strongMatch,
  }
}

function observationToResult(
  observation: {
    observationId: string
    scope: LightweightMemoryResult['scope']
    projectId?: string
    sessionId?: string
    type: LightweightMemoryResult['type']
    kind: LightweightMemoryResult['kind']
    domain: LightweightMemoryResult['domain']
    lifecycle: LightweightMemoryResult['lifecycle']
    retrievalPolicy: LightweightMemoryResult['retrievalPolicy']
    title: string
    summary: string
    evidenceIds: string[]
    evidenceEventIds: string[]
    tags: string[]
    confidence: number
    source: 'rule' | 'llm' | 'manual'
    createdAt: string
  },
  normalized: NormalizedQuery,
): MemoryContextCandidate {
  const text = `${observation.title}\n${observation.summary}\n${observation.tags.join(' ')}`

  // W120 M5: confidence + policyBoost must clear the strong-match gate.
  // A high-confidence observation whose evidence text doesn't include any
  // strong query term must NOT be boosted to the top of recall.
  const hasQuery = !hasNoQuery(normalized)
  const textScore = scoreText(text, normalized)
  const matched = !hasQuery || hasQueryMatch(text, normalized)
  const strongMatch = !hasQuery || hasStrongMatch(text, normalized)
  const boost = matched && strongMatch
    ? observation.confidence + policyBoost(observation)
    : 0

  return {
    id: observation.observationId,
    source: 'observation',
    scope: observation.scope,
    score: textScore + boost,
    tokenEstimate: estimateTokens(text),
    title: observation.title,
    summary: observation.summary,
    textPreview: observation.summary,
    type: observation.type,
    kind: observation.kind,
    domain: observation.domain,
    lifecycle: observation.lifecycle,
    retrievalPolicy: observation.retrievalPolicy,
    createdAt: observation.createdAt,
    projectId: observation.projectId,
    sessionId: observation.sessionId,
    evidenceIds: observation.evidenceIds,
    evidenceEventIds: observation.evidenceEventIds,
    observationSource: observation.source,
    dedupeKey: observationDedupeKey(observation),
    strongMatch,
  }
}

function proposalToResult(
  proposal: Proposal,
  normalized: NormalizedQuery,
): MemoryContextCandidate {
  const decisionReason = proposal.decisionReason
    ? `Decision reason: ${proposal.decisionReason}`
    : ''
  const summary = [proposal.rationale, decisionReason].filter(Boolean).join(' ')
  const text = [
    proposal.title,
    proposal.rationale,
    decisionReason,
    `Status: ${proposal.status}`,
    `Type: ${proposal.type}`,
    proposal.evidenceEventIds.join(' '),
  ].filter(Boolean).join('\n')

  const hasQuery = !hasNoQuery(normalized)
  const textScore = scoreText(text, normalized)
  const matched = !hasQuery || hasQueryMatch(text, normalized)
  const strongMatch = !hasQuery || hasStrongMatch(text, normalized)
  const boost = matched && strongMatch
    ? Math.min(proposal.confidence, 0.4) + proposalBoost(proposal)
    : 0

  return {
    id: proposal.proposalId,
    source: 'proposal',
    scope: 'project',
    score: textScore + boost,
    tokenEstimate: estimateTokens(text),
    title: proposal.title,
    summary: compact(summary, PROPOSAL_PREVIEW_CHARS),
    textPreview: compact(text, PROPOSAL_PREVIEW_CHARS),
    type: proposal.type,
    retrievalPolicy: proposal.status === 'candidate' || proposal.status === 'accepted'
      ? 'hint'
      : 'search_only',
    createdAt: proposal.updatedAt ?? proposal.reviewedAt ?? proposal.createdAt,
    projectId: proposal.projectId,
    evidenceEventIds: proposal.evidenceEventIds,
    proposalStatus: proposal.status,
    strongMatch,
  }
}

function policyBoost(
  observation: Pick<LightweightMemoryResult, 'retrievalPolicy' | 'lifecycle' | 'type'>,
): number {
  if (observation.retrievalPolicy === 'never_inject') return -10
  if (observation.retrievalPolicy === 'candidate_only') return -0.15
  if (observation.retrievalPolicy === 'search_only') return -0.05
  let boost = 0
  if (observation.lifecycle === 'active') boost += 0.1
  // Type-based boosts for high-value observation types
  if (observation.type === 'project_state') boost += 0.1
  if (observation.type === 'decision') boost += 0.08
  return boost
}

function proposalBoost(proposal: Pick<Proposal, 'status'>): number {
  if (proposal.status === 'accepted') return 0.16
  if (proposal.status === 'candidate') return 0.12
  if (proposal.status === 'superseded') return -0.08
  return -0.12
}

function rankMemoryCandidates(
  candidates: MemoryContextCandidate[],
): MemoryContextCandidate[] {
  return candidates
    .filter(candidate => candidate.retrievalPolicy !== 'never_inject')
    .sort(compareMemoryCandidates)
}

function dedupeObservationResults(
  observations: MemoryContextCandidate[],
): MemoryContextCandidate[] {
  const bestByEvidenceType = new Map<string, MemoryContextCandidate>()

  for (const observation of observations) {
    const key = observation.dedupeKey
    if (!key) continue

    const current = bestByEvidenceType.get(key)
    if (!current || compareObservationDedupeCandidates(observation, current) < 0) {
      bestByEvidenceType.set(key, observation)
    }
  }

  return [...bestByEvidenceType.values()]
}

function dedupeProposalResults(
  proposals: MemoryContextCandidate[],
): MemoryContextCandidate[] {
  const bestByProposalId = new Map<string, MemoryContextCandidate>()

  for (const proposal of proposals) {
    const current = bestByProposalId.get(proposal.id)
    if (!current || compareMemoryCandidates(proposal, current) < 0) {
      bestByProposalId.set(proposal.id, proposal)
    }
  }

  return [...bestByProposalId.values()]
}

function compareMemoryCandidates(
  left: MemoryContextCandidate,
  right: MemoryContextCandidate,
): number {
  // W120 M5: strong-match items always rank above weak-match items
  // regardless of policyPriority, so a high-confidence observation with
  // no query overlap can no longer outrank a real match.
  const strong = (right.strongMatch === true ? 1 : 0) - (left.strongMatch === true ? 1 : 0)
  if (strong !== 0) return strong

  const policy = policyPriority(right) - policyPriority(left)
  if (policy !== 0) return policy

  const source = sourcePriority(right) - sourcePriority(left)
  if (source !== 0) return source

  const score = right.score - left.score
  if (score !== 0) return score

  const createdAt = (right.createdAt ?? '').localeCompare(left.createdAt ?? '')
  if (createdAt !== 0) return createdAt

  return left.id.localeCompare(right.id)
}

function compareObservationDedupeCandidates(
  left: MemoryContextCandidate,
  right: MemoryContextCandidate,
): number {
  const source = sourcePriority(right) - sourcePriority(left)
  if (source !== 0) return source

  return compareMemoryCandidates(left, right)
}

function sourcePriority(candidate: MemoryContextCandidate): number {
  if (candidate.source === 'observation' && candidate.observationSource === 'llm') return 4
  if (candidate.source === 'observation' && candidate.observationSource === 'manual') return 3
  if (
    candidate.source === 'proposal' &&
    (candidate.proposalStatus === 'accepted' || candidate.proposalStatus === 'candidate')
  ) return 3
  if (candidate.source === 'observation' && candidate.observationSource === 'rule') return 2
  if (candidate.source === 'archive') return 1
  if (candidate.source === 'proposal') return 0.5
  return 0
}

function policyPriority(candidate: MemoryContextCandidate): number {
  let priority = 0
  if (candidate.lifecycle === 'active') priority += 4
  if (candidate.retrievalPolicy === 'hint') priority += 3
  if (candidate.lifecycle === 'candidate') priority += 1
  if (candidate.retrievalPolicy === 'candidate_only') priority -= 2
  if (candidate.retrievalPolicy === 'search_only') priority -= 1
  return priority
}

function fitTokenBudget(
  results: MemoryContextCandidate[],
  maxTokens: number,
): MemoryContextCandidate[] {
  const selected: MemoryContextCandidate[] = []
  let used = 0

  for (const result of results.filter(result => result.source !== 'profile')) {
    if (used + result.tokenEstimate > maxTokens) continue
    selected.push(result)
    used += result.tokenEstimate
  }

  const profileBudget = Math.max(1, Math.floor(maxTokens * PROFILE_TOKEN_BUDGET_RATIO))
  let profileUsed = 0
  for (const result of results.filter(result => result.source === 'profile')) {
    if (profileUsed + result.tokenEstimate > profileBudget) continue
    if (used + result.tokenEstimate > maxTokens) continue
    selected.push(result)
    used += result.tokenEstimate
    profileUsed += result.tokenEstimate
  }

  selected.sort(compareMemoryCandidates)
  return selected
}

function stripCandidateMetadata(
  candidates: MemoryContextCandidate[],
): LightweightMemoryResult[] {
  // W143.1: also strip retrievalLayer — that field is debug-only and
  // must NOT appear in plain LightweightMemoryResult output.
  return candidates.map(({
    observationSource: _source,
    proposalStatus: _proposalStatus,
    dedupeKey: _key,
    retrievalLayer: _layer,
    ...result
  }) => result)
}

function observationDedupeKey(
  observation: Pick<
    MemoryContextCandidate,
    'type' | 'scope' | 'projectId' | 'sessionId' | 'evidenceEventIds'
  >,
): string {
  return [
    observation.type ?? '',
    observation.scope,
    observation.projectId ?? '',
    observation.sessionId ?? '',
    ...(observation.evidenceEventIds ?? []).slice().sort(),
  ].join('\u001f')
}

/**
 * Check whether the text has any actual relevance to the query.
 * This is the relevance gate — boosts must NEVER bypass it.
 *
 * W120 M4 + M6: a normalised query with no terms (single-char CJK,
 * stopword-only, empty) returns false here so retrieval surfaces 0
 * results instead of flooding the user with substring noise.
 */
export function hasQueryMatch(text: string, normalized: NormalizedQuery): boolean {
  if (hasNoQuery(normalized)) return false
  const lower = text.toLowerCase()
  if (normalized.fullQuery && lower.includes(normalized.fullQuery)) return true
  return normalized.termGroups.every(group => termGroupMatches(lower, group))
}

/**
 * W120 M5: a strong match exists if the full query appears verbatim OR
 * if any *strong* term (≥3 ASCII identifier chars or a multi-char CJK
 * substring) is present in the text. This is the gate that allows
 * boosts to apply.
 */
export function hasStrongMatch(text: string, normalized: NormalizedQuery): boolean {
  if (hasNoQuery(normalized)) return false
  const lower = text.toLowerCase()
  if (normalized.fullQuery && lower.includes(normalized.fullQuery)) return true
  return normalized.termGroups.some(group =>
    termGroupHasStrongVariant(group) && termGroupMatches(lower, group),
  )
}

function hasExactPhraseMatch(text: string, normalized: NormalizedQuery): boolean {
  if (!normalized.fullQuery) return false
  return text.toLowerCase().includes(normalized.fullQuery)
}

function scoreText(text: string, normalized: NormalizedQuery): number {
  if (hasNoQuery(normalized)) return 0
  const lower = text.toLowerCase()
  const hits = normalized.termGroups.filter(group => termGroupMatches(lower, group)).length
  const base = hits / normalized.termGroups.length

  // Exact wave ID boost: any term shaped W\d+ that hits in text.
  const waveIds = normalized.terms.filter(term => /^w\d{2,3}[a-z]?$/.test(term))
  const waveHits = waveIds.filter(term => lower.includes(term)).length
  const waveBoost = waveIds.length > 0 && waveHits === waveIds.length ? STRONG_TERM_BOOST : 0

  const exactBoost = normalized.fullQuery && lower.includes(normalized.fullQuery) ? 0.15 : 0
  return base + waveBoost + exactBoost
}

function termGroupMatches(lowerText: string, group: QueryTermGroup): boolean {
  return group.variants.some(variant => lowerText.includes(variant))
}

function termGroupHasStrongVariant(group: QueryTermGroup): boolean {
  return group.variants.some(variant => isStrongTerm(variant))
}

/**
 * Historical capture bugs stored some control-plane text before W111 fixed
 * future capture boundaries. Retrieval must hide that legacy noise without
 * deleting user data.
 */
function isRetrievalControlPlaneResult(result: Pick<LightweightMemoryResult, 'title' | 'summary' | 'textPreview'>): boolean {
  return isRetrievalControlPlaneText([
    result.title,
    result.summary,
    result.textPreview,
  ].filter(Boolean).join('\n'))
}

function isRetrievalControlPlaneText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (trimmed.includes('<think>')) return true
  if (/^Commit\b/im.test(trimmed)) return true
  if (/(^|\n)\s*(?:Safety rule:|Preference:|Decision:|Project fact:|Habit:|Constraint:)?\s*(?:执行\s+W\d{2,3}|修复完成|全部通过)/u.test(trimmed)) return true
  if (/##\s*W\d{2,3}(?:\.\d+)?\s*.*报告/u.test(trimmed)) return true

  if (trimmed.includes('<command-name>')) return true
  if (trimmed.includes('<local-command-stdout>')) return true
  if (trimmed.includes('硬红线')) return true
  if (trimmed.includes('Smoke 要求')) return true
  if (trimmed.includes('最终报告必须包含')) return true
  if (trimmed.includes('验证命令：')) return true
  if (trimmed.includes('不能 push')) return true
  if (trimmed.includes('施工包')) return true
  if (trimmed.includes('修复前断链证据')) return true
  if (trimmed.includes('修复策略')) return true
  if (trimmed.includes('recallForMossen')) return true
  if (trimmed.includes('Observation 有')) return true
  if (trimmed.includes('archive count 是')) return true
  if (trimmed.includes('现在理解了完整链路')) return true
  if (trimmed.includes('让我检查')) return true
  if (trimmed.includes('现在有结果了')) return true
  if (trimmed.includes('问题！CLI')) return true
  if (trimmed.includes('现在返回') && trimmed.includes('条结果')) return true
  if (trimmed.includes('这意味着') && trimmed.includes('CLI')) return true
  if (trimmed.includes('但关键是')) return true
  if (trimmed.includes('alias 下只有') && trimmed.includes('observations')) return true
  if (trimmed.includes('当前问题') && trimmed.includes('实机结果')) return true
  if (trimmed.includes('现在完全理解了根因')) return true
  if (trimmed.includes('Key findings:')) return true
  if (trimmed.includes('问题现象') && trimmed.includes('判定')) return true
  if (trimmed.includes('实机运行') && trimmed.includes('/memory-sidecar recall')) return true
  if (/^W\d{2,3}\s*结果：/u.test(trimmed) && trimmed.includes('污染')) return true

  return false
}

function scopeForStore(scope: ScopeFilter['scope']): ScopeFilter['scope'] | undefined {
  return scope === 'workspace' || scope === 'team' ? undefined : scope
}

/**
 * W111: Search profiles across multiple candidate projectIds.
 * Merges results, keeping the most recent profile snapshot.
 */
async function searchProfilesMultiProject(
  options: MemoryContextOptions,
  candidateIds: string[],
  scopeFilter: ScopeFilter,
): Promise<Array<{ profile: Parameters<typeof profileToResult>[0] }>> {
  const allProfiles: Array<{ profile: Parameters<typeof profileToResult>[0] }> = []
  for (const projectId of candidateIds) {
    const profiles = await recentProfileSnapshots({
      ...options,
      scope: scopeForStore(scopeFilter.scope),
      projectId,
      limit: PROFILE_RESULT_LIMIT,
    })
    allProfiles.push(...profiles)
  }
  // Keep only the most recent profile
  return allProfiles
    .sort((a, b) => b.profile.generatedAt.localeCompare(a.profile.generatedAt))
    .slice(0, PROFILE_RESULT_LIMIT)
}

/**
 * W111: Search observations across multiple candidate projectIds.
 * Deduplicates by observationId.
 */
async function searchObservationsMultiProject(
  options: MemoryContextOptions,
  candidateIds: string[],
  scopeFilter: ScopeFilter,
): Promise<Array<{ observation: Parameters<typeof observationToResult>[0] }>> {
  const seenIds = new Set<string>()
  const allObs: Array<{ observation: Parameters<typeof observationToResult>[0] }> = []
  for (const projectId of candidateIds) {
    const observations = await recentObservations({
      ...options,
      scope: scopeForStore(scopeFilter.scope),
      projectId,
      sessionId: scopeFilter.sessionId,
      limit: 200,
    })
    for (const entry of observations) {
      const id = entry.observation.observationId
      if (!seenIds.has(id)) {
        seenIds.add(id)
        allObs.push(entry)
      }
    }
  }
  return allObs
}

/**
 * Search project-level proposals across candidate projectIds.
 *
 * Proposals do not currently carry sessionId, so session-scope recall keeps
 * them out until the schema can prove exact-session relevance.
 */
async function searchProposalsMultiProject(
  options: MemoryContextOptions,
  candidateIds: string[],
  scopeFilter: ScopeFilter,
): Promise<Array<{ proposal: Proposal }>> {
  if (scopeFilter.scope === 'session') return []

  const seenIds = new Set<string>()
  const allProposals: Array<{ proposal: Proposal }> = []
  for (const projectId of candidateIds) {
    const proposals = await recentProposals({
      ...options,
      projectId,
      limit: PROPOSAL_RESULT_LIMIT,
    })
    for (const entry of proposals) {
      const id = entry.proposal.proposalId
      if (!seenIds.has(id)) {
        seenIds.add(id)
        allProposals.push(entry)
      }
    }
  }
  return allProposals
}

/**
 * W108: Search archive across multiple candidate projectIds.
 *
 * For each candidate, first tries SQLite/FTS search. If that yields no results
 * (e.g. index is empty), falls back to read-only JSONL scan.
 * Deduplicates by eventId across candidates.
 */
async function searchArchiveMultiProject(
  options: MemoryContextOptions,
  candidateIds: string[],
  query: string,
  normalized: NormalizedQuery,
  limit: number,
): Promise<ArchiveIndexSearchResult[]> {
  const bestByEventId = new Map<string, ArchiveIndexSearchResult>()
  const queryVariants = archiveSearchQueries(query, normalized)

  for (const projectId of candidateIds) {
    const scopeFilter: ScopeFilter = {
      ...options.scopeFilter,
      projectId,
    }

    let projectResults: ArchiveIndexSearchResult[] = []
    for (const searchQuery of queryVariants) {
      // Try SQLite/FTS first.
      // W143.1: tag every row with retrievalLayer='sqlite' so the
      // recall debug payload can report per-layer counts. The field is
      // metadata only — stripped before the result reaches normal
      // recall output.
      let results: ArchiveIndexSearchResult[] = (await searchArchiveEvents({
        ...options,
        scopeFilter,
        query: searchQuery,
        limit,
      })).map(r => ({ ...r, retrievalLayer: 'sqlite' as const }))

      // W111: If FTS returned results but none have exact full-query match,
      // also try JSONL fallback to find exact matches that FTS missed.
      if (results.length > 0 && searchQuery) {
        const queryLower = searchQuery.toLowerCase()
        const hasExactMatch = results.some(
          r => r.textPreview.toLowerCase().includes(queryLower),
        )
        if (!hasExactMatch) {
          const fallback = await searchArchiveJsonlFallback({
            rootDir: options.rootDir,
            projectId,
            query: searchQuery,
            limit,
          })
          // Merge fallback results with FTS results.
          // W143.1: each fallback row carries retrievalLayer='jsonl-fallback'.
          const fallbackMapped: ArchiveIndexSearchResult[] = fallback.map(r => ({
            event: r.event,
            eventId: r.eventId,
            source: 'archive' as const,
            scope: r.scope,
            score: r.score,
            tokenEstimate: r.tokenEstimate,
            textPreview: r.textPreview,
            createdAt: r.createdAt,
            jsonlPath: '',
            retrievalLayer: 'jsonl-fallback' as const,
          }))
          results = [...results, ...fallbackMapped]
        }
      }

      // W108: If SQLite returned nothing and there's a query, try JSONL fallback.
      if (results.length === 0 && searchQuery) {
        const fallback = await searchArchiveJsonlFallback({
          rootDir: options.rootDir,
          projectId,
          query: searchQuery,
          limit,
        })
        results = fallback.map(r => ({
          event: r.event,
          eventId: r.eventId,
          source: 'archive' as const,
          scope: r.scope,
          score: r.score,
          tokenEstimate: r.tokenEstimate,
          textPreview: r.textPreview,
          createdAt: r.createdAt,
          jsonlPath: '',
          retrievalLayer: 'jsonl-fallback' as const,
        }))
      }

      // No empty-query fallback: irrelevant results are worse than no results.
      projectResults = [...projectResults, ...results]
    }

    for (const result of projectResults) {
      const current = bestByEventId.get(result.eventId)
      if (!current || compareArchiveSearchResult(result, current) < 0) {
        bestByEventId.set(result.eventId, result)
      }
    }
  }

  return [...bestByEventId.values()]
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

function compareArchiveSearchResult(
  left: ArchiveIndexSearchResult,
  right: ArchiveIndexSearchResult,
): number {
  const score = right.score - left.score
  if (score !== 0) return score
  return right.createdAt.localeCompare(left.createdAt)
}

function archiveSearchQueries(
  query: string,
  normalized: NormalizedQuery,
): string[] {
  if (!query) return ['']
  const variants = [query]
  const archiveTerms = normalized.termGroups.map(preferredArchiveSearchVariant)
  const aliasQuery = archiveTerms.filter(Boolean).join(' ')
  if (aliasQuery && aliasQuery.toLowerCase() !== query.toLowerCase()) {
    variants.push(aliasQuery)
  }
  return [...new Set(variants.map(variant => variant.trim()).filter(Boolean))]
}

function preferredArchiveSearchVariant(group: QueryTermGroup): string {
  if (ARCHIVE_SEARCH_VARIANT.test(group.term)) return group.term
  return group.variants.find(variant => ARCHIVE_SEARCH_VARIANT.test(variant)) ?? group.term
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}

/**
 * W143-B2: build a textPreview centered on the first matched query
 * region in the full event text. If no match region can be located,
 * fall back to the index-stored prefix preview.
 *
 * Mirrors `searchArchiveJsonlFallback`'s makePreview behaviour so the
 * SQLite path and the JSONL fallback path return previews of comparable
 * shape — the operator no longer sees "head-only" snippets for SQLite
 * results and "centered" snippets for fallback results.
 */
function makeQueryCenteredPreview(
  fullText: string,
  normalized: NormalizedQuery,
  storedPreview: string,
  maxLen = 280,
): string {
  if (!fullText) return storedPreview
  if (fullText.length <= maxLen) return fullText
  const lower = fullText.toLowerCase()
  let idx = -1
  if (normalized.fullQuery) {
    idx = lower.indexOf(normalized.fullQuery)
  }
  if (idx < 0 && normalized.terms.length > 0) {
    for (const group of normalized.termGroups) {
      for (const variant of group.variants) {
        const termIdx = lower.indexOf(variant)
        if (termIdx >= 0 && (idx < 0 || termIdx < idx)) idx = termIdx
      }
    }
  }
  if (idx < 0) return storedPreview
  const half = Math.max(40, Math.floor(maxLen / 2))
  const start = Math.max(0, idx - half)
  const end = Math.min(fullText.length, start + maxLen)
  const slice = fullText.slice(start, end)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < fullText.length ? '...' : ''
  return `${prefix}${slice}${suffix}`
}
