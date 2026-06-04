// W435d — Memory worker lock + status.
//
// Covers the simpler primitives:
//   - getMemoryWorkerLockPath (pure)
//   - acquireMemoryWorkerLock / releaseMemoryWorkerLock round-trip
//   - acquire fails when already held by a different process
//   - getMemoryWorkerStatus shape on an empty project
//   - isProcessAlive on current pid + on a guaranteed-dead pid
//
// Full runMemoryWorkerOnce / runMemoryWorkerLoop orchestration is too
// intertwined with classification / job runner / dirty checkpointing for
// unit-test isolation; covered indirectly by harness smokes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  acquireMemoryWorkerLock,
  getMemoryWorkerLockPath,
  getMemoryWorkerStatus,
  isProcessAlive,
  MEMORY_WORKER_DEFAULT_INTERVAL_MS,
  MEMORY_WORKER_DEFAULT_RETRY_MAX_ATTEMPTS,
  MEMORY_WORKER_LOCK_STALE_MS,
  releaseMemoryWorkerLock,
} from '../workerLoop.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

describe('worker loop constants are sane', () => {
  test('exposed defaults are positive numbers', () => {
    expect(MEMORY_WORKER_DEFAULT_INTERVAL_MS).toBeGreaterThan(0)
    expect(MEMORY_WORKER_DEFAULT_RETRY_MAX_ATTEMPTS).toBeGreaterThan(0)
    expect(MEMORY_WORKER_LOCK_STALE_MS).toBeGreaterThan(0)
  })
})

describe('getMemoryWorkerLockPath', () => {
  test('points at agent/worker.lock under project memory dir', () => {
    const p = getMemoryWorkerLockPath({ rootDir: '/tmp/x', projectId: 'p1' })
    expect(p).toBe('/tmp/x/projects/p1/memory/agent/worker.lock')
  })
})

describe('acquireMemoryWorkerLock + releaseMemoryWorkerLock', () => {
  test('acquire creates lock file with owner metadata', async () => {
    const projectId = 'proj-wl-acquire'
    const lock = await acquireMemoryWorkerLock({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(lock.acquired).toBe(true)
    expect(lock.owner.projectId).toBe(projectId)
    expect(lock.owner.lockId).toMatch(/^[0-9a-f-]{36}$/)
    expect(lock.owner.pid).toBe(process.pid)
    expect(existsSync(lock.lockPath)).toBe(true)
    await releaseMemoryWorkerLock(lock)
    expect(existsSync(lock.lockPath)).toBe(false)
  })

  test('second acquire while held throws', async () => {
    const projectId = 'proj-wl-conflict'
    const lock = await acquireMemoryWorkerLock({
      rootDir: fixture.rootDir,
      projectId,
    })
    try {
      await expect(
        acquireMemoryWorkerLock({
          rootDir: fixture.rootDir,
          projectId,
        }),
      ).rejects.toThrow(/memory worker is already running/)
    } finally {
      await releaseMemoryWorkerLock(lock)
    }
  })

  test('release on un-acquired lock is no-op', async () => {
    await releaseMemoryWorkerLock({
      lockPath: '/tmp/never-existed',
      acquired: false,
      staleRemoved: false,
      owner: {
        lockId: 'x',
        pid: 0,
        hostname: 'nowhere',
        projectId: 'p',
        acquiredAt: '',
        startedAt: '',
        updatedAt: '',
        heartbeatAt: '',
      },
    })
    // No throw == pass.
    expect(true).toBe(true)
  })

  test('release does not delete lock owned by someone else', async () => {
    const projectId = 'proj-wl-foreign'
    const lock = await acquireMemoryWorkerLock({
      rootDir: fixture.rootDir,
      projectId,
    })
    try {
      // Forge a lock object with a different lockId pointing at the real
      // file — release must NOT delete it.
      await releaseMemoryWorkerLock({
        lockPath: lock.lockPath,
        acquired: true,
        staleRemoved: false,
        owner: { ...lock.owner, lockId: 'totally-different-lock-id' },
      })
      expect(existsSync(lock.lockPath)).toBe(true)
    } finally {
      await releaseMemoryWorkerLock(lock)
    }
  })
})

describe('getMemoryWorkerStatus', () => {
  test('returns shape with no dirty/jobs/lock on a fresh project', async () => {
    const projectId = 'proj-wl-status-empty'
    const status = await getMemoryWorkerStatus({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(status.projectId).toBe(projectId)
    expect(status.dirty.total).toBe(0)
    expect(status.dirty.unconsumed).toBe(0)
    expect(status.jobs.totalJobs).toBe(0)
    expect(status.schedule.shouldSchedule).toBe(false)
  })
})

describe('isProcessAlive', () => {
  test('current pid is alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  test('PID 0 is conventionally treated as not-alive', () => {
    expect(isProcessAlive(0)).toBe(false)
  })

  test('huge unlikely pid is not alive', () => {
    expect(isProcessAlive(2 ** 30 - 1)).toBe(false)
  })
})
