/**
 * W167-A — archive compression copy-compress writer.
 *
 * This is the first real archive-compression write path, but it is
 * intentionally conservative: it writes `.jsonl.gz` shadow copies and
 * `.manifest.json` files next to source archive sessions, and NEVER
 * deletes or rewrites the source `.jsonl` files. Source archive JSONL
 * remains authoritative until a later read-compat + restore drill has
 * proven the compressed shadow can be consumed safely.
 *
 * Safety model:
 *   - 8-hex in-memory token, 10 min TTL, one-shot.
 *   - confirm deletes token before any write.
 *   - confirm recomputes the W149-E shadow plan and rejects drift.
 *   - sidecar must be fully disabled before dry-run/confirm can plan.
 *   - writes are temp-file + fsync + rename in the same directory.
 *   - every gzip payload is gunzip-roundtripped before/after write.
 *   - source `.jsonl` bytes and mtimes are verified unchanged.
 */

import { createHash, randomBytes } from 'node:crypto'
import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
} from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import {
  generateArchiveCompressionShadowReport,
  type ArchiveCompressionShadowReport,
  type ArchiveCompressionShadowSession,
} from './archiveCompressionShadowReport.js'

export const ARCHIVE_COMPRESSION_WRITE_TOKEN_TTL_MS = 10 * 60 * 1000
export const ARCHIVE_COMPRESSION_WRITE_MANIFEST_VERSION = 1
export const ARCHIVE_COMPRESSION_WRITE_TOOL_VERSION = 'w167a-copy-compress-v1'

export type ArchiveCompressionWriteBlockedReason =
  | 'sidecar-enabled'
  | 'recoverability-failed'
  | 'no-targets'
  | 'token-expired'
  | 'token-invalid'
  | 'plan-drift'
  | 'write-outside-project'
  | 'write-failed'

export type ArchiveCompressionWriteTarget = {
  sessionId: string
  sourcePath: string
  compressedPath: string
  manifestPath: string
  sourceBytes: number
  sourceSha256: string
  estimatedCompressedBytes: number
  estimatedSavingsBytes: number
}

export type ArchiveCompressionWriteDryRun = {
  dryRun: true
  writeMode: 'copy-compress-shadow'
  safeToExecuteNow: boolean
  token: string
  expiresAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  shadow: ArchiveCompressionShadowReport
  status: 'planned' | 'blocked'
  blocked?: ArchiveCompressionWriteBlockedReason
  detail?: string
  targets: ArchiveCompressionWriteTarget[]
  estimatedCompressedFiles: number
  estimatedManifestFiles: number
  estimatedSavingsBytes: number
  warnings: string[]
  recommendedActions: string[]
  confirmCommand: string
  notes: string[]
}

export type ArchiveCompressionWriteResult = {
  sessionId: string
  sourcePath: string
  compressedPath: string
  manifestPath: string
  status: 'written' | 'failed'
  sourceBytes: number
  compressedBytes: number
  sourceSha256: string
  compressedSha256: string
  roundtripSha256: string
  sourceUnchanged: boolean
  errorMessage?: string
}

export type ArchiveCompressionWriteConfirm = {
  dryRun: false
  writeMode: 'copy-compress-shadow'
  startedAt: string
  finishedAt: string
  durationMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  shadow: ArchiveCompressionShadowReport
  planDriftDetected: boolean
  driftReason?: string
  status: 'executed' | 'blocked' | 'failed'
  blocked?: ArchiveCompressionWriteBlockedReason
  detail?: string
  sourceArchiveChanged: false
  compressedFilesWritten: number
  manifestsWritten: number
  results: ArchiveCompressionWriteResult[]
  notes: string[]
}

export type ArchiveCompressionWriteDryRunOptions = MemoryRootOptions & {
  configPath?: string
  now?: () => Date
}

export type ArchiveCompressionWriteConfirmOptions = MemoryRootOptions & {
  token: string
  configPath?: string
  now?: () => Date
}

type StoredWritePlan = {
  dryRun: ArchiveCompressionWriteDryRun
  resolvedProjectId: string
  memoryDir: string
  shadowSignature: string
  storedAt: number
}

const writeStore = new Map<string, StoredWritePlan>()

const WRITE_NOTES: string[] = [
  'copy-compress shadow only — source .jsonl files remain authoritative',
  'writes .jsonl.gz and .jsonl.gz.manifest.json next to source sessions',
  'source archive files are never deleted or rewritten by W167-A',
]

export function _resetArchiveCompressionWriteStoreForTesting(): void {
  writeStore.clear()
}

export async function createArchiveCompressionWriteDryRun(
  options: ArchiveCompressionWriteDryRunOptions,
): Promise<ArchiveCompressionWriteDryRun> {
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
  const targets = shadow.sessions.map(session =>
    buildTarget(shadow.memoryDir, session),
  )
  const token = randomBytes(4).toString('hex')
  const expiresAt = new Date(
    startedMs + ARCHIVE_COMPRESSION_WRITE_TOKEN_TTL_MS,
  ).toISOString()

  const classification = classifyDryRun({ sidecarDisabled, shadow, targets })
  const dryRun: ArchiveCompressionWriteDryRun = {
    dryRun: true,
    writeMode: 'copy-compress-shadow',
    safeToExecuteNow: classification.status === 'planned',
    token,
    expiresAt,
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    memoryDir: shadow.memoryDir,
    sidecarDisabled,
    shadow,
    status: classification.status,
    ...(classification.blocked ? { blocked: classification.blocked } : {}),
    ...(classification.detail ? { detail: classification.detail } : {}),
    targets,
    estimatedCompressedFiles: targets.length,
    estimatedManifestFiles: targets.length,
    estimatedSavingsBytes: shadow.totalEstimatedSavingsBytes,
    warnings: classification.warnings,
    recommendedActions: classification.recommendedActions,
    confirmCommand: `/memory-sidecar governance compression write --confirm ${token}`,
    notes: [...WRITE_NOTES],
  }

  writeStore.set(
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

export async function executeArchiveCompressionWriteConfirm(
  options: ArchiveCompressionWriteConfirmOptions,
): Promise<ArchiveCompressionWriteConfirm> {
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
  const stored = writeStore.get(key)
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

  // One-shot: delete before any write. Even if the executor fails, replay is
  // impossible and the operator must re-run dry-run against current disk.
  writeStore.delete(key)

  const sidecarDisabled = isSidecarFullyDisabled(options.configPath)
  const shadow = await generateArchiveCompressionShadowReport({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: resolved.projectId,
    now: options.now,
  })
  const driftSignature = signShadow(shadow)
  const planDriftDetected = driftSignature !== stored.shadowSignature
  const targets = shadow.sessions.map(session =>
    buildTarget(shadow.memoryDir, session),
  )

  if (!sidecarDisabled) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: resolved.projectId,
      memoryDir: shadow.memoryDir,
      sidecarDisabled,
      blocked: 'sidecar-enabled',
      detail: 'sidecar must be disabled before compression write confirm',
      shadow,
      planDriftDetected,
    })
  }
  if (!shadow.recoverability.pass) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: resolved.projectId,
      memoryDir: shadow.memoryDir,
      sidecarDisabled,
      blocked: 'recoverability-failed',
      detail: `recoverability did not pass: ${shadow.recoverability.reasons.join('; ')}`,
      shadow,
      planDriftDetected,
    })
  }
  if (planDriftDetected) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: resolved.projectId,
      memoryDir: shadow.memoryDir,
      sidecarDisabled,
      blocked: 'plan-drift',
      detail: 'shadow plan drifted between dry-run and confirm; re-run --dry-run',
      shadow,
      planDriftDetected: true,
      driftReason: 'session list or per-session sha256 drift',
    })
  }
  if (targets.length === 0) {
    return blockedConfirm({
      now,
      startedMs,
      projectId: options.projectId,
      resolvedProjectId: resolved.projectId,
      memoryDir: shadow.memoryDir,
      sidecarDisabled,
      blocked: 'no-targets',
      detail: 'no compressible sessions; nothing to write',
      shadow,
      planDriftDetected,
    })
  }

  const results: ArchiveCompressionWriteResult[] = []
  for (const target of targets) {
    try {
      results.push(await writeCompressedTarget(target, shadow.memoryDir, now))
    } catch (error) {
      results.push({
        sessionId: target.sessionId,
        sourcePath: target.sourcePath,
        compressedPath: target.compressedPath,
        manifestPath: target.manifestPath,
        status: 'failed',
        sourceBytes: target.sourceBytes,
        compressedBytes: 0,
        sourceSha256: target.sourceSha256,
        compressedSha256: '',
        roundtripSha256: '',
        sourceUnchanged: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const failed = results.filter(result => result.status === 'failed')
  const finishedMs = Date.now()
  return {
    dryRun: false,
    writeMode: 'copy-compress-shadow',
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    memoryDir: shadow.memoryDir,
    sidecarDisabled,
    shadow,
    planDriftDetected: false,
    status: failed.length > 0 ? 'failed' : 'executed',
    ...(failed.length > 0 ? { blocked: 'write-failed' as const } : {}),
    ...(failed.length > 0
      ? { detail: `${failed.length} compression target(s) failed` }
      : {}),
    sourceArchiveChanged: false,
    compressedFilesWritten: results.filter(r => r.status === 'written').length,
    manifestsWritten: results.filter(r => r.status === 'written').length,
    results,
    notes: [...WRITE_NOTES],
  }
}

function classifyDryRun(input: {
  sidecarDisabled: boolean
  shadow: ArchiveCompressionShadowReport
  targets: ArchiveCompressionWriteTarget[]
}): {
  status: 'planned' | 'blocked'
  blocked?: ArchiveCompressionWriteBlockedReason
  detail?: string
  warnings: string[]
  recommendedActions: string[]
} {
  const warnings: string[] = []
  if (!input.shadow.recoverability.pass) {
    warnings.push('recoverability report did not pass')
    return {
      status: 'blocked',
      blocked: 'recoverability-failed',
      detail: `recoverability did not pass: ${input.shadow.recoverability.reasons.join('; ')}`,
      warnings,
      recommendedActions: ['/memory-sidecar governance compression shadow'],
    }
  }
  if (!input.sidecarDisabled) {
    warnings.push(
      'sidecar must be disabled before governance compression write confirm',
    )
    return {
      status: 'blocked',
      blocked: 'sidecar-enabled',
      detail: 'sidecar must be disabled before confirm',
      warnings,
      recommendedActions: ['/memory-sidecar disable'],
    }
  }
  if (input.targets.length === 0) {
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

async function writeCompressedTarget(
  target: ArchiveCompressionWriteTarget,
  memoryDir: string,
  now: Date,
): Promise<ArchiveCompressionWriteResult> {
  assertWriteWithinProjectMemoryDir(target.compressedPath, memoryDir)
  assertWriteWithinProjectMemoryDir(target.manifestPath, memoryDir)

  const sourceBefore = await stat(target.sourcePath)
  const source = await readFile(target.sourcePath)
  const sourceSha256 = sha256(source)
  if (sourceSha256 !== target.sourceSha256) {
    throw new Error(`source sha drift for ${target.sessionId}`)
  }

  const compressed = gzipSync(source)
  const roundtrip = gunzipSync(compressed)
  const roundtripSha256 = sha256(roundtrip)
  if (roundtripSha256 !== sourceSha256) {
    throw new Error(`gzip roundtrip mismatch for ${target.sessionId}`)
  }

  const compressedSha256 = sha256(compressed)
  await atomicWriteBuffer(target.compressedPath, compressed)

  const persistedCompressed = await readFile(target.compressedPath)
  const persistedRoundtripSha256 = sha256(gunzipSync(persistedCompressed))
  if (persistedRoundtripSha256 !== sourceSha256) {
    throw new Error(`persisted gzip roundtrip mismatch for ${target.sessionId}`)
  }

  const manifest = {
    manifestVersion: ARCHIVE_COMPRESSION_WRITE_MANIFEST_VERSION,
    toolVersion: ARCHIVE_COMPRESSION_WRITE_TOOL_VERSION,
    generatedAt: now.toISOString(),
    sessionId: target.sessionId,
    sourcePath: path.relative(memoryDir, target.sourcePath),
    compressedPath: path.relative(memoryDir, target.compressedPath),
    algorithm: 'gzip',
    sourceBytes: source.length,
    compressedBytes: persistedCompressed.length,
    sourceSha256,
    compressedSha256,
    roundtripSha256: persistedRoundtripSha256,
    sourceRetained: true,
    sourceDeletionAllowed: false,
  }
  await atomicWriteBuffer(
    target.manifestPath,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  )

  const sourceAfter = await stat(target.sourcePath)
  const sourceUnchanged =
    sourceBefore.size === sourceAfter.size &&
    sourceBefore.mtimeMs === sourceAfter.mtimeMs
  if (!sourceUnchanged) {
    throw new Error(`source changed while writing ${target.sessionId}`)
  }

  return {
    sessionId: target.sessionId,
    sourcePath: target.sourcePath,
    compressedPath: target.compressedPath,
    manifestPath: target.manifestPath,
    status: 'written',
    sourceBytes: source.length,
    compressedBytes: persistedCompressed.length,
    sourceSha256,
    compressedSha256,
    roundtripSha256: persistedRoundtripSha256,
    sourceUnchanged,
  }
}

async function atomicWriteBuffer(filePath: string, body: Buffer): Promise<void> {
  const dir = path.dirname(filePath)
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(tempPath, 'wx', 0o600)
    await handle.writeFile(body)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(tempPath, filePath)
    await fsyncDirectory(dir)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {})
    }
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

async function fsyncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  } catch {
    // Some filesystems do not allow directory fsync. The file itself
    // was already fsynced before rename; directory fsync is best-effort.
  } finally {
    await handle?.close().catch(() => {})
  }
}

function buildTarget(
  memoryDir: string,
  session: ArchiveCompressionShadowSession,
): ArchiveCompressionWriteTarget {
  const sourcePath = path.join(memoryDir, session.sessionPath)
  const compressedPath = `${sourcePath}.gz`
  return {
    sessionId: session.sessionId,
    sourcePath,
    compressedPath,
    manifestPath: `${compressedPath}.manifest.json`,
    sourceBytes: session.originalBytes,
    sourceSha256: session.originalSha256,
    estimatedCompressedBytes: session.estimatedCompressedBytes,
    estimatedSavingsBytes: session.estimatedSavingsBytes,
  }
}

function blockedConfirm(input: {
  now: Date
  startedMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  sidecarDisabled: boolean
  blocked: ArchiveCompressionWriteBlockedReason
  detail: string
  shadow: ArchiveCompressionShadowReport
  planDriftDetected: boolean
  driftReason?: string
}): ArchiveCompressionWriteConfirm {
  const finishedMs = Date.now()
  return {
    dryRun: false,
    writeMode: 'copy-compress-shadow',
    startedAt: new Date(input.startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - input.startedMs),
    projectId: input.projectId,
    resolvedProjectId: input.resolvedProjectId,
    memoryDir: input.memoryDir,
    sidecarDisabled: input.sidecarDisabled,
    shadow: input.shadow,
    planDriftDetected: input.planDriftDetected,
    ...(input.driftReason ? { driftReason: input.driftReason } : {}),
    status: 'blocked',
    blocked: input.blocked,
    detail: input.detail,
    sourceArchiveChanged: false,
    compressedFilesWritten: 0,
    manifestsWritten: 0,
    results: [],
    notes: [...WRITE_NOTES],
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

function assertWriteWithinProjectMemoryDir(
  targetPath: string,
  memoryDir: string,
): void {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedMemory = path.resolve(memoryDir)
  if (
    resolvedTarget !== resolvedMemory &&
    !resolvedTarget.startsWith(`${resolvedMemory}${path.sep}`)
  ) {
    throw new Error(`refusing write outside project memory dir: ${targetPath}`)
  }
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

function tokenKey(
  rootDir: string | undefined,
  resolvedProjectId: string,
  token: string,
): string {
  return `${rootDir ?? ''}::${resolvedProjectId}::${token}`
}

function sweepExpired(now: number): void {
  for (const [key, value] of writeStore.entries()) {
    if (now - value.storedAt > ARCHIVE_COMPRESSION_WRITE_TOKEN_TTL_MS) {
      writeStore.delete(key)
    }
  }
}
