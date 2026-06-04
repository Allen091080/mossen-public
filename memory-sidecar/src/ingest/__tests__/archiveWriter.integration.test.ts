// W435a2 — Full ingestConversationEvent disk-write integration tests.
//
// Complements W435a's archiveWriter.test.ts (guard-only) with the happy
// path that actually writes a JSONL line + dirty marker. Each test gets a
// fresh project subdir under one shared tmp root for isolation.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ingestConversationEvent } from '../archiveWriter.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function archiveSessionPath(projectId: string, sessionId: string): string {
  return join(
    fixture.rootDir,
    'projects',
    projectId,
    'memory',
    'archive',
    'sessions',
    `${sessionId}.jsonl`,
  )
}

function dirtyJsonlPath(projectId: string): string {
  return join(fixture.rootDir, 'projects', projectId, 'memory', 'agent', 'dirty.jsonl')
}

function makeEvent(projectId: string, sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: 'mossen',
    sourceEventId: 'mossen:integration-1',
    projectId,
    sessionId,
    scope: 'project',
    role: 'user',
    kind: 'message',
    text: 'hello world',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  } as never
}

describe('ingestConversationEvent integration (W435a2)', () => {
  test('writes a JSONL line at the expected path', async () => {
    const projectId = 'proj-write'
    const sessionId = 'sess-write'
    const result = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: makeEvent(projectId, sessionId),
    })

    expect(result.archiveEvent.projectId).toBe(projectId)
    expect(result.archiveEvent.sessionId).toBe(sessionId)
    expect(result.archiveEvent.eventId).toMatch(/^evt_/)

    const path = archiveSessionPath(projectId, sessionId)
    expect(existsSync(path)).toBe(true)
    const contents = await readFile(path, 'utf8')
    const lines = contents.split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.eventId).toBe(result.archiveEvent.eventId)
    expect(parsed.text).toBe('hello world')
  })

  test('eventId is deterministic for same input', async () => {
    const projectId = 'proj-deterministic'
    const sessionId = 'sess-deterministic'
    // Use slightly varying overrides to make sourceEventIds distinct so we
    // can write twice without dedup at the upper layer; but for "same input"
    // determinism we just compare the makeArchiveEventId output indirectly.
    const eventA = makeEvent(projectId, sessionId, {
      sourceEventId: 'mossen:det-1',
    })
    const eventB = makeEvent(projectId, `${sessionId}-B`, {
      sourceEventId: 'mossen:det-1', // same sourceEventId, different sessionId
    })

    const a = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: eventA,
    })
    const b = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: eventB,
    })

    // Same sourceEventId but different sessionId -> different eventIds.
    expect(a.archiveEvent.eventId).not.toBe(b.archiveEvent.eventId)

    // Same input -> same eventId. Re-run with eventA's exact data.
    const a2Event = makeEvent(projectId, sessionId, {
      sourceEventId: 'mossen:det-1',
      sessionId,
    })
    const a2 = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: a2Event,
    })
    expect(a2.archiveEvent.eventId).toBe(a.archiveEvent.eventId)
  })

  test('writes a dirty marker by default', async () => {
    const projectId = 'proj-dirty'
    const sessionId = 'sess-dirty'
    const result = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: makeEvent(projectId, sessionId, { sourceEventId: 'dirty-1' }),
    })

    expect(result.dirtyMarker).toBeDefined()
    expect(result.dirtyMarker!.eventIds).toContain(result.archiveEvent.eventId)
    expect(existsSync(dirtyJsonlPath(projectId))).toBe(true)
    const dirtyLines = (await readFile(dirtyJsonlPath(projectId), 'utf8'))
      .split('\n')
      .filter(Boolean)
    expect(dirtyLines.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(dirtyLines[0]!).reason).toBe('archive_append')
  })

  test('markDirty: false suppresses dirty marker', async () => {
    const projectId = 'proj-no-dirty'
    const sessionId = 'sess-no-dirty'
    const result = await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      markDirty: false,
      event: makeEvent(projectId, sessionId, { sourceEventId: 'no-dirty-1' }),
    })

    expect(result.dirtyMarker).toBeUndefined()
    // archive still written, dirty queue not
    expect(existsSync(archiveSessionPath(projectId, sessionId))).toBe(true)
    expect(existsSync(dirtyJsonlPath(projectId))).toBe(false)
  })

  test('redacted text is what lands on disk', async () => {
    const projectId = 'proj-redact'
    const sessionId = 'sess-redact'
    // API-key-shaped string — redaction module catches these. We just
    // assert that whatever lands on disk has redaction metadata populated
    // and the textHash + tokenEstimate fields are filled in. Specific
    // redaction patterns are W435f's concern.
    const text =
      'My OpenAI key is sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf01234567'
    await ingestConversationEvent({
      rootDir: fixture.rootDir,
      projectId,
      event: makeEvent(projectId, sessionId, {
        sourceEventId: 'redact-1',
        text,
      }),
    })

    const path = archiveSessionPath(projectId, sessionId)
    const contents = await readFile(path, 'utf8')
    const parsed = JSON.parse(contents.split('\n').filter(Boolean)[0]!)

    expect(parsed.redaction).toBeDefined()
    expect(typeof parsed.redaction.applied).toBe('boolean')
    expect(parsed.textHash).toBeDefined()
    expect(parsed.tokenEstimate).toBeGreaterThanOrEqual(1)
  })
})
