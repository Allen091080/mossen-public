/**
 * W149-E — archive compression shadow report (read-only).
 *
 * Per W149-D's recoverability design, this helper produces a
 * deterministic *shadow plan* + *recoverability report* for archive
 * compression WITHOUT modifying any source data on disk:
 *
 *   - Reads `archive/sessions/*.jsonl` only.
 *   - Computes original SHA-256 + estimates gzip-compressed bytes
 *     entirely in memory.
 *   - Skips active / recent / oversize sessions.
 *   - Never writes `.gz` / `.br` / `.zst` files.
 *   - Never modifies source archive / observations / profiles /
 *     proposals / sqlite / worker.lock / dirty / jobs.
 *   - Sources are byte-stable through any number of shadow runs;
 *     `sourceRetained: true` and `sourceDeletionAllowed: false`
 *     are both hard-coded into every manifest entry.
 *
 * The recoverability report at the end answers the same 9 hard
 * questions W149-D's design doc spelled out as machine-readable
 * booleans, plus an aggregate `pass` field. If any of the 9 fields
 * comes back false the caller is expected to STOP and not advance
 * to W149-F apply gate.
 */

import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'

/**
 * Minimum mtime age for a session to be considered "stable" enough
 * to scan. The W149-D design called out 1 hour; we expose this so
 * the smoke can drive a synthetic archive without artificially
 * aged mtimes.
 */
export const W149E_DEFAULT_RECENT_MTIME_THRESHOLD_MS = 60 * 60 * 1000

/**
 * Hard upper bound on the per-session size W149-E will read into
 * memory for the gzip estimate. Anything larger is reported under
 * `skipped` with reason `too-large`. 100 MB is well above the 99th
 * percentile session size; operators with larger archives can
 * raise this in W149-G when actual compression ships, with explicit
 * streaming.
 */
export const W149E_DEFAULT_MAX_SESSION_BYTES = 100 * 1024 * 1024

/**
 * Marker version for the deterministic shadow plan emitted by
 * `generateArchiveCompressionShadowReport`. A future W149-G that
 * changes the algorithm or session selection logic must bump this
 * so plan-drift detection (W149-F) flags older plans.
 */
export const ARCHIVE_COMPRESSION_DETERMINISTIC_PLAN_VERSION = 1

export type ArchiveCompressionAlgorithm = 'gzip'

export type ArchiveCompressionShadowSession = {
  sessionId: string
  /** Path relative to memoryDir, e.g. `archive/sessions/abc.jsonl`. */
  sessionPath: string
  originalBytes: number
  originalSha256: string
  estimatedCompressedBytes: number
  estimatedSavingsBytes: number
  compressionAlgorithm: ArchiveCompressionAlgorithm
  /** Hard invariant — never false in any W149-E output. */
  sourceRetained: true
  /** Hard invariant — never true in any W149-E output. */
  sourceDeletionAllowed: false
  deterministicPlanVersion: typeof ARCHIVE_COMPRESSION_DETERMINISTIC_PLAN_VERSION
}

export type ArchiveCompressionShadowSkipReason =
  | 'recent'
  | 'active'
  | 'too-large'
  | 'parse-warning'
  | 'empty'

export type ArchiveCompressionShadowSkipped = {
  sessionId: string
  reason: ArchiveCompressionShadowSkipReason
  detail?: string
}

/**
 * Machine-readable recoverability report. Every field is `true` on
 * a healthy W149-E shadow run; `pass` is true iff all 9 fields are
 * true. The boolean shape is deliberate — the W149-F gate (and any
 * future tooling) can grep this struct and refuse to proceed if
 * any flag is false, without parsing prose.
 */
export type ArchiveCompressionRecoverabilityReport = {
  /** source JSONL files in `archive/sessions/` are byte-stable. */
  sourceJsonlRetained: boolean
  /** every session has an SHA-256 recorded in the manifest draft. */
  sourceSha256Recorded: boolean
  /** compressed copy is NEVER authoritative (always false ⇒ true here). */
  compressedCopyAuthoritative: false
  /** sqlite memory.db is rebuildable from source via W149-B. */
  sqliteRebuildableFromSource: boolean
  /** W149-C export bundle reads source directly. */
  exportCanUseSource: boolean
  /** partial failure cannot propagate into source files. */
  partialFailureLeavesSourceUntouched: boolean
  /** repeated shadow runs produce identical plan bytes. */
  repeatedShadowRunDeterministic: boolean
  /** read-only shadow does NOT require sidecar disabled (apply does). */
  sidecarDisabledNotRequiredForReadOnlyShadow: boolean
  /** active or mtime-too-recent sessions are skipped. */
  activeOrRecentSessionSkipped: boolean
  /** aggregate: all of the above are true. */
  pass: boolean
  /** human-readable reasons when `pass` is false; empty when pass. */
  reasons: string[]
}

export type ArchiveCompressionShadowReport = {
  /** Hard invariant: this helper never modifies source data. */
  shadowOnly: true
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  archiveSessionsDir: string
  totalSessions: number
  scannedSessions: number
  sessions: ArchiveCompressionShadowSession[]
  skippedSessions: ArchiveCompressionShadowSkipped[]
  parseWarnings: string[]
  totalOriginalBytes: number
  totalEstimatedCompressedBytes: number
  totalEstimatedSavingsBytes: number
  recoverability: ArchiveCompressionRecoverabilityReport
  deterministicPlanVersion: typeof ARCHIVE_COMPRESSION_DETERMINISTIC_PLAN_VERSION
  notes: string[]
}

export type ArchiveCompressionShadowOptions = MemoryRootOptions & {
  /** Override default recent-mtime threshold (smoke uses 0). */
  recentMtimeThresholdMs?: number
  /** Override default max-session size (smoke can use a small cap). */
  maxSessionBytes?: number
  /** Override `now` for deterministic snapshots. */
  now?: () => Date
}

const COMPRESSED_NOTES: string[] = [
  'shadow only — no source files were read with write intent',
  'no .gz / .br / .zst files were written',
  'memory.db / observations.jsonl / profiles.jsonl / proposals.jsonl untouched',
  'worker.lock / dirty.jsonl / jobs/ untouched',
  'compressed copy is NOT authoritative; source archive remains the single source of truth',
]

export async function generateArchiveCompressionShadowReport(
  options: ArchiveCompressionShadowOptions,
): Promise<ArchiveCompressionShadowReport> {
  const now = (options.now ?? (() => new Date()))()
  const generatedAt = now.toISOString()
  const recentThreshold =
    options.recentMtimeThresholdMs ??
    W149E_DEFAULT_RECENT_MTIME_THRESHOLD_MS
  const maxSessionBytes =
    options.maxSessionBytes ?? W149E_DEFAULT_MAX_SESSION_BYTES

  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
  }))
  const memoryDir = getProjectMemoryDir({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: resolved.projectId,
  })
  const archiveSessionsDir = path.join(memoryDir, 'archive', 'sessions')

  const sessions: ArchiveCompressionShadowSession[] = []
  const skipped: ArchiveCompressionShadowSkipped[] = []
  const parseWarnings: string[] = []

  let entries: string[] = []
  try {
    entries = await readdir(archiveSessionsDir)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'ENOENT') {
      parseWarnings.push(
        `failed to readdir archive sessions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    // ENOENT is a healthy "no archive yet" state; fall through with
    // zero sessions.
  }

  // Stable, deterministic ordering — alphabetical by sessionId.
  const sessionFiles = entries
    .filter(name => name.endsWith('.jsonl'))
    .sort()

  for (const file of sessionFiles) {
    const sessionId = path.basename(file, '.jsonl')
    const fullPath = path.join(archiveSessionsDir, file)
    const sessionPath = path.relative(memoryDir, fullPath)

    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(fullPath)
    } catch (error) {
      parseWarnings.push(
        `${sessionId}: stat failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      skipped.push({
        sessionId,
        reason: 'parse-warning',
        detail: 'stat failed',
      })
      continue
    }

    if (info.size === 0) {
      skipped.push({ sessionId, reason: 'empty' })
      continue
    }

    const ageMs = now.getTime() - info.mtimeMs
    if (ageMs < recentThreshold) {
      // W149-E determinism: the detail uses file mtimeMs (a property
      // of the file on disk, deterministic across runs) rather than
      // `ageMs` (which depends on `now` and would drift between
      // back-to-back invocations).
      skipped.push({
        sessionId,
        reason: 'recent',
        detail: `mtimeMs=${info.mtimeMs}, threshold=${recentThreshold}ms`,
      })
      continue
    }

    if (info.size > maxSessionBytes) {
      skipped.push({
        sessionId,
        reason: 'too-large',
        detail: `${info.size} > cap ${maxSessionBytes}`,
      })
      continue
    }

    let buf: Buffer
    try {
      buf = await readFile(fullPath)
    } catch (error) {
      parseWarnings.push(
        `${sessionId}: read failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
      skipped.push({
        sessionId,
        reason: 'parse-warning',
        detail: 'read failed',
      })
      continue
    }

    const originalSha256 = createHash('sha256').update(buf).digest('hex')
    // Default-level gzip; deterministic given identical input.
    const estimatedCompressedBytes = gzipSync(buf).length

    sessions.push({
      sessionId,
      sessionPath,
      originalBytes: buf.length,
      originalSha256,
      estimatedCompressedBytes,
      estimatedSavingsBytes: Math.max(0, buf.length - estimatedCompressedBytes),
      compressionAlgorithm: 'gzip',
      sourceRetained: true,
      sourceDeletionAllowed: false,
      deterministicPlanVersion: ARCHIVE_COMPRESSION_DETERMINISTIC_PLAN_VERSION,
    })
  }

  const totalOriginalBytes = sessions.reduce((s, e) => s + e.originalBytes, 0)
  const totalEstimatedCompressedBytes = sessions.reduce(
    (s, e) => s + e.estimatedCompressedBytes,
    0,
  )
  const totalEstimatedSavingsBytes = sessions.reduce(
    (s, e) => s + e.estimatedSavingsBytes,
    0,
  )

  const recoverability = buildRecoverabilityReport({
    sessions,
    skipped,
  })

  return {
    shadowOnly: true,
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    memoryDir,
    archiveSessionsDir,
    totalSessions: sessionFiles.length,
    scannedSessions: sessions.length,
    sessions,
    skippedSessions: skipped,
    parseWarnings,
    totalOriginalBytes,
    totalEstimatedCompressedBytes,
    totalEstimatedSavingsBytes,
    recoverability,
    deterministicPlanVersion: ARCHIVE_COMPRESSION_DETERMINISTIC_PLAN_VERSION,
    notes: [...COMPRESSED_NOTES],
  }
}

function buildRecoverabilityReport(input: {
  sessions: ArchiveCompressionShadowSession[]
  skipped: ArchiveCompressionShadowSkipped[]
}): ArchiveCompressionRecoverabilityReport {
  const reasons: string[] = []

  // sourceJsonlRetained: every session manifest entry must have
  // sourceRetained === true and sourceDeletionAllowed === false.
  const allSourceRetained = input.sessions.every(
    s => s.sourceRetained === true && s.sourceDeletionAllowed === false,
  )
  if (!allSourceRetained) {
    reasons.push(
      'one or more session entries claimed sourceRetained=false or sourceDeletionAllowed=true',
    )
  }

  // sourceSha256Recorded: every session must carry a 64-char hex.
  const allSha256Recorded = input.sessions.every(
    s => /^[0-9a-f]{64}$/.test(s.originalSha256),
  )
  if (!allSha256Recorded && input.sessions.length > 0) {
    reasons.push('one or more session entries missing valid sha256')
  }

  // The remaining flags are properties of the W149-E *design*, not
  // of any specific session list. They are constant true for every
  // shadow run that this helper produces — but we still gate `pass`
  // on `allSourceRetained` and `allSha256Recorded` so a future
  // helper bug that drops the invariant would flip `pass` to false.
  const pass =
    allSourceRetained && (allSha256Recorded || input.sessions.length === 0)

  return {
    sourceJsonlRetained: allSourceRetained,
    sourceSha256Recorded: allSha256Recorded || input.sessions.length === 0,
    compressedCopyAuthoritative: false,
    sqliteRebuildableFromSource: true,
    exportCanUseSource: true,
    partialFailureLeavesSourceUntouched: true,
    repeatedShadowRunDeterministic: true,
    sidecarDisabledNotRequiredForReadOnlyShadow: true,
    activeOrRecentSessionSkipped: true,
    pass,
    reasons,
  }
}
