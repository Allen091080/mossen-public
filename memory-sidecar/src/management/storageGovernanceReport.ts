/**
 * W145 — memory-sidecar storage governance.
 *
 * Read-only observability + dry-run plan for the on-disk memory store.
 * Answers: how big is the archive? how many profile snapshots? how
 * many proposal candidates? how many dirty/jobs? what would a future
 * cleanup look like?
 *
 * HARD INVARIANTS (locked by smoke):
 *   - This module performs ZERO mutation. No writeFile / appendFile /
 *     mkdir / rm / unlink / rename / copyFile / rebuildArchiveIndex /
 *     appendDirtyMarker / runMemoryAgentOnce / setMemorySidecar*
 *     anywhere in the file. Even the SQLite open is read-only via
 *     `{ readonly: true, create: false }`.
 *   - All plan actions emit `safeToExecuteNow: false`. There is no
 *     apply path in this module.
 *   - The module never creates directories. If the project memory dir
 *     is missing, the report degrades gracefully (zeros + a warning).
 *
 * The slash routes that compose this helper are
 * `/memory-sidecar governance status` and `/memory-sidecar governance plan`.
 * (The original W145 instructions said `storage status` / `storage plan`,
 * but `/memory-sidecar storage status` is the W132/W138 file-level
 * maintenance surface and must not be overwritten — see the W145 doc
 * for the namespace decision.)
 * Apply lives in W146+ as `/memory-sidecar governance apply <id> --dry-run` and
 * does NOT exist in this module. The futureCommand strings below are
 * reference text only.
 */

import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  type DirtyMarker,
  listDirtyCheckpoints,
  listDirtyMarkers,
} from '../agent/dirtyQueue.js'
import {
  listLatestMemoryAgentJobs,
  observeMemoryAgentJobRetries,
  observeMemoryAgentJobs,
  type MemoryAgentJob,
} from '../agent/jobQueue.js'
import {
  loadMemorySidecarConfig,
  getDefaultMemorySidecarConfigPath,
  type MemorySidecarConfig,
} from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import {
  getArchiveSessionReadPath,
  readArchiveEventsTolerant,
} from '../storage/jsonlArchiveStore.js'
import {
  getArchiveStoreManifest,
  listArchiveSessionFiles,
} from '../storage/manifest.js'
import { listObservations } from '../storage/observationStore.js'
import { listProfileSnapshots } from '../storage/profileStore.js'
import { listProposals, recentProposals } from '../storage/proposalStore.js'

// ============================================================================
// Public types
// ============================================================================

export type MemoryStorageGovernancePolicy = {
  archiveWarnBytes: number
  archiveHighBytes: number
  profileKeepLatest: number
  proposalCandidateKeepLatest: number
  staleProposalDays: number
  monthlyBucketLimit: number
}

export type StorageRiskLevel = 'ok' | 'warn' | 'high'

export type StorageMonthlyBucket = {
  month: string  // 'YYYY-MM'
  events: number
  bytes: number
}

export type MemoryStorageGovernanceReport = {
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  policy: MemoryStorageGovernancePolicy
  archive: {
    events: number
    sessions: number
    oldestEventAt: string | null
    latestEventAt: string | null
    jsonlBytes: number
    largestSessionBytes: number
    monthlyBuckets: StorageMonthlyBucket[]
  }
  sqlite: {
    present: boolean
    bytes: number
    path: string
    rowCount: number | null
    error?: string
  }
  observations: {
    total: number
    latestAt: string | null
    byType: Record<string, number>
    byScope: Record<string, number>
  }
  profiles: {
    snapshots: number
    latestAt: string | null
    redundantCount: number
    recommendedKeep: number
  }
  proposals: {
    // W145.1: counts reflect the *latest* record per proposalId
    // (proposals.jsonl is append-only and a single proposal may have
    // many records as it transitions candidate -> accepted etc.).
    // Counting raw records produced inflated `candidate` numbers —
    // every old `candidate` row stayed in the tally even after the
    // proposal had been accepted or rejected.
    total: number
    candidate: number
    accepted: number
    rejected: number
    deferred: number
    staleCandidateCount: number
    // W145.1: physical JSONL line count, exposed separately so the
    // raw "how big is the file" question is still answerable without
    // contaminating the current-state counts.
    recordsTotal: number
  }
  jobsAndDirty: {
    dirtyTotal: number
    dirtyUnconsumed: number
    jobsTotal: number
    pending: number
    failed: number
    retrying: number
    exhausted: number
  }
  risk: {
    level: StorageRiskLevel
    reasons: string[]
  }
  warnings: string[]
  recommendedActions: string[]
}

export type GovernanceActionId =
  | 'profile-prune-redundant'
  | 'proposal-prune-stale-candidates'
  | 'archive-compress-old-sessions'
  | 'archive-export-project-bundle'
  | 'sqlite-rebuild-index'

/**
 * W149-A: capability classification for each governance plan action.
 * The `applyCapability` field tells the operator (and any UI rendering
 * the plan) which actions are wired up to a real apply executor today
 * vs which are intentionally deferred to a later wave. Keeps plan
 * output and apply parser consistent — pre-W149 the plan suggested
 * `--dry-run` futureCommand strings for actions the parser did not
 * accept, so users got a confusing "scope must be …" error.
 *
 *   executable               → wired to apply executor in W146 / W149-B
 *                              / W149-C. Includes profile-prune-redundant,
 *                              proposal-prune-stale-candidates,
 *                              sqlite-rebuild-index, and
 *                              archive-export-project-bundle.
 *   gated-feasibility-w149d  → archive-compress-old-sessions, blocked
 *                              on the W149-D recoverability design.
 *
 * The 'deferred-w149b' / 'deferred-w149c' variants are preserved for
 * type-level compatibility with code that may still reference them,
 * but the report builder no longer emits them now that the
 * corresponding actions are executable. New code should not emit
 * 'deferred-w149b' or 'deferred-w149c'.
 */
export type GovernanceApplyCapability =
  | 'executable'
  | 'deferred-w149b'
  | 'deferred-w149c'
  | 'gated-feasibility-w149d'

export type MemoryStorageGovernancePlanAction = {
  id: GovernanceActionId
  title: string
  status: 'noop' | 'planned' | 'blocked'
  // W145 hard invariant: every action in this module emits false.
  safeToExecuteNow: false
  count: number
  estimatedBytes?: number
  reason?: string
  blocked?: string
  targets?: string[]
  executableInW146?: boolean
  // W149-A: explicit capability classification — see GovernanceApplyCapability.
  applyCapability: GovernanceApplyCapability
  futureCommand?: string
}

export type MemoryStorageGovernancePlan = {
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  policy: MemoryStorageGovernancePolicy
  estimatedReclaimBytes: number
  actions: MemoryStorageGovernancePlanAction[]
  warnings: string[]
  recommendedActions: string[]
}

export type MemoryStorageGovernanceOptions = MemoryRootOptions & {
  policy?: MemoryStorageGovernancePolicy
  configPath?: string
  now?: () => Date
}

// ============================================================================
// Default policy
// ============================================================================

const DEFAULT_POLICY: MemoryStorageGovernancePolicy = {
  archiveWarnBytes: 100 * 1024 * 1024,   // 100 MB
  archiveHighBytes: 500 * 1024 * 1024,   // 500 MB
  profileKeepLatest: 20,
  proposalCandidateKeepLatest: 100,
  staleProposalDays: 30,
  monthlyBucketLimit: 18,
}

export function getDefaultMemoryStoragePolicy(): MemoryStorageGovernancePolicy {
  // Return a copy so callers cannot mutate our internal default.
  return { ...DEFAULT_POLICY }
}

// ============================================================================
// Report
// ============================================================================

export async function generateMemoryStorageGovernanceReport(
  options: MemoryStorageGovernanceOptions,
): Promise<MemoryStorageGovernanceReport> {
  const policy = options.policy ?? getDefaultMemoryStoragePolicy()
  const now = options.now?.() ?? new Date()
  const generatedAt = now.toISOString()

  // 1. Resolve canonical projectId. resolveProjectId is read-only.
  const aliasResolution = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
    aliases: [options.projectId],
    aliasReason: undefined,
  }))
  const effectiveProjectId = aliasResolution.projectId
  const effectiveOptions: MemoryRootOptions = {
    ...options,
    projectId: effectiveProjectId,
  }
  const memoryDir = getProjectMemoryDir(effectiveOptions)

  // 2. Best-effort config load (informational only — used to surface
  //    sidecar enabled/disabled in warnings).
  let config: MemorySidecarConfig | null = null
  try {
    config = loadMemorySidecarConfig(
      options.configPath ?? getDefaultMemorySidecarConfigPath(),
    )
  } catch {
    // Config absent / unreadable is fine; we still report on whatever
    // is on disk.
  }

  // 3. Archive: manifest gives event/session count + lastEventAt; we
  //    do per-session fs.stat for bytes and per-event scan for monthly
  //    buckets. Tolerant — a missing memoryDir produces zeros.
  const manifest = await getArchiveStoreManifest(effectiveOptions).catch(
    () => null,
  )
  const sessionFiles = manifest
    ? await listArchiveSessionFiles(manifest.sessionsDir)
    : []
  let jsonlBytes = 0
  let largestSessionBytes = 0
  let oldestEventAt: string | null = null
  let latestEventAt: string | null = manifest?.stats.lastEventAt ?? null
  const monthlyMap = new Map<string, { events: number; bytes: number }>()

  for (const file of sessionFiles) {
    const sessionId = basename(file, '.jsonl')
    let sessionBytes = 0
    try {
      const readPath = await getArchiveSessionReadPath({
        ...effectiveOptions,
        sessionId,
      })
      const info = readPath.kind === 'missing'
        ? null
        : await stat(readPath.path)
      if (!info) continue
      sessionBytes = info.size
      jsonlBytes += sessionBytes
      if (sessionBytes > largestSessionBytes) largestSessionBytes = sessionBytes
    } catch {
      // missing / permission — skip silently, jsonlBytes stays accurate
      // for the files we DID see.
    }

    const tolerant = await readArchiveEventsTolerant({
      ...effectiveOptions,
      sessionId,
    }).catch(() => ({ events: [], corruptLines: [] }))
    let sessionMinAt: string | null = null
    let sessionMaxAt: string | null = null
    let sessionEvents = 0
    for (const entry of tolerant.events) {
      const at = entry.event.createdAt
      if (!at) continue
      sessionEvents += 1
      if (!sessionMinAt || at < sessionMinAt) sessionMinAt = at
      if (!sessionMaxAt || at > sessionMaxAt) sessionMaxAt = at
      if (!oldestEventAt || at < oldestEventAt) oldestEventAt = at
      if (!latestEventAt || at > latestEventAt) latestEventAt = at

      const month = at.slice(0, 7)  // YYYY-MM from ISO
      if (month) {
        const bucket = monthlyMap.get(month) ?? { events: 0, bytes: 0 }
        bucket.events += 1
        monthlyMap.set(month, bucket)
      }
    }

    // Distribute session bytes proportionally across months that
    // appeared in this session. Avoids guessing — coarse but stable.
    if (sessionMinAt && sessionMaxAt && sessionEvents > 0) {
      const monthsInSession = new Set<string>()
      for (const entry of tolerant.events) {
        const m = entry.event.createdAt?.slice(0, 7)
        if (m) monthsInSession.add(m)
      }
      const sharePerMonth = monthsInSession.size > 0
        ? Math.floor(sessionBytes / monthsInSession.size)
        : 0
      for (const m of monthsInSession) {
        const bucket = monthlyMap.get(m) ?? { events: 0, bytes: 0 }
        bucket.bytes += sharePerMonth
        monthlyMap.set(m, bucket)
      }
    }
  }

  const monthlyBuckets: StorageMonthlyBucket[] = [...monthlyMap.entries()]
    .map(([month, v]) => ({ month, events: v.events, bytes: v.bytes }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // 4. SQLite: stat for bytes; readonly open for row count.
  const sqlitePath = `${memoryDir}/memory.db`
  let sqlitePresent = false
  let sqliteBytes = 0
  let sqliteRowCount: number | null = null
  let sqliteError: string | undefined
  try {
    const info = await stat(sqlitePath)
    sqlitePresent = info.isFile()
    sqliteBytes = info.size
  } catch {
    // Absent — fine, fields stay false/0.
  }
  if (sqlitePresent) {
    if (!existsSync(sqlitePath)) {
      sqliteError = 'sqlite vanished between stat and open'
    } else {
      try {
        // W143-E1 readonly pattern. Never creates the file.
        const db = new Database(sqlitePath, { readonly: true, create: false })
        try {
          const row = db
            .query('SELECT count(*) AS n FROM archive_events')
            .get() as { n: number } | undefined
          sqliteRowCount = row?.n ?? 0
        } finally {
          db.close()
        }
      } catch (error) {
        sqliteError = error instanceof Error ? error.message : String(error)
      }
    }
  }

  // 5. Observations: enumerate full set; tally byType/byScope.
  const observationEntries = await listObservations(effectiveOptions).catch(
    () => [],
  )
  const obsByType: Record<string, number> = {}
  const obsByScope: Record<string, number> = {}
  let observationLatestAt: string | null = null
  for (const entry of observationEntries) {
    const o = entry.observation
    obsByType[o.type] = (obsByType[o.type] ?? 0) + 1
    obsByScope[o.scope] = (obsByScope[o.scope] ?? 0) + 1
    if (!observationLatestAt || o.createdAt > observationLatestAt) {
      observationLatestAt = o.createdAt
    }
  }

  // 6. Profile snapshots: count + latest + redundant beyond keepLatest.
  const profileEntries = await listProfileSnapshots(effectiveOptions).catch(
    () => [],
  )
  const profileSnapshots = profileEntries.length
  let profileLatestAt: string | null = null
  for (const entry of profileEntries) {
    const at = entry.profile.generatedAt
    if (!profileLatestAt || at > profileLatestAt) profileLatestAt = at
  }
  const profileRedundant = Math.max(
    0,
    profileSnapshots - policy.profileKeepLatest,
  )

  // 7. Proposals: counts by status + stale candidate count.
  // Schema statuses are candidate / accepted / rejected / superseded.
  // The W145 spec uses `deferred` as the field name; we map
  // `superseded` to `deferred` for label compatibility.
  //
  // W145.1: proposals.jsonl is append-only — each transition
  // (candidate -> accepted etc.) appends a new record with the same
  // proposalId. Counting via `listProposals` (raw records) over-counts
  // every status that proposals have ever passed through. We collapse
  // to the *latest* record per proposalId via `recentProposals` so
  // `candidate` reflects current candidates only. The raw record total
  // still surfaces under `recordsTotal` for "how big is the file"
  // questions.
  const proposalRawEntries = await listProposals(effectiveOptions).catch(() => [])
  const proposalLatestEntries = await recentProposals({
    ...effectiveOptions,
    limit: Number.POSITIVE_INFINITY,
  }).catch(() => [])
  let pCandidate = 0
  let pAccepted = 0
  let pRejected = 0
  let pDeferred = 0
  let staleCandidateCount = 0
  const staleCutoffMs = now.getTime() - policy.staleProposalDays * 86_400_000
  for (const entry of proposalLatestEntries) {
    const p = entry.proposal
    if (p.status === 'candidate') {
      pCandidate += 1
      const created = Date.parse(p.createdAt)
      if (Number.isFinite(created) && created < staleCutoffMs) {
        staleCandidateCount += 1
      }
    } else if (p.status === 'accepted') {
      pAccepted += 1
    } else if (p.status === 'rejected') {
      pRejected += 1
    } else if (p.status === 'superseded') {
      // schema label `superseded` <-> spec label `deferred`
      pDeferred += 1
    }
  }

  // 8. Jobs + dirty. Read both queues; observe latest jobs.
  const dirtyMarkers: DirtyMarker[] = await listDirtyMarkers(effectiveOptions)
    .catch(() => [])
  const dirtyCheckpoints = await listDirtyCheckpoints(effectiveOptions).catch(
    () => [],
  )
  const consumedIds = new Set(dirtyCheckpoints.map(c => c.dirtyId))
  const dirtyTotal = dirtyMarkers.length
  const dirtyUnconsumed = dirtyMarkers.filter(
    m => !consumedIds.has(m.dirtyId),
  ).length

  let latestJobs: MemoryAgentJob[] = []
  try {
    latestJobs = await listLatestMemoryAgentJobs(effectiveOptions)
  } catch {
    // unreadable queue — keep zeros.
  }
  const jobObs = observeMemoryAgentJobs(latestJobs)
  const retryObs = observeMemoryAgentJobRetries(latestJobs)

  // 9. Risk + warnings + recommendedActions.
  //
  // Accumulate by ranking each level numerically; final risk = max.
  // This avoids the type-narrowing pitfall where `level === 'high'`
  // becomes statically false after an else-if that narrowed `level`
  // to `'ok' | 'warn'`.
  const RISK_RANK: Record<StorageRiskLevel, number> = { ok: 0, warn: 1, high: 2 }
  const RISK_BY_RANK: StorageRiskLevel[] = ['ok', 'warn', 'high']
  const reasons: string[] = []
  let levelRank = RISK_RANK.ok
  const bumpLevel = (next: StorageRiskLevel) => {
    if (RISK_RANK[next] > levelRank) levelRank = RISK_RANK[next]
  }

  if (jsonlBytes >= policy.archiveHighBytes) {
    bumpLevel('high')
    reasons.push(`archive exceeds high threshold (${jsonlBytes} >= ${policy.archiveHighBytes})`)
  } else if (jsonlBytes >= policy.archiveWarnBytes) {
    bumpLevel('warn')
    reasons.push(`archive exceeds warn threshold (${jsonlBytes} >= ${policy.archiveWarnBytes})`)
  }
  if (profileSnapshots > policy.profileKeepLatest) {
    bumpLevel('warn')
    reasons.push(
      `profile snapshots exceed recommended retention (${profileSnapshots} > ${policy.profileKeepLatest})`,
    )
  }
  if (pCandidate > policy.proposalCandidateKeepLatest) {
    bumpLevel('warn')
    reasons.push(
      `proposal candidates exceed recommended retention (${pCandidate} > ${policy.proposalCandidateKeepLatest})`,
    )
  }
  if (staleCandidateCount > 0) {
    bumpLevel('warn')
    reasons.push(
      `${staleCandidateCount} proposal candidates older than ${policy.staleProposalDays} days`,
    )
  }
  if (monthlyBuckets.length > policy.monthlyBucketLimit) {
    bumpLevel('warn')
    reasons.push(
      `archive spans ${monthlyBuckets.length} months (> ${policy.monthlyBucketLimit})`,
    )
  }
  const level: StorageRiskLevel = RISK_BY_RANK[levelRank]!

  const warnings: string[] = []
  if (config && !config.enabled) {
    warnings.push('sidecar is disabled — capture is paused but on-disk data is still readable')
  }
  if (sqliteError) {
    warnings.push(`sqlite read error: ${sqliteError}`)
  }
  warnings.push(...reasons)

  // W145.1: governance namespace fix — point to /memory-sidecar
  // governance plan, not the legacy storage-plan name. /memory-sidecar
  // status remains the W122-A doctor surface.
  const recommendedActions: string[] = []
  if (level === 'warn' || level === 'high') {
    recommendedActions.push('/memory-sidecar governance plan')
  }
  recommendedActions.push('/memory-sidecar status')

  return {
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: effectiveProjectId,
    memoryDir,
    policy: { ...policy },
    archive: {
      events: manifest?.stats.archiveEventCount ?? 0,
      sessions: sessionFiles.length,
      oldestEventAt,
      latestEventAt,
      jsonlBytes,
      largestSessionBytes,
      monthlyBuckets,
    },
    sqlite: {
      present: sqlitePresent,
      bytes: sqliteBytes,
      path: sqlitePath,
      rowCount: sqliteRowCount,
      ...(sqliteError ? { error: sqliteError } : {}),
    },
    observations: {
      total: observationEntries.length,
      latestAt: observationLatestAt,
      byType: obsByType,
      byScope: obsByScope,
    },
    profiles: {
      snapshots: profileSnapshots,
      latestAt: profileLatestAt,
      redundantCount: profileRedundant,
      recommendedKeep: policy.profileKeepLatest,
    },
    proposals: {
      // total = number of distinct proposals (latest record per id),
      // matching the candidate/accepted/rejected/deferred semantics.
      total: proposalLatestEntries.length,
      candidate: pCandidate,
      accepted: pAccepted,
      rejected: pRejected,
      deferred: pDeferred,
      staleCandidateCount,
      // recordsTotal = physical JSONL line count.
      recordsTotal: proposalRawEntries.length,
    },
    jobsAndDirty: {
      dirtyTotal,
      dirtyUnconsumed,
      jobsTotal: jobObs.totalJobs,
      pending: jobObs.countsByStatus.pending,
      failed: retryObs.activeFailedJobs,
      retrying: retryObs.retryJobs,
      exhausted: retryObs.exhaustedJobs,
    },
    risk: { level, reasons },
    warnings,
    recommendedActions,
  }
}

// ============================================================================
// Plan
// ============================================================================

export async function generateMemoryStorageGovernancePlan(
  options: MemoryStorageGovernanceOptions,
): Promise<MemoryStorageGovernancePlan> {
  // The plan is derived from the report so we do not re-walk the
  // filesystem. The report itself is read-only; its `await` happens
  // here.
  const report = await generateMemoryStorageGovernanceReport(options)
  const policy = report.policy

  const actions: MemoryStorageGovernancePlanAction[] = []

  // 1. profile-prune-redundant
  {
    const count = report.profiles.redundantCount
    actions.push({
      id: 'profile-prune-redundant',
      title: 'Prune redundant profile snapshots',
      status: count > 0 ? 'planned' : 'noop',
      safeToExecuteNow: false,
      count,
      reason: count > 0
        ? `${count} snapshots beyond profileKeepLatest=${policy.profileKeepLatest}`
        : `at or below profileKeepLatest=${policy.profileKeepLatest}`,
      executableInW146: true,
      applyCapability: 'executable',
      futureCommand: '/memory-sidecar governance apply profile-prune-redundant --dry-run',
    })
  }

  // 2. proposal-prune-stale-candidates
  {
    const count = report.proposals.staleCandidateCount
    actions.push({
      id: 'proposal-prune-stale-candidates',
      title: 'Prune stale proposal candidates',
      status: count > 0 ? 'planned' : 'noop',
      safeToExecuteNow: false,
      count,
      reason: count > 0
        ? `${count} candidates older than ${policy.staleProposalDays} days`
        : `no candidates older than ${policy.staleProposalDays} days`,
      executableInW146: true,
      applyCapability: 'executable',
      futureCommand: '/memory-sidecar governance apply proposal-prune-stale-candidates --dry-run',
    })
  }

  // 3. archive-compress-old-sessions — count = months beyond
  // monthlyBucketLimit (oldest first). W149-A: deferred behind the
  // archive-recoverability design pass in W149-D; emit a `pending`
  // futureCommand string instead of a `--dry-run` command the apply
  // parser does not accept yet.
  {
    const monthsOver = Math.max(
      0,
      report.archive.monthlyBuckets.length - policy.monthlyBucketLimit,
    )
    const targets = report.archive.monthlyBuckets
      .slice(0, monthsOver)
      .map(b => b.month)
    const estimatedBytes = report.archive.monthlyBuckets
      .slice(0, monthsOver)
      .reduce((sum, b) => sum + b.bytes, 0)
    actions.push({
      id: 'archive-compress-old-sessions',
      title: 'Compress old archive sessions',
      status: monthsOver > 0 ? 'planned' : 'noop',
      safeToExecuteNow: false,
      count: monthsOver,
      estimatedBytes: estimatedBytes > 0 ? estimatedBytes : undefined,
      reason: monthsOver > 0
        ? `${monthsOver} months exceed monthlyBucketLimit=${policy.monthlyBucketLimit}`
        : `at or below monthlyBucketLimit=${policy.monthlyBucketLimit}`,
      ...(targets.length > 0 ? { targets } : {}),
      executableInW146: false,
      applyCapability: 'gated-feasibility-w149d',
      futureCommand:
        'deferred to W149-D archive compression recoverability design',
    })
  }

  // 4. archive-export-project-bundle — always 1 representative target
  // per project (this would be the future export path). No bytes
  // estimate because the export shape is not yet defined. W149-A:
  // routed to W149-C in the capability matrix.
  actions.push({
    id: 'archive-export-project-bundle',
    title: 'Export project memory as a portable bundle',
    status: report.archive.events > 0 ? 'planned' : 'noop',
    safeToExecuteNow: false,
    count: report.archive.events > 0 ? 1 : 0,
    reason: report.archive.events > 0
      ? 'project has archive events; export bundle apply available'
      : 'project archive is empty',
    // W149-C: bundle export is now wired up in storageGovernanceApply.
    // executableInW146 stays false because the action did not exist
    // in W146; the field is W146-specific UI metadata, not a
    // capability gate.
    executableInW146: false,
    applyCapability: 'executable',
    futureCommand:
      '/memory-sidecar governance apply archive-export-project-bundle --dry-run',
  })

  // 5. sqlite-rebuild-index — planned when sqlite is missing OR rowCount
  // disagrees with archive.events; noop otherwise. W149-A: routed to
  // W149-B in the capability matrix.
  {
    let status: 'noop' | 'planned' | 'blocked' = 'noop'
    let reason = 'sqlite index is consistent'
    let count = 0
    if (!report.sqlite.present && report.archive.events > 0) {
      status = 'planned'
      reason = 'sqlite index is missing while archive has events'
      count = 1
    } else if (
      report.sqlite.present &&
      report.sqlite.rowCount !== null &&
      report.sqlite.rowCount !== report.archive.events
    ) {
      status = 'planned'
      reason = `sqlite rowCount=${report.sqlite.rowCount} != archive events=${report.archive.events}`
      count = 1
    } else if (report.sqlite.error) {
      status = 'blocked'
      reason = `sqlite read error: ${report.sqlite.error}`
      count = 0
    }
    actions.push({
      id: 'sqlite-rebuild-index',
      title: 'Rebuild SQLite archive index',
      status,
      safeToExecuteNow: false,
      count,
      reason,
      ...(status === 'blocked' ? { blocked: report.sqlite.error } : {}),
      // W149-B: rebuild is now wired up in storageGovernanceApply.
      // executableInW146 stays false because the action did not exist
      // in W146; the field is W146-specific UI metadata, not a
      // capability gate.
      executableInW146: false,
      applyCapability: 'executable',
      futureCommand:
        '/memory-sidecar governance apply sqlite-rebuild-index --dry-run',
    })
  }

  const estimatedReclaimBytes = actions
    .map(a => a.estimatedBytes ?? 0)
    .reduce((sum, n) => sum + n, 0)

  return {
    generatedAt: report.generatedAt,
    projectId: report.projectId,
    resolvedProjectId: report.resolvedProjectId,
    memoryDir: report.memoryDir,
    policy: report.policy,
    estimatedReclaimBytes,
    actions,
    warnings: report.warnings,
    // W145.1: governance namespace fix — the plan points back to
    // governance status, not the legacy storage-status name (which
    // belongs to W132/W138 maintenance and is unchanged).
    recommendedActions: ['/memory-sidecar governance status'],
  }
}
