// W122-B Agent B — Sidecar self-repair planner + executor.
//
// Two-phase write surface gated by 8-hex one-shot tokens (10 min TTL):
//   1. getMemorySidecarRepairPlan(options)        — pure read; mints a token.
//   2. executeMemorySidecarRepairPlan({token,..}) — single-use; recomputes
//      plan, executes only actions still safe, redacts errors.
//
// Hard constraints (RED LINES):
//   - Writes ONLY via existing helpers:
//       (a) appendDirtyMarker             (memory-sidecar/src/agent/dirtyQueue.ts)
//       (b) rebuildArchiveIndex           (memory-sidecar/src/storage/sqliteIndex.ts)
//       (c) releaseStaleMemoryWorkerLock  (memory-sidecar/src/agent/releaseLock.ts)
//   - All writes scoped to getProjectMemoryDir({...options, projectId: effective}).
//   - failed-jobs is SCHEMA-BLOCKED — always status='blocked', never executed.
//   - Tokens are in-memory only (Map); not mirrored to ~/.mossen.
//   - One-shot: token deleted from store BEFORE any disk write in execute().

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { basename } from 'node:path'
import { Database } from 'bun:sqlite'

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import { redactMemoryText } from '../redaction/redact.js'
import {
  loadMemorySidecarConfig,
  getDefaultMemorySidecarConfigPath,
} from '../config/config.js'
import {
  appendDirtyMarker,
  listDirtyMarkers,
  type DirtyMarker,
} from '../agent/dirtyQueue.js'
import { getMemoryWorkerStatus } from '../agent/workerLoop.js'
import { rebuildArchiveIndex } from '../storage/sqliteIndex.js'
import {
  listArchiveSessionFilesWithGzipFallback,
  readArchiveEvents,
} from '../storage/jsonlArchiveStore.js'
import { releaseStaleMemoryWorkerLock } from '../agent/releaseLock.js'

export const REPAIR_TOKEN_TTL_MS = 10 * 60 * 1000

export type RepairActionId =
  | 'missing-dirty'
  | 'stale-lock'
  | 'index-rebuild'
  | 'failed-jobs'

export type RepairBlockedReason =
  | 'job-queue-immutable'
  | 'cross-host-lock'
  | 'live-lock'
  | 'unknown-pid'
  | 'sidecar-disabled'
  | 'archive-empty'
  | 'no-stale-lock'
  | 'no-missing-dirty'
  | 'sqlite-up-to-date'

export type RepairAction = {
  id: RepairActionId
  status: 'planned' | 'blocked' | 'noop'
  count: number
  detail?: string
  targets?: string[]
  safeToExecute: boolean
  blocked?: RepairBlockedReason
  recommendedAction?: string
}

export type RepairPlan = {
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  token: string
  expiresAt: string
  actions: RepairAction[]
  warnings: string[]
  estimatedWrites: number
  recommendedActions: string[]
  confirmCommand: string
}

export type RepairExecuteOptions = MemoryRootOptions & { token: string }

export type RepairActionResult = {
  id: RepairActionId
  status: 'executed' | 'skipped' | 'failed' | 'blocked'
  count: number
  detail?: string
  errorMessage?: string
}

export type RepairExecution = {
  startedAt: string
  finishedAt: string
  durationMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  results: RepairActionResult[]
  totals: { executed: number; skipped: number; failed: number; blocked: number }
  summary: string
}

// --- Token store ------------------------------------------------------------

type StoredPlan = { plan: RepairPlan; storedAt: number }

const repairPlanStore = new Map<string, StoredPlan>()

function tokenKey(rootDir: string, resolvedProjectId: string, token: string): string {
  return `${rootDir}::${resolvedProjectId}::${token}`
}

function sweepExpired(now: number): void {
  for (const [key, entry] of repairPlanStore.entries()) {
    if (now - entry.storedAt > REPAIR_TOKEN_TTL_MS) {
      repairPlanStore.delete(key)
    }
  }
}

export function _resetRepairPlanStoreForTesting(): void {
  repairPlanStore.clear()
}

// --- Path safety ------------------------------------------------------------

function assertWriteWithinProjectMemoryDir(absPath: string, memoryDir: string): void {
  const norm = path.resolve(absPath)
  const allowed = path.resolve(memoryDir)
  if (!norm.startsWith(allowed + path.sep) && norm !== allowed) {
    throw new Error(`refusing write outside project memoryDir: path=${norm}`)
  }
}

// --- Internal recon helpers (re-derived locally; do NOT import Agent A) -----

type Recon = {
  effectiveProjectId: string
  memoryDir: string
  sessionsDir: string
  sidecarEnabled: boolean
  archiveEventCount: number
  jsonlSessionFiles: string[]
  archiveEventsBySession: Map<string, { eventId: string; sessionId: string }[]>
  unmarkedArchiveEvents: { eventId: string; sessionId: string; jsonlPath: string }[]
  sqliteExists: boolean
  sqliteCount: number
  workerStatus: Awaited<ReturnType<typeof getMemoryWorkerStatus>>
  activeFailedJobs: number
}

async function recon(options: MemoryRootOptions): Promise<Recon> {
  const resolved = await resolveProjectId({ ...options, projectId: options.projectId })
  const effectiveProjectId = resolved.projectId
  const projOpts = { ...options, projectId: effectiveProjectId }
  const memoryDir = getProjectMemoryDir(projOpts)
  const sessionsDir = `${memoryDir}/archive/sessions`

  // Sidecar enabled?
  let sidecarEnabled = true
  try {
    const cfg = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
    sidecarEnabled = cfg.enabled === true
  } catch {
    sidecarEnabled = false
  }

  // List session files + read events.
  const jsonlSessionFiles: string[] = []
  const archiveEventsBySession = new Map<string, { eventId: string; sessionId: string }[]>()
  let archiveEventCount = 0
  try {
    const files = await listArchiveSessionFilesWithGzipFallback(sessionsDir)
    for (const f of files) {
      jsonlSessionFiles.push(f)
      const sessionId = basename(f, '.jsonl')
      const events = await readArchiveEvents({ ...projOpts, sessionId })
      const list = events.map(entry => ({
        eventId: entry.event.eventId,
        sessionId: entry.event.sessionId,
      }))
      archiveEventsBySession.set(sessionId, list)
      archiveEventCount += list.length
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }

  // Dirty markers: collect all eventIds already covered.
  const markers: DirtyMarker[] = await listDirtyMarkers(projOpts)
  const markedEventIds = new Set<string>()
  for (const marker of markers) {
    for (const id of marker.eventIds) {
      markedEventIds.add(id)
    }
  }

  // Compute unmarked archive events (missing-dirty candidates).
  const unmarkedArchiveEvents: { eventId: string; sessionId: string; jsonlPath: string }[] = []
  for (const [sessionId, events] of archiveEventsBySession.entries()) {
    for (const ev of events) {
      if (!markedEventIds.has(ev.eventId)) {
        unmarkedArchiveEvents.push({
          eventId: ev.eventId,
          sessionId,
          jsonlPath: `archive/sessions/${sessionId}.jsonl`,
        })
      }
    }
  }

  // Sqlite count.
  const dbPath = `${memoryDir}/memory.db`
  const sqliteExists = existsSync(dbPath)
  let sqliteCount = 0
  if (sqliteExists) {
    try {
      // W146.2 P2-2: recon is a pure read; open SQLite in readonly mode
      // to align with W143-E1 / dataIntegrityReport / storageGovernance-
      // Report. The previous {readwrite:true} flag worked but advertised
      // a write intent that this code path never honors, and bun:sqlite
      // 1.3.x on some macOS builds prefers the explicit readonly flag.
      const db = new Database(dbPath, { readonly: true, create: false })
      try {
        const row = db.query('SELECT COUNT(*) AS c FROM archive_events').get() as
          | { c: number }
          | undefined
        sqliteCount = row?.c ?? 0
      } finally {
        db.close()
      }
    } catch {
      sqliteCount = 0
    }
  }

  const workerStatus = await getMemoryWorkerStatus(projOpts)
  const activeFailedJobs = workerStatus.retries.activeFailedJobs

  return {
    effectiveProjectId,
    memoryDir,
    sessionsDir,
    sidecarEnabled,
    archiveEventCount,
    jsonlSessionFiles,
    archiveEventsBySession,
    unmarkedArchiveEvents,
    sqliteExists,
    sqliteCount,
    workerStatus,
    activeFailedJobs,
  }
}

// --- Action computation -----------------------------------------------------

function computeActions(recon: Recon): RepairAction[] {
  // W122-B.1: when sidecar is disabled, EVERY mutation action must be
  // blocked with safeToExecute=false. Previously only missing-dirty was
  // gated on sidecarEnabled; stale-lock and index-rebuild could still
  // surface safeToExecute=true, letting confirm write to disk after
  // disable. Now the planner short-circuits the entire action set when
  // disabled. failed-jobs keeps its standalone job-queue-immutable
  // reason since it is forbidden in both states.
  if (!recon.sidecarEnabled) {
    return [
      {
        id: 'missing-dirty',
        status: 'blocked',
        count: recon.unmarkedArchiveEvents.length,
        safeToExecute: false,
        blocked: 'sidecar-disabled',
        detail: 'memory sidecar is disabled; enable before reconciling dirty queue',
        recommendedAction: '/memory-sidecar enable',
      },
      {
        id: 'stale-lock',
        status: 'blocked',
        count: recon.workerStatus.lock.held ? 1 : 0,
        safeToExecute: false,
        blocked: 'sidecar-disabled',
        detail: 'memory sidecar is disabled; worker.lock release deferred',
        recommendedAction: '/memory-sidecar enable',
      },
      {
        id: 'index-rebuild',
        status: 'blocked',
        count: recon.archiveEventCount,
        safeToExecute: false,
        blocked: 'sidecar-disabled',
        detail: 'memory sidecar is disabled; sqlite rebuild deferred',
        recommendedAction: '/memory-sidecar enable',
      },
      {
        id: 'failed-jobs',
        status: 'blocked',
        count: recon.activeFailedJobs,
        safeToExecute: false,
        blocked: 'job-queue-immutable',
        detail:
          recon.activeFailedJobs === 0
            ? 'no active failed jobs'
            : `${recon.activeFailedJobs} active failed job(s); job-queue is append-only`,
        recommendedAction: '/memory-sidecar worker status',
      },
    ]
  }

  const actions: RepairAction[] = []

  // 1. missing-dirty
  if (recon.unmarkedArchiveEvents.length === 0) {
    actions.push({
      id: 'missing-dirty',
      status: 'noop',
      count: 0,
      safeToExecute: false,
      blocked: 'no-missing-dirty',
      detail: 'all archive events already have dirty markers',
    })
  } else {
    const targets = Array.from(
      new Set(recon.unmarkedArchiveEvents.map(ev => ev.jsonlPath)),
    ).sort()
    actions.push({
      id: 'missing-dirty',
      status: 'planned',
      count: recon.unmarkedArchiveEvents.length,
      safeToExecute: true,
      targets,
      detail: `append ${recon.unmarkedArchiveEvents.length} dirty marker(s) for archive events missing reconciliation`,
      recommendedAction: '/memory-sidecar worker run-once',
    })
  }

  // 2. stale-lock
  const lock = recon.workerStatus.lock
  if (!lock.held) {
    actions.push({
      id: 'stale-lock',
      status: 'noop',
      count: 0,
      safeToExecute: false,
      blocked: 'no-stale-lock',
      detail: 'worker.lock is not present',
    })
  } else if (lock.sameHost === false) {
    actions.push({
      id: 'stale-lock',
      status: 'blocked',
      count: 1,
      safeToExecute: false,
      blocked: 'cross-host-lock',
      detail: `lock owned by a different host (hostname=${lock.hostname ?? 'unknown'}); refusing to release`,
    })
  } else if (lock.pidAlive === true) {
    actions.push({
      id: 'stale-lock',
      status: 'blocked',
      count: 1,
      safeToExecute: false,
      blocked: 'live-lock',
      detail: `worker pid=${lock.pid ?? 'unknown'} is alive; not stale`,
    })
  } else if (
    (lock.staleReason === 'dead_pid' && lock.sameHost === true && lock.pidDead === true) ||
    (lock.staleReason === 'mtime' && lock.stale === true)
  ) {
    actions.push({
      id: 'stale-lock',
      status: 'planned',
      count: 1,
      safeToExecute: true,
      targets: ['agent/worker.lock'],
      detail: `stale worker.lock (reason=${lock.staleReason}, pid=${lock.pid ?? 'unknown'})`,
      recommendedAction: '/memory-sidecar repair --confirm <token>',
    })
  } else {
    actions.push({
      id: 'stale-lock',
      status: 'blocked',
      count: 1,
      safeToExecute: false,
      blocked: 'unknown-pid',
      detail: `lock state undecidable (staleReason=${lock.staleReason ?? 'none'})`,
    })
  }

  // 3. index-rebuild
  if (recon.archiveEventCount === 0) {
    actions.push({
      id: 'index-rebuild',
      status: 'noop',
      count: 0,
      safeToExecute: false,
      blocked: 'archive-empty',
      detail: 'archive is empty; nothing to index',
    })
  } else if (recon.sqliteExists && recon.sqliteCount === recon.archiveEventCount) {
    actions.push({
      id: 'index-rebuild',
      status: 'noop',
      count: 0,
      safeToExecute: false,
      blocked: 'sqlite-up-to-date',
      detail: `sqlite already has ${recon.sqliteCount} events matching ${recon.archiveEventCount} jsonl events`,
    })
  } else {
    actions.push({
      id: 'index-rebuild',
      status: 'planned',
      count: recon.archiveEventCount,
      safeToExecute: true,
      targets: ['memory.db'],
      detail: `rebuild sqlite index (jsonl=${recon.archiveEventCount}, sqlite=${recon.sqliteExists ? recon.sqliteCount : 'absent'})`,
      recommendedAction: '/memory-sidecar repair --confirm <token>',
    })
  }

  // 4. failed-jobs (SCHEMA-BLOCKED — never executed)
  actions.push({
    id: 'failed-jobs',
    status: 'blocked',
    count: recon.activeFailedJobs,
    safeToExecute: false,
    blocked: 'job-queue-immutable',
    detail:
      recon.activeFailedJobs === 0
        ? 'no active failed jobs'
        : `${recon.activeFailedJobs} active failed job(s); job-queue is append-only`,
    recommendedAction:
      'inspect via /memory-sidecar worker status; job-queue is append-only — destructive cleanup not supported',
  })

  return actions
}

// --- Plan ------------------------------------------------------------------

async function buildPlan(options: MemoryRootOptions): Promise<{ plan: RepairPlan; recon: Recon }> {
  const r = await recon(options)
  const actions = computeActions(r)

  const warnings: string[] = []
  if (!r.sidecarEnabled) {
    warnings.push('sidecar disabled — most actions are gated until /memory-sidecar enable')
  }
  if (actions.find(a => a.id === 'failed-jobs' && a.count > 0)) {
    warnings.push('failed-jobs cannot be executed automatically (append-only queue)')
  }

  const recommendedActions = actions
    .filter(a => a.recommendedAction)
    .map(a => a.recommendedAction as string)

  const estimatedWrites = actions
    .filter(a => a.safeToExecute)
    .reduce((sum, a) => sum + a.count, 0)

  const tokenBytes = randomBytes(4)
  const token = Buffer.from(tokenBytes).toString('hex')
  const generatedAtMs = Date.now()
  const generatedAt = new Date(generatedAtMs).toISOString()
  const expiresAt = new Date(generatedAtMs + REPAIR_TOKEN_TTL_MS).toISOString()

  const plan: RepairPlan = {
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: r.effectiveProjectId,
    memoryDir: r.memoryDir,
    token,
    expiresAt,
    actions,
    warnings,
    estimatedWrites,
    recommendedActions,
    confirmCommand: `/memory-sidecar repair --confirm ${token}`,
  }

  return { plan, recon: r }
}

export async function getMemorySidecarRepairPlan(
  options: MemoryRootOptions,
): Promise<RepairPlan> {
  sweepExpired(Date.now())
  const { plan } = await buildPlan(options)
  const home = process.env.HOME ?? '.'
  const rootDir = options.rootDir ?? `${home}/.mossen`
  repairPlanStore.set(tokenKey(rootDir, plan.resolvedProjectId, plan.token), {
    plan,
    storedAt: Date.now(),
  })
  return plan
}

// --- Execute ---------------------------------------------------------------

async function executeMissingDirty(
  options: MemoryRootOptions,
  effectiveProjectId: string,
  memoryDir: string,
  unmarked: { eventId: string; sessionId: string; jsonlPath: string }[],
): Promise<RepairActionResult> {
  let appended = 0
  // Group by session so we emit one marker per session (not per event).
  const bySession = new Map<string, string[]>()
  for (const ev of unmarked) {
    const ids = bySession.get(ev.sessionId) ?? []
    ids.push(ev.eventId)
    bySession.set(ev.sessionId, ids)
  }
  for (const [sessionId, eventIds] of bySession.entries()) {
    const targetPath = path.join(memoryDir, 'agent', 'dirty.jsonl')
    assertWriteWithinProjectMemoryDir(targetPath, memoryDir)
    const marker: DirtyMarker = {
      schemaVersion: 1,
      dirtyId: randomUUID(),
      projectId: effectiveProjectId,
      sessionId,
      eventIds,
      reason: 'manual_rebuild',
      createdAt: new Date().toISOString(),
    }
    await appendDirtyMarker({
      ...options,
      projectId: effectiveProjectId,
      marker,
    })
    appended += eventIds.length
  }
  return {
    id: 'missing-dirty',
    status: 'executed',
    count: appended,
    detail: `appended ${appended} event(s) across ${bySession.size} session(s)`,
  }
}

async function executeStaleLock(
  options: MemoryRootOptions,
  effectiveProjectId: string,
  memoryDir: string,
): Promise<RepairActionResult> {
  // releaseStaleMemoryWorkerLock asserts path safety internally, but we
  // also pre-assert here for defense-in-depth.
  const lockPath = path.join(memoryDir, 'agent', 'worker.lock')
  assertWriteWithinProjectMemoryDir(lockPath, memoryDir)
  const result = await releaseStaleMemoryWorkerLock({
    ...options,
    projectId: effectiveProjectId,
  })
  if (result.released) {
    return {
      id: 'stale-lock',
      status: 'executed',
      count: 1,
      detail: `released stale worker.lock (reason=${result.staleReason ?? 'unknown'}, pid=${result.pid ?? 'unknown'})`,
    }
  }
  return {
    id: 'stale-lock',
    status: 'skipped',
    count: 0,
    detail: `not released: reason=${result.reason}`,
  }
}

async function executeIndexRebuild(
  options: MemoryRootOptions,
  effectiveProjectId: string,
  memoryDir: string,
): Promise<RepairActionResult> {
  const dbPath = path.join(memoryDir, 'memory.db')
  assertWriteWithinProjectMemoryDir(dbPath, memoryDir)
  const result = await rebuildArchiveIndex({
    ...options,
    projectId: effectiveProjectId,
  })
  return {
    id: 'index-rebuild',
    status: 'executed',
    count: result.indexed,
    detail: `rebuilt sqlite index (indexed=${result.indexed}, fts=${result.ftsAvailable})`,
  }
}

export async function executeMemorySidecarRepairPlan(
  options: RepairExecuteOptions,
): Promise<RepairExecution> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  sweepExpired(startedAtMs)

  // Resolve to find the effectiveProjectId we keyed the token under.
  const resolved = await resolveProjectId({ ...options, projectId: options.projectId })
  const effectiveProjectId = resolved.projectId
  const memoryDir = getProjectMemoryDir({ ...options, projectId: effectiveProjectId })
  const home = process.env.HOME ?? '.'
  const rootDir = options.rootDir ?? `${home}/.mossen`

  const key = tokenKey(rootDir, effectiveProjectId, options.token)
  const stored = repairPlanStore.get(key)
  if (!stored || startedAtMs - stored.storedAt > REPAIR_TOKEN_TTL_MS) {
    if (stored) repairPlanStore.delete(key)
    throw new Error('repair token invalid or expired')
  }

  // One-shot: delete BEFORE any disk write.
  repairPlanStore.delete(key)

  // Re-derive plan to avoid acting on stale snapshot.
  const { plan: freshPlan, recon: freshRecon } = await buildPlan(options)

  const results: RepairActionResult[] = []

  // W122-B.1: defense-in-depth — when sidecar is disabled at confirm
  // time, refuse every mutation regardless of what the stale plan said.
  // computeActions() already gates safeToExecute=false in this state,
  // but we double-check here so a future planner change cannot
  // accidentally allow writes through this gate.
  if (!freshRecon.sidecarEnabled) {
    for (const stale of stored.plan.actions) {
      results.push({
        id: stale.id,
        status: 'blocked',
        count: 0,
        detail: 'sidecar disabled at confirm time; mutation refused',
      })
    }
    const finishedAtMs = Date.now()
    const finishedAt = new Date(finishedAtMs).toISOString()
    const totals = {
      executed: 0,
      skipped: 0,
      failed: 0,
      blocked: results.length,
    }
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      projectId: options.projectId,
      resolvedProjectId: effectiveProjectId,
      memoryDir,
      results,
      totals,
      summary:
        `repair refused — sidecar disabled at confirm time / 修复已拦截 — 确认时 sidecar 已关闭`,
    }
  }

  for (const stale of stored.plan.actions) {
    const fresh = freshPlan.actions.find(a => a.id === stale.id)
    if (stale.id === 'failed-jobs') {
      results.push({
        id: 'failed-jobs',
        status: 'blocked',
        count: fresh?.count ?? stale.count,
        detail: 'job-queue immutable; not executed',
      })
      continue
    }
    if (!stale.safeToExecute) {
      results.push({
        id: stale.id,
        status: stale.status === 'noop' ? 'skipped' : 'blocked',
        count: 0,
        detail: stale.detail ?? 'not safe to execute at plan time',
      })
      continue
    }
    if (!fresh || !fresh.safeToExecute) {
      results.push({
        id: stale.id,
        status: 'skipped',
        count: 0,
        detail: fresh
          ? `state changed since plan: ${fresh.detail ?? 'no longer safe'}`
          : 'action vanished from refreshed plan',
      })
      continue
    }

    try {
      let result: RepairActionResult
      if (stale.id === 'missing-dirty') {
        // Use fresh recon's unmarked set, not the stale plan, to avoid
        // re-appending markers for events that got reconciled meanwhile.
        const r = await recon(options)
        result = await executeMissingDirty(
          options,
          effectiveProjectId,
          memoryDir,
          r.unmarkedArchiveEvents,
        )
      } else if (stale.id === 'stale-lock') {
        result = await executeStaleLock(options, effectiveProjectId, memoryDir)
      } else if (stale.id === 'index-rebuild') {
        result = await executeIndexRebuild(options, effectiveProjectId, memoryDir)
      } else {
        result = {
          id: stale.id,
          status: 'skipped',
          count: 0,
          detail: 'unrecognised action id',
        }
      }
      results.push(result)
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const redacted = redactMemoryText(raw)
      results.push({
        id: stale.id,
        status: 'failed',
        count: 0,
        errorMessage: redacted.text,
      })
    }
  }

  const finishedAtMs = Date.now()
  const finishedAt = new Date(finishedAtMs).toISOString()
  const totals = {
    executed: results.filter(r => r.status === 'executed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    blocked: results.filter(r => r.status === 'blocked').length,
  }
  const summary =
    `repair done — executed=${totals.executed} skipped=${totals.skipped} failed=${totals.failed} blocked=${totals.blocked}` +
    ` / 修复完成 — 执行=${totals.executed} 跳过=${totals.skipped} 失败=${totals.failed} 拦截=${totals.blocked}`

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    projectId: options.projectId,
    resolvedProjectId: effectiveProjectId,
    memoryDir,
    results,
    totals,
    summary,
  }
}
