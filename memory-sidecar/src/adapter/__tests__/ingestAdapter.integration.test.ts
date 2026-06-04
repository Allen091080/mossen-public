// W435a2 — ingestAdapterPayloads full write path (archive + dead-letter).
//
// Complements ingestAdapter.test.ts (planAdapterPayloads dry-run only) with
// real disk-write verification: archive JSONL exists at expected path,
// IngressEventAck.archiveEventId is populated for accepted events, and
// dead-letter writes happen for failed/skipped payloads when the option is
// not explicitly disabled.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ingestAdapterPayloads } from '../ingestAdapter.js'
import { getAdapterDeadLetterPath } from '../deadLetterStore.js'
import type { MemoryAdapterPayload } from '../payload.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function validPayload(overrides: Partial<MemoryAdapterPayload> = {}): MemoryAdapterPayload {
  return {
    schemaVersion: 1,
    adapter: 'mossen-hook',
    sourceEventId: 'mossen:int-1',
    projectId: 'proj-int-a',
    sessionId: 'sess-int-a',
    scope: 'project',
    role: 'user',
    kind: 'message',
    channel: 'conversation',
    text: 'hello from integration',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  }
}

function archivePath(projectId: string, sessionId: string): string {
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

describe('ingestAdapterPayloads integration (W435a2)', () => {
  test('valid payload -> writes archive + ack has archiveEventId', async () => {
    const projectId = 'proj-int-write'
    const sessionId = 'sess-int-write'
    const result = await ingestAdapterPayloads({
      rootDir: fixture.rootDir,
      payloads: [validPayload({ projectId, sessionId })],
    })

    expect(result.accepted).toBe(1)
    expect(result.events).toHaveLength(1)
    const ack = result.events[0]!
    expect(ack.status).toBe('accepted')
    expect(ack.archiveEventId).toMatch(/^evt_/)
    expect(ack.sourceEventId).toBe('mossen:int-1')

    expect(existsSync(archivePath(projectId, sessionId))).toBe(true)
    const contents = await readFile(archivePath(projectId, sessionId), 'utf8')
    const parsed = JSON.parse(contents.split('\n').filter(Boolean)[0]!)
    expect(parsed.eventId).toBe(ack.archiveEventId)
  })

  test('enabled: false -> NO disk writes (red-line behaviour)', async () => {
    const projectId = 'proj-disabled'
    const sessionId = 'sess-disabled'
    const result = await ingestAdapterPayloads({
      rootDir: fixture.rootDir,
      enabled: false,
      payloads: [validPayload({ projectId, sessionId })],
    })

    expect(result.accepted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.events[0]!.reason).toBe('adapter_disabled')

    // W119 H1 contract: zero disk writes when disabled.
    expect(existsSync(archivePath(projectId, sessionId))).toBe(false)
    expect(existsSync(getAdapterDeadLetterPath({ rootDir: fixture.rootDir, projectId }))).toBe(false)
  })

  test('invalid payload writes a dead-letter entry by default', async () => {
    const bogus = {
      schemaVersion: 1,
      adapter: 'mossen-hook',
      sourceEventId: 'mossen:dl-1',
      // missing projectId + cwd -> invalid_schema
      sessionId: 'sess-dl-a',
      role: 'user',
      text: 'bad payload',
    } as MemoryAdapterPayload

    const result = await ingestAdapterPayloads({
      rootDir: fixture.rootDir,
      payloads: [bogus],
    })

    expect(result.failed).toBe(1)
    expect(result.events[0]!.reason).toBe('invalid_schema')

    const dlPath = getAdapterDeadLetterPath({ rootDir: fixture.rootDir, projectId: 'adapter' })
    expect(existsSync(dlPath)).toBe(true)
    const dlContents = await readFile(dlPath, 'utf8')
    const dlLines = dlContents.split('\n').filter(Boolean)
    const dlEntry = dlLines
      .map(line => JSON.parse(line))
      .find(e => e.sourceEventId === 'mossen:dl-1')
    expect(dlEntry).toBeDefined()
    expect(dlEntry.reason).toBe('invalid_schema')
  })

  test('deadLetter: false suppresses dead-letter writes', async () => {
    // Use a separate fresh tmp root so we can assert "no file created"
    // without races against the previous test.
    const tmp = await createTmpMemoryRoot('mossen-memtest-noDL-')
    try {
      const bogus = {
        schemaVersion: 1,
        adapter: 'mossen-hook',
        sourceEventId: 'mossen:noDL-1',
        sessionId: 'sess-noDL',
        role: 'user',
        text: 'still bad',
      } as MemoryAdapterPayload

      const result = await ingestAdapterPayloads({
        rootDir: tmp.rootDir,
        deadLetter: false,
        payloads: [bogus],
      })

      expect(result.failed).toBe(1)
      // Dead letter file must not exist.
      expect(existsSync(getAdapterDeadLetterPath({ rootDir: tmp.rootDir, projectId: 'adapter' }))).toBe(false)
    } finally {
      await tmp.cleanup()
    }
  })

  test('multi-project batch buckets writes per project', async () => {
    const payloads = [
      validPayload({ projectId: 'proj-mp-x', sessionId: 'sess-x', sourceEventId: 'x-1' }),
      validPayload({ projectId: 'proj-mp-y', sessionId: 'sess-y', sourceEventId: 'y-1' }),
      validPayload({ projectId: 'proj-mp-x', sessionId: 'sess-x', sourceEventId: 'x-2' }),
    ]
    const result = await ingestAdapterPayloads({
      rootDir: fixture.rootDir,
      payloads,
    })
    expect(result.accepted).toBe(3)
    expect(result.projects).toHaveLength(2)

    expect(existsSync(archivePath('proj-mp-x', 'sess-x'))).toBe(true)
    expect(existsSync(archivePath('proj-mp-y', 'sess-y'))).toBe(true)
    const xContents = await readFile(archivePath('proj-mp-x', 'sess-x'), 'utf8')
    expect(xContents.split('\n').filter(Boolean).length).toBe(2)
    const yContents = await readFile(archivePath('proj-mp-y', 'sess-y'), 'utf8')
    expect(yContents.split('\n').filter(Boolean).length).toBe(1)
  })
})
