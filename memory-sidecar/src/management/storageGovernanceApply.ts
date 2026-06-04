/**
 * W146 / W149-B / W149-C — memory-sidecar governance apply gate.
 *
 * This is intentionally separate from W145's read-only
 * storageGovernanceReport helper. W146 introduced the first two
 * executable actions; W149-B added sqlite-rebuild-index; W149-C added
 * archive-export-project-bundle. Together the write surface for
 * long-term governance is:
 *
 *   - profile-prune-redundant         (W146,   JSONL rewrite)
 *   - proposal-prune-stale-candidates (W146,   JSONL rewrite)
 *   - sqlite-rebuild-index            (W149-B, archive→memory.db rebuild)
 *   - archive-export-project-bundle   (W149-C, source→exports/ copy)
 *
 * Archive compression remains non-executable. Existing W132/W138
 * storage export/cleanup and W122-B repair keep their own routes and
 * safety contracts.
 *
 * Safety model:
 *   - 8-hex in-memory token, 10 min TTL, one-shot.
 *   - confirm deletes token before any write.
 *   - confirm recomputes targets from current disk state.
 *   - writes are limited to profiles.jsonl / proposals.jsonl / memory.db
 *     under the resolved project memoryDir. archive/, observations.jsonl,
 *     dirty.jsonl and jobs/ are NEVER modified.
 *   - sidecar must be disabled before confirm, avoiding append-vs-rewrite
 *     races with the worker (and avoiding double-write into memory.db
 *     during a rebuild).
 */

import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
} from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import {
  getProfileSnapshotsPath,
  listProfileSnapshots,
  type ProfileSnapshotWithLocation,
} from '../storage/profileStore.js'
import {
  getProposalsPath,
  listProposals,
  recentProposals,
  type ProposalWithLocation,
} from '../storage/proposalStore.js'
import {
  getArchiveSessionReadPath,
  listArchiveSessionFilesWithGzipFallback,
  readArchiveEvents,
} from '../storage/jsonlArchiveStore.js'
import {
  rebuildArchiveIndex,
} from '../storage/sqliteIndex.js'
import {
  generateMemoryStorageGovernanceReport,
  getDefaultMemoryStoragePolicy,
  type MemoryStorageGovernanceReport,
  type MemoryStorageGovernancePolicy,
} from './storageGovernanceReport.js'

export const GOVERNANCE_APPLY_TOKEN_TTL_MS = 10 * 60 * 1000

export type GovernanceApplyActionId =
  | 'profile-prune-redundant'
  | 'proposal-prune-stale-candidates'
  | 'sqlite-rebuild-index'
  | 'archive-export-project-bundle'

export type GovernanceApplyScope = GovernanceApplyActionId | 'all'

export type GovernanceApplyBlockedReason =
  | 'sidecar-enabled'
  | 'no-targets'
  | 'unsupported-action'
  | 'invalid-token'
  | 'expired-token'
  | 'plan-mismatch'
  | 'write-outside-project'

export type GovernanceApplyDryRunAction = {
  id: GovernanceApplyActionId
  status: 'planned' | 'noop' | 'blocked'
  count: number
  estimatedBytes: number
  safeToExecute: boolean
  blocked?: GovernanceApplyBlockedReason
  detail?: string
  targets?: string[]
}

export type GovernanceApplyDryRun = {
  dryRun: true
  token: string
  expiresAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  scope: GovernanceApplyScope
  sidecarDisabled: boolean
  actions: GovernanceApplyDryRunAction[]
  estimatedWrites: number
  estimatedReclaimBytes: number
  warnings: string[]
  recommendedActions: string[]
  confirmCommand: string
}

export type GovernanceApplyActionResult = {
  id: GovernanceApplyActionId
  status: 'executed' | 'skipped' | 'blocked' | 'failed'
  count: number
  reclaimedBytes: number
  detail?: string
  blocked?: GovernanceApplyBlockedReason
  errorMessage?: string
  /**
   * W149-B sqlite-rebuild-index telemetry. Populated only on the
   * sqlite-rebuild-index path; left undefined for JSONL-rewrite actions
   * so existing callers (W146 smoke + memory-sidecar.tsx renderer)
   * keep working unchanged. `archiveChanged: false` is a hard
   * invariant — the rebuilder is read-only on archive/ and write-only
   * on memory.db.
   */
  sqliteRebuild?: {
    rowsBefore: number | null
    rowsAfter: number
    durationMs: number
    archiveChanged: false
    ftsAvailable: boolean
  }
  /**
   * W149-C archive-export-project-bundle telemetry. Populated only on
   * the export-bundle path; left undefined for other actions.
   * `sourceChanged: false` is a hard invariant — the exporter copies
   * from memoryDir into exports/ and never writes back into memoryDir.
   */
  exportBundle?: {
    bundleDir: string
    manifestPath: string
    fileCount: number
    totalBytes: number
    archiveEvents: number
    observations: number
    profiles: number
    proposals: number
    sourceChanged: false
  }
}

export type GovernanceApplyExecution = {
  dryRun: false
  startedAt: string
  finishedAt: string
  durationMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  scope: GovernanceApplyScope
  results: GovernanceApplyActionResult[]
  totals: {
    executed: number
    skipped: number
    blocked: number
    failed: number
    reclaimedBytes: number
  }
  summary: string
}

export type GovernanceApplyOptions = MemoryRootOptions & {
  scope: GovernanceApplyScope
  policy?: MemoryStorageGovernancePolicy
  configPath?: string
  now?: () => Date
}

export type GovernanceApplyConfirmOptions = MemoryRootOptions & {
  token: string
  configPath?: string
  now?: () => Date
}

type ResolvedGovernanceApplyOptions = GovernanceApplyOptions & {
  resolvedProjectId: string
  memoryDir: string
}

type StoredGovernanceApplyPlan = {
  dryRun: GovernanceApplyDryRun
  options: ResolvedGovernanceApplyOptions
  storedAt: number
}

const governanceApplyStore = new Map<string, StoredGovernanceApplyPlan>()

export function _resetGovernanceApplyStoreForTesting(): void {
  governanceApplyStore.clear()
}

export async function createMemoryStorageGovernanceApplyDryRun(
  options: GovernanceApplyOptions,
): Promise<GovernanceApplyDryRun> {
  const now = options.now?.() ?? new Date()
  const resolved = await resolveGovernanceApplyOptions(options)
  sweepExpired(now.getTime())

  const token = randomBytes(4).toString('hex')
  const expiresAt = new Date(now.getTime() + GOVERNANCE_APPLY_TOKEN_TTL_MS).toISOString()
  const dryRun = await buildDryRun(resolved, token, expiresAt)
  governanceApplyStore.set(
    tokenKey(resolved.rootDir, resolved.resolvedProjectId, token),
    { dryRun, options: resolved, storedAt: now.getTime() },
  )
  return dryRun
}

export async function executeMemoryStorageGovernanceApply(
  options: GovernanceApplyConfirmOptions,
): Promise<GovernanceApplyExecution> {
  if (!/^[0-9a-f]{8}$/.test(options.token)) {
    throw new Error('governance apply token must be 8 hex characters')
  }

  const started = Date.now()
  const resolvedProjectId = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).then(r => r.projectId)
  const key = tokenKey(options.rootDir, resolvedProjectId, options.token)
  sweepExpired(started)
  const stored = governanceApplyStore.get(key)
  if (!stored) {
    throw new Error('governance apply token invalid or expired')
  }

  // One-shot: delete before any write. Even if a write fails, replay is
  // impossible and the operator must re-run dry-run against current disk.
  governanceApplyStore.delete(key)

  if (stored.dryRun.estimatedWrites <= 0) {
    throw new Error('governance apply token was not executable; re-run dry-run after resolving warnings')
  }

  const freshOptions: ResolvedGovernanceApplyOptions = {
    ...stored.options,
    rootDir: options.rootDir,
    memoryDir: options.memoryDir ?? stored.options.memoryDir,
    projectId: options.projectId,
    configPath: options.configPath ?? stored.options.configPath,
    now: options.now ?? stored.options.now,
  }
  const dryRun = await buildDryRun(
    freshOptions,
    options.token,
    new Date(started + GOVERNANCE_APPLY_TOKEN_TTL_MS).toISOString(),
  )

  const results: GovernanceApplyActionResult[] = []
  for (const action of dryRun.actions) {
    if (!action.safeToExecute || action.status !== 'planned') {
      results.push({
        id: action.id,
        status: action.blocked ? 'blocked' : 'skipped',
        count: action.count,
        reclaimedBytes: 0,
        blocked: action.blocked,
        detail: action.detail,
      })
      continue
    }

    try {
      if (action.id === 'profile-prune-redundant') {
        results.push(await executeProfilePrune(freshOptions))
      } else if (action.id === 'proposal-prune-stale-candidates') {
        results.push(await executeProposalPrune(freshOptions))
      } else if (action.id === 'sqlite-rebuild-index') {
        results.push(await executeSqliteRebuild(freshOptions))
      } else if (action.id === 'archive-export-project-bundle') {
        results.push(await executeExportBundle({
          ...freshOptions,
          now: freshOptions.now ?? (() => new Date()),
        }))
      } else {
        results.push({
          id: action.id,
          status: 'blocked',
          count: action.count,
          reclaimedBytes: 0,
          blocked: 'unsupported-action',
        })
      }
    } catch (error) {
      results.push({
        id: action.id,
        status: 'failed',
        count: action.count,
        reclaimedBytes: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const finished = Date.now()
  const totals = {
    executed: results.filter(r => r.status === 'executed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    blocked: results.filter(r => r.status === 'blocked').length,
    failed: results.filter(r => r.status === 'failed').length,
    reclaimedBytes: results.reduce((sum, r) => sum + r.reclaimedBytes, 0),
  }

  return {
    dryRun: false,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    projectId: options.projectId,
    resolvedProjectId,
    memoryDir: freshOptions.memoryDir,
    scope: stored.options.scope,
    results,
    totals,
    summary: totals.failed > 0
      ? 'governance apply completed with failures'
      : totals.executed > 0
        ? 'governance apply completed'
        : 'governance apply made no changes',
  }
}

async function resolveGovernanceApplyOptions(
  options: GovernanceApplyOptions,
): Promise<ResolvedGovernanceApplyOptions> {
  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  })
  const memoryDir = getProjectMemoryDir({
    ...options,
    projectId: resolved.projectId,
  })
  return {
    ...options,
    resolvedProjectId: resolved.projectId,
    memoryDir,
  }
}

async function buildDryRun(
  options: ResolvedGovernanceApplyOptions,
  token: string,
  expiresAt: string,
): Promise<GovernanceApplyDryRun> {
  const report = await generateMemoryStorageGovernanceReport({
    ...options,
    projectId: options.resolvedProjectId,
    policy: options.policy ?? getDefaultMemoryStoragePolicy(),
    configPath: options.configPath,
    now: options.now,
  })
  const sidecarDisabled = isSidecarFullyDisabled(options.configPath)
  const actions = await computeApplyActions(options, sidecarDisabled)
  const executable = actions.filter(a => a.safeToExecute && a.status === 'planned')
  const warnings = [...report.warnings]
  if (!sidecarDisabled) {
    warnings.push('sidecar must be disabled before governance apply to avoid append/rewrite races')
  }

  return {
    dryRun: true,
    token,
    expiresAt,
    projectId: options.projectId,
    resolvedProjectId: options.resolvedProjectId,
    memoryDir: options.memoryDir,
    scope: options.scope,
    sidecarDisabled,
    actions,
    estimatedWrites: executable.length,
    estimatedReclaimBytes: executable.reduce((sum, a) => sum + a.estimatedBytes, 0),
    warnings,
    recommendedActions: executable.length > 0
      ? [`/memory-sidecar governance apply --confirm ${token}`]
      : sidecarDisabled
        ? ['/memory-sidecar governance status']
        : ['/memory-sidecar disable', '/memory-sidecar governance plan'],
    confirmCommand: `/memory-sidecar governance apply --confirm ${token}`,
  }
}

async function computeApplyActions(
  options: ResolvedGovernanceApplyOptions,
  sidecarDisabled: boolean,
): Promise<GovernanceApplyDryRunAction[]> {
  const scopes = expandScope(options.scope)
  const actions: GovernanceApplyDryRunAction[] = []
  if (scopes.includes('profile-prune-redundant')) {
    const target = await profilePruneTargets(options)
    actions.push(toDryRunAction({
      id: 'profile-prune-redundant',
      count: target.prune.length,
      estimatedBytes: target.estimatedBytes,
      sidecarDisabled,
      detail: target.prune.length > 0
        ? `would keep latest ${options.policy?.profileKeepLatest ?? getDefaultMemoryStoragePolicy().profileKeepLatest} profile snapshots`
        : 'profile snapshots are already within retention',
      targets: target.prune.slice(0, 5).map(p => `${p.profile.generatedAt} ${p.profile.sourceJobId}`),
    }))
  }
  if (scopes.includes('proposal-prune-stale-candidates')) {
    const target = await proposalPruneTargets(options)
    actions.push(toDryRunAction({
      id: 'proposal-prune-stale-candidates',
      count: target.pruneProposalIds.size,
      estimatedBytes: target.estimatedBytes,
      sidecarDisabled,
      detail: target.pruneProposalIds.size > 0
        ? `would remove stale current candidate proposals older than ${target.staleProposalDays} days`
        : 'no stale current candidate proposals',
      targets: [...target.pruneProposalIds].slice(0, 5),
    }))
  }
  if (scopes.includes('sqlite-rebuild-index')) {
    const target = await sqliteRebuildTarget(options)
    actions.push(toSqliteRebuildDryRunAction({
      target,
      sidecarDisabled,
    }))
  }
  if (scopes.includes('archive-export-project-bundle')) {
    const target = await exportBundleTarget(options)
    actions.push(toExportBundleDryRunAction({ target, sidecarDisabled }))
  }
  return actions
}

function toDryRunAction(input: {
  id: GovernanceApplyActionId
  count: number
  estimatedBytes: number
  sidecarDisabled: boolean
  detail: string
  targets: string[]
}): GovernanceApplyDryRunAction {
  if (input.count <= 0) {
    return {
      id: input.id,
      status: 'noop',
      count: 0,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'no-targets',
      detail: input.detail,
    }
  }
  if (!input.sidecarDisabled) {
    return {
      id: input.id,
      status: 'blocked',
      count: input.count,
      estimatedBytes: input.estimatedBytes,
      safeToExecute: false,
      blocked: 'sidecar-enabled',
      detail: input.detail,
      targets: input.targets,
    }
  }
  return {
    id: input.id,
    status: 'planned',
    count: input.count,
    estimatedBytes: input.estimatedBytes,
    safeToExecute: true,
    detail: input.detail,
    targets: input.targets,
  }
}

function expandScope(scope: GovernanceApplyScope): GovernanceApplyActionId[] {
  // W149-B: `all` keeps to the JSONL prune actions. sqlite-rebuild-index
  // requires an explicit scope so an operator running the broad `all`
  // sweep is never surprised by an index rebuild — the rebuild can take
  // seconds on large archives and the operator deserves an explicit
  // confirmation that this specific action is what they asked for.
  return scope === 'all'
    ? ['profile-prune-redundant', 'proposal-prune-stale-candidates']
    : [scope]
}

function isSidecarFullyDisabled(configPath?: string): boolean {
  try {
    const config = loadMemorySidecarConfig(
      configPath ?? getDefaultMemorySidecarConfigPath(),
    )
    return (
      config.enabled === false &&
      config.capture.enabled === false &&
      config.adapter.enabled === false
    )
  } catch {
    return false
  }
}

async function profilePruneTargets(options: ResolvedGovernanceApplyOptions): Promise<{
  all: ProfileSnapshotWithLocation[]
  keep: ProfileSnapshotWithLocation[]
  prune: ProfileSnapshotWithLocation[]
  estimatedBytes: number
}> {
  const policy = options.policy ?? getDefaultMemoryStoragePolicy()
  const all = await listProfileSnapshots({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
    limit: Number.POSITIVE_INFINITY,
  })
  const byNewest = [...all].sort((a, b) =>
    b.profile.generatedAt.localeCompare(a.profile.generatedAt),
  )
  const keepSet = new Set(
    byNewest
      .slice(0, Math.max(0, policy.profileKeepLatest))
      .map(entry => entry.byteOffset),
  )
  const keep = all.filter(entry => keepSet.has(entry.byteOffset))
  const prune = all.filter(entry => !keepSet.has(entry.byteOffset))
  return {
    all,
    keep,
    prune,
    estimatedBytes: prune.reduce((sum, entry) => sum + entry.byteLength, 0),
  }
}

async function proposalPruneTargets(options: ResolvedGovernanceApplyOptions): Promise<{
  all: ProposalWithLocation[]
  keep: ProposalWithLocation[]
  pruneProposalIds: Set<string>
  estimatedBytes: number
  staleProposalDays: number
}> {
  const policy = options.policy ?? getDefaultMemoryStoragePolicy()
  const now = options.now?.() ?? new Date()
  const staleCutoffMs = now.getTime() - policy.staleProposalDays * 86_400_000
  const latest = await recentProposals({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
    limit: Number.POSITIVE_INFINITY,
  })
  const pruneProposalIds = new Set<string>()
  for (const entry of latest) {
    if (entry.proposal.status !== 'candidate') continue
    const created = Date.parse(entry.proposal.createdAt)
    if (Number.isFinite(created) && created < staleCutoffMs) {
      pruneProposalIds.add(entry.proposal.proposalId)
    }
  }
  const all = await listProposals({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
    limit: Number.POSITIVE_INFINITY,
  })
  const keep = all.filter(entry => !pruneProposalIds.has(entry.proposal.proposalId))
  const estimatedBytes = all
    .filter(entry => pruneProposalIds.has(entry.proposal.proposalId))
    .reduce((sum, entry) => sum + entry.byteLength, 0)
  return {
    all,
    keep,
    pruneProposalIds,
    estimatedBytes,
    staleProposalDays: policy.staleProposalDays,
  }
}

async function executeProfilePrune(
  options: ResolvedGovernanceApplyOptions,
): Promise<GovernanceApplyActionResult> {
  const target = await profilePruneTargets(options)
  if (target.prune.length <= 0) {
    return {
      id: 'profile-prune-redundant',
      status: 'skipped',
      count: 0,
      reclaimedBytes: 0,
      detail: 'no redundant profile snapshots',
    }
  }
  const file = getProfileSnapshotsPath({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
  })
  await rewriteJsonlFile({
    file,
    memoryDir: options.memoryDir,
    records: target.keep.map(entry => entry.profile),
  })
  return {
    id: 'profile-prune-redundant',
    status: 'executed',
    count: target.prune.length,
    reclaimedBytes: target.estimatedBytes,
    detail: `kept ${target.keep.length} profile snapshots`,
  }
}

// --- W149-B sqlite-rebuild-index ----------------------------------------

type SqliteRebuildTarget = {
  sqlitePath: string
  sqlitePresent: boolean
  currentRows: number | null
  archiveEvents: number
  estimatedRows: number
  rebuildReason:
    | 'consistent'
    | 'sqlite-missing'
    | 'row-mismatch'
    | 'sqlite-error'
    | 'archive-empty'
  rebuildReasonDetail?: string
}

async function sqliteRebuildTarget(
  options: ResolvedGovernanceApplyOptions,
): Promise<SqliteRebuildTarget> {
  const report = await generateMemoryStorageGovernanceReport({
    ...options,
    projectId: options.resolvedProjectId,
    policy: options.policy ?? getDefaultMemoryStoragePolicy(),
    configPath: options.configPath,
    now: options.now,
  })
  return classifySqliteRebuildTarget(options.memoryDir, report)
}

function classifySqliteRebuildTarget(
  memoryDir: string,
  report: MemoryStorageGovernanceReport,
): SqliteRebuildTarget {
  const sqlitePath = `${memoryDir}/memory.db`
  const archiveEvents = report.archive.events
  const sqlitePresent = report.sqlite.present
  const currentRows = report.sqlite.rowCount ?? null

  if (report.sqlite.error) {
    return {
      sqlitePath,
      sqlitePresent,
      currentRows,
      archiveEvents,
      estimatedRows: archiveEvents,
      rebuildReason: 'sqlite-error',
      rebuildReasonDetail: report.sqlite.error,
    }
  }
  if (archiveEvents <= 0) {
    return {
      sqlitePath,
      sqlitePresent,
      currentRows,
      archiveEvents,
      estimatedRows: 0,
      rebuildReason: 'archive-empty',
    }
  }
  if (!sqlitePresent) {
    return {
      sqlitePath,
      sqlitePresent,
      currentRows,
      archiveEvents,
      estimatedRows: archiveEvents,
      rebuildReason: 'sqlite-missing',
    }
  }
  if (currentRows !== null && currentRows !== archiveEvents) {
    return {
      sqlitePath,
      sqlitePresent,
      currentRows,
      archiveEvents,
      estimatedRows: archiveEvents,
      rebuildReason: 'row-mismatch',
    }
  }
  return {
    sqlitePath,
    sqlitePresent,
    currentRows,
    archiveEvents,
    estimatedRows: archiveEvents,
    rebuildReason: 'consistent',
  }
}

function toSqliteRebuildDryRunAction(input: {
  target: SqliteRebuildTarget
  sidecarDisabled: boolean
}): GovernanceApplyDryRunAction {
  const { target, sidecarDisabled } = input
  // archive-empty / consistent → noop. sqlite-error → blocked (can't
  // safely unlink a db whose state we couldn't read; operator should
  // run /memory-sidecar repair first).
  if (target.rebuildReason === 'archive-empty') {
    return {
      id: 'sqlite-rebuild-index',
      status: 'noop',
      count: 0,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'no-targets',
      detail: 'archive is empty; nothing to rebuild from',
    }
  }
  if (target.rebuildReason === 'consistent') {
    return {
      id: 'sqlite-rebuild-index',
      status: 'noop',
      count: 0,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'no-targets',
      detail: `sqlite rowCount=${target.currentRows} matches archive events=${target.archiveEvents}`,
    }
  }
  if (target.rebuildReason === 'sqlite-error') {
    return {
      id: 'sqlite-rebuild-index',
      status: 'blocked',
      count: 0,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'unsupported-action',
      detail:
        `sqlite read error: ${target.rebuildReasonDetail ?? 'unknown'}; ` +
        'run /memory-sidecar repair plan before rebuild',
    }
  }
  if (!sidecarDisabled) {
    return {
      id: 'sqlite-rebuild-index',
      status: 'blocked',
      count: 1,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'sidecar-enabled',
      detail:
        target.rebuildReason === 'sqlite-missing'
          ? `sqlite is missing while archive has ${target.archiveEvents} events`
          : `sqlite rowCount=${target.currentRows} != archive events=${target.archiveEvents}`,
    }
  }
  return {
    id: 'sqlite-rebuild-index',
    status: 'planned',
    count: 1,
    estimatedBytes: 0,
    safeToExecute: true,
    detail:
      target.rebuildReason === 'sqlite-missing'
        ? `would rebuild memory.db from archive (~${target.estimatedRows} events)`
        : `would rebuild memory.db: rowCount=${target.currentRows} → ~${target.estimatedRows}`,
    targets: [target.sqlitePath],
  }
}

async function executeSqliteRebuild(
  options: ResolvedGovernanceApplyOptions,
): Promise<GovernanceApplyActionResult> {
  const target = await sqliteRebuildTarget(options)
  if (
    target.rebuildReason === 'archive-empty' ||
    target.rebuildReason === 'consistent'
  ) {
    return {
      id: 'sqlite-rebuild-index',
      status: 'skipped',
      count: 0,
      reclaimedBytes: 0,
      detail: target.rebuildReason === 'archive-empty'
        ? 'archive is empty; nothing to rebuild'
        : 'sqlite already consistent with archive',
    }
  }
  if (target.rebuildReason === 'sqlite-error') {
    return {
      id: 'sqlite-rebuild-index',
      status: 'blocked',
      count: 0,
      reclaimedBytes: 0,
      blocked: 'unsupported-action',
      detail: 'sqlite read error; run /memory-sidecar repair plan first',
    }
  }

  // The write guard belongs to JSONL paths; sqlite path is allowlisted
  // separately by `assertWriteWithinProjectMemoryDir` (which now permits
  // memory.db). Doing one assertion before rebuildArchiveIndex is
  // belt-and-suspenders against future regressions in path resolution.
  assertWriteWithinProjectMemoryDir(target.sqlitePath, options.memoryDir)

  const rowsBefore = target.currentRows
  const started = Date.now()
  const result = await rebuildArchiveIndex({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
  })
  const finished = Date.now()
  return {
    id: 'sqlite-rebuild-index',
    status: 'executed',
    count: 1,
    reclaimedBytes: 0,
    detail:
      `rebuilt memory.db (${rowsBefore ?? 'absent'} → ${result.indexed} events` +
      (result.ftsAvailable ? ', fts available' : ', fts unavailable') +
      ')',
    sqliteRebuild: {
      rowsBefore,
      rowsAfter: result.indexed,
      durationMs: finished - started,
      archiveChanged: false,
      ftsAvailable: result.ftsAvailable,
    },
  }
}

async function executeProposalPrune(
  options: ResolvedGovernanceApplyOptions,
): Promise<GovernanceApplyActionResult> {
  const target = await proposalPruneTargets(options)
  if (target.pruneProposalIds.size <= 0) {
    return {
      id: 'proposal-prune-stale-candidates',
      status: 'skipped',
      count: 0,
      reclaimedBytes: 0,
      detail: 'no stale proposal candidates',
    }
  }
  const file = getProposalsPath({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.resolvedProjectId,
  })
  await rewriteJsonlFile({
    file,
    memoryDir: options.memoryDir,
    records: target.keep.map(entry => entry.proposal),
  })
  return {
    id: 'proposal-prune-stale-candidates',
    status: 'executed',
    count: target.pruneProposalIds.size,
    reclaimedBytes: target.estimatedBytes,
    detail: `removed ${target.pruneProposalIds.size} stale current candidate proposal(s)`,
  }
}

// --- W149-C archive-export-project-bundle ------------------------------

type ExportBundleTarget = {
  archiveSessionsDir: string
  archiveSessionFiles: string[]
  archiveEvents: number
  observationsPath: string
  observationsExists: boolean
  observationsCount: number
  profilesPath: string
  profilesExists: boolean
  profilesCount: number
  proposalsPath: string
  proposalsExists: boolean
  proposalsCount: number
  exportsDir: string
}

function getMemorySidecarRoot(options: ResolvedGovernanceApplyOptions): string {
  // Mirror getProjectMemoryDir's default-resolution logic: if the
  // caller passed an explicit memoryDir we walk back up two levels
  // (`<rootDir>/projects/<id>/memory` → `<rootDir>`); otherwise apply
  // the same `~/.mossen` default the rest of the sidecar uses.
  if (options.rootDir) return options.rootDir
  if (options.memoryDir) {
    const projectsDir = path.dirname(path.dirname(options.memoryDir))
    return path.dirname(projectsDir)
  }
  return `${process.env.HOME ?? '.'}/.mossen`
}

function getExportsDir(options: ResolvedGovernanceApplyOptions): string {
  return path.join(getMemorySidecarRoot(options), 'exports')
}

async function exportBundleTarget(
  options: ResolvedGovernanceApplyOptions,
): Promise<ExportBundleTarget> {
  const { stat: statAsync } = await import('node:fs/promises')
  const memoryDir = options.memoryDir
  const archiveSessionsDir = path.join(memoryDir, 'archive', 'sessions')
  const observationsPath = path.join(memoryDir, 'observations.jsonl')
  const profilesPath = path.join(memoryDir, 'profiles.jsonl')
  const proposalsPath = path.join(memoryDir, 'proposals.jsonl')

  const archiveSessionFiles: string[] = []
  let archiveEvents = 0
  try {
    const entries = await listArchiveSessionFilesWithGzipFallback(
      archiveSessionsDir,
    )
    for (const entry of entries) {
      const sessionId = path.basename(entry, '.jsonl')
      const readPath = await getArchiveSessionReadPath({
        ...options,
        projectId: options.resolvedProjectId,
        sessionId,
      })
      if (readPath.kind === 'missing') continue
      archiveSessionFiles.push(readPath.path)
      archiveEvents += (
        await readArchiveEvents({
          ...options,
          projectId: options.resolvedProjectId,
          sessionId,
        })
      ).length
    }
  } catch {
    // archive may be absent on a fresh project; bundle still yields a
    // valid manifest with archiveEvents=0.
  }

  const [observationsCount, observationsExists] =
    await countJsonlIfPresent(observationsPath, statAsync)
  const [profilesCount, profilesExists] =
    await countJsonlIfPresent(profilesPath, statAsync)
  const [proposalsCount, proposalsExists] =
    await countJsonlIfPresent(proposalsPath, statAsync)

  return {
    archiveSessionsDir,
    archiveSessionFiles,
    archiveEvents,
    observationsPath,
    observationsExists,
    observationsCount,
    profilesPath,
    profilesExists,
    profilesCount,
    proposalsPath,
    proposalsExists,
    proposalsCount,
    exportsDir: getExportsDir(options),
  }
}

async function countJsonlIfPresent(
  filePath: string,
  statAsync: (path: string) => Promise<{ isFile(): boolean }>,
): Promise<[number, boolean]> {
  try {
    const info = await statAsync(filePath)
    if (!info.isFile()) return [0, false]
    return [await countJsonlLines(filePath), true]
  } catch {
    return [0, false]
  }
}

async function countJsonlLines(filePath: string): Promise<number> {
  const { readFile } = await import('node:fs/promises')
  try {
    const body = await readFile(filePath, 'utf8')
    if (!body) return 0
    return body.split('\n').filter(line => line.length > 0).length
  } catch {
    return 0
  }
}

function toExportBundleDryRunAction(input: {
  target: ExportBundleTarget
  sidecarDisabled: boolean
}): GovernanceApplyDryRunAction {
  const { target, sidecarDisabled } = input
  const totalRecords =
    target.archiveEvents +
    target.observationsCount +
    target.profilesCount +
    target.proposalsCount

  if (totalRecords <= 0) {
    return {
      id: 'archive-export-project-bundle',
      status: 'noop',
      count: 0,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'no-targets',
      detail: 'project has no archive / observation / profile / proposal data to export',
    }
  }
  if (!sidecarDisabled) {
    return {
      id: 'archive-export-project-bundle',
      status: 'blocked',
      count: 1,
      estimatedBytes: 0,
      safeToExecute: false,
      blocked: 'sidecar-enabled',
      detail: `would export ${totalRecords} record(s); sidecar must be disabled first`,
    }
  }
  return {
    id: 'archive-export-project-bundle',
    status: 'planned',
    count: 1,
    estimatedBytes: 0,
    safeToExecute: true,
    detail:
      `would export ${target.archiveEvents} archive events, ` +
      `${target.observationsCount} observations, ` +
      `${target.profilesCount} profiles, ` +
      `${target.proposalsCount} proposals to ${target.exportsDir}`,
    targets: [target.exportsDir],
  }
}

async function executeExportBundle(
  options: ResolvedGovernanceApplyOptions & { now: () => Date },
): Promise<GovernanceApplyActionResult> {
  const target = await exportBundleTarget(options)
  const totalRecords =
    target.archiveEvents +
    target.observationsCount +
    target.profilesCount +
    target.proposalsCount
  if (totalRecords <= 0) {
    return {
      id: 'archive-export-project-bundle',
      status: 'skipped',
      count: 0,
      reclaimedBytes: 0,
      detail: 'project has no data to export',
    }
  }

  const { mkdir, copyFile, writeFile, readFile, stat: statAsync } = await import(
    'node:fs/promises'
  )
  const { createHash } = await import('node:crypto')
  const stamp = options
    .now()
    .toISOString()
    .replace(/[:.]/g, '-')
  const suffix = randomBytes(4).toString('hex')
  const safeProjectId = options.resolvedProjectId.replace(/[^A-Za-z0-9._-]/g, '_')
  const bundleDir = path.join(
    target.exportsDir,
    `${safeProjectId}-${stamp}-${suffix}`,
  )

  // bundle dir must be a fresh path. statAsync throwing is the success
  // signal; if it resolves we abort to avoid clobbering.
  try {
    await statAsync(bundleDir)
    throw new Error(`refusing export: bundle path already exists: ${bundleDir}`)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(bundleDir, { recursive: true })
  const archiveOutDir = path.join(bundleDir, 'archive', 'events')
  await mkdir(archiveOutDir, { recursive: true })

  const writtenFiles: string[] = []
  const sourceMtimesBefore = new Map<string, number>()

  // Snapshot source mtimes so we can verify nothing in memoryDir was
  // touched by the export.
  for (const session of target.archiveSessionFiles) {
    sourceMtimesBefore.set(session, (await statAsync(session)).mtimeMs)
  }
  if (target.observationsExists) {
    sourceMtimesBefore.set(
      target.observationsPath,
      (await statAsync(target.observationsPath)).mtimeMs,
    )
  }
  if (target.profilesExists) {
    sourceMtimesBefore.set(
      target.profilesPath,
      (await statAsync(target.profilesPath)).mtimeMs,
    )
  }
  if (target.proposalsExists) {
    sourceMtimesBefore.set(
      target.proposalsPath,
      (await statAsync(target.proposalsPath)).mtimeMs,
    )
  }

  for (const session of target.archiveSessionFiles) {
    const dest = path.join(archiveOutDir, path.basename(session))
    assertWriteWithinExportsBundleDir(dest, bundleDir)
    await copyFile(session, dest)
    writtenFiles.push(dest)
  }
  if (target.observationsExists) {
    const dest = path.join(bundleDir, 'observations.jsonl')
    assertWriteWithinExportsBundleDir(dest, bundleDir)
    await copyFile(target.observationsPath, dest)
    writtenFiles.push(dest)
  }
  if (target.profilesExists) {
    const dest = path.join(bundleDir, 'profiles.jsonl')
    assertWriteWithinExportsBundleDir(dest, bundleDir)
    await copyFile(target.profilesPath, dest)
    writtenFiles.push(dest)
  }
  if (target.proposalsExists) {
    const dest = path.join(bundleDir, 'proposals.jsonl')
    assertWriteWithinExportsBundleDir(dest, bundleDir)
    await copyFile(target.proposalsPath, dest)
    writtenFiles.push(dest)
  }

  // checksums.sha256 — one line per bundle file in `<sha256>  <relpath>`
  // format (mirrors GNU sha256sum). manifest.json includes a lookup
  // table for programmatic verification.
  const checksums: Array<{ relPath: string; sha256: string; bytes: number }> = []
  let totalBytes = 0
  for (const file of writtenFiles) {
    const buf = await readFile(file)
    const sha = createHash('sha256').update(buf).digest('hex')
    const relPath = path.relative(bundleDir, file).split(path.sep).join('/')
    checksums.push({ relPath, sha256: sha, bytes: buf.length })
    totalBytes += buf.length
  }

  const manifest = {
    schemaVersion: 1,
    bundleType: 'archive-export-project-bundle',
    generatedBy: 'W149-C governance apply',
    projectId: options.projectId,
    resolvedProjectId: options.resolvedProjectId,
    sourceMemoryDir: options.memoryDir,
    bundleDir,
    timestamp: stamp,
    suffix,
    counts: {
      archiveEvents: target.archiveEvents,
      observations: target.observationsCount,
      profiles: target.profilesCount,
      proposals: target.proposalsCount,
      sessions: target.archiveSessionFiles.length,
    },
    files: checksums,
    notes: [
      'bundle is read-only data extraction; original memoryDir is byte-stable.',
      'sqlite memory.db is intentionally excluded (rebuildable from archive).',
      'worker.lock / config.json / API keys are intentionally excluded.',
    ],
  }
  const manifestPath = path.join(bundleDir, 'manifest.json')
  assertWriteWithinExportsBundleDir(manifestPath, bundleDir)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  const checksumsPath = path.join(bundleDir, 'checksums.sha256')
  assertWriteWithinExportsBundleDir(checksumsPath, bundleDir)
  const checksumsBody = checksums
    .map(c => `${c.sha256}  ${c.relPath}`)
    .join('\n') + '\n'
  await writeFile(checksumsPath, checksumsBody, 'utf8')

  // Source byte-stability check. If any source file mtime moved we
  // surface a hard failure — the rest of the bundle is already on disk
  // but the operator needs to know the exporter touched the source.
  for (const [src, mtimeBefore] of sourceMtimesBefore) {
    const after = (await statAsync(src)).mtimeMs
    if (after !== mtimeBefore) {
      throw new Error(
        `governance export touched source file: ${src} (mtime drift)`,
      )
    }
  }

  return {
    id: 'archive-export-project-bundle',
    status: 'executed',
    count: 1,
    reclaimedBytes: 0,
    detail:
      `exported ${target.archiveEvents + target.observationsCount + target.profilesCount + target.proposalsCount} record(s) ` +
      `into ${bundleDir} (${writtenFiles.length + 2} files, ${totalBytes} bytes)`,
    exportBundle: {
      bundleDir,
      manifestPath,
      fileCount: writtenFiles.length + 2,
      totalBytes: totalBytes,
      archiveEvents: target.archiveEvents,
      observations: target.observationsCount,
      profiles: target.profilesCount,
      proposals: target.proposalsCount,
      sourceChanged: false,
    },
  }
}

function assertWriteWithinExportsBundleDir(
  absPath: string,
  bundleDir: string,
): void {
  const norm = path.resolve(absPath)
  const allowed = path.resolve(bundleDir)
  if (!norm.startsWith(allowed + path.sep) && norm !== allowed) {
    throw new Error(`refusing export write outside bundle dir: ${norm}`)
  }
  // The bundle layout is fixed; reject any unexpected segments. This
  // is defense-in-depth alongside the prefix check; a future regression
  // that miscomputes a relative path will land here, not on disk.
  const rel = path.relative(allowed, norm)
  const head = rel.split(path.sep)[0] ?? ''
  if (
    head !== '' &&
    head !== 'manifest.json' &&
    head !== 'checksums.sha256' &&
    head !== 'observations.jsonl' &&
    head !== 'profiles.jsonl' &&
    head !== 'proposals.jsonl' &&
    head !== 'archive'
  ) {
    throw new Error(`refusing export write to unsupported bundle path: ${norm}`)
  }
}

async function rewriteJsonlFile(options: {
  file: string
  memoryDir: string
  records: unknown[]
}): Promise<void> {
  assertWriteWithinProjectMemoryDir(options.file, options.memoryDir)
  const temp = `${options.file}.w146-${randomBytes(4).toString('hex')}.tmp`
  assertWriteWithinProjectMemoryDir(temp, options.memoryDir)
  const body = options.records.map(record => JSON.stringify(record)).join('\n')
  const next = body ? `${body}\n` : ''
  try {
    await writeFile(temp, next, 'utf8')
    await rename(temp, options.file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function assertWriteWithinProjectMemoryDir(absPath: string, memoryDir: string): void {
  const norm = path.resolve(absPath)
  const allowed = path.resolve(memoryDir)
  if (!norm.startsWith(allowed + path.sep) && norm !== allowed) {
    throw new Error(`refusing governance write outside project memoryDir: ${norm}`)
  }
  const base = path.basename(norm)
  // W149-B: memory.db is allowlisted for sqlite-rebuild-index. Note that
  // rebuildArchiveIndex itself only writes to `<memoryDir>/memory.db`;
  // this guard is the single source of truth for "what files governance
  // apply is allowed to mutate". archive/, observations.jsonl,
  // dirty.jsonl, jobs/, worker.lock are intentionally absent — the
  // rebuild reads from archive/ but never writes to it.
  if (
    base !== 'profiles.jsonl' &&
    base !== 'proposals.jsonl' &&
    base !== 'memory.db' &&
    !base.startsWith('profiles.jsonl.w146-') &&
    !base.startsWith('proposals.jsonl.w146-')
  ) {
    throw new Error(`refusing governance write to unsupported file: ${norm}`)
  }
}

function tokenKey(rootDir: string, resolvedProjectId: string, token: string): string {
  return `${rootDir}::${resolvedProjectId}::${token}`
}

function sweepExpired(now: number): void {
  for (const [key, value] of governanceApplyStore.entries()) {
    if (now - value.storedAt > GOVERNANCE_APPLY_TOKEN_TTL_MS) {
      governanceApplyStore.delete(key)
    }
  }
}
