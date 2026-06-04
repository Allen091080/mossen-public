// W435f — dirtyQueue behavior tests.
//
// Covers:
//   - appendDirtyMarker: writes to agent/dirty.jsonl + path layout
//   - appendDirtyMarker: rejects malformed marker
//   - appendDirtyMarker: rejects projectId mismatch
//   - listDirtyMarkers: round-trips appended entries + ignores corrupt lines
//   - appendDirtyCheckpoint: writes to agent/dirty-checkpoints.jsonl
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  appendDirtyCheckpoint,
  appendDirtyMarker,
  getDirtyCheckpointPath,
  getDirtyQueuePath,
  listDirtyMarkers,
  type DirtyMarker,
} from '../dirtyQueue.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function marker(overrides: Partial<DirtyMarker> = {}): DirtyMarker {
  return {
    schemaVersion: 1,
    dirtyId: 'dirty_evt_1',
    projectId: 'proj-dq',
    sessionId: 'sess-dq',
    eventIds: ['evt_1'],
    reason: 'archive_append',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('getDirtyQueuePath', () => {
  test('points at agent/dirty.jsonl under project memory dir', () => {
    const p = getDirtyQueuePath({ rootDir: '/tmp/x', projectId: 'p1' })
    expect(p).toBe('/tmp/x/projects/p1/memory/agent/dirty.jsonl')
  })
})

describe('getDirtyCheckpointPath', () => {
  test('points at agent/dirty-checkpoints.jsonl', () => {
    const p = getDirtyCheckpointPath({ rootDir: '/tmp/x', projectId: 'p1' })
    expect(p).toBe('/tmp/x/projects/p1/memory/agent/dirty-checkpoints.jsonl')
  })
})

describe('appendDirtyMarker', () => {
  test('writes JSONL line at expected path', async () => {
    const projectId = 'proj-dq-write'
    const result = await appendDirtyMarker({
      rootDir: fixture.rootDir,
      projectId,
      marker: marker({ projectId, dirtyId: 'dirty_w1' }),
    })
    expect(result.dirtyId).toBe('dirty_w1')

    const path = getDirtyQueuePath({ rootDir: fixture.rootDir, projectId })
    expect(existsSync(path)).toBe(true)
  })

  test('rejects malformed marker (missing required field)', async () => {
    await expect(
      appendDirtyMarker({
        rootDir: fixture.rootDir,
        projectId: 'proj-dq',
        marker: { schemaVersion: 1 } as DirtyMarker,
      }),
    ).rejects.toThrow(/marker must match DirtyMarker schema/)
  })

  test('rejects projectId mismatch', async () => {
    await expect(
      appendDirtyMarker({
        rootDir: fixture.rootDir,
        projectId: 'proj-a',
        marker: marker({ projectId: 'proj-b' }),
      }),
    ).rejects.toThrow(/projectId must match/)
  })

  test('rejects unknown reason', async () => {
    await expect(
      appendDirtyMarker({
        rootDir: fixture.rootDir,
        projectId: 'proj-dq',
        marker: marker({ reason: 'unexpected_reason' as 'archive_append' }),
      }),
    ).rejects.toThrow(/marker must match DirtyMarker schema/)
  })
})

describe('listDirtyMarkers', () => {
  test('returns appended markers in file order', async () => {
    const projectId = 'proj-dq-list'
    await appendDirtyMarker({
      rootDir: fixture.rootDir,
      projectId,
      marker: marker({ projectId, dirtyId: 'list_1', eventIds: ['evt_a'] }),
    })
    await appendDirtyMarker({
      rootDir: fixture.rootDir,
      projectId,
      marker: marker({ projectId, dirtyId: 'list_2', eventIds: ['evt_b'] }),
    })

    const all = await listDirtyMarkers({ rootDir: fixture.rootDir, projectId })
    expect(all.map(m => m.dirtyId)).toEqual(['list_1', 'list_2'])
  })

  test('tolerates corrupt lines (skips, returns valid only)', async () => {
    const projectId = 'proj-dq-corrupt'
    await appendDirtyMarker({
      rootDir: fixture.rootDir,
      projectId,
      marker: marker({ projectId, dirtyId: 'good_1' }),
    })
    // Inject a bad line.
    const path = getDirtyQueuePath({ rootDir: fixture.rootDir, projectId })
    await appendFile(path, '\nNOT-JSON\n')

    const all = await listDirtyMarkers({ rootDir: fixture.rootDir, projectId })
    expect(all.map(m => m.dirtyId)).toEqual(['good_1'])
  })

  test('missing file returns empty array', async () => {
    const all = await listDirtyMarkers({
      rootDir: fixture.rootDir,
      projectId: 'proj-dq-empty',
    })
    expect(all).toEqual([])
  })
})

describe('appendDirtyCheckpoint', () => {
  test('writes JSONL line at expected path', async () => {
    const projectId = 'proj-dq-ckpt'
    const checkpoint = {
      schemaVersion: 1 as const,
      dirtyId: 'dirty_w1',
      projectId,
      consumedAt: '2026-05-19T10:05:00.000Z',
      reason: 'worker_completed' as const,
    }
    const result = await appendDirtyCheckpoint({
      rootDir: fixture.rootDir,
      projectId,
      checkpoint,
    })
    expect(result.dirtyId).toBe('dirty_w1')

    const path = getDirtyCheckpointPath({ rootDir: fixture.rootDir, projectId })
    expect(existsSync(path)).toBe(true)
  })

  test('rejects projectId mismatch', async () => {
    await expect(
      appendDirtyCheckpoint({
        rootDir: fixture.rootDir,
        projectId: 'proj-a',
        checkpoint: {
          schemaVersion: 1,
          dirtyId: 'd',
          projectId: 'proj-b',
          consumedAt: '2026-05-19T10:00:00.000Z',
          reason: 'worker_completed',
        },
      }),
    ).rejects.toThrow(/projectId must match/)
  })
})
