import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import {
  listDirtyCheckpoints,
  listDirtyMarkers,
  listUnconsumedDirtyMarkers,
} from './dirtyQueue.js'
import {
  listLatestMemoryAgentJobs,
  listMemoryAgentJobs,
  observeMemoryAgentJobRetries,
  observeMemoryAgentJobs,
  retryFailedMemoryAgentJobs,
  type MemoryAgentJob,
  type MemoryAgentJobObservation,
  type MemoryAgentRetryObservation,
} from './jobQueue.js'
import { detectArchiveEventsMissingDirty } from './reconcile.js'
import { redactMemoryText } from '../redaction/redact.js'
import { shouldScheduleMemoryAgent, type MemoryAgentScheduleDecision } from './scheduler.js'
import { runMemoryAgentOnce, type MemoryAgentRunOnceResult } from './workerRunOnce.js'

export const MEMORY_WORKER_LOCK_STALE_MS = 10 * 60 * 1000
export const MEMORY_WORKER_DEFAULT_INTERVAL_MS = 5_000
export const MEMORY_WORKER_DEFAULT_MAX_IDLE_ITERATIONS = Number.POSITIVE_INFINITY
export const MEMORY_WORKER_DEFAULT_RETRY_MAX_ATTEMPTS = 3
export const MEMORY_WORKER_DEFAULT_RETRY_BACKOFF_BASE_MS = 30_000
export const MEMORY_WORKER_DEFAULT_RETRY_MAX_BACKOFF_MS = 5 * 60 * 1000

export type MemoryWorkerLockOwner = {
  lockId: string
  pid: number
  hostname: string
  projectId: string
  acquiredAt: string
  startedAt: string
  updatedAt: string
  heartbeatAt: string
}

export type MemoryWorkerLock = {
  lockPath: string
  acquired: boolean
  staleRemoved: boolean
  owner: MemoryWorkerLockOwner
}

export type MemoryWorkerStatus = {
  projectId: string
  lock: {
    path: string
    held: boolean
    stale: boolean
    owner?: unknown
    ageMs?: number
    // W121-A item 2 — additional pid/host visibility
    pid?: number
    hostname?: string
    heartbeatAt?: string
    sameHost?: boolean
    pidAlive?: boolean
    pidDead?: boolean
    staleReason?: 'mtime' | 'dead_pid' | 'none'
    // W148-B: read-only signal that the lock file exists on disk but
    // its JSON could not be parsed (corrupt / partial / wrong format).
    // True only when held=true but no owner record is recoverable.
    // Doctor / status surfaces should warn and recommend manual
    // inspection; we deliberately do NOT auto-reclaim corrupt locks
    // because their identity is unverifiable (W146.4 P1-1 guard).
    corruptLock?: boolean
  }
  dirty: {
    total: number
    consumed: number
    unconsumed: number
  }
  schedule: MemoryAgentScheduleDecision
  jobs: MemoryAgentJobObservation
  retries: MemoryAgentRetryObservation
}

export type MemoryWorkerRetryOptions = {
  enabled?: boolean
  maxAttempts?: number
  backoffBaseMs?: number
  maxBackoffMs?: number
  markExhausted?: boolean
}

export type MemoryWorkerLoopOptions = MemoryRootOptions & {
  intervalMs?: number
  maxIterations?: number
  maxIdleIterations?: number
  force?: boolean
  llmProviderConfig?: MemoryRootOptions['llmProviderConfig']
  now?: () => number
  retry?: MemoryWorkerRetryOptions
  onIteration?: (iteration: MemoryWorkerLoopIteration) => void | Promise<void>
}

export type MemoryWorkerLoopIteration = {
  index: number
  ran: boolean
  reason: 'scheduled' | 'forced' | 'pending_jobs' | 'reconcile_required' | 'idle'
  schedule: MemoryAgentScheduleDecision
  pendingJobs: number
  retriedJobs: MemoryAgentJob[]
  run?: MemoryAgentRunOnceResult
}

export type MemoryWorkerLoopResult = {
  lock: MemoryWorkerLock
  intervalMs: number
  iterations: MemoryWorkerLoopIteration[]
  stoppedReason: 'max_iterations' | 'max_idle_iterations'
  finalStatus: MemoryWorkerStatus
}

export type MemoryWorkerRunOnceResult = MemoryAgentRunOnceResult & {
  lock: MemoryWorkerLock
  retriedJobs: MemoryAgentJob[]
  run: MemoryAgentRunOnceResult
  finalStatus: MemoryWorkerStatus
}

export function getMemoryWorkerLockPath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/agent/worker.lock`
}

export async function acquireMemoryWorkerLock(
  options: MemoryRootOptions & { staleMs?: number },
): Promise<MemoryWorkerLock> {
  const lockPath = getMemoryWorkerLockPath(options)
  await mkdir(`${getProjectMemoryDir(options)}/agent`, { recursive: true })

  const staleRemoved = await removeStaleLockIfNeeded(lockPath, options.staleMs)
  const now = new Date().toISOString()
  const host = hostname()
  const owner: MemoryWorkerLockOwner = {
    lockId: randomUUID(),
    pid: process.pid,
    hostname: host,
    projectId: options.projectId,
    acquiredAt: now,
    startedAt: now,
    updatedAt: now,
    heartbeatAt: now,
  }
  const file = await open(lockPath, 'wx').catch(error => {
    if (error?.code === 'EEXIST') return undefined
    throw error
  })

  if (!file) {
    throw new Error(`memory worker is already running: ${lockPath}`)
  }

  try {
    await file.write(`${JSON.stringify(owner)}\n`, 0, 'utf8')
  } finally {
    await file.close()
  }

  return {
    lockPath,
    acquired: true,
    staleRemoved,
    owner,
  }
}

export async function releaseMemoryWorkerLock(lock: MemoryWorkerLock): Promise<void> {
  if (!lock.acquired) return
  const currentOwner = await readFile(lock.lockPath, 'utf8')
    .then(raw => JSON.parse(raw) as { lockId?: unknown })
    .catch(() => undefined)
  if (currentOwner?.lockId !== lock.owner.lockId) return
  await rm(lock.lockPath, { force: true })
}

export async function getMemoryWorkerStatus(
  options: MemoryRootOptions & { now?: () => number },
): Promise<MemoryWorkerStatus> {
  const markers = await listDirtyMarkers(options)
  const checkpoints = await listDirtyCheckpoints(options)
  const consumed = new Set(checkpoints.map(checkpoint => checkpoint.dirtyId))
  const unconsumedMarkers = markers.filter(marker => !consumed.has(marker.dirtyId))
  const jobs = await listMemoryAgentJobs(options)
  const schedule = shouldScheduleMemoryAgent({
    dirtyMarkers: unconsumedMarkers,
    now: options.now,
  })

  return {
    projectId: options.projectId,
    lock: await readLockStatus(options),
    dirty: {
      total: markers.length,
      consumed: consumed.size,
      unconsumed: unconsumedMarkers.length,
    },
    schedule,
    jobs: observeMemoryAgentJobs(jobs),
    retries: observeMemoryAgentJobRetries(jobs),
  }
}

export async function runMemoryWorkerOnce(
  options: MemoryWorkerLoopOptions,
): Promise<MemoryWorkerRunOnceResult> {
  const lock = await acquireMemoryWorkerLock(options)
  try {
    await touchMemoryWorkerLock(lock)
    const retriedJobs = await retryFailedJobsForWorker(options)
    const run = await runMemoryAgentOnce(options)
    await touchMemoryWorkerLock(lock)

    return {
      ...run,
      lock,
      retriedJobs,
      run,
      finalStatus: await getUnlockedWorkerStatus(options, lock),
    }
  } finally {
    await releaseMemoryWorkerLock(lock)
  }
}

export async function runMemoryWorkerLoop(
  options: MemoryWorkerLoopOptions,
): Promise<MemoryWorkerLoopResult> {
  const intervalMs = Math.max(0, options.intervalMs ?? MEMORY_WORKER_DEFAULT_INTERVAL_MS)
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY
  const maxIdleIterations = options.maxIdleIterations ??
    MEMORY_WORKER_DEFAULT_MAX_IDLE_ITERATIONS
  const iterations: MemoryWorkerLoopIteration[] = []
  const lock = await acquireMemoryWorkerLock(options)
  let idleIterations = 0
  let stoppedReason: MemoryWorkerLoopResult['stoppedReason'] = 'max_iterations'

  try {
    for (let index = 0; index < maxIterations; index += 1) {
      await touchMemoryWorkerLock(lock)
      const retriedJobs = await retryFailedJobsForWorker(options)
      const dirtyMarkers = await listUnconsumedDirtyMarkers(options)
      const schedule = shouldScheduleMemoryAgent({
        dirtyMarkers,
        force: options.force && index === 0,
        now: options.now,
      })
      const pendingJobs = (await listLatestMemoryAgentJobs(options))
        .filter(job => job.status === 'pending')

      // W121-A item 1 — detect archive events that have no covering dirty
      // marker. When schedule/pendingJobs are both empty (archive-only or
      // dirty-missing state) the agent would otherwise never run and the
      // reconcile flow inside runMemoryAgentOnce would never fire. A
      // read-only scan here forces a run with reason=reconcile_required.
      let reconcileMissing = 0
      try {
        const report = await detectArchiveEventsMissingDirty(options)
        reconcileMissing = report.missing.length
      } catch (error) {
        // W146.2 P2-8: pre-W146.2 this catch silently set reconcileMissing
        // to 0 when the archive scan threw — disk perm errors / malformed
        // sessions / sqlite contention all looked identical to "archive
        // clean", which let dirty-missing states quietly persist across
        // worker iterations. Surface to stderr (the only logger this
        // module has — memory-sidecar deliberately avoids a logger
        // import) and redact via redactMemoryText so no archive content
        // leaks into the log line. Do NOT mutate scheduling: if the scan
        // threw, treat the run as if reconcile had no work, same as
        // before — operators can re-run worker once after fixing the
        // underlying disk/permission issue.
        const redacted = redactMemoryText(
          error instanceof Error ? error.message : String(error),
        )
        // eslint-disable-next-line no-console
        console.error('[memory-sidecar] reconcile probe failed:', redacted.text)
        reconcileMissing = 0
      }
      const reconcileRequired = reconcileMissing > 0

      if (schedule.shouldSchedule || pendingJobs.length > 0 || reconcileRequired) {
        const run = await runMemoryAgentOnce(options)
        iterations.push({
          index,
          ran: true,
          reason: runReason(schedule, pendingJobs.length, reconcileRequired),
          schedule,
          pendingJobs: pendingJobs.length,
          retriedJobs,
          run,
        })
        idleIterations = 0
      } else {
        iterations.push({
          index,
          ran: false,
          reason: 'idle',
          schedule,
          pendingJobs: 0,
          retriedJobs,
        })
        idleIterations += 1
      }

      await options.onIteration?.(iterations[iterations.length - 1])
      await touchMemoryWorkerLock(lock)
      if (idleIterations >= maxIdleIterations) {
        stoppedReason = 'max_idle_iterations'
        break
      }
      if (index + 1 < maxIterations && intervalMs > 0) {
        await sleep(intervalMs)
      }
    }

    return {
      lock,
      intervalMs,
      iterations,
      stoppedReason,
      finalStatus: await getUnlockedWorkerStatus(options, lock),
    }
  } finally {
    await releaseMemoryWorkerLock(lock)
  }
}

async function getUnlockedWorkerStatus(
  options: MemoryWorkerLoopOptions,
  lock: MemoryWorkerLock,
): Promise<MemoryWorkerStatus> {
  await releaseMemoryWorkerLock(lock)
  return getMemoryWorkerStatus(options)
}

async function retryFailedJobsForWorker(
  options: MemoryWorkerLoopOptions,
): Promise<MemoryAgentJob[]> {
  if (options.retry?.enabled === false) return []

  return retryFailedMemoryAgentJobs({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
    maxAttempts: options.retry?.maxAttempts ?? MEMORY_WORKER_DEFAULT_RETRY_MAX_ATTEMPTS,
    backoffBaseMs: options.retry?.backoffBaseMs ?? MEMORY_WORKER_DEFAULT_RETRY_BACKOFF_BASE_MS,
    maxBackoffMs: options.retry?.maxBackoffMs ?? MEMORY_WORKER_DEFAULT_RETRY_MAX_BACKOFF_MS,
    markExhausted: options.retry?.markExhausted ?? true,
  })
}

async function touchMemoryWorkerLock(lock: MemoryWorkerLock): Promise<void> {
  if (!lock.acquired) return
  const now = new Date().toISOString()
  const updated: MemoryWorkerLockOwner = {
    ...lock.owner,
    updatedAt: now,
    heartbeatAt: now,
  }
  try {
    await writeFile(lock.lockPath, `${JSON.stringify(updated)}\n`, 'utf8')
    lock.owner.updatedAt = now
    lock.owner.heartbeatAt = now
  } catch (error) {
    // W148-B: pre-W148 a transient touch failure (disk full / EACCES /
    // EROFS) propagated up and crashed the worker loop. Log and swallow:
    // the lock identity on disk is unchanged, the next iteration will
    // try to touch again, and a peer waiting for stale-lock reclaim
    // will simply see an older mtime and hit the existing TOCTOU
    // guard. Local in-memory updatedAt/heartbeatAt is intentionally
    // NOT advanced when the on-disk write failed — the next status
    // read should reflect the real on-disk mtime, not a fictitious
    // success.
    const redacted = error instanceof Error ? error.message : String(error)
    // eslint-disable-next-line no-console
    console.error(
      `[memory-sidecar] worker.lock touch failed (lock identity preserved): ${redacted}`,
    )
  }
}

function runReason(
  schedule: MemoryAgentScheduleDecision,
  pendingJobs: number,
  reconcileRequired = false,
): MemoryWorkerLoopIteration['reason'] {
  if (schedule.reasons.includes('force')) return 'forced'
  if (schedule.shouldSchedule) return 'scheduled'
  if (pendingJobs > 0) return 'pending_jobs'
  if (reconcileRequired) return 'reconcile_required'
  return 'idle'
}

async function readLockStatus(
  options: MemoryRootOptions & { now?: () => number },
): Promise<MemoryWorkerStatus['lock']> {
  const lockPath = getMemoryWorkerLockPath(options)
  const info = await stat(lockPath).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (!info) {
    return { path: lockPath, held: false, stale: false }
  }

  const nowMs = options.now?.() ?? Date.now()
  const owner = await readFile(lockPath, 'utf8')
    .then(raw => JSON.parse(raw) as unknown)
    .catch(() => undefined)
  const updatedAt = owner && typeof owner === 'object' && 'updatedAt' in owner &&
    typeof owner.updatedAt === 'string'
    ? Date.parse(owner.updatedAt)
    : info.mtimeMs
  const ageMs = Math.max(0, nowMs - updatedAt)

  // W121-A item 2 — extract pid/hostname/heartbeatAt with type guards
  const ownerPid = owner && typeof owner === 'object' && 'pid' in owner &&
    typeof owner.pid === 'number'
    ? owner.pid
    : undefined
  const ownerHostname = owner && typeof owner === 'object' && 'hostname' in owner &&
    typeof owner.hostname === 'string'
    ? owner.hostname
    : undefined
  const ownerHeartbeatAt = owner && typeof owner === 'object' && 'heartbeatAt' in owner &&
    typeof owner.heartbeatAt === 'string'
    ? owner.heartbeatAt
    : undefined

  const sameHost = ownerHostname !== undefined ? ownerHostname === hostname() : false
  let pidAlive: boolean | undefined
  let pidDead: boolean | undefined
  if (sameHost === true && typeof ownerPid === 'number') {
    const alive = isProcessAlive(ownerPid)
    pidAlive = alive
    pidDead = !alive
  }

  const mtimeStale = ageMs >= MEMORY_WORKER_LOCK_STALE_MS
  let staleReason: 'mtime' | 'dead_pid' | 'none'
  if (pidDead === true) {
    staleReason = 'dead_pid'
  } else if (mtimeStale) {
    staleReason = 'mtime'
  } else {
    staleReason = 'none'
  }

  // W148-B: signal corrupt-lock state so doctor can warn without us
  // auto-reclaiming. The lock exists on disk (info != null) but
  // readLockOwnerSafe returned undefined OR returned an object with
  // no recoverable lockId. Either way the W146.4 P1-1 guard prevents
  // safe reclaim, so the operator needs to inspect.
  const ownerLockId = owner && typeof owner === 'object' && 'lockId' in owner &&
    typeof owner.lockId === 'string'
    ? owner.lockId
    : undefined
  const corruptLock = owner === undefined ||
    (typeof ownerLockId !== 'string' || ownerLockId.length === 0)

  return {
    path: lockPath,
    held: true,
    stale: staleReason !== 'none',
    owner,
    ageMs,
    pid: ownerPid,
    hostname: ownerHostname,
    heartbeatAt: ownerHeartbeatAt,
    sameHost,
    pidAlive,
    pidDead,
    staleReason,
    corruptLock,
  }
}

async function removeStaleLockIfNeeded(
  lockPath: string,
  staleMs = MEMORY_WORKER_LOCK_STALE_MS,
): Promise<boolean> {
  const info = await stat(lockPath).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (!info) return false

  // W120 M3: prefer PID-based liveness on the same host. If the lock was
  // written by a process on this host and that PID is no longer alive,
  // reclaim immediately without waiting for the mtime grace window. If the
  // PID IS alive, never steal the lock — even after staleMs elapses, the
  // process may simply be in a long-running job. mtime fallback only
  // applies when hostname differs or pid information is missing.
  const owner = await readLockOwnerSafe(lockPath)
  const sameHost = owner?.hostname === hostname()
  if (sameHost && typeof owner?.pid === 'number' && owner.pid > 0) {
    if (isProcessAlive(owner.pid)) {
      return false
    }
    // W146.4 P1-1: TOCTOU guard. Between the readLockOwnerSafe above and
    // the on-disk delete inside reclaimStaleLock, the OS may recycle the
    // dead PID and a fresh worker on this host (or a parallel `mossen`
    // invocation) may overwrite the lock file with its own owner record.
    // Re-read and lockId-compare before deleting so we never reclaim a
    // lock that already belongs to someone else. Missing/changed lockId
    // => refuse to reclaim, return false; the next iteration will re-
    // evaluate.
    if (!(await sameLockIdStillPresent(lockPath, owner.lockId))) {
      return false
    }
    await reclaimStaleLock(lockPath)
    return true
  }

  if (Date.now() - info.mtimeMs < staleMs) return false

  // W146.4 P1-1: same TOCTOU guard for the cross-host / missing-pid path.
  // mtime alone says "this lock is old"; before we delete it, confirm
  // the on-disk lockId still matches what we just observed. Otherwise
  // a lock that was just rewritten by a peer would be wrongly reclaimed.
  if (!(await sameLockIdStillPresent(lockPath, owner?.lockId))) {
    return false
  }

  await reclaimStaleLock(lockPath)
  return true
}

/**
 * W146.4 P1-1: re-read the lock file and confirm `lockId` still matches
 * the value observed earlier. Returns false if the lock is gone, the
 * file is unreadable/unparseable, or the lockId differs (e.g. a peer
 * rewrote the lock between the two reads). Returns true only when both
 * snapshots show the same non-empty lockId.
 */
async function sameLockIdStillPresent(
  lockPath: string,
  expectedLockId: string | undefined,
): Promise<boolean> {
  if (typeof expectedLockId !== 'string' || expectedLockId.length === 0) {
    return false
  }
  const owner = await readLockOwnerSafe(lockPath)
  return typeof owner?.lockId === 'string' && owner.lockId === expectedLockId
}

async function readLockOwnerSafe(lockPath: string): Promise<Partial<MemoryWorkerLockOwner> | undefined> {
  return readFile(lockPath, 'utf8')
    .then(raw => {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as Partial<MemoryWorkerLockOwner>
      }
      return undefined
    })
    .catch(() => undefined)
}

async function reclaimStaleLock(lockPath: string): Promise<void> {
  await rm(lockPath, { force: true })
  await writeFile(`${lockPath}.stale-removed`, `${new Date().toISOString()}\n`, 'utf8')
    .catch(() => undefined)
}

/**
 * W120 M3: POSIX `kill(pid, 0)` is a no-op signal that returns 0 if the
 * process exists and we have permission to signal it; ESRCH means the
 * process is gone; EPERM means it exists but is owned by another user
 * (still alive — do not reclaim). Any other error is treated as alive
 * (be conservative; we'd rather wait for mtime fallback than steal a
 * lock from a running worker).
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ESRCH') return false
    return true
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
