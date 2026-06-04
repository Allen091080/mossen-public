// Offline recall-quality baseline for memoryContext / recallForMossen.
//
// This is intentionally a small benchmark-style test, not a tuning change:
// it seeds observations, profiles, SQLite archive rows, and JSONL archive
// fallback data, then measures Recall@5 / MRR / empty-result rate. Future
// retrieval work should improve these floors, not regress them.
import { describe, expect, test } from 'bun:test'
import { appendArchiveEvent } from '../../storage/jsonlArchiveStore.js'
import { indexArchiveEvents } from '../../storage/sqliteIndex.js'
import { appendObservations } from '../../storage/observationStore.js'
import { appendProfileSnapshot } from '../../storage/profileStore.js'
import { appendProposals } from '../../storage/proposalStore.js'
import type { ArchiveEvent } from '../../schema/archiveEvent.js'
import type {
  Observation,
  ObservationDomain,
  ObservationType,
} from '../../schema/observation.js'
import type { ProfileSnapshot } from '../../schema/profile.js'
import type { Proposal } from '../../schema/proposal.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../schema/scope.js'
import {
  createTmpMemoryRoot,
  type TmpMemoryRoot,
} from '../../__tests__/_fixtures/tmpRoot.js'
import { recallForMossen } from '../recallForMossen.js'

const PROJECT_ID = 'proj-recall-quality'
const SESSION_ID = 'sess-recall-quality'
const START = '2026-06-02T02:00:00.000Z'

type RecallQualityCase = {
  expectedTopIds: string[]
  note: string
  query: string
}

type CaseResult = {
  empty: boolean
  expectedTopIds: string[]
  itemIds: string[]
  note: string
  query: string
  rank: number | null
}

type RecallMetrics = {
  emptyRate: number
  mrr: number
  recallAt5: number
  results: CaseResult[]
}

function observation(
  id: string,
  type: ObservationType,
  title: string,
  summary: string,
  overrides: Partial<Observation> = {},
): Observation {
  const domain: ObservationDomain =
    type === 'decision' || type === 'project_state'
      ? 'memory'
      : type === 'workflow_pattern'
        ? 'workflow'
        : 'code'

  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    observationId: id,
    scope: 'project',
    visibility: 'project',
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    type,
    kind: type === 'project_state' ? 'state' : 'semantic',
    domain,
    lifecycle: 'active',
    retrievalPolicy: 'hint',
    title,
    summary,
    evidenceIds: [`evt-${id}`],
    evidenceEventIds: [`evt-${id}`],
    files: [],
    tags: [id.replace(/^obs-/, '')],
    confidence: 0.9,
    source: 'llm',
    promotionStatus: 'candidate',
    createdAt: START,
    ...overrides,
  }
}

function archiveEvent(
  id: string,
  text: string,
  overrides: Partial<ArchiveEvent> = {},
): ArchiveEvent {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    eventId: id,
    source: 'mossen',
    sourceEventId: `mossen:${id}`,
    scope: 'project',
    visibility: 'project',
    owner: { projectId: PROJECT_ID, sessionId: SESSION_ID },
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    role: 'assistant',
    kind: 'message',
    text,
    textHash: `sha256:${id}`,
    tokenEstimate: Math.max(1, Math.ceil(text.length / 4)),
    createdAt: START,
    redaction: { applied: false, version: 1, notes: [] },
    ...overrides,
  }
}

function profileSnapshot(): ProfileSnapshot {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    projectId: PROJECT_ID,
    scope: 'project',
    generatedAt: '2026-06-02T02:10:00.000Z',
    sourceJobId: 'job-profile-quality',
    preferences: [
      'Prefer small steps with bun run typecheck after each memory-sidecar change.',
    ],
    habits: ['Build a recall benchmark before changing ranking weights.'],
    constraints: ['Do not change schema or the main query loop for recall work.'],
    projectFacts: ['Memory-sidecar recall currently combines observations, profiles, and archive search.'],
    confidence: 0.86,
  }
}

function proposal(
  id: string,
  title: string,
  rationale: string,
  overrides: Partial<Proposal> = {},
): Proposal {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    proposalId: id,
    type: 'workflow',
    status: 'candidate',
    projectId: PROJECT_ID,
    title,
    rationale,
    evidenceEventIds: [`evt-${id}`],
    createdAt: START,
    confidence: 0.88,
    ...overrides,
  }
}

async function seedRecallQualityFixture(
  fixture: TmpMemoryRoot,
): Promise<void> {
  await appendObservations({
    rootDir: fixture.rootDir,
    projectId: PROJECT_ID,
    observations: [
      observation(
        'obs-memory-storage',
        'decision',
        'Memory sidecar storage uses archive JSONL and SQLite FTS',
        'Storage decision: memory-sidecar recall indexes archive.jsonl into SQLite FTS and uses JSONL fallback before vector search exists.',
        { tags: ['memory-sidecar', 'storage', 'sqlite', 'jsonl', 'fts'] },
      ),
      observation(
        'obs-rust-entity',
        'bugfix',
        'rust-analyzer mac.rs entity recall was fixed',
        'W143 improved entity extraction for rust-analyzer and mac.rs tokens so file-like terms survive recall.',
        { tags: ['rust-analyzer', 'mac.rs', 'w143'] },
      ),
      observation(
        'obs-provider-routing',
        'decision',
        'Sidecar provider routing should vary by job type',
        'Provider routing plan: classify_llm can use a cheap backend while synthesize_profile can use a stronger profile backend.',
        { tags: ['provider-routing', 'classify_llm', 'synthesize_profile'] },
      ),
      observation(
        'obs-small-steps',
        'workflow_pattern',
        'Use small steps and typecheck for memory-sidecar work',
        'Workflow pattern: keep each recall change small, run bun run typecheck, then run the focused memory-sidecar tests.',
        { tags: ['small-steps', 'typecheck', 'workflow'] },
      ),
    ],
  })

  await appendProfileSnapshot({
    rootDir: fixture.rootDir,
    projectId: PROJECT_ID,
    profile: profileSnapshot(),
  })

  await appendProposals({
    rootDir: fixture.rootDir,
    projectId: PROJECT_ID,
    proposals: [
      proposal(
        'proposal-memory-routing-budget',
        'Throttle sidecar-classifier budget in memory routing',
        'Proposal: keep classify_llm on the cheap sidecar-classifier path and reserve stronger backends for profile synthesis so memory routing budget stays predictable.',
      ),
    ],
  })

  const archiveEvents = [
    archiveEvent(
      'evt-archive-capture-pipeline',
      'Capture pipeline: stopHooks calls captureTurnForMemorySidecar, archiveWriter writes archive.jsonl, and dirty markers trigger worker processing.',
    ),
    archiveEvent(
      'evt-archive-control-plane-noise',
      '硬红线: 不改 scripts/smoke_check.py。施工包要求让我检查 recallForMossen，现在返回 10 条结果。',
    ),
    archiveEvent(
      'evt-archive-unrelated',
      'The terminal theme command stores color preferences and is unrelated to memory retrieval.',
    ),
  ]

  for (const event of archiveEvents) {
    await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId: PROJECT_ID,
      event,
    })
  }
  await indexArchiveEvents(
    { rootDir: fixture.rootDir, projectId: PROJECT_ID },
    archiveEvents,
  )
}

async function evaluateRecallQuality(
  fixture: TmpMemoryRoot,
  cases: RecallQualityCase[],
): Promise<RecallMetrics> {
  const results: CaseResult[] = []

  for (const testCase of cases) {
    const result = await recallForMossen({
      rootDir: fixture.rootDir,
      projectId: PROJECT_ID,
      query: testCase.query,
      limit: 5,
      maxTokens: 1200,
      debug: true,
    })
    const itemIds = result.items.map(item => item.id)
    const index = itemIds.findIndex(id => testCase.expectedTopIds.includes(id))
    results.push({
      query: testCase.query,
      note: testCase.note,
      expectedTopIds: testCase.expectedTopIds,
      itemIds,
      rank: index >= 0 ? index + 1 : null,
      empty: itemIds.length === 0,
    })
  }

  const hitCount = results.filter(result => result.rank !== null && result.rank <= 5).length
  const reciprocalRankSum = results.reduce(
    (sum, result) => sum + (result.rank ? 1 / result.rank : 0),
    0,
  )
  const emptyCount = results.filter(result => result.empty).length

  return {
    recallAt5: hitCount / cases.length,
    mrr: reciprocalRankSum / cases.length,
    emptyRate: emptyCount / cases.length,
    results,
  }
}

describe('recall quality baseline', () => {
  test('tracks Recall@5, MRR, and empty-result rate over representative queries', async () => {
    const fixture = await createTmpMemoryRoot()
    try {
      await seedRecallQualityFixture(fixture)

      const metrics = await evaluateRecallQuality(fixture, [
        {
          query: 'memory sidecar sqlite jsonl',
          expectedTopIds: ['obs-memory-storage'],
          note: 'storage and retrieval architecture should be easy to find',
        },
        {
          query: 'rust-analyzer mac.rs',
          expectedTopIds: ['obs-rust-entity'],
          note: 'file-like entity tokens should rank in the top results',
        },
        {
          query: 'provider routing classify_llm',
          expectedTopIds: ['obs-provider-routing'],
          note: 'per-job backend routing decisions should be findable',
        },
        {
          query: 'small steps typecheck',
          expectedTopIds: ['obs-small-steps', `profile:${PROJECT_ID}:2026-06-02T02:10:00.000Z`],
          note: 'workflow preferences should surface from observations or profile',
        },
        {
          query: 'throttle sidecar-classifier budget',
          expectedTopIds: ['proposal-memory-routing-budget'],
          note: 'high-value proposals should be searchable recall candidates',
        },
        {
          query: '捕获 管线',
          expectedTopIds: ['evt-archive-capture-pipeline'],
          note: 'archive evidence should be reachable from Chinese task wording',
        },
        {
          query: '记忆 持久化',
          expectedTopIds: ['obs-memory-storage'],
          note: 'Chinese sidecar terminology should bridge to English memory storage facts',
        },
      ])

      // Current baseline: every representative query should hit top-5.
      // Future semantic/vector work can add more cases, but should not
      // re-open these low-cost lexical/CJK domain bridges.
      expect(metrics.recallAt5).toBeGreaterThanOrEqual(1)
      expect(metrics.mrr).toBeGreaterThanOrEqual(0.9)
      expect(metrics.emptyRate).toBeLessThanOrEqual(0)

      const misses = metrics.results.filter(result => result.rank === null)
      expect(misses).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  test('keeps legacy control-plane archive noise out of recall results', async () => {
    const fixture = await createTmpMemoryRoot()
    try {
      await seedRecallQualityFixture(fixture)

      const result = await recallForMossen({
        rootDir: fixture.rootDir,
        projectId: PROJECT_ID,
        query: '硬红线',
        limit: 5,
        maxTokens: 1200,
        debug: true,
      })

      expect(result.items.map(item => item.id)).not.toContain(
        'evt-archive-control-plane-noise',
      )
      expect(result.filteredControlPlaneCount).toBeGreaterThanOrEqual(1)
      expect(result.debug?.archiveJsonlFallbackHits ?? 0).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })
})
