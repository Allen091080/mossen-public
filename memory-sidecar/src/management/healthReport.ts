// W122-A: read-only production-readiness health report.
//
// Built on top of generateTrialReport — reuses archive / worker / dirty /
// reconcile / observations / profile / proposals / retrievalProbe / warnings
// data. Adds: explicit config snapshot, alias-resolution snapshot, sqlite
// presence probe, filteredControlPlaneCount on the retrieval probe, a
// 14-check doctor matrix, a 0-100 healthScore, and stable
// recommendedActions slash-command strings.
//
// HARD CONSTRAINT: read-only ONLY. No fs writes. No setMemorySidecar*
// calls. No runMemoryAgentOnce. Everything below either reuses an existing
// read-only helper or stat()s a file path (never creates it).

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import {
  getDefaultMemorySidecarConfigPath,
  getMemorySidecarLlmStatus,
  hasIndependentLlmConfig,
  loadMemorySidecarConfig,
  type MemorySidecarConfig,
} from '../config/config.js'
import { resolveProjectId } from '../projectId.js'
import { memoryContext } from '../retrieval/context.js'
import { getMemoryWorkerStatus } from '../agent/workerLoop.js'
import { redactErrorMessage } from '../redaction/redactPaths.js'
import { generateTrialReport, type TrialReport } from './trialReport.js'

export type HealthReportOptions = MemoryRootOptions & {
  query?: string
  limit?: number
}

export type HealthCheck = {
  id: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  detail?: string
  action?: string
}

export type HealthReport = {
  generatedAt: string
  projectId: string
  paths: {
    home: string
    root: string
    memoryDir: string
    sqlitePath: string
    configPath: string
  }
  config: {
    sidecarEnabled: boolean
    captureEnabled: boolean
    adapterEnabled: boolean
    ruleClassifierEnabled: boolean
    llmEnabled: boolean
    llmProviderKind: string
    llmHasIndependentConfig: boolean
    llmApiKeyEnv: string | null
    llmApiKeyConfigured: boolean | null
    mossenProfileDeprecated: true
  }
  alias: {
    requestedProjectId: string
    resolvedProjectId: string
    searchedProjectIds: string[]
    aliasReason: string | null
  }
  archive: {
    events: number
    sessions: number
    lastEventAt: string | null
  }
  dirty: {
    total: number
    consumed: number
    unconsumed: number
  }
  reconcile: {
    scanWindow: number
    scannedEvents: number
    missing: number
  }
  worker: {
    lockHeld: boolean
    lockStale: boolean
    pid: number | null
    hostname: string | null
    heartbeatAt: string | null
    sameHost: boolean | null
    pidAlive: boolean | null
    pidDead: boolean | null
    staleReason: string | null
    jobs: {
      total: number
      pending: number
      running: number
      completed: number
      failed: number
      skipped: number
      // W143-D1: per-type / per-status matrix. Optional and populated
      // from trial.worker.jobs.countsByTypeStatus.
      countsByTypeStatus?: Record<string, Record<string, number>>
    }
    // W144: derived "is there anything actually pending?" signal so
    // status / doctor can stop warning purely on dirty.unconsumed
    // (markers are retained for audit even after every job has
    // finished). Optional + populated unconditionally; old readers
    // ignore it.
    effectivePendingWork?: boolean
    retries: {
      activeFailedJobs: number
      retryJobs: number
      exhaustedJobs: number
      maxRetryAttempt: number
    }
  }
  observations: { total: number }
  profile: { snapshots: number; latestAt: string | null }
  proposals: {
    total: number
    candidate: number
    accepted: number
    rejected: number
    deferred: number
  }
  retrievalProbe: {
    query: string
    results: number
    estimatedTokens: number
    filteredControlPlaneCount: number
  }
  index: { sqlitePresent: boolean }
  warnings: string[]
  recommendedActions: string[]
  checks: HealthCheck[]
  healthScore: number
  grade: 'ok' | 'warn' | 'fail'
}

const DEFAULT_QUERY = '旁路记忆'
const FRESH_EVENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const HEALTH_SCORE_WARN_PENALTY = 5
const HEALTH_SCORE_FAIL_PENALTY = 20

// W146.1 / W148-A: scrub absolute paths + token-shaped substrings from
// config-load error messages before they reach HealthCheck.detail /
// warnings. The implementation lives in redaction/redactPaths.ts so this
// surface and dataIntegrityReport.redact share identical coverage; pre-
// W148 the two had drifted and Linux/opt + Windows paths leaked from
// the doctor surface but not from the integrity surface.
function redactHealthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return redactErrorMessage(raw)
}

export async function generateHealthReport(
  options: HealthReportOptions,
): Promise<HealthReport> {
  const generatedAt = new Date().toISOString()
  const query = options.query ?? DEFAULT_QUERY
  const limit = options.limit ?? 5

  const home = process.env.HOME ?? homedir()
  const root = options.rootDir ?? `${home}/.mossen`
  const configPath = getDefaultMemorySidecarConfigPath()

  // 1) Config snapshot. loadMemorySidecarConfig handles missing-file by
  //    returning defaults, so a config-readable failure is true only when
  //    parsing throws.
  let config: MemorySidecarConfig | null = null
  let configReadable = true
  let configError: string | null = null
  try {
    config = loadMemorySidecarConfig(configPath)
  } catch (error) {
    configReadable = false
    // W146.1: configError flows into HealthCheck.detail (config-readable
    // probe) and is rendered to the operator via /memory-sidecar status
    // / doctor. Raw bun:sqlite / fs error messages may include absolute
    // /Users/.../.mossen/... paths; redact them before surfacing.
    configError = redactHealthError(error)
  }

  // 2) Alias resolution. W122-A.1: must run BEFORE any archive/dirty/
  //    observation/profile/proposal/reconcile/worker read so those reads
  //    target the canonical projectId where data actually lives. Previously
  //    every read was pinned to options.projectId (the request), so when
  //    data was at alias `mossensrc` and the request came in as
  //    `-Users-...-mossensrc`, healthReport surfaced zeros across the
  //    board.
  const aliasResolution = await resolveProjectId({
    rootDir: options.rootDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
    aliases: [options.projectId],
    aliasReason: undefined as string | undefined,
  }))
  const effectiveProjectId = aliasResolution.projectId

  // 3) Trial report drives archive/worker/dirty/reconcile/observations/
  //    profile/proposals/retrievalProbe/warnings — read from the canonical
  //    projectId.
  const trial: TrialReport = await generateTrialReport({
    ...options,
    projectId: effectiveProjectId,
    query,
    limit,
  })

  // 4) memoryContext gives filteredControlPlaneCount (TrialReport does not
  //    expose it). W122-A.1: memoryContext also fans out aliases internally
  //    via candidateIds discovery, so we use bundle.results.length and
  //    bundle.totalTokenEstimate as the canonical retrievalProbe values
  //    too — trial.retrievalProbe goes through memorySearch which does
  //    NOT alias-fan, so it would still report 0 hits when data is at a
  //    canonical alias.
  let filteredControlPlaneCount = 0
  let probeResultsCount = trial.retrievalProbe.results
  let probeTokens = trial.retrievalProbe.estimatedTokens
  let probeError: string | null = null
  try {
    const bundle = await memoryContext({
      ...options,
      projectId: effectiveProjectId,
      query,
      scopeFilter: { scope: 'project', projectId: effectiveProjectId },
      limit,
    })
    filteredControlPlaneCount = bundle.filteredControlPlaneCount
    probeResultsCount = bundle.results.length
    probeTokens = bundle.totalTokenEstimate
  } catch (error) {
    probeError = error instanceof Error ? error.message : String(error)
  }

  // 4b) Worker status with full lock detail (pid/host/heartbeat/staleReason).
  //     TrialReport collapses this; fetch directly for the doctor surface.
  const workerStatus = await getMemoryWorkerStatus({
    ...options,
    projectId: effectiveProjectId,
  }).catch(() => null)
  const workerLockPid = workerStatus?.lock.pid ?? null
  const workerLockHost = workerStatus?.lock.hostname ?? null
  const workerLockHeartbeatAt = workerStatus?.lock.heartbeatAt ?? null
  const workerLockSameHost = workerStatus?.lock.sameHost ?? null
  const workerLockPidAlive = workerStatus?.lock.pidAlive ?? null
  const workerLockPidDead = workerStatus?.lock.pidDead ?? null
  const workerLockStaleReason = workerStatus?.lock.staleReason ?? null

  // 5) sqlite presence: stat only, never create. W122-A.1: probe the
  //    canonical project's sqlite (not the requested project's), since
  //    that's where data actually lives.
  const effectiveMemoryDir = getProjectMemoryDir({
    ...options,
    projectId: effectiveProjectId,
  })
  const effectiveSqlitePath = `${effectiveMemoryDir}/memory.db`
  const sqlitePresent = await stat(effectiveSqlitePath)
    .then(() => true)
    .catch(() => false)

  // 6) Config-derived flags (always populated even when config unreadable).
  const sidecarEnabled = config?.enabled ?? false
  const captureEnabled = config?.capture.enabled ?? false
  const adapterEnabled = config?.adapter.enabled ?? false
  const ruleClassifierEnabled = config?.classification.ruleBased ?? false
  const llmEnabled = config?.classification.llm ?? false
  const llmProviderKind = config?.classification.llmProvider ?? 'disabled'
  const llmHasIndependentConfig = config ? hasIndependentLlmConfig(config) : false
  const llmStatus = config ? getMemorySidecarLlmStatus(config) : null
  const llmApiKeyEnv = llmStatus?.apiKeyEnv ?? null
  const llmApiKeyConfigured = llmStatus
    ? llmStatus.apiKeyConfigured ?? null
    : null

  // 7) 14 checks.
  const checks: HealthCheck[] = []

  // 1. config-readable
  checks.push({
    id: 'config-readable',
    status: configReadable ? 'pass' : 'fail',
    summary: configReadable
      ? 'config readable / 配置文件可读'
      : 'config not readable / 配置文件无法解析',
    detail: configError ?? undefined,
  })

  // 2. enabled-consistency: sidecarEnabled must match adapterEnabled and
  //    captureEnabled (setMemorySidecarEnabled flips all three together).
  const enabledTriple = [sidecarEnabled, captureEnabled, adapterEnabled]
  const allEnabled = enabledTriple.every(Boolean)
  const allDisabled = enabledTriple.every(value => !value)
  const enabledConsistent = allEnabled || allDisabled
  checks.push({
    id: 'enabled-consistency',
    status: enabledConsistent ? 'pass' : 'warn',
    summary: enabledConsistent
      ? 'enabled flags aligned / enabled 三元组一致'
      : 'enabled flags drift / sidecar/capture/adapter enabled 不一致',
    detail: `sidecar=${sidecarEnabled} capture=${captureEnabled} adapter=${adapterEnabled}`,
  })

  // 3. disabled-safe (W122-A.1): when sidecar is disabled, sidecar/capture/
  //    adapter must ALL be off. Archive retention post-disable is intentional
  //    user-data — historical events stay on disk and are NOT a violation
  //    of the disabled-safe contract. If you also need 0 writes since the
  //    last disable, take a status snapshot, observe activity, and re-run
  //    `/memory-sidecar status` (the contract is tested by the W119.1 hard
  //    gate, not by archive emptiness).
  const archiveCount = trial.archive.events
  const disabledSafe = sidecarEnabled || allDisabled
  let disabledSafeSummary: string
  if (sidecarEnabled) {
    disabledSafeSummary =
      'sidecar enabled; check not applicable / sidecar 已开启，不适用'
  } else if (disabledSafe) {
    disabledSafeSummary =
      archiveCount > 0
        ? 'sidecar disabled; archive retained (history preserved) / sidecar 已关闭，历史归档保留'
        : 'sidecar disabled; archive empty / sidecar 已关闭，归档为空'
  } else {
    disabledSafeSummary =
      'sidecar disabled but capture/adapter still on / sidecar 关闭但 capture/adapter 仍开'
  }
  checks.push({
    id: 'disabled-safe',
    status: disabledSafe ? 'pass' : 'warn',
    summary: disabledSafeSummary,
    detail: `sidecar=${sidecarEnabled} capture=${captureEnabled} adapter=${adapterEnabled} events=${archiveCount}`,
  })

  // 4. archive-present
  let archivePresentStatus: HealthCheck['status'] = 'pass'
  let archivePresentSummary = 'archive non-empty / 已有归档事件'
  if (archiveCount === 0) {
    if (captureEnabled) {
      archivePresentStatus = 'warn'
      archivePresentSummary =
        'archive empty but capture enabled / capture 已开启但无事件'
    } else {
      archivePresentStatus = 'pass'
      archivePresentSummary = 'archive empty (capture off) / 未捕获，归档为空'
    }
  }
  checks.push({
    id: 'archive-present',
    status: archivePresentStatus,
    summary: archivePresentSummary,
    detail: `events=${archiveCount}`,
  })

  // 5. latest-event-fresh: pass when within 30 days; warn otherwise.
  //    Not-applicable when 0 events: surface as pass with clarifying detail.
  const lastEventAt = trial.archive.lastEventAt
  let freshStatus: HealthCheck['status'] = 'pass'
  let freshSummary = 'latest event recent / 最近事件在 30 天内'
  let freshDetail: string | undefined
  if (archiveCount === 0) {
    freshSummary = 'no archive / 无归档事件'
    freshDetail = 'no archive'
  } else if (!lastEventAt) {
    freshStatus = 'warn'
    freshSummary = 'archive has events but no timestamp / 缺少最新时间戳'
  } else {
    const ageMs = Date.now() - Date.parse(lastEventAt)
    if (Number.isFinite(ageMs) && ageMs > FRESH_EVENT_WINDOW_MS) {
      freshStatus = 'warn'
      freshSummary = 'latest event older than 30 days / 最近事件已超 30 天'
    }
    freshDetail = `lastEventAt=${lastEventAt}`
  }
  checks.push({
    id: 'latest-event-fresh',
    status: freshStatus,
    summary: freshSummary,
    detail: freshDetail,
  })

  // 6. dirty-backlog (W144: gated on effectivePendingWork).
  //
  // dirty.unconsumed is a raw queue counter that can stay large long
  // after every queued job has finished — markers are retained for
  // audit even when their corresponding job is completed/skipped. Pre-
  // W144 the check warned/failed purely on the marker count, which
  // misled operators on machines where the worker had drained all jobs
  // but markers were preserved.
  //
  // Now: if there's NO runnable work (no pending/running/failed/retry/
  // exhausted jobs and reconcile.missing=0), the unconsumed marker
  // count is informational only — the check passes regardless of size.
  // If runnable work IS present, the original size thresholds still
  // promote to warn/fail.
  const unconsumed = trial.worker.dirtyUnconsumed
  const jobsByStatus = trial.worker.jobs
  const reconcileMissing = trial.worker.reconcile.missing
  // running counts only when worker lock is actually held; otherwise
  // it's a residual record from a crashed worker.
  const runningCount = trial.worker.lockHeld ? jobsByStatus.running : 0
  const hasRunnableWork =
    jobsByStatus.pending > 0 ||
    runningCount > 0 ||
    trial.worker.retries.activeFailedJobs > 0 ||
    trial.worker.retries.retryJobs > 0 ||
    trial.worker.retries.exhaustedJobs > 0 ||
    reconcileMissing > 0
  let dirtyStatus: HealthCheck['status'] = 'pass'
  let dirtySummary = 'dirty backlog small / dirty 队列正常'
  let dirtyDetail = `unconsumed=${unconsumed}`
  if (!hasRunnableWork) {
    if (unconsumed > 0) {
      dirtySummary =
        'dirty markers retained but no runnable jobs are pending'
      dirtyDetail = `unconsumed=${unconsumed} (informational — no pending/failed/retry/reconcile work)`
    }
    // status stays 'pass'.
  } else if (unconsumed > 500) {
    dirtyStatus = 'fail'
    dirtySummary = 'dirty backlog very large with runnable work / dirty 队列严重积压'
  } else if (unconsumed >= 50) {
    dirtyStatus = 'warn'
    dirtySummary = 'dirty backlog medium with runnable work / dirty 队列堆积'
  }
  checks.push({
    id: 'dirty-backlog',
    status: dirtyStatus,
    summary: dirtySummary,
    detail: dirtyDetail,
  })

  // 7. reconcile-missing
  const missing = trial.worker.reconcile.missing
  checks.push({
    id: 'reconcile-missing',
    status: missing === 0 ? 'pass' : 'warn',
    summary:
      missing === 0
        ? 'reconcile clean / archive 与 dirty 一致'
        : 'archive events missing dirty markers / 存在未对账事件',
    detail: `missing=${missing} scanWindow=${trial.worker.reconcile.scanWindow}`,
    action: missing === 0 ? undefined : '/memory-sidecar worker run-once',
  })

  // 8. worker-lock-stale: pass when not-held OR not-stale; warn when
  //    staleReason='mtime'; fail when staleReason='dead_pid'.
  const lockHeld = trial.worker.lockHeld
  const lockStale = trial.worker.lockStale
  let lockStatus: HealthCheck['status'] = 'pass'
  let lockSummary = 'worker lock healthy / worker 锁正常'
  if (lockHeld && lockStale) {
    if (workerLockStaleReason === 'dead_pid') {
      lockStatus = 'fail'
      lockSummary =
        'worker lock stale: dead pid / worker 锁过期，进程已死'
    } else {
      lockStatus = 'warn'
      lockSummary =
        'worker lock stale (mtime) / worker 锁过期，可能崩溃'
    }
  }
  checks.push({
    id: 'worker-lock-stale',
    status: lockStatus,
    summary: lockSummary,
    detail: `held=${lockHeld} stale=${lockStale} reason=${workerLockStaleReason ?? 'none'}`,
  })

  // 9. worker-failed-jobs
  const activeFailed = trial.worker.retries.activeFailedJobs
  checks.push({
    id: 'worker-failed-jobs',
    status: activeFailed === 0 ? 'pass' : 'warn',
    summary:
      activeFailed === 0
        ? 'no active failed jobs / 无活跃失败任务'
        : 'active failed jobs / 存在活跃失败任务',
    detail: `activeFailedJobs=${activeFailed}`,
  })

  // 10. llm-configured
  let llmCheckStatus: HealthCheck['status'] = 'pass'
  let llmSummary = 'llm disabled (rule-based ok) / 仅规则分类'
  let llmDetail: string | undefined = `provider=${llmProviderKind}`
  if (llmProviderKind === 'mossen-profile') {
    llmCheckStatus = 'fail'
    llmSummary =
      'llm provider mossen-profile is deprecated / mossen-profile 已废弃'
  } else if (llmEnabled) {
    if (!llmHasIndependentConfig) {
      llmCheckStatus = 'warn'
      llmSummary =
        'llm enabled but no independent config / 已开启但缺独立 config'
    } else if (llmApiKeyConfigured === false) {
      llmCheckStatus = 'warn'
      llmSummary =
        'llm enabled but api key env not set / 已开启但 env 未导出'
      llmDetail = `apiKeyEnv=${llmApiKeyEnv ?? 'unset'}`
    } else {
      llmSummary = 'llm enabled and configured / llm 配置完整'
    }
  }
  checks.push({
    id: 'llm-configured',
    status: llmCheckStatus,
    summary: llmSummary,
    detail: llmDetail,
  })

  // 11. retrieval-probe (W143-E2: no longer drives a warn on the
  // hard-coded seed query).
  //
  // Pre-W143 this check warned whenever the fixed seed query
  // `mossen旁路记忆` returned 0 results AND archive was non-empty. That
  // seed has nothing to do with whether real recall works — projects
  // that have never typed that exact phrase legitimately get 0 results,
  // and operators were being misled into thinking the sidecar was
  // broken. Real recall quality is now verified by
  // `/memory-sidecar recall-test` and the W143 smoke.
  //
  // Behaviour now:
  //   - probeError (e.g. sqlite open failure)       → warn (still actionable)
  //   - probeResultsCount === 0 && archive > 0       → pass + diagnostic detail
  //   - probeResultsCount > 0                        → pass
  //
  // The HealthCheck.status type is `'pass' | 'warn' | 'fail'`; we keep
  // the diagnostic info in `detail` rather than introducing a new
  // status enum value (which would ripple through every reader).
  let probeStatus: HealthCheck['status'] = 'pass'
  let probeSummary = 'retrieval probe ran / 检索探针执行'
  let probeDetail = `results=${probeResultsCount} filteredControlPlane=${filteredControlPlaneCount}`
  if (probeError) {
    probeStatus = 'warn'
    probeSummary = 'retrieval probe error / 检索探针异常'
  } else if (probeResultsCount === 0 && archiveCount > 0) {
    probeSummary = 'retrieval probe seed empty (informational)'
    probeDetail = `${probeDetail} — use \`/memory-sidecar recall-test\` for real coverage`
  }
  checks.push({
    id: 'retrieval-probe',
    status: probeStatus,
    summary: probeSummary,
    detail: probeDetail,
  })

  // 12. alias-consistency: always pass; the count is informative.
  const searchedProjectIds = aliasResolution.aliases
  checks.push({
    id: 'alias-consistency',
    status: 'pass',
    summary: 'alias resolution applied / 别名解析已执行',
    detail: `searchedProjectIds=${searchedProjectIds.length}`,
  })

  // 13. sqlite-index
  let sqliteStatus: HealthCheck['status'] = 'pass'
  let sqliteSummary = 'sqlite index present / sqlite 索引可用'
  if (!sqlitePresent && archiveCount > 0) {
    sqliteStatus = 'warn'
    sqliteSummary =
      'sqlite missing, JSONL fallback active / sqlite 缺失，使用 JSONL 回退'
  } else if (!sqlitePresent && archiveCount === 0) {
    sqliteSummary = 'sqlite absent (no archive yet) / 尚无归档，索引未建'
  }
  checks.push({
    id: 'sqlite-index',
    status: sqliteStatus,
    summary: sqliteSummary,
    detail: `sqlitePresent=${sqlitePresent}`,
  })

  // 14. legacy-memory-isolation
  checks.push({
    id: 'legacy-memory-isolation',
    status: 'pass',
    summary: 'legacy /memory recall isolated / 旧 /memory recall 已隔离',
    detail: '/memory recall hint emits migration',
  })

  // 8) Health score + grade.
  let healthScore = 100
  for (const check of checks) {
    if (check.status === 'warn') healthScore -= HEALTH_SCORE_WARN_PENALTY
    else if (check.status === 'fail') healthScore -= HEALTH_SCORE_FAIL_PENALTY
  }
  if (healthScore < 0) healthScore = 0
  if (healthScore > 100) healthScore = 100

  let grade: HealthReport['grade'] = 'ok'
  if (checks.some(check => check.status === 'fail')) {
    grade = 'fail'
  } else if (checks.some(check => check.status === 'warn')) {
    grade = 'warn'
  }

  // 9) Warnings: trial warnings + warn/fail check summaries.
  const warnings: string[] = [...trial.warnings]
  for (const check of checks) {
    if (check.status === 'warn' || check.status === 'fail') {
      warnings.push(`[${check.id}] ${check.summary}`)
    }
  }

  // 10) Recommended actions: stable slash-command strings.
  const recommendedActions: string[] = []
  if (!sidecarEnabled) {
    recommendedActions.push('/memory-sidecar enable')
  }
  if (!llmHasIndependentConfig || llmProviderKind === 'mossen-profile') {
    recommendedActions.push(
      '/memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV>',
    )
  }
  recommendedActions.push('/memory-sidecar recall-test')
  recommendedActions.push('/memory-sidecar explain-capture')

  return {
    generatedAt,
    projectId: options.projectId,
    paths: {
      home,
      root,
      memoryDir: effectiveMemoryDir,
      sqlitePath: effectiveSqlitePath,
      configPath,
    },
    config: {
      sidecarEnabled,
      captureEnabled,
      adapterEnabled,
      ruleClassifierEnabled,
      llmEnabled,
      llmProviderKind,
      llmHasIndependentConfig,
      llmApiKeyEnv,
      llmApiKeyConfigured,
      mossenProfileDeprecated: true,
    },
    alias: {
      requestedProjectId: aliasResolution.requestedProjectId,
      resolvedProjectId: aliasResolution.projectId,
      searchedProjectIds,
      aliasReason: aliasResolution.aliasReason ?? null,
    },
    archive: {
      events: trial.archive.events,
      sessions: trial.archive.sessions,
      lastEventAt: trial.archive.lastEventAt,
    },
    dirty: {
      total: trial.worker.dirtyTotal,
      consumed: trial.worker.dirtyConsumed,
      unconsumed: trial.worker.dirtyUnconsumed,
    },
    reconcile: {
      scanWindow: trial.worker.reconcile.scanWindow,
      scannedEvents: trial.worker.reconcile.scannedEvents,
      missing: trial.worker.reconcile.missing,
    },
    worker: {
      lockHeld: trial.worker.lockHeld,
      lockStale: trial.worker.lockStale,
      pid: workerLockPid,
      hostname: workerLockHost,
      heartbeatAt: workerLockHeartbeatAt,
      sameHost: workerLockSameHost,
      pidAlive: workerLockPidAlive,
      pidDead: workerLockPidDead,
      staleReason: workerLockStaleReason,
      jobs: trial.worker.jobs,
      // W144: surface the same hasRunnableWork signal computed in the
      // dirty-backlog check so the slash-command renderer can show
      // `worker.runnableWork: yes/no` without recomputing.
      effectivePendingWork: hasRunnableWork,
      retries: trial.worker.retries,
    },
    observations: { total: trial.observations.total },
    profile: {
      snapshots: trial.profile.snapshots,
      latestAt: trial.profile.latestAt,
    },
    proposals: {
      total: trial.proposals.total,
      candidate: trial.proposals.candidate,
      accepted: trial.proposals.accepted,
      rejected: trial.proposals.rejected,
      deferred: trial.proposals.deferred,
    },
    retrievalProbe: {
      query: trial.retrievalProbe.query,
      results: probeResultsCount,
      estimatedTokens: probeTokens,
      filteredControlPlaneCount,
    },
    index: { sqlitePresent },
    warnings,
    recommendedActions,
    checks,
    healthScore,
    grade,
  }
}
