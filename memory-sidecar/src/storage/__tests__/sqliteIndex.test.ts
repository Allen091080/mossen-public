// W435c — sqliteIndex behavior tests (integration with fixture).
//
// Covers:
//   - initializeMemoryIndex creates a real db file at expected path
//   - existingOnly: true returns null when no db exists (W119 H1 read-path
//     contract: never auto-create on read)
//   - indexArchiveEvents writes rows for events
//   - searchArchiveEvents returns rows by text match (FTS5 + LIKE fallback)
//   - getArchiveEventsById retrieves specific events
//   - searchArchiveEvents on a never-indexed project returns []
//     instead of materialising a db
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  getArchiveEventsById,
  indexArchiveEvents,
  initializeMemoryIndex,
  searchArchiveEvents,
} from '../sqliteIndex.js'
import type { ArchiveEvent } from '../../schema/archiveEvent.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function archiveEvent(overrides: Partial<ArchiveEvent> = {}): ArchiveEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt_index_a',
    source: 'mossen',
    sourceEventId: 'mossen:idx-a',
    scope: 'project',
    visibility: 'project',
    owner: { projectId: 'proj-idx', sessionId: 'sess-idx' },
    projectId: 'proj-idx',
    sessionId: 'sess-idx',
    role: 'user',
    kind: 'message',
    text: 'use pnpm not npm',
    textHash: 'sha256:h1',
    tokenEstimate: 4,
    createdAt: '2026-05-19T10:00:00.000Z',
    redaction: { applied: false, version: 1, notes: [] },
    ...overrides,
  }
}

function projectDbPath(projectId: string): string {
  return join(fixture.rootDir, 'projects', projectId, 'memory', 'memory.db')
}

describe('initializeMemoryIndex', () => {
  test('creates a db file at expected path when no existingOnly', async () => {
    const projectId = 'proj-init'
    const index = await initializeMemoryIndex({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(index).not.toBeNull()
    expect(index!.dbPath).toBe(projectDbPath(projectId))
    expect(existsSync(index!.dbPath)).toBe(true)
    index!.db.close()
  })

  test('existingOnly: true returns null when no db exists yet', async () => {
    const projectId = 'proj-existing-only-empty'
    const index = await initializeMemoryIndex({
      rootDir: fixture.rootDir,
      projectId,
      existingOnly: true,
    })
    expect(index).toBeNull()
    // critical: must NOT have created the file
    expect(existsSync(projectDbPath(projectId))).toBe(false)
  })

  test('existingOnly: true returns the index when db exists', async () => {
    const projectId = 'proj-existing-only-set'
    // Create the db first.
    const init = await initializeMemoryIndex({
      rootDir: fixture.rootDir,
      projectId,
    })
    init!.db.close()
    // Now read-only access should succeed.
    const reread = await initializeMemoryIndex({
      rootDir: fixture.rootDir,
      projectId,
      existingOnly: true,
    })
    expect(reread).not.toBeNull()
    reread!.db.close()
  })
})

describe('indexArchiveEvents + searchArchiveEvents', () => {
  test('indexed events are searchable by full-text', async () => {
    const projectId = 'proj-search-fts'
    await indexArchiveEvents({ rootDir: fixture.rootDir, projectId }, [
      archiveEvent({
        eventId: 'evt_search_1',
        projectId,
        text: 'always use pnpm in this project',
      }),
      archiveEvent({
        eventId: 'evt_search_2',
        projectId,
        sourceEventId: 'mossen:idx-b',
        text: 'react components prefer hooks',
      }),
    ])

    const hits = await searchArchiveEvents({
      rootDir: fixture.rootDir,
      projectId,
      query: 'pnpm',
      scopeFilter: { scope: 'project', projectId },
      limit: 10,
    })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some(h => h.event.eventId === 'evt_search_1')).toBe(true)
    // Different keyword finds the other event.
    const hits2 = await searchArchiveEvents({
      rootDir: fixture.rootDir,
      projectId,
      query: 'react',
      scopeFilter: { scope: 'project', projectId },
      limit: 10,
    })
    expect(hits2.some(h => h.event.eventId === 'evt_search_2')).toBe(true)
  })

  test('searchArchiveEvents returns [] when project has no db (W119 H1)', async () => {
    const projectId = 'proj-search-empty'
    const hits = await searchArchiveEvents({
      rootDir: fixture.rootDir,
      projectId,
      query: 'anything',
      scopeFilter: { scope: 'project', projectId },
    })
    expect(hits).toEqual([])
    // Must NOT have created the db.
    expect(existsSync(projectDbPath(projectId))).toBe(false)
  })

  test('limit <= 0 short-circuits to []', async () => {
    const hits = await searchArchiveEvents({
      rootDir: fixture.rootDir,
      projectId: 'proj-init',
      query: 'pnpm',
      scopeFilter: { scope: 'project', projectId: 'proj-init' },
      limit: 0,
    })
    expect(hits).toEqual([])
  })
})

describe('getArchiveEventsById', () => {
  test('retrieves specific events by id', async () => {
    const projectId = 'proj-byid'
    await indexArchiveEvents({ rootDir: fixture.rootDir, projectId }, [
      archiveEvent({ eventId: 'evt_byid_1', projectId, text: 'one' }),
      archiveEvent({ eventId: 'evt_byid_2', projectId, sourceEventId: 'mossen:idx-byid-2', text: 'two' }),
    ])

    const rows = await getArchiveEventsById({
      rootDir: fixture.rootDir,
      projectId,
      eventIds: ['evt_byid_1', 'evt_byid_2', 'evt_nonexistent'],
      scopeFilter: { scope: 'project', projectId },
    })
    expect(rows.length).toBe(2)
    expect(rows.map(r => r.event.eventId).sort()).toEqual([
      'evt_byid_1',
      'evt_byid_2',
    ])
  })

  test('empty eventIds returns []', async () => {
    const projectId = 'proj-byid'
    const rows = await getArchiveEventsById({
      rootDir: fixture.rootDir,
      projectId,
      eventIds: [],
      scopeFilter: { scope: 'project', projectId },
    })
    expect(rows).toEqual([])
  })

  test('returns [] when project has no db (W119 H1)', async () => {
    const projectId = 'proj-byid-empty'
    const rows = await getArchiveEventsById({
      rootDir: fixture.rootDir,
      projectId,
      eventIds: ['evt_anything'],
      scopeFilter: { scope: 'project', projectId },
    })
    expect(rows).toEqual([])
    expect(existsSync(projectDbPath(projectId))).toBe(false)
  })
})
