import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runWithCwdOverride } from '../../../../utils/cwd.js'
import { MemoryContextTool } from '../../../../tools/MemoryContextTool/MemoryContextTool.js'
import {
  createDefaultMemorySidecarConfig,
  projectIdFromCwd,
} from '../../index.js'
import { appendArchiveEvent } from '../../storage/jsonlArchiveStore.js'
import { appendObservations } from '../../storage/observationStore.js'
import { appendProposals } from '../../storage/proposalStore.js'
import { indexArchiveEvents } from '../../storage/sqliteIndex.js'
import type { ArchiveEvent } from '../../schema/archiveEvent.js'
import type { Observation } from '../../schema/observation.js'
import type { Proposal } from '../../schema/proposal.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../schema/scope.js'
import { createTmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

const START = '2026-06-02T04:00:00.000Z'
const OLD_SESSION_ID = 'sess-memory-context-tool-old'

function observation(projectId: string): Observation {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    observationId: 'obs-tool-capture-pipeline',
    scope: 'project',
    visibility: 'project',
    projectId,
    sessionId: OLD_SESSION_ID,
    type: 'decision',
    kind: 'semantic',
    domain: 'memory',
    lifecycle: 'active',
    retrievalPolicy: 'hint',
    title: 'Capture pipeline should stay deterministic',
    summary: 'Past decision: capture pipeline evidence should be recalled without asking the user to mention memory explicitly.',
    evidenceIds: ['evt-tool-capture-pipeline'],
    evidenceEventIds: ['evt-tool-capture-pipeline'],
    files: [],
    tags: ['capture', 'pipeline', 'memory-context-tool'],
    confidence: 0.92,
    source: 'llm',
    promotionStatus: 'candidate',
    createdAt: START,
  }
}

function proposal(projectId: string): Proposal {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    proposalId: 'proposal-tool-capture-pipeline',
    type: 'workflow',
    status: 'candidate',
    projectId,
    title: 'Use capture pipeline evidence as surfacing proof',
    rationale: 'Proposal: validate proactive surfacing with capture pipeline queries before changing the main query loop.',
    evidenceEventIds: ['evt-tool-capture-pipeline'],
    createdAt: START,
    confidence: 0.86,
  }
}

function archiveEvent(projectId: string): ArchiveEvent {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    eventId: 'evt-tool-capture-pipeline',
    source: 'mossen',
    sourceEventId: 'tool-e2e:capture-pipeline',
    scope: 'project',
    visibility: 'project',
    owner: { projectId, sessionId: OLD_SESSION_ID },
    projectId,
    sessionId: OLD_SESSION_ID,
    role: 'assistant',
    kind: 'message',
    text: 'Capture pipeline evidence: stopHooks forwards turns into archiveWriter, JSONL storage, and index_archive so later sessions can retrieve the decision.',
    textHash: 'sha256:evt-tool-capture-pipeline',
    tokenEstimate: 36,
    createdAt: START,
    redaction: { applied: false, version: 1, notes: [] },
  }
}

async function writeEnabledConfig(rootDir: string): Promise<void> {
  const config = createDefaultMemorySidecarConfig({
    ...process.env,
    MOSSEN_MEMORY_SIDECAR_HOME: rootDir,
  })
  config.enabled = true
  config.retrieval.maxResults = 5
  config.retrieval.maxTokens = 900
  await writeFile(
    join(rootDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )
}

describe('MemoryContextTool integration', () => {
  test('surfaces prior-session observations, proposals, and archive evidence for a natural query', async () => {
    const fixture = await createTmpMemoryRoot('mossen-memory-context-tool-')
    const previousHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME

    try {
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir
      await writeEnabledConfig(fixture.rootDir)

      const cwd = join(fixture.rootDir, 'workspace', 'mossensrc')
      await mkdir(cwd, { recursive: true })
      const projectId = projectIdFromCwd(cwd)
      const event = archiveEvent(projectId)

      await appendArchiveEvent({
        rootDir: fixture.rootDir,
        projectId,
        event,
      })
      await indexArchiveEvents(
        { rootDir: fixture.rootDir, projectId },
        [event],
      )
      await appendObservations({
        rootDir: fixture.rootDir,
        projectId,
        observations: [observation(projectId)],
      })
      await appendProposals({
        rootDir: fixture.rootDir,
        projectId,
        proposals: [proposal(projectId)],
      })

      const result = await runWithCwdOverride(cwd, () =>
        MemoryContextTool.call(
          {
            query: '捕获 管线',
            max_results: 5,
            max_tokens: 900,
          },
        ),
      )

      expect(result.data.enabled).toBe(true)
      expect(result.data.projectId).toBe(projectId)
      expect(result.data.totalTokenEstimate).toBeLessThanOrEqual(result.data.maxTokens)
      expect(result.data.sections.observations.map(item => item.id)).toContain(
        'obs-tool-capture-pipeline',
      )
      expect(result.data.sections.proposals.map(item => item.id)).toContain(
        'proposal-tool-capture-pipeline',
      )
      expect(result.data.sections.archive.map(item => item.id)).toContain(
        'evt-tool-capture-pipeline',
      )
    } finally {
      if (previousHome === undefined) {
        delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      } else {
        process.env.MOSSEN_MEMORY_SIDECAR_HOME = previousHome
      }
      await fixture.cleanup()
    }
  })
})
