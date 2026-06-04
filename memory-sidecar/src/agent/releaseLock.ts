// W122-B Agent B — Stale worker.lock release helper.
//
// Single-purpose write helper used by /memory-sidecar repair confirmation flow
// to safely unlink a stale worker.lock file. Layered safety:
//
//   1. Re-read lock state via getMemoryWorkerStatus (no cached snapshot).
//   2. Refuse cross-host locks. Refuse live PIDs.
//   3. Only safe-deletes when staleReason ∈ {dead_pid, mtime} AND same host
//      AND (PID confirmed dead OR mtime grace expired).
//   4. Path assertion: lockPath must start with project memoryDir AND end
//      with `/agent/worker.lock` before unlink.
//
// All writes scoped to the project memoryDir derived from the requested
// projectId after alias resolution. No global / cross-project writes.

import { stat, unlink } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import { getMemoryWorkerStatus } from './workerLoop.js'

export type ReleaseStaleLockReason =
  | 'released'
  | 'no-lock'
  | 'live-lock'
  | 'cross-host'
  | 'unknown-pid'
  | 'unsafe-staleReason'

export type ReleaseStaleLockResult = {
  released: boolean
  reason: ReleaseStaleLockReason
  staleReason: 'dead_pid' | 'mtime' | 'none' | null
  pid: number | null
  hostname: string | null
  lockPath: string
}

/**
 * Safely unlink a stale memory worker lock for the resolved project.
 *
 * Read flow:
 *   - resolveProjectId(options) → effectiveProjectId
 *   - lockPath = `${getProjectMemoryDir({...options, projectId: effective})}/agent/worker.lock`
 *   - lock state from getMemoryWorkerStatus({...options, projectId: effective})
 *
 * Decision matrix (first match wins):
 *   - !lock.held                                      → no-lock          (no write)
 *   - lock.sameHost === false                         → cross-host       (no write)
 *   - lock.staleReason === 'dead_pid'
 *       && lock.sameHost === true
 *       && lock.pidDead === true                      → unlink + released
 *   - lock.staleReason === 'mtime' && lock.stale      → unlink + released
 *   - lock.pidAlive === true                          → live-lock        (no write)
 *   - pid undecidable                                 → unknown-pid      (no write)
 *   - otherwise                                       → unsafe-staleReason
 */
export async function releaseStaleMemoryWorkerLock(
  options: MemoryRootOptions,
): Promise<ReleaseStaleLockResult> {
  const resolved = await resolveProjectId({ ...options, projectId: options.projectId })
  const effectiveProjectId = resolved.projectId
  const memoryDir = getProjectMemoryDir({ ...options, projectId: effectiveProjectId })
  const lockPath = `${memoryDir}/agent/worker.lock`

  const status = await getMemoryWorkerStatus({ ...options, projectId: effectiveProjectId })
  const lock = status.lock

  if (!lock.held) {
    return {
      released: false,
      reason: 'no-lock',
      staleReason: null,
      pid: null,
      hostname: null,
      lockPath,
    }
  }

  const pid = typeof lock.pid === 'number' ? lock.pid : null
  const host = typeof lock.hostname === 'string' ? lock.hostname : null
  const staleReason = lock.staleReason ?? null

  if (lock.sameHost === false) {
    return {
      released: false,
      reason: 'cross-host',
      staleReason,
      pid,
      hostname: host,
      lockPath,
    }
  }

  let safe = false
  if (
    lock.staleReason === 'dead_pid' &&
    lock.sameHost === true &&
    lock.pidDead === true
  ) {
    safe = true
  } else if (lock.staleReason === 'mtime' && lock.stale === true) {
    safe = true
  }

  if (!safe) {
    if (lock.pidAlive === true) {
      return {
        released: false,
        reason: 'live-lock',
        staleReason,
        pid,
        hostname: host,
        lockPath,
      }
    }
    if (lock.pidAlive === undefined && lock.pidDead === undefined) {
      return {
        released: false,
        reason: 'unknown-pid',
        staleReason,
        pid,
        hostname: host,
        lockPath,
      }
    }
    return {
      released: false,
      reason: 'unsafe-staleReason',
      staleReason,
      pid,
      hostname: host,
      lockPath,
    }
  }

  // Path assertion — never delete anything outside the project memoryDir.
  if (!lockPath.startsWith(memoryDir) || !lockPath.endsWith('/agent/worker.lock')) {
    throw new Error(
      `refusing to unlink lock outside project memoryDir: lockPath=${lockPath} memoryDir=${memoryDir}`,
    )
  }

  try {
    await unlink(lockPath)
  } catch (error) {
    // Race: file disappeared between status probe and unlink — treat as success.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  // Confirm gone.
  const after = await stat(lockPath).catch(error => {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
    throw error
  })
  if (after) {
    throw new Error(`unlink returned but lock still present: ${lockPath}`)
  }

  return {
    released: true,
    reason: 'released',
    staleReason,
    pid,
    hostname: host,
    lockPath,
  }
}
