import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendObservations,
  appendProposals,
  createDefaultMemorySidecarConfig,
  indexArchiveEvents,
  projectIdFromCwd,
  type ArchiveEvent,
  type Observation,
  type Proposal,
} from '../../../memory-sidecar/src/index.js'
import { createTmpMemoryRoot } from '../../../memory-sidecar/src/__tests__/_fixtures/tmpRoot.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../../memory-sidecar/src/schema/scope.js'
import { createUserMessage } from '../../../utils/messages.js'
import {
  buildMemorySidecarPrefetchReminder,
  prefetchQueryFromMessages,
} from '../prefetch.js'

const START = '2026-06-02T08:00:00.000Z'
const SESSION_ID = 'sess-prefetch-old'

function observation(projectId: string): Observation {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    observationId: 'obs-prefetch-capture-pipeline',
    scope: 'project',
    visibility: 'project',
    projectId,
    sessionId: SESSION_ID,
    type: 'decision',
    kind: 'semantic',
    domain: 'memory',
    lifecycle: 'active',
    retrievalPolicy: 'hint',
    title: 'Capture pipeline should be recalled before main-loop changes',
    summary: 'Past decision: validate capture pipeline evidence with sidecar recall before changing any primary query loop.',
    evidenceIds: ['evt-prefetch-capture-pipeline'],
    evidenceEventIds: ['evt-prefetch-capture-pipeline'],
    files: [],
    tags: ['capture', 'pipeline', 'memory-sidecar'],
    confidence: 0.93,
    source: 'llm',
    promotionStatus: 'candidate',
    createdAt: START,
  }
}

function proposal(projectId: string): Proposal {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    proposalId: 'proposal-prefetch-capture-pipeline',
    type: 'workflow',
    status: 'candidate',
    projectId,
    title: 'Use capture pipeline recall as surfacing proof',
    rationale: 'Proposal: proactive surfacing should first prove capture pipeline recall on a natural query.',
    evidenceEventIds: ['evt-prefetch-capture-pipeline'],
    createdAt: START,
    confidence: 0.86,
  }
}

function archiveEvent(projectId: string): ArchiveEvent {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    eventId: 'evt-prefetch-capture-pipeline',
    source: 'mossen',
    sourceEventId: 'prefetch:capture-pipeline',
    scope: 'project',
    visibility: 'project',
    owner: { projectId, sessionId: SESSION_ID },
    projectId,
    sessionId: SESSION_ID,
    role: 'assistant',
    kind: 'message',
    text: 'Capture pipeline evidence: stopHooks sends turns to archiveWriter, then index_archive makes prior decisions retrievable in later sessions.',
    textHash: 'sha256:evt-prefetch-capture-pipeline',
    tokenEstimate: 35,
    createdAt: START,
    redaction: { applied: false, version: 1, notes: [] },
  }
}

async function writeConfig(rootDir: string, enabled: boolean): Promise<void> {
  const config = createDefaultMemorySidecarConfig({
    ...process.env,
    MOSSEN_MEMORY_SIDECAR_HOME: rootDir,
  })
  config.enabled = enabled
  config.retrieval.maxResults = 5
  config.retrieval.maxTokens = 900
  await writeFile(
    join(rootDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )
}

describe('memory sidecar prefetch', () => {
  test('prefetchQueryFromMessages ignores meta messages', () => {
    const query = prefetchQueryFromMessages([
      createUserMessage({ content: 'visible user question' }),
      createUserMessage({ content: 'hidden reminder', isMeta: true }),
    ])

    expect(query).toBe('visible user question')
  })

  test('returns null when sidecar config is disabled', async () => {
    const fixture = await createTmpMemoryRoot('mossen-prefetch-disabled-')
    const previousHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME

    try {
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir
      await writeConfig(fixture.rootDir, false)

      const reminder = await buildMemorySidecarPrefetchReminder({
        cwd: fixture.rootDir,
        messages: [createUserMessage({ content: 'capture pipeline' })],
      })

      expect(reminder).toBeNull()
    } finally {
      if (previousHome === undefined) delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      else process.env.MOSSEN_MEMORY_SIDECAR_HOME = previousHome
      await fixture.cleanup()
    }
  })

  test('builds a compact reminder for high-score prior memory', async () => {
    const fixture = await createTmpMemoryRoot('mossen-prefetch-enabled-')
    const previousHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME

    try {
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir
      await writeConfig(fixture.rootDir, true)

      const cwd = join(fixture.rootDir, 'workspace', 'mossensrc')
      await mkdir(cwd, { recursive: true })
      const projectId = projectIdFromCwd(cwd)
      const event = archiveEvent(projectId)

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
      await indexArchiveEvents(
        { rootDir: fixture.rootDir, projectId },
        [event],
      )

      const reminder = await buildMemorySidecarPrefetchReminder({
        cwd,
        messages: [createUserMessage({ content: '捕获 管线 怎么验证' })],
      })

      expect(reminder).toContain('<system-reminder>')
      expect(reminder).toContain('obs-prefetch-capture-pipeline')
      expect(reminder).toContain('proposal-prefetch-capture-pipeline')
      expect(reminder).not.toContain('hidden reminder')
    } finally {
      if (previousHome === undefined) delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      else process.env.MOSSEN_MEMORY_SIDECAR_HOME = previousHome
      await fixture.cleanup()
    }
  })

  test('returns null when recall is below the injection threshold', async () => {
    const fixture = await createTmpMemoryRoot('mossen-prefetch-low-score-')
    const previousHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME

    try {
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir
      await writeConfig(fixture.rootDir, true)

      const cwd = join(fixture.rootDir, 'workspace', 'mossensrc')
      await mkdir(cwd, { recursive: true })

      const reminder = await buildMemorySidecarPrefetchReminder({
        cwd,
        messages: [createUserMessage({ content: 'totally unrelated topic' })],
      })

      expect(reminder).toBeNull()
    } finally {
      if (previousHome === undefined) delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      else process.env.MOSSEN_MEMORY_SIDECAR_HOME = previousHome
      await fixture.cleanup()
    }
  })
})
