// W419c — tombstoneArchiveEvent end-to-end remap tests.
//
// Locks the W419c contract that "archive event not found" from
// createDeleteDryRun gets mapped to reason: 'not_found' rather than
// 'failed'. Pairs with the W435e source-side test in userMemory.test.ts
// (which pins that createDeleteDryRun throws the specific error string).
//
// Uses the W435a2 tmp-dir fixture. Because tombstoneArchiveEvent reads
// the memory-sidecar CONFIG (via getDefaultMemorySidecarConfigPath which
// derives from $MOSSEN_CONFIG_HOME / $HOME), this test must drive that
// config to point at the tmp root.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tombstoneArchiveEvent } from '../tombstone.js'
import { ingestConversationEvent } from '../../../memory-sidecar/src/index.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../../memory-sidecar/src/__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot
let savedSidecarHome: string | undefined

beforeAll(async () => {
  fixture = await createTmpMemoryRoot('mossen-w419c-')

  // tombstone -> loadMemorySidecarConfig -> getDefaultMemorySidecarConfigPath
  // reads $MOSSEN_MEMORY_SIDECAR_HOME (the sidecar root, not mossen home).
  // Point that at the fixture so config + data both live inside tmp.
  savedSidecarHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME
  process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir

  // Materialise a minimal config that enables the sidecar + adapter so
  // tombstone (which checks config.enabled) doesn't bail early.
  const configPath = join(fixture.rootDir, 'config.json')
  await mkdir(fixture.rootDir, { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      homeDir: fixture.rootDir,
      adapter: { enabled: true },
    }),
    'utf8',
  )
})

afterAll(async () => {
  if (savedSidecarHome === undefined) {
    delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
  } else {
    process.env.MOSSEN_MEMORY_SIDECAR_HOME = savedSidecarHome
  }
  await fixture.cleanup()
})

describe('tombstoneArchiveEvent — W419c not_found remap', () => {
  test('nonexistent archiveEventId returns reason: not_found', async () => {
    const result = await tombstoneArchiveEvent({
      archiveEventId: 'evt_does_not_exist_at_all',
      projectId: 'proj-w419c-missing',
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.reason).toBe('not_found')
    }
  })

  test('happy path: ingest -> tombstone returns ok:true with deletedRecords', async () => {
    const projectId = 'proj-w419c-happy'
    const sessionId = 'sess-w419c-happy'
    const ingest = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: {
        schemaVersion: 1,
        source: 'mossen',
        sourceEventId: 'mossen:w419c-happy-1',
        projectId,
        sessionId,
        scope: 'project',
        role: 'user',
        kind: 'message',
        text: 'short-lived for w419c',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    })

    const result = await tombstoneArchiveEvent({
      archiveEventId: ingest.archiveEvent.eventId,
      projectId,
    })
    expect(result.ok).toBe(true)
    if (result.ok === true) {
      expect(result.archiveEventId).toBe(ingest.archiveEvent.eventId)
      expect(result.deletedRecords).toBeGreaterThanOrEqual(1)
    }
  })

  test('second tombstone of an already-deleted id returns not_found (was previously failed)', async () => {
    const projectId = 'proj-w419c-twice'
    const sessionId = 'sess-w419c-twice'
    const ingest = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: {
        schemaVersion: 1,
        source: 'mossen',
        sourceEventId: 'mossen:w419c-twice-1',
        projectId,
        sessionId,
        scope: 'project',
        role: 'user',
        kind: 'message',
        text: 'double-tombstone target',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    })

    // First tombstone succeeds.
    const first = await tombstoneArchiveEvent({
      archiveEventId: ingest.archiveEvent.eventId,
      projectId,
    })
    expect(first.ok).toBe(true)

    // Second tombstone on the same (now deleted) id must surface as
    // not_found, NOT failed (W419c fix). Before W419c this would have
    // returned reason:'failed' with detail "archive event not found: ...".
    const second = await tombstoneArchiveEvent({
      archiveEventId: ingest.archiveEvent.eventId,
      projectId,
    })
    expect(second.ok).toBe(false)
    if (second.ok === false) {
      expect(second.reason).toBe('not_found')
    }
  })
})
