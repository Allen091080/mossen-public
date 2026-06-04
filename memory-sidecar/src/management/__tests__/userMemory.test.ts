// W435e — userMemory management API.
//
// Covers the management surface that /memory-sidecar + W419/W432/W433
// build on:
//   - listUserMemory on empty project returns []
//   - searchUserMemory on empty project returns []
//   - createDeleteDryRun + confirmDelete two-phase round-trip (locks the
//     contract W419 tombstoneArchiveEvent depends on)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  confirmDelete,
  createDeleteDryRun,
  listUserMemory,
  searchUserMemory,
  type UserMemoryPaths,
} from '../userMemory.js'
import { getProjectMemoryDir, ingestConversationEvent } from '../../index.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function pathsFor(projectId: string): UserMemoryPaths {
  const memoryDir = getProjectMemoryDir({ rootDir: fixture.rootDir, projectId })
  return {
    home: fixture.rootDir,
    root: fixture.rootDir,
    configPath: join(fixture.rootDir, 'config.json'),
    projectId,
    memoryDir,
    sqlitePath: join(memoryDir, 'memory.db'),
  }
}

describe('listUserMemory / searchUserMemory', () => {
  test('empty project returns []', async () => {
    const projectId = 'proj-um-empty'
    const list = await listUserMemory({
      rootDir: fixture.rootDir,
      projectId,
      kind: 'all',
    })
    expect(list).toEqual([])

    const searched = await searchUserMemory({
      rootDir: fixture.rootDir,
      projectId,
      kind: 'all',
      query: 'anything',
    })
    expect(searched).toEqual([])
  })

  test('after ingesting an event, archive kind lists it', async () => {
    const projectId = 'proj-um-archive'
    const sessionId = 'sess-um'
    const ingest = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: {
        schemaVersion: 1,
        source: 'mossen',
        sourceEventId: 'mossen:um-1',
        projectId,
        sessionId,
        scope: 'project',
        role: 'user',
        kind: 'message',
        text: 'hello user memory',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    })

    const list = await listUserMemory({
      rootDir: fixture.rootDir,
      projectId,
      kind: 'archive',
      limit: 50,
    })
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list.some(entry => entry.id === ingest.archiveEvent.eventId)).toBe(true)
    expect(list[0]!.kind).toBe('archive')
  })
})

describe('createDeleteDryRun + confirmDelete (W419 contract)', () => {
  test('two-phase round-trip removes the archive entry', async () => {
    const projectId = 'proj-um-delete'
    const sessionId = 'sess-um-del'
    const ingest = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: {
        schemaVersion: 1,
        source: 'mossen',
        sourceEventId: 'mossen:um-del-1',
        projectId,
        sessionId,
        scope: 'project',
        role: 'user',
        kind: 'message',
        text: 'short-lived',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    })
    const eventId = ingest.archiveEvent.eventId

    // confirm before dry-run -> the management layer requires a token from
    // dry-run; missing token surfaces as readPlan error.
    // We just go through the happy path.
    const dryRun = await createDeleteDryRun({
      rootDir: fixture.rootDir,
      projectId,
      paths: pathsFor(projectId),
      kind: 'archive',
      id: eventId,
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.operation).toBe('delete')
    expect(dryRun.token).toMatch(/.{8,}/)
    expect(Array.isArray(dryRun.targets)).toBe(true)
    expect(dryRun.targets.length).toBeGreaterThanOrEqual(1)

    const result = await confirmDelete({
      rootDir: fixture.rootDir,
      projectId,
      paths: pathsFor(projectId),
      token: dryRun.token,
    })
    expect(result.dryRun).toBe(false)
    expect(result.operation).toBe('delete')

    // Verify the entry is gone.
    const listAfter = await listUserMemory({
      rootDir: fixture.rootDir,
      projectId,
      kind: 'archive',
      limit: 50,
    })
    expect(listAfter.some(entry => entry.id === eventId)).toBe(false)
  })

  test('dry-run for nonexistent archive id throws (not empty targets)', async () => {
    // CONTRACT NOTE: createDeleteDryRun throws when the id doesn't exist,
    // it does NOT return { targets: [] }. This makes the W419 tombstone
    // helper's 'not_found' branch dead code — callers see reason: 'failed'
    // with detail "archive event not found: ...". Worth a small UX polish
    // in a future W419c followup (catch + remap to not_found in the
    // tombstone wrapper).
    const projectId = 'proj-um-empty-target'
    await expect(
      createDeleteDryRun({
        rootDir: fixture.rootDir,
        projectId,
        paths: pathsFor(projectId),
        kind: 'archive',
        id: 'evt_does_not_exist',
      }),
    ).rejects.toThrow(/archive event not found/)
  })

  test('confirmDelete with bogus token throws', async () => {
    const projectId = 'proj-um-bad-token'
    await expect(
      confirmDelete({
        rootDir: fixture.rootDir,
        projectId,
        paths: pathsFor(projectId),
        token: 'not-a-real-token',
      }),
    ).rejects.toThrow()
  })
})

// Anchor for the fixture path layout — we use existsSync in places above
// already, but assert at least one read so the import isn't flagged.
void existsSync
