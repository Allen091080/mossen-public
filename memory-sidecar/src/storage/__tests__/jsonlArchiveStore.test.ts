// W435f — jsonlArchiveStore behavior tests.
//
// Covers:
//   - appendArchiveEvent: writes correct JSONL line at correct path
//   - appendArchiveEvent: rejects mismatched projectId / missing sessionId
//   - getArchiveSessionPath: derives path from rootDir + projectId + sessionId
//   - readArchiveEvents: round-trips appended events
//   - readArchiveEventsTolerant: handles corrupt lines without failing
//   - sessionId sanitization: traversal-safe path segments
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  appendArchiveEvent,
  getArchiveSessionPath,
  readArchiveEvents,
  readArchiveEventsTolerant,
} from '../jsonlArchiveStore.js'
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
    eventId: 'evt_test_a',
    source: 'mossen',
    sourceEventId: 'mossen:test-a',
    scope: 'project',
    visibility: 'project',
    owner: { projectId: 'proj-store', sessionId: 'sess-store' },
    projectId: 'proj-store',
    sessionId: 'sess-store',
    role: 'user',
    kind: 'message',
    text: 'hello store',
    textHash: 'sha256:hello',
    tokenEstimate: 3,
    createdAt: '2026-05-19T10:00:00.000Z',
    redaction: { applied: false, version: 1, notes: [] },
    ...overrides,
  }
}

describe('getArchiveSessionPath', () => {
  test('derives a path under rootDir / projects / projectId / memory', () => {
    const path = getArchiveSessionPath({
      rootDir: '/tmp/fake',
      projectId: 'proj-x',
      sessionId: 'sess-y',
    })
    expect(path).toContain('/tmp/fake/projects/proj-x/memory/archive/sessions/')
    expect(path).toContain('sess-y.jsonl')
  })

  test('rejects path traversal in sessionId with a throw', () => {
    // safePathSegment throws rather than silently rewriting — locks the
    // contract so a "make it more lenient" refactor surfaces in tests.
    expect(() =>
      getArchiveSessionPath({
        rootDir: '/tmp/fake',
        projectId: 'proj-x',
        sessionId: '../../escape',
      }),
    ).toThrow(/unsafe path segment/)
  })
})

describe('appendArchiveEvent', () => {
  test('writes event as JSONL at expected path + returns location', async () => {
    const projectId = 'proj-append'
    const sessionId = 'sess-append'
    const event = archiveEvent({ projectId, sessionId, eventId: 'evt_append_1' })
    const result = await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event,
    })

    expect(result.event.eventId).toBe('evt_append_1')
    expect(result.jsonlPath).toContain('/proj-append/memory/archive/sessions/sess-append.jsonl')
    expect(result.byteOffset).toBe(0)
    expect(result.byteLength).toBeGreaterThan(0)

    expect(existsSync(result.jsonlPath)).toBe(true)
  })

  test('rejects when event.projectId does not match options.projectId', async () => {
    await expect(
      appendArchiveEvent({
        rootDir: fixture.rootDir,
        projectId: 'proj-a',
        event: archiveEvent({ projectId: 'proj-b' }),
      }),
    ).rejects.toThrow(/projectId must match/)
  })

  test('rejects when event.sessionId is missing', async () => {
    await expect(
      appendArchiveEvent({
        rootDir: fixture.rootDir,
        projectId: 'proj-store',
        event: archiveEvent({ sessionId: '' }),
      }),
    ).rejects.toThrow(/sessionId is required/)
  })

  test('second append advances byteOffset', async () => {
    const projectId = 'proj-offset'
    const sessionId = 'sess-offset'
    const a = await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: archiveEvent({ projectId, sessionId, eventId: 'evt_off_1' }),
    })
    const b = await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: archiveEvent({ projectId, sessionId, eventId: 'evt_off_2' }),
    })

    expect(b.byteOffset).toBe(a.byteOffset + a.byteLength)
  })
})

describe('readArchiveEvents', () => {
  test('round-trips an appended event', async () => {
    const projectId = 'proj-read'
    const sessionId = 'sess-read'
    await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: archiveEvent({ projectId, sessionId, eventId: 'evt_read_1', text: 'roundtrip' }),
    })

    const events = await readArchiveEvents({
      rootDir: fixture.rootDir,
      projectId,
      sessionId,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.event.eventId).toBe('evt_read_1')
    expect(events[0]!.event.text).toBe('roundtrip')
  })

  test('missing file -> empty array', async () => {
    const events = await readArchiveEvents({
      rootDir: fixture.rootDir,
      projectId: 'proj-nonexistent',
      sessionId: 'sess-nonexistent',
    })
    expect(events).toEqual([])
  })
})

describe('readArchiveEventsTolerant', () => {
  test('separates valid from corrupt lines', async () => {
    const projectId = 'proj-tolerant'
    const sessionId = 'sess-tolerant'
    // First append a valid event so the path exists.
    await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: archiveEvent({ projectId, sessionId, eventId: 'evt_ok' }),
    })
    // Now manually inject a bad line.
    const path = getArchiveSessionPath({
      rootDir: fixture.rootDir,
      projectId,
      sessionId,
    })
    await mkdir(dirname(path), { recursive: true })
    const fs = await import('node:fs/promises')
    await fs.appendFile(path, '\nNOT-JSON\n')

    const result = await readArchiveEventsTolerant({
      rootDir: fixture.rootDir,
      projectId,
      sessionId,
    })
    expect(result.events.length).toBe(1)
    expect(result.events[0]!.event.eventId).toBe('evt_ok')
    expect(result.corruptLines.length).toBeGreaterThanOrEqual(1)
    expect(result.corruptLines[0]!.rawLine).toContain('NOT-JSON')
  })

  test('missing path returns empty events + empty corrupt lines', async () => {
    const result = await readArchiveEventsTolerant({
      rootDir: fixture.rootDir,
      projectId: 'proj-missing',
      sessionId: 'sess-missing',
    })
    expect(result.events).toEqual([])
    expect(result.corruptLines).toEqual([])
  })
})

// Suppress 'writeFile' warning — actually used via dynamic import to keep
// the eslint-friendly static import surface minimal.
void writeFile
