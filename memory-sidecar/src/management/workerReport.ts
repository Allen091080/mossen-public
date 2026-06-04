// W122-B Agent C: read-only worker status production report.
//
// Wraps getMemoryWorkerStatus + jobQueue aggregation + reconcile cache to
// produce a fixed-shape worker report with bilingual warnings and stable
// recommendedActions slash-command strings. NEVER mutates state — no
// archive writes, no run-once invocation, no setMemorySidecar* calls.
//
// HARD CONSTRAINT: 100% read-only. Every external probe is wrapped in
// try/catch. Sub-probe failures degrade to fallback values + warning, never
// throw out of generateWorkerReport.

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import { getMemoryWorkerStatus } from '../agent/workerLoop.js'
import {
  listLatestMemoryAgentJobs,
  observeMemoryAgentJobRetries,
  type MemoryAgentJob,
  type MemoryAgentJobStatus,
} from '../agent/jobQueue.js'
import { detectArchiveEventsMissingDirty } from '../agent/reconcile.js'
import { redactMemoryText } from '../redaction/redact.js'

export type WorkerReportLockStaleReason = 'dead_pid' | 'mtime' | 'none'

export type WorkerReportLastJob = {
  id: string
  type: string
  finishedAt: string
} | null

export type WorkerReportLastFailedJob = {
  id: string
  type: string
  errorClass: string
  redactedMessage: string
  finishedAt: string
} | null

export type WorkerReport = {
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  dirty: { total: number; consumed: number; unconsumed: number }
  reconcile: { scanWindow: number; scannedEvents: number; missing: number }
  lock: {
    held: boolean
    stale: boolean
    pid: number | null
    hostname: string | null
    heartbeatAt: string | null
    sameHost: boolean | null
    pidAlive: boolean | null
    pidDead: boolean | null
    staleReason: WorkerReportLockStaleReason | null
    lockPath: string
  }
  jobs: {
    byStatus: {
      pending: number
      running: number
      completed: number
      failed: number
      skipped: number
    }
    byType: Record<string, number>
    activeFailed: number
    retryJobs: number
    exhaustedJobs: number
  }
  lastCompleted: WorkerReportLastJob
  lastFailed: WorkerReportLastFailedJob
  // W144: dirty.unconsumed is a raw queue counter and can stay positive
  // long after every queued job has finished (jobs are dedup'd, marked
  // skipped/completed, but the marker file is retained for audit).
  // effectivePendingWork is the real "does the user need to do
  // something?" signal. true when ANY of:
  //   - jobs.pending > 0
  //   - jobs.running > 0   (and lock is still held; otherwise it's a
  //     residual record — see effectivePendingWork derivation)
  //   - activeFailed > 0
  //   - retryJobs > 0
  //   - exhaustedJobs > 0
  //   - reconcile.missing > 0
  // Optional so older readers that ignore it still work.
  effectivePendingWork?: boolean
  recommendedActions: string[]
  warnings: string[]
}

const REDACTED_MESSAGE_MAX_LEN = 200
const DIRTY_BACKLOG_WARN_THRESHOLD = 50

export async function generateWorkerReport(
  options: MemoryRootOptions,
): Promise<WorkerReport> {
  const generatedAt = new Date().toISOString()
  const warnings: string[] = []

  // 1) Resolve canonical projectId so all downstream reads target the
  //    project alias where data actually lives.
  const aliasResolution = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
    aliases: [options.projectId],
    aliasReason: undefined as string | undefined,
  }))
  const effectiveProjectId = aliasResolution.projectId
  const effectiveOptions: MemoryRootOptions = {
    ...options,
    projectId: effectiveProjectId,
  }
  const memoryDir = getProjectMemoryDir(effectiveOptions)

  // 2) Worker status — full lock detail + dirty queue snapshot.
  const workerStatus = await getMemoryWorkerStatus(effectiveOptions).catch(
    () => null,
  )
  if (!workerStatus) {
    warnings.push(
      'worker status unavailable / 无法读取 worker 状态',
    )
  }

  const dirtyTotal = workerStatus?.dirty.total ?? 0
  const dirtyConsumed = workerStatus?.dirty.consumed ?? 0
  const dirtyUnconsumed = workerStatus?.dirty.unconsumed ?? 0

  const lockHeld = workerStatus?.lock.held ?? false
  const lockStale = workerStatus?.lock.stale ?? false
  const lockPath =
    workerStatus?.lock.path ?? `${memoryDir}/agent/worker.lock`
  const lockPid = workerStatus?.lock.pid ?? null
  const lockHostname = workerStatus?.lock.hostname ?? null
  const lockHeartbeatAt = workerStatus?.lock.heartbeatAt ?? null
  const lockSameHost = workerStatus?.lock.sameHost ?? null
  const lockPidAlive = workerStatus?.lock.pidAlive ?? null
  const lockPidDead = workerStatus?.lock.pidDead ?? null
  const lockStaleReason: WorkerReportLockStaleReason | null =
    workerStatus?.lock.staleReason ?? null

  // 3) Reconcile snapshot — read directly from reconcile.ts (workerStatus
  //    does not carry it). Missing means archive events without dirty
  //    markers; worker run-once will repair on next start.
  let reconcile = { scanWindow: 0, scannedEvents: 0, missing: 0 }
  try {
    const report = await detectArchiveEventsMissingDirty(effectiveOptions)
    reconcile = {
      scanWindow: report.scanWindow,
      scannedEvents: report.scannedEvents,
      missing: report.missing.length,
    }
  } catch {
    warnings.push(
      'reconcile snapshot unavailable / 无法读取 reconcile 快照',
    )
  }

  // 4) Job aggregation. listLatestMemoryAgentJobs returns the latest entry
  //    per jobId; aggregate byStatus/byType + retry counts.
  let latestJobs: MemoryAgentJob[] = []
  try {
    latestJobs = await listLatestMemoryAgentJobs(effectiveOptions)
  } catch {
    warnings.push(
      'job queue unreadable / 无法读取任务队列',
    )
  }

  const byStatus: WorkerReport['jobs']['byStatus'] = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  }
  const byType: Record<string, number> = {}
  for (const job of latestJobs) {
    if (job.status in byStatus) {
      byStatus[job.status as MemoryAgentJobStatus] += 1
    }
    byType[job.type] = (byType[job.type] ?? 0) + 1
  }

  const retryObs = observeMemoryAgentJobRetries(latestJobs)
  const activeFailed = retryObs.activeFailedJobs
  const retryJobs = retryObs.retryJobs
  const exhaustedJobs = retryObs.exhaustedJobs

  // 5) lastCompleted / lastFailed — pick max finishedAt within latest jobs.
  const lastCompleted = pickLastJob(latestJobs, 'completed')
  const lastFailed = pickLastFailedJob(latestJobs)

  // 6) Warnings derived from state.
  // W144: derive effectivePendingWork BEFORE producing warnings so the
  // dirty-backlog warning can be suppressed when nothing is actually
  // runnable. `running` only counts when the lock is held; otherwise
  // it's a residual record from a prior crashed worker that died
  // without flipping its status.
  const runningCounted = lockHeld ? byStatus.running : 0
  const hasRunnableJobs =
    byStatus.pending > 0 ||
    runningCounted > 0 ||
    activeFailed > 0 ||
    retryJobs > 0 ||
    exhaustedJobs > 0
  const hasReconcileWork = reconcile.missing > 0
  const effectivePendingWork = hasRunnableJobs || hasReconcileWork

  if (lockHeld && lockStale) {
    if (lockStaleReason === 'dead_pid') {
      warnings.push(
        'worker lock stale (dead pid) / worker 锁过期，进程已死',
      )
    } else {
      warnings.push(
        'worker lock stale / worker 锁过期',
      )
    }
  }
  // W144: only warn on dirty backlog when there is actual runnable
  // work. A retained marker count above the threshold with no pending
  // / failed / retry / exhausted jobs and no reconcile gap is just
  // historical bookkeeping and must NOT alarm the operator.
  if (dirtyUnconsumed >= DIRTY_BACKLOG_WARN_THRESHOLD && effectivePendingWork) {
    warnings.push(
      `large dirty backlog (${dirtyUnconsumed}) with runnable work / dirty 队列堆积且存在可执行任务`,
    )
  }
  if (activeFailed > 0) {
    warnings.push(
      `${activeFailed} active failed jobs / 存在活跃失败任务`,
    )
  }
  if (reconcile.missing > 0) {
    warnings.push(
      `${reconcile.missing} archive events missing dirty markers / 存在未对账事件`,
    )
  }

  // 7) Recommended actions — stable slash-command strings.
  const recommendedActions: string[] = []
  if (lockHeld && lockStale && lockStaleReason === 'dead_pid') {
    recommendedActions.push('/memory-sidecar repair')
  }
  // W144: only recommend run-once when there's something to run.
  if (
    (dirtyUnconsumed > DIRTY_BACKLOG_WARN_THRESHOLD && effectivePendingWork) ||
    hasRunnableJobs ||
    hasReconcileWork
  ) {
    if (!recommendedActions.includes('/memory-sidecar worker run-once')) {
      recommendedActions.push('/memory-sidecar worker run-once')
    }
  }
  if (activeFailed > 0) {
    recommendedActions.push('/memory-sidecar doctor')
  }
  recommendedActions.push('/memory-sidecar status')

  return {
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: effectiveProjectId,
    memoryDir,
    dirty: {
      total: dirtyTotal,
      consumed: dirtyConsumed,
      unconsumed: dirtyUnconsumed,
    },
    reconcile,
    lock: {
      held: lockHeld,
      stale: lockStale,
      pid: lockPid,
      hostname: lockHostname,
      heartbeatAt: lockHeartbeatAt,
      sameHost: lockSameHost,
      pidAlive: lockPidAlive,
      pidDead: lockPidDead,
      staleReason: lockStaleReason,
      lockPath,
    },
    jobs: {
      byStatus,
      byType,
      activeFailed,
      retryJobs,
      exhaustedJobs,
    },
    effectivePendingWork,
    lastCompleted,
    lastFailed,
    recommendedActions,
    warnings,
  }
}

function jobFinishedAt(job: MemoryAgentJob): string | undefined {
  return job.completedAt ?? job.updatedAt
}

function pickLastJob(
  jobs: MemoryAgentJob[],
  status: MemoryAgentJobStatus,
): WorkerReportLastJob {
  let best: MemoryAgentJob | undefined
  let bestTime = -Infinity
  for (const job of jobs) {
    if (job.status !== status) continue
    const finished = jobFinishedAt(job)
    if (!finished) continue
    const t = Date.parse(finished)
    if (!Number.isFinite(t)) continue
    if (t > bestTime) {
      bestTime = t
      best = job
    }
  }
  if (!best) return null
  return {
    id: best.jobId,
    type: best.type,
    finishedAt: jobFinishedAt(best) ?? '',
  }
}

function pickLastFailedJob(
  jobs: MemoryAgentJob[],
): WorkerReportLastFailedJob {
  let best: MemoryAgentJob | undefined
  let bestTime = -Infinity
  for (const job of jobs) {
    if (job.status !== 'failed') continue
    const finished = jobFinishedAt(job)
    if (!finished) continue
    const t = Date.parse(finished)
    if (!Number.isFinite(t)) continue
    if (t > bestTime) {
      bestTime = t
      best = job
    }
  }
  if (!best) return null
  const errorClass = errorClassFromJobType(best.type)
  const redacted = redactMemoryText(best.error ?? '').text
  const truncated =
    redacted.length > REDACTED_MESSAGE_MAX_LEN
      ? redacted.slice(0, REDACTED_MESSAGE_MAX_LEN)
      : redacted
  return {
    id: best.jobId,
    type: best.type,
    errorClass,
    redactedMessage: truncated,
    finishedAt: jobFinishedAt(best) ?? '',
  }
}

function errorClassFromJobType(type: string): string {
  // Naive prefix mapping: 'classify_llm' → 'classify',
  // 'synthesize_profile' → 'profile', 'detect_proposals' → 'proposal',
  // 'index_archive' → 'index'. Falls back to first underscore segment.
  if (type.startsWith('classify')) return 'classify'
  if (type.startsWith('synthesize')) return 'profile'
  if (type.startsWith('detect')) return 'proposal'
  if (type.startsWith('index')) return 'index'
  const segments = type.split('_')
  return segments[0] || 'unknown'
}
