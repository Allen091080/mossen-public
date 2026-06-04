/**
 * W149-F — archive compression APPLY GATE ONLY.
 *
 * This module provides the dry-run + confirm token handshake that
 * a future W149-G copy-compress wave would gate on. It does NOT
 * compress anything and does NOT write any compressed files. Every
 * confirmed plan is a *verified dry-run* — the gate confirms the
 * operator's intent, the sidecar-disabled state, the
 * recoverability invariants, and that the W149-E shadow plan has
 * not drifted between dry-run and confirm. No archive byte is
 * written and no source is read with write intent.
 *
 * Hard invariants (smoke locks all of these):
 *
 *   - dryRun: true on both paths (initial dry-run + confirm).
 *   - applyGateOnly: true.
 *   - archiveChanged: false on confirm.
 *   - compressedFilesWritten: 0 on confirm.
 *   - status is one of `'planned' | 'blocked' | 'noop-confirmed'`.
 *   - safeToExecuteNow is intentionally absent / false-equivalent
 *     so a downstream apply executor cannot accidentally treat a
 *     W149-F gate result as a green-light to write.
 *
 * Token model mirrors W146 / W149-B / W149-C:
 *   - 8-hex token, 10-min TTL.
 *   - one-shot: confirm deletes the token before any further work.
 *   - confirm recomputes the shadow plan from current disk state
 *     and surfaces plan-drift when the session list / sha256s
 *     diverge from the dry-run snapshot.
 *
 * Sidecar gate mirrors the W146/W149-B/C gate: enabled === false
 * AND capture.enabled === false AND adapter.enabled === false.
 * Even though this module never writes, the gate is enforced so
 * that the same configuration prerequisite is observed end-to-end
 * for any W149-* compression flow.
 */

import { randomBytes } from 'node:crypto'

import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
} from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import {
  generateArchiveCompressionShadowReport,
  type ArchiveCompressionShadowReport,
} from './archiveCompressionShadowReport.js'

export const APPLY_GATE_TOKEN_TTL_MS = 10 * 60 * 1000

export type ArchiveCompressionApplyGateBlockedReason =
  | 'sidecar-enabled'
  | 'recoverability-failed'
  | 'no-targets'
  | 'token-expired'
  | 'token-invalid'
  | 'plan-drift'

export type ArchiveCompressionApplyDryRun = {
  /** Hard invariant — both dry-run AND confirm carry dryRun: true. */
  dryRun: true
  /** Hard invariant — never the green-light to write. */
  applyGateOnly: true
  /** Hard invariant — actions are never marked safe to execute. */
  safeToExecuteNow: false
  token: string
  expiresAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  shadow: ArchiveCompressionShadowReport
  status: 'planned' | 'blocked'
  blocked?: ArchiveCompressionApplyGateBlockedReason
  detail?: string
  estimatedSavingsBytes: number
  warnings: string[]
  recommendedActions: string[]
  confirmCommand: string
  notes: string[]
}

export type ArchiveCompressionApplyConfirm = {
  /** Hard invariant — confirm is STILL dry-run. */
  dryRun: true
  /** Hard invariant — apply gate, not real apply. */
  applyGateOnly: true
  /** Hard invariant — actions are never marked safe to execute. */
  safeToExecuteNow: false
  startedAt: string
  finishedAt: string
  durationMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  /** Recomputed shadow plan at confirm time. */
  shadow: ArchiveCompressionShadowReport
  /** True iff the session list / sha256 set drifted from dry-run. */
  planDriftDetected: boolean
  driftReason?: string
  status: 'noop-confirmed' | 'blocked'
  blocked?: ArchiveCompressionApplyGateBlockedReason
  detail?: string
  /** Hard invariant — confirm never modifies archive bytes. */
  archiveChanged: false
  /** Hard invariant — confirm never writes compressed files. */
  compressedFilesWritten: 0
  notes: string[]
}

export type ArchiveCompressionApplyDryRunOptions = MemoryRootOptions & {
  configPath?: string
  now?: () => Date
}

export type ArchiveCompressionApplyConfirmOptions = MemoryRootOptions & {
  token: string
  configPath?: string
  now?: () => Date
}

type StoredApplyGatePlan = {
  dryRun: ArchiveCompressionApplyDryRun
  resolvedProjectId: string
  memoryDir: string
  /** Stable signature of the shadow session list — used for drift. */
  shadowSignature: string
  storedAt: number
}

const applyGateStore = new Map<string, StoredApplyGatePlan>()

export function _resetArchiveCompressionApplyGateForTesting(): void {
  applyGateStore.clear()
}

const APPLY_GATE_NOTES: string[] = [
  'apply gate only — no compressed files written',
  'no archive files changed',
  'W149-G required for copy-compress',
]

export async function createArchiveCompressionApplyDryRun(
  options: ArchiveCompressionApplyDryRunOptions,
): Promise<ArchiveCompressionApplyDryRun> {
  const now = (options.now ?? (() => new Date()))()
  const startedMs = now.getTime()
  sweepExpired(startedMs)

  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
  }))

  const sidecarDisabled = isSidecarFullyDisabled(options.configPath)
  const shadow = await generateArchiveCompressionShadowReport({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: resolved.projectId,
    now: options.now,
  })

  const token = randomBytes(4).toString('hex')
  const expiresAt = new Date(startedMs + APPLY_GATE_TOKEN_TTL_MS).toISOString()

  const { status, blocked, detail, warnings, recommendedActions } =
    classifyDryRun({ sidecarDisabled, shadow })

  const dryRun: ArchiveCompressionApplyDryRun = {
    dryRun: true,
    applyGateOnly: true,
    safeToExecuteNow: false,
    token,
    expiresAt,
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    memoryDir: shadow.memoryDir,
    sidecarDisabled,
    shadow,
    status,
    ...(blocked ? { blocked } : {}),
    ...(detail ? { detail } : {}),
    estimatedSavingsBytes: shadow.totalEstimatedSavingsBytes,
    warnings,
    recommendedActions,
    confirmCommand: `/memory-sidecar governance compression apply --confirm ${token}`,
    notes: [...APPLY_GATE_NOTES],
  }

  applyGateStore.set(
    tokenKey(options.rootDir, resolved.projectId, token),
    {
      dryRun,
      resolvedProjectId: resolved.projectId,
      memoryDir: shadow.memoryDir,
      shadowSignature: signShadow(shadow),
      storedAt: startedMs,
    },
  )
  return dryRun
}

export async function executeArchiveCompressionApplyConfirm(
  options: ArchiveCompressionApplyConfirmOptions,
): Promise<ArchiveCompressionApplyConfirm> {
  const now = (options.now ?? (() => new Date()))()
  const startedMs = now.getTime()
  sweepExpired(startedMs)

  if (!/^[0-9a-f]{8}$/.test(options.token)) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: options.projectId,
      memoryDir: '',
      sidecarDisabled: false,
      blocked: 'token-invalid',
      detail: 'token must be 8 hex characters',
      shadow: emptyShadow(now, options.projectId),
      planDriftDetected: false,
    })
  }

  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
  }))

  const key = tokenKey(options.rootDir, resolved.projectId, options.token)
  const stored = applyGateStore.get(key)
  if (!stored) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: resolved.projectId,
      memoryDir: '',
      sidecarDisabled: false,
      blocked: 'token-expired',
      detail: 'token invalid or expired',
      shadow: emptyShadow(now, options.projectId),
      planDriftDetected: false,
    })
  }

  // One-shot: delete before further work so a replayed confirm
  // cannot reuse the same token even if validation passes.
  applyGateStore.delete(key)

  const sidecarDisabled = isSidecarFullyDisabled(options.configPath)
  const shadow = await generateArchiveCompressionShadowReport({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: resolved.projectId,
    now: options.now,
  })

  const driftSignature = signShadow(shadow)
  const planDriftDetected = driftSignature !== stored.shadowSignature

  let status: ArchiveCompressionApplyConfirm['status'] = 'noop-confirmed'
  let blocked: ArchiveCompressionApplyGateBlockedReason | undefined
  let detail: string | undefined

  if (!sidecarDisabled) {
    status = 'blocked'
    blocked = 'sidecar-enabled'
    detail = 'sidecar must be disabled before apply gate confirm'
  } else if (!shadow.recoverability.pass) {
    status = 'blocked'
    blocked = 'recoverability-failed'
    detail = `recoverability did not pass: ${shadow.recoverability.reasons.join('; ')}`
  } else if (planDriftDetected) {
    status = 'blocked'
    blocked = 'plan-drift'
    detail = 'shadow plan drifted between dry-run and confirm; re-run --dry-run'
  } else if (shadow.scannedSessions === 0) {
    status = 'blocked'
    blocked = 'no-targets'
    detail = 'no compressible sessions; nothing to confirm'
  }

  const finishedMs = Date.now()
  return {
    dryRun: true,
    applyGateOnly: true,
    safeToExecuteNow: false,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    memoryDir: shadow.memoryDir,
    sidecarDisabled,
    shadow,
    planDriftDetected,
    ...(planDriftDetected
      ? { driftReason: 'session list or per-session sha256 drift' }
      : {}),
    status,
    ...(blocked ? { blocked } : {}),
    ...(detail ? { detail } : {}),
    archiveChanged: false,
    compressedFilesWritten: 0,
    notes: [...APPLY_GATE_NOTES],
  }
}

function classifyDryRun(input: {
  sidecarDisabled: boolean
  shadow: ArchiveCompressionShadowReport
}): {
  status: 'planned' | 'blocked'
  blocked?: ArchiveCompressionApplyGateBlockedReason
  detail?: string
  warnings: string[]
  recommendedActions: string[]
} {
  const warnings: string[] = []
  const recommendedActions: string[] = []

  if (!input.shadow.recoverability.pass) {
    warnings.push('recoverability report did not pass')
    recommendedActions.push(
      '/memory-sidecar governance compression shadow',
    )
    return {
      status: 'blocked',
      blocked: 'recoverability-failed',
      detail: `recoverability did not pass: ${input.shadow.recoverability.reasons.join('; ')}`,
      warnings,
      recommendedActions,
    }
  }
  if (!input.sidecarDisabled) {
    warnings.push(
      'sidecar must be disabled before governance compression apply confirm',
    )
    recommendedActions.push('/memory-sidecar disable')
    return {
      status: 'blocked',
      blocked: 'sidecar-enabled',
      detail: 'sidecar must be disabled before confirm',
      warnings,
      recommendedActions,
    }
  }
  if (input.shadow.scannedSessions === 0) {
    return {
      status: 'blocked',
      blocked: 'no-targets',
      detail: 'no compressible sessions found',
      warnings,
      recommendedActions: ['/memory-sidecar governance compression shadow'],
    }
  }
  return {
    status: 'planned',
    warnings,
    recommendedActions: ['copy and run the confirm command above'],
  }
}

function blockedConfirm(input: {
  now: Date
  startedMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  blocked: ArchiveCompressionApplyGateBlockedReason
  detail: string
  shadow: ArchiveCompressionShadowReport
  planDriftDetected: boolean
}): ArchiveCompressionApplyConfirm {
  const finishedMs = Date.now()
  return {
    dryRun: true,
    applyGateOnly: true,
    safeToExecuteNow: false,
    startedAt: new Date(input.startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - input.startedMs),
    projectId: input.projectId,
    resolvedProjectId: input.resolvedProjectId,
    memoryDir: input.memoryDir,
    sidecarDisabled: input.sidecarDisabled,
    shadow: input.shadow,
    planDriftDetected: input.planDriftDetected,
    status: 'blocked',
    blocked: input.blocked,
    detail: input.detail,
    archiveChanged: false,
    compressedFilesWritten: 0,
    notes: [...APPLY_GATE_NOTES],
  }
}

function emptyShadow(
  now: Date,
  projectId: string,
): ArchiveCompressionShadowReport {
  return {
    shadowOnly: true,
    generatedAt: now.toISOString(),
    projectId,
    resolvedProjectId: projectId,
    memoryDir: '',
    archiveSessionsDir: '',
    totalSessions: 0,
    scannedSessions: 0,
    sessions: [],
    skippedSessions: [],
    parseWarnings: [],
    totalOriginalBytes: 0,
    totalEstimatedCompressedBytes: 0,
    totalEstimatedSavingsBytes: 0,
    recoverability: {
      sourceJsonlRetained: true,
      sourceSha256Recorded: true,
      compressedCopyAuthoritative: false,
      sqliteRebuildableFromSource: true,
      exportCanUseSource: true,
      partialFailureLeavesSourceUntouched: true,
      repeatedShadowRunDeterministic: true,
      sidecarDisabledNotRequiredForReadOnlyShadow: true,
      activeOrRecentSessionSkipped: true,
      pass: true,
      reasons: [],
    },
    deterministicPlanVersion: 1,
    notes: [],
  }
}

function signShadow(shadow: ArchiveCompressionShadowReport): string {
  // Stable signature: sorted (sessionId, originalSha256, originalBytes)
  // tuples. Captures both "sessions added/removed" and "session
  // contents changed" within the same single string. Excludes
  // generatedAt and any other timestamp-y field.
  const triples = [...shadow.sessions]
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .map(s => `${s.sessionId}|${s.originalSha256}|${s.originalBytes}`)
  return triples.join('\n')
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

function tokenKey(
  rootDir: string | undefined,
  resolvedProjectId: string,
  token: string,
): string {
  return `${rootDir ?? ''}::${resolvedProjectId}::${token}`
}

function sweepExpired(now: number): void {
  for (const [key, value] of applyGateStore.entries()) {
    if (now - value.storedAt > APPLY_GATE_TOKEN_TTL_MS) {
      applyGateStore.delete(key)
    }
  }
}
