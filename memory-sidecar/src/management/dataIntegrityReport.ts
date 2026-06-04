// W122-B Agent A: read-only data-integrity audit report.
//
// Probes 11 finding ids against the canonical project's memory dir. Every
// finding is emitted (even when status='ok') for stable assertion shape.
// HARD CONSTRAINT: read-only ONLY. No fs writes. No setMemorySidecar*.
// No appendArchiveEvent / appendDirtyMarker / appendDirtyCheckpoint /
// appendJsonlLine / runMemoryAgentOnce. Probes wrapped in try/catch — a
// single probe failure must NEVER break the whole report.

import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { Database } from 'bun:sqlite'

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import { redactErrorMessage } from '../redaction/redactPaths.js'
import { verifyArchiveStore } from '../storage/verifyRepair.js'
import {
  listArchiveSessionFilesWithGzipFallback,
  readArchiveEvents,
} from '../storage/jsonlArchiveStore.js'
import { listDirtyMarkers } from '../agent/dirtyQueue.js'
import {
  listLatestMemoryAgentJobs,
  observeMemoryAgentJobRetries,
} from '../agent/jobQueue.js'
import { getMemoryWorkerStatus } from '../agent/workerLoop.js'
import { listProposals } from '../storage/proposalStore.js'
import { listProfileSnapshots } from '../storage/profileStore.js'
import { getDefaultMemoryStoragePolicy } from './storageGovernanceReport.js'

export type DataIntegrityFindingId =
  | 'archive-corrupt-line'
  | 'archive-missing-dirty'
  | 'dirty-orphan'
  | 'sqlite-missing'
  | 'sqlite-empty'
  | 'sqlite-jsonl-mismatch'
  | 'jobs-failed-active'
  | 'jobs-exhausted'
  | 'lock-stale'
  | 'proposal-pending'
  | 'profile-redundant'

export type DataIntegrityFinding = {
  id: DataIntegrityFindingId
  status: 'ok' | 'warn' | 'fail'
  count: number
  detail?: string
  // Project-relative paths only — NEVER leak absolute paths to callers.
  // Use paths like 'archive/sessions/<sessionId>.jsonl' or 'agent/worker.lock'.
  targets?: string[]
  summary: string  // bilingual one-liner: "english / 中文"
}

export type DataIntegrityReportOptions = MemoryRootOptions

export type DataIntegrityReport = {
  generatedAt: string
  projectId: string         // requested
  resolvedProjectId: string // canonical (after resolveProjectId)
  memoryDir: string         // ABSOLUTE memory dir of canonical project
  findings: DataIntegrityFinding[]
  totals: {
    findingsTotal: number
    findingsOk: number
    findingsWarn: number
    findingsFail: number
  }
}

// W146.2 P2-5: pre-W146.2 this report used a standalone constant of 50,
// while storageGovernanceReport's policy used profileKeepLatest=20. The
// same project surfaced two different "redundant?" answers depending on
// which command the operator ran. Both surfaces now consult the W145
// policy default so they stay aligned. If the policy ever becomes
// runtime-configurable, this getter will pick that up automatically.
//
// Resolved lazily because memory-sidecar/src/index.ts is a barrel that
// re-exports both storageGovernanceReport and dataIntegrityReport;
// calling the policy getter at module-load tripped a TDZ on
// `DEFAULT_POLICY` whenever storageGovernanceReport was loaded first
// (storageGovernanceReport imports from `../index.js`, which pulled
// dataIntegrityReport in mid-load).
function profileRedundantThreshold(): number {
  return getDefaultMemoryStoragePolicy().profileKeepLatest
}

// W146.2 P2-9 / W148-A: shared with healthReport.redactHealthError via
// redaction/redactPaths.ts. Pre-W148 the two helpers had drifted and
// healthReport leaked /opt and Windows paths the integrity surface
// already stripped.
function redact(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return redactErrorMessage(raw)
}

function relPath(absPath: string, memoryDir: string): string {
  if (absPath.startsWith(`${memoryDir}/`)) {
    return absPath.slice(memoryDir.length + 1)
  }
  return absPath
}

async function listAllArchiveEventIds(
  options: MemoryRootOptions,
  memoryDir: string,
): Promise<{ eventId: string; sessionId: string }[]> {
  const sessionsDir = `${memoryDir}/archive/sessions`
  const jsonlFiles = await listArchiveSessionFilesWithGzipFallback(sessionsDir)
  const out: { eventId: string; sessionId: string }[] = []
  for (const file of jsonlFiles) {
    const sessionId = basename(file, '.jsonl')
    const events = await readArchiveEvents({ ...options, sessionId })
    for (const { event } of events) {
      out.push({ eventId: event.eventId, sessionId })
    }
  }
  return out
}

export async function generateDataIntegrityReport(
  options: DataIntegrityReportOptions,
): Promise<DataIntegrityReport> {
  const generatedAt = new Date().toISOString()

  // 1) Canonical projectId resolution. All probes must hit the resolved
  //    project's memory dir (mirrors healthReport.ts:171-180).
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
  const probeOptions: MemoryRootOptions = {
    ...options,
    projectId: effectiveProjectId,
  }
  const memoryDir = getProjectMemoryDir(probeOptions)

  const findings: DataIntegrityFinding[] = []

  // Pre-compute archive event count + per-session corrupt counts via
  // verifyArchiveStore so subsequent probes can reuse them. Wrapped in
  // try/catch — failure surfaces in the archive-corrupt-line finding only.
  let verifyOk = true
  let verifyError: string | null = null
  let archiveEventCount = 0
  let corruptByPath = new Map<string, number>()
  try {
    const verify = await verifyArchiveStore(probeOptions)
    for (const file of verify.files) {
      archiveEventCount += file.eventCount
      if (file.corruptLines.length > 0) {
        corruptByPath.set(file.jsonlPath, file.corruptLines.length)
      }
    }
  } catch (error) {
    verifyOk = false
    verifyError = redact(error)
  }

  // Probe 1: archive-corrupt-line
  try {
    if (!verifyOk) {
      findings.push({
        id: 'archive-corrupt-line',
        status: 'warn',
        count: 0,
        detail: verifyError ?? 'verify failed',
        summary: 'archive verify failed / 归档校验失败',
      })
    } else {
      const totalCorrupt = Array.from(corruptByPath.values()).reduce(
        (sum, n) => sum + n,
        0,
      )
      const targets = Array.from(corruptByPath.keys()).map(p =>
        relPath(p, memoryDir),
      )
      findings.push({
        id: 'archive-corrupt-line',
        status: totalCorrupt > 0 ? 'fail' : 'ok',
        count: totalCorrupt,
        targets: targets.length > 0 ? targets : undefined,
        summary:
          totalCorrupt > 0
            ? 'archive has corrupt lines / 归档存在损坏行'
            : 'archive lines clean / 归档行完整',
      })
    }
  } catch (error) {
    findings.push({
      id: 'archive-corrupt-line',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'archive corrupt-line probe failed / 归档损坏行探针失败',
    })
  }

  // Pre-compute archive eventIds + dirty markers for missing/orphan probes.
  let archiveEventList: { eventId: string; sessionId: string }[] = []
  let archiveListError: string | null = null
  try {
    archiveEventList = await listAllArchiveEventIds(probeOptions, memoryDir)
  } catch (error) {
    archiveListError = redact(error)
  }

  let dirtyMarkers: Awaited<ReturnType<typeof listDirtyMarkers>> = []
  let dirtyListError: string | null = null
  try {
    dirtyMarkers = await listDirtyMarkers(probeOptions)
  } catch (error) {
    dirtyListError = redact(error)
  }

  // Probe 2: archive-missing-dirty
  try {
    if (archiveListError || dirtyListError) {
      findings.push({
        id: 'archive-missing-dirty',
        status: 'warn',
        count: 0,
        detail: archiveListError ?? dirtyListError ?? 'probe error',
        summary:
          'archive/dirty list failed / 归档或 dirty 列出失败',
      })
    } else {
      const dirtyEventIds = new Set<string>()
      for (const marker of dirtyMarkers) {
        for (const id of marker.eventIds) dirtyEventIds.add(id)
      }
      const missingTargets = new Set<string>()
      let missing = 0
      for (const { eventId, sessionId } of archiveEventList) {
        if (!dirtyEventIds.has(eventId)) {
          missing += 1
          missingTargets.add(`archive/sessions/${sessionId}.jsonl`)
        }
      }
      findings.push({
        id: 'archive-missing-dirty',
        status: missing > 0 ? 'warn' : 'ok',
        count: missing,
        targets:
          missingTargets.size > 0 ? Array.from(missingTargets) : undefined,
        summary:
          missing > 0
            ? 'archive events missing dirty markers / 归档事件缺少 dirty 标记'
            : 'archive/dirty consistent / 归档与 dirty 一致',
      })
    }
  } catch (error) {
    findings.push({
      id: 'archive-missing-dirty',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary:
        'archive-missing-dirty probe failed / archive-missing-dirty 探针失败',
    })
  }

  // Probe 3: dirty-orphan
  try {
    if (archiveListError || dirtyListError) {
      findings.push({
        id: 'dirty-orphan',
        status: 'warn',
        count: 0,
        detail: archiveListError ?? dirtyListError ?? 'probe error',
        summary:
          'archive/dirty list failed / 归档或 dirty 列出失败',
      })
    } else {
      const archiveEventIds = new Set(archiveEventList.map(e => e.eventId))
      let orphan = 0
      for (const marker of dirtyMarkers) {
        for (const id of marker.eventIds) {
          if (!archiveEventIds.has(id)) orphan += 1
        }
      }
      findings.push({
        id: 'dirty-orphan',
        status: orphan > 0 ? 'warn' : 'ok',
        count: orphan,
        targets:
          orphan > 0 ? ['agent/dirty.jsonl'] : undefined,
        summary:
          orphan > 0
            ? 'dirty markers reference unknown events / dirty 标记指向未知事件'
            : 'no orphan dirty markers / 无孤立 dirty 标记',
      })
    }
  } catch (error) {
    findings.push({
      id: 'dirty-orphan',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'dirty-orphan probe failed / dirty-orphan 探针失败',
    })
  }

  // Pre-compute sqlite presence + row count.
  const sqlitePath = `${memoryDir}/memory.db`
  const sqlitePresent = await stat(sqlitePath)
    .then(() => true)
    .catch(() => false)

  let sqliteRowCount: number | null = null
  let sqliteRowError: string | null = null
  if (sqlitePresent) {
    try {
      // W143-E1: Open read-only — never create. Bun:sqlite (1.3.x) on
      // some macOS builds returns "flags must include
      // SQLITE_OPEN_READONLY when readwrite=false" if we pass
      // `{ readwrite: false }`. The supported pattern is `readonly: true`
      // which sets the SQLITE_OPEN_READONLY flag explicitly.
      if (!existsSync(sqlitePath)) {
        sqliteRowError = 'sqlite vanished between stat and open'
      } else {
        const db = new Database(sqlitePath, { readonly: true, create: false })
        try {
          const row = db
            .query('SELECT count(*) as n FROM archive_events')
            .get() as { n: number } | undefined
          sqliteRowCount = row?.n ?? 0
        } finally {
          db.close()
        }
      }
    } catch (error) {
      sqliteRowError = redact(error)
    }
  }

  // Probe 4: sqlite-missing
  try {
    const archiveNonEmpty = archiveEventCount > 0
    const isWarn = !sqlitePresent && archiveNonEmpty
    findings.push({
      id: 'sqlite-missing',
      status: isWarn ? 'warn' : 'ok',
      count: isWarn ? 1 : 0,
      targets: isWarn ? ['memory.db'] : undefined,
      detail: `sqlitePresent=${sqlitePresent} archiveEvents=${archiveEventCount}`,
      summary: isWarn
        ? 'sqlite missing but archive non-empty / sqlite 缺失但归档非空'
        : sqlitePresent
          ? 'sqlite present / sqlite 已存在'
          : 'sqlite absent (no archive yet) / 尚无归档，sqlite 未建',
    })
  } catch (error) {
    findings.push({
      id: 'sqlite-missing',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'sqlite-missing probe failed / sqlite-missing 探针失败',
    })
  }

  // Probe 5: sqlite-empty
  try {
    if (!sqlitePresent) {
      findings.push({
        id: 'sqlite-empty',
        status: 'ok',
        count: 0,
        detail: 'sqlite not present',
        summary: 'sqlite absent; check skipped / sqlite 不存在，跳过',
      })
    } else if (sqliteRowError) {
      findings.push({
        id: 'sqlite-empty',
        status: 'warn',
        count: 0,
        detail: sqliteRowError,
        summary: 'sqlite row count failed / sqlite 行数读取失败',
      })
    } else {
      const rowCount = sqliteRowCount ?? 0
      const archiveNonEmpty = archiveEventCount > 0
      const isWarn = rowCount === 0 && archiveNonEmpty
      findings.push({
        id: 'sqlite-empty',
        status: isWarn ? 'warn' : 'ok',
        count: isWarn ? 1 : 0,
        targets: isWarn ? ['memory.db'] : undefined,
        detail: `sqliteRows=${rowCount} archiveEvents=${archiveEventCount}`,
        summary: isWarn
          ? 'sqlite empty but archive non-empty / sqlite 为空但归档非空'
          : 'sqlite row count ok / sqlite 行数正常',
      })
    }
  } catch (error) {
    findings.push({
      id: 'sqlite-empty',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'sqlite-empty probe failed / sqlite-empty 探针失败',
    })
  }

  // Probe 6: sqlite-jsonl-mismatch
  try {
    if (!sqlitePresent || sqliteRowError || sqliteRowCount === null) {
      findings.push({
        id: 'sqlite-jsonl-mismatch',
        status: 'ok',
        count: 0,
        detail: !sqlitePresent
          ? 'sqlite not present'
          : sqliteRowError ?? 'sqlite row count unavailable',
        summary:
          'sqlite/jsonl mismatch check skipped / sqlite/jsonl 对比跳过',
      })
    } else {
      const delta = Math.abs(sqliteRowCount - archiveEventCount)
      const isWarn = delta > 0
      findings.push({
        id: 'sqlite-jsonl-mismatch',
        status: isWarn ? 'warn' : 'ok',
        count: delta,
        detail: `sqlite=${sqliteRowCount} jsonl=${archiveEventCount}`,
        summary: isWarn
          ? 'sqlite/jsonl row count mismatch / sqlite 与 jsonl 行数不一致'
          : 'sqlite/jsonl row counts match / sqlite 与 jsonl 行数一致',
      })
    }
  } catch (error) {
    findings.push({
      id: 'sqlite-jsonl-mismatch',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary:
        'sqlite-jsonl-mismatch probe failed / sqlite-jsonl-mismatch 探针失败',
    })
  }

  // Pre-compute job retries observation.
  let retries: Awaited<ReturnType<typeof observeMemoryAgentJobRetries>> | null = null
  let jobsListError: string | null = null
  try {
    const latestJobs = await listLatestMemoryAgentJobs(probeOptions)
    retries = observeMemoryAgentJobRetries(latestJobs)
  } catch (error) {
    jobsListError = redact(error)
  }

  // Probe 7: jobs-failed-active
  try {
    if (jobsListError || !retries) {
      findings.push({
        id: 'jobs-failed-active',
        status: 'warn',
        count: 0,
        detail: jobsListError ?? 'retries unavailable',
        summary: 'job list failed / 任务列表读取失败',
      })
    } else {
      const failed = retries.activeFailedJobs
      findings.push({
        id: 'jobs-failed-active',
        status: failed > 0 ? 'warn' : 'ok',
        count: failed,
        targets: failed > 0 ? ['agent/jobs.jsonl'] : undefined,
        detail: `activeFailedJobs=${failed}`,
        summary:
          failed > 0
            ? 'active failed jobs / 存在活跃失败任务'
            : 'no active failed jobs / 无活跃失败任务',
      })
    }
  } catch (error) {
    findings.push({
      id: 'jobs-failed-active',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'jobs-failed-active probe failed / jobs-failed-active 探针失败',
    })
  }

  // Probe 8: jobs-exhausted
  try {
    if (jobsListError || !retries) {
      findings.push({
        id: 'jobs-exhausted',
        status: 'warn',
        count: 0,
        detail: jobsListError ?? 'retries unavailable',
        summary: 'job list failed / 任务列表读取失败',
      })
    } else {
      const exhausted = retries.exhaustedJobs
      findings.push({
        id: 'jobs-exhausted',
        status: exhausted > 0 ? 'warn' : 'ok',
        count: exhausted,
        targets: exhausted > 0 ? ['agent/jobs.jsonl'] : undefined,
        detail: `exhaustedJobs=${exhausted} maxRetryAttempt=${retries.maxRetryAttempt}`,
        summary:
          exhausted > 0
            ? 'retry-exhausted jobs / 重试次数耗尽的任务'
            : 'no retry-exhausted jobs / 无重试耗尽任务',
      })
    }
  } catch (error) {
    findings.push({
      id: 'jobs-exhausted',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'jobs-exhausted probe failed / jobs-exhausted 探针失败',
    })
  }

  // Probe 9: lock-stale
  try {
    const status = await getMemoryWorkerStatus(probeOptions)
    const held = status.lock.held
    const stale = status.lock.stale
    const isWarn = Boolean(held && stale)
    const detailParts = [
      `held=${held}`,
      `stale=${stale}`,
      `staleReason=${status.lock.staleReason ?? 'none'}`,
      `pid=${status.lock.pid ?? 'none'}`,
      `hostname=${status.lock.hostname ?? 'none'}`,
    ]
    findings.push({
      id: 'lock-stale',
      status: isWarn ? 'warn' : 'ok',
      count: isWarn ? 1 : 0,
      targets: isWarn ? ['agent/worker.lock'] : undefined,
      detail: detailParts.join(' '),
      summary: isWarn
        ? 'worker lock stale / worker 锁过期'
        : 'worker lock healthy / worker 锁正常',
    })
  } catch (error) {
    findings.push({
      id: 'lock-stale',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'lock-stale probe failed / lock-stale 探针失败',
    })
  }

  // Probe 10: proposal-pending
  try {
    const proposals = await listProposals(probeOptions)
    // Latest record per proposalId. Sort key matches proposalStore's
    // updatedAt → reviewedAt → createdAt ordering.
    const latest = new Map<string, typeof proposals[number]>()
    for (const record of proposals) {
      const current = latest.get(record.proposal.proposalId)
      const sortKey = (p: (typeof record)['proposal']) =>
        p.updatedAt ?? p.reviewedAt ?? p.createdAt
      if (
        !current ||
        sortKey(record.proposal) >= sortKey(current.proposal)
      ) {
        latest.set(record.proposal.proposalId, record)
      }
    }
    const candidateCount = Array.from(latest.values()).filter(
      r => r.proposal.status === 'candidate',
    ).length
    findings.push({
      id: 'proposal-pending',
      status: candidateCount > 0 ? 'warn' : 'ok',
      count: candidateCount,
      targets: candidateCount > 0 ? ['proposals.jsonl'] : undefined,
      detail: `candidate=${candidateCount} totalLatest=${latest.size}`,
      summary:
        candidateCount > 0
          ? 'pending proposals awaiting review / 待审 proposal'
          : 'no pending proposals / 无待审 proposal',
    })
  } catch (error) {
    findings.push({
      id: 'proposal-pending',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'proposal-pending probe failed / proposal-pending 探针失败',
    })
  }

  // Probe 11: profile-redundant
  // Heuristic: ProfileSnapshot schema has no content hash field, so we use
  // the secondary heuristic from the spec — snapshots beyond the W145
  // governance policy's profileKeepLatest count are flagged as redundant.
  try {
    const snapshots = await listProfileSnapshots(probeOptions)
    const snapshotCount = snapshots.length
    const threshold = profileRedundantThreshold()
    const isWarn = snapshotCount > threshold
    findings.push({
      id: 'profile-redundant',
      status: isWarn ? 'warn' : 'ok',
      count: isWarn ? snapshotCount : 0,
      targets: isWarn ? ['profiles.jsonl'] : undefined,
      detail: `snapshots=${snapshotCount} threshold=${threshold}`,
      summary: isWarn
        ? 'profile snapshot count high / profile 快照数偏多'
        : 'profile snapshot count ok / profile 快照数正常',
    })
  } catch (error) {
    findings.push({
      id: 'profile-redundant',
      status: 'warn',
      count: 0,
      detail: redact(error),
      summary: 'profile-redundant probe failed / profile-redundant 探针失败',
    })
  }

  const totals = {
    findingsTotal: findings.length,
    findingsOk: findings.filter(f => f.status === 'ok').length,
    findingsWarn: findings.filter(f => f.status === 'warn').length,
    findingsFail: findings.filter(f => f.status === 'fail').length,
  }

  return {
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: effectiveProjectId,
    memoryDir,
    findings,
    totals,
  }
}
