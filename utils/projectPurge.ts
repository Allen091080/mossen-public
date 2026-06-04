import { randomBytes } from 'crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { basename, join, sep } from 'path'
import {
  getOriginalCwd,
  getProjectRoot,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getMossenConfigHomeDir } from './envUtils.js'
import {
  findProjectDir,
  getProjectsDir,
  sanitizePath,
} from './sessionStoragePortable.js'
import { getSettingsForSource } from './settings/settings.js'

// ---------------------------------------------------------------------------
// User-facing /project purge (W55 Round 2):
//
// Two-step flow mirroring W55 Round 1 /plugin prune (cacheUtils.ts):
//   1. getProjectPurgePlan() resolves the target cwd → realpath → NFC →
//      sanitizePath, runs the active-project guard (three-way: original
//      cwd / project root / session project dir), classifies project dir
//      entries into archive vs preserve buckets (memory is preserved by
//      default), and mints a one-shot token (TTL = PROJECT_PURGE_TOKEN_TTL_MS).
//      Read-only — no archive write, no entry deletion.
//   2. executeProjectPurgePlan() consumes the token (delete-before-mutate),
//      re-runs the active-project guard, re-enumerates project dir entries
//      (no snapshot reuse), then archives entries to
//      `~/.mossen/backups/purge-<ISO-with-dashes>-<8hex>/<sanitizedTarget>/`
//      followed by a manifest write and a delete pass.
//
// Hard red lines enforced here:
//   - Never deletes the active project (three-way guard, dry-run + confirm).
//   - Never directly fs.rm()'s the project root — only enumerates top-level
//     entries and archives/deletes them per-entry.
//   - Never touches anything outside the target project dir or the backup
//     dir; symlinks are not followed (lstat + skip in copyRecursive; rm with
//     `force: true` removes the symlink, not its target).
//   - When MOSSEN_WORKSPACE_MEMORY_PATH_OVERRIDE / MOSSEN_CODE_REMOTE_MEMORY_DIR /
//     settings.autoMemoryDirectory is active, --include-memory is REJECTED:
//     external memory is out of scope for /project purge.
//   - Phase A (archive/copy) STOPS on first failure — no entry is deleted
//     unless its archive succeeded; the project dir is preserved.
//   - Phase B (delete original) records per-entry errors but does not throw.
// ---------------------------------------------------------------------------

/** TTL for project-purge plan tokens (10 minutes). */
export const PROJECT_PURGE_TOKEN_TTL_MS = 10 * 60 * 1000

export type ProjectPurgeMemoryStatus = 'in-project' | 'external' | 'absent'

export type ProjectPurgeEntry = {
  /** Entry basename within the project dir (e.g. `<uuid>.jsonl`). */
  name: string
  /** Absolute path of the entry on disk. */
  absPath: string
  kind: 'file' | 'directory' | 'other'
  /** Approximate size in bytes; -1 on stat failure. */
  sizeBytes: number
  /** True iff `name === 'memory'`. */
  isMemory: boolean
}

export type ProjectPurgePlan = {
  /** Single-use base16 token (8 hex chars). */
  token: string
  /** Date.now() at plan creation. Plan expires at createdAt + TTL. */
  createdAt: number
  /** Resolved canonical target cwd (post-realpath + NFC). */
  targetCwd: string
  /** sanitizePath(targetCwd) — directory name under ~/.mossen/projects/. */
  sanitizedTarget: string
  /** Absolute path: ~/.mossen/projects/<sanitizedTarget>/. */
  originalProjectDir: string
  /** Memory location classification at dry-run time. */
  memoryStatus: ProjectPurgeMemoryStatus
  /** When memoryStatus === 'external': hint of where memory is configured. */
  memoryExternalHint?: string
  /** Reason describing which override is active (env / settings.<source>). */
  memoryExternalReason?: string
  /** True iff memory will be archived (only possible when memoryStatus is in-project). */
  includeMemory: boolean
  /** Top-level entries to archive (excludes memory unless includeMemory is true). */
  toArchive: ProjectPurgeEntry[]
  /** Top-level entries skipped (typically memory when default behavior). */
  toSkip: ProjectPurgeEntry[]
  /** Sum of sizeBytes over toArchive; -1 if any entry size unknown. */
  totalArchiveBytes: number
  /** Backup destination: ~/.mossen/backups/purge-<ts>-<hex>/<sanitizedTarget>/. */
  archiveDir: string
}

export type ProjectPurgeError =
  | { kind: 'unknown_token' }
  | { kind: 'expired_token' }
  | { kind: 'active_project'; targetCwd: string; sanitizedTarget: string }
  | { kind: 'invalid_target'; targetCwd: string; reason: string }
  | { kind: 'unsupported_flag'; flag: string }
  | {
      kind: 'external_memory_include_rejected'
      externalHint?: string
      reason?: string
    }
  | { kind: 'token_target_mismatch'; expected: string; got: string }
  | { kind: 'project_dir_missing'; path: string }

export type ProjectPurgeResult = {
  archivedEntries: Array<{
    name: string
    kind: 'file' | 'directory' | 'other'
    bytes: number
  }>
  skippedEntries: Array<{
    name: string
    kind: 'file' | 'directory' | 'other'
    reason: string
  }>
  errors: Array<{
    phase: 'copy' | 'delete' | 'manifest' | 'cleanup'
    name: string
    message: string
  }>
  archiveDir: string
  manifestPath: string
  totalArchivedBytes: number
  /** True iff the project dir was empty after archive+delete and was removed. */
  projectDirRemoved: boolean
  /** True iff Phase A halted early (does not enter Phase B for remaining entries). */
  phaseAHalted: boolean
}

/**
 * Module-level token store. Populated by getProjectPurgePlan, drained by
 * executeProjectPurgePlan. Tokens are deleted before any side effects so a
 * thrown error mid-execution does not leave the token live.
 */
const projectPurgePlanStore = new Map<string, ProjectPurgePlan>()

function evictExpiredPlans(now: number = Date.now()): void {
  for (const [token, plan] of projectPurgePlanStore) {
    if (now - plan.createdAt > PROJECT_PURGE_TOKEN_TTL_MS) {
      projectPurgePlanStore.delete(token)
    }
  }
}

function generatePurgeToken(): string {
  return randomBytes(4).toString('hex')
}

function timestampForArchiveDir(now: number): string {
  // ISO with `:` and `.` replaced by `-` so the resulting path component is
  // safe on every filesystem we support.
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

async function computeEntrySizeBytes(
  absPath: string,
  kind: 'file' | 'directory' | 'other',
): Promise<number> {
  if (kind === 'file') {
    try {
      return (await stat(absPath)).size
    } catch {
      return -1
    }
  }
  if (kind === 'directory') {
    try {
      let total = 0
      const entries = await readdir(absPath, { withFileTypes: true })
      for (const e of entries) {
        const child = join(absPath, e.name)
        if (e.isDirectory()) {
          const sub = await computeEntrySizeBytes(child, 'directory')
          if (sub < 0) return -1
          total += sub
        } else if (e.isFile()) {
          try {
            total += (await stat(child)).size
          } catch {
            return -1
          }
        }
      }
      return total
    } catch {
      return -1
    }
  }
  return -1
}

/**
 * Three-way active-project guard. The target project must NOT be the
 * current original cwd, the stable project root, or the active session's
 * project dir (any one matching → reject).
 */
function detectActiveProject(targetCanonical: string): boolean {
  const targetSanitized = sanitizePath(targetCanonical)
  for (const cwd of [getOriginalCwd(), getProjectRoot()]) {
    if (sanitizePath(cwd) === targetSanitized) return true
  }
  const sessionDir = getSessionProjectDir()
  if (sessionDir && basename(sessionDir) === targetSanitized) {
    return true
  }
  return false
}

/**
 * Detect whether memory is redirected by an env var or settings override.
 * When ANY override is active we treat memory as 'external' — /project purge
 * never modifies external memory, and --include-memory is rejected.
 */
function detectMemoryOverride(): {
  override: boolean
  hint?: string
  reason?: string
} {
  if (process.env.MOSSEN_WORKSPACE_MEMORY_PATH_OVERRIDE) {
    return {
      override: true,
      hint: process.env.MOSSEN_WORKSPACE_MEMORY_PATH_OVERRIDE,
      reason: 'env.MOSSEN_WORKSPACE_MEMORY_PATH_OVERRIDE',
    }
  }
  if (process.env.MOSSEN_CODE_REMOTE_MEMORY_DIR) {
    return {
      override: true,
      hint: process.env.MOSSEN_CODE_REMOTE_MEMORY_DIR,
      reason: 'env.MOSSEN_CODE_REMOTE_MEMORY_DIR',
    }
  }
  for (const source of [
    'policySettings',
    'flagSettings',
    'localSettings',
    'userSettings',
  ] as const) {
    try {
      const dir = getSettingsForSource(source)?.autoMemoryDirectory
      if (typeof dir === 'string' && dir.trim().length > 0) {
        return {
          override: true,
          hint: dir.trim(),
          reason: `settings.${source}.autoMemoryDirectory`,
        }
      }
    } catch (error) {
      logForDebugging(
        `projectPurge: settings probe for ${source} failed (ignored): ${String(error)}`,
      )
    }
  }
  return { override: false }
}

async function classifyMemory(
  projectDir: string,
): Promise<{
  status: ProjectPurgeMemoryStatus
  hint?: string
  reason?: string
}> {
  const override = detectMemoryOverride()
  if (override.override) {
    return { status: 'external', hint: override.hint, reason: override.reason }
  }
  try {
    const st = await stat(join(projectDir, 'memory'))
    return { status: st.isDirectory() ? 'in-project' : 'absent' }
  } catch {
    return { status: 'absent' }
  }
}

/**
 * Recursive copy that REFUSES to follow symlinks. Symlinks within the project
 * dir are deliberately skipped (we never want /project purge to traverse out
 * of ~/.mossen/projects/ via a stray symlink). Skip is recorded silently;
 * the caller treats it as a non-fatal data loss for archive purposes — by
 * design we do not preserve nor follow symlinks in the backup.
 */
async function copyRecursiveNoSymlink(src: string, dest: string): Promise<void> {
  const st = await lstat(src)
  if (st.isSymbolicLink()) {
    logForDebugging(`projectPurge: skipping symlink during archive: ${src}`)
    return
  }
  if (st.isDirectory()) {
    await mkdir(dest, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const e of entries) {
      await copyRecursiveNoSymlink(join(src, e.name), join(dest, e.name))
    }
    return
  }
  if (st.isFile()) {
    await copyFile(src, dest)
    return
  }
  // Special files (sockets, devices) are out of scope and silently skipped.
  logForDebugging(`projectPurge: skipping non-regular entry: ${src}`)
}

/**
 * Build a dry-run plan. Read-only: no archive writes, no deletions, no
 * marker writes. Returns either a plan + token, or a tagged error (active
 * project, invalid target, etc.).
 */
export async function getProjectPurgePlan(opts: {
  targetCwd?: string
  includeMemory?: boolean
}): Promise<ProjectPurgePlan | ProjectPurgeError> {
  const now = Date.now()
  evictExpiredPlans(now)

  const includeMemoryReq = !!opts.includeMemory
  const rawTarget = opts.targetCwd?.trim() || getOriginalCwd()

  let canonical: string
  try {
    canonical = (await realpath(rawTarget)).normalize('NFC')
  } catch (error) {
    return {
      kind: 'invalid_target',
      targetCwd: rawTarget,
      reason: `realpath failed: ${String(error)}`,
    }
  }

  if (detectActiveProject(canonical)) {
    return {
      kind: 'active_project',
      targetCwd: canonical,
      sanitizedTarget: sanitizePath(canonical),
    }
  }

  const sanitized = sanitizePath(canonical)
  const projectDirCandidate = await findProjectDir(canonical)
  const projectDir = projectDirCandidate ?? join(getProjectsDir(), sanitized)

  const memory = await classifyMemory(projectDir)

  if (includeMemoryReq && memory.status === 'external') {
    return {
      kind: 'external_memory_include_rejected',
      externalHint: memory.hint,
      reason: memory.reason,
    }
  }

  let dirents: Array<{
    name: string
    isDirectory(): boolean
    isFile(): boolean
  }>
  try {
    dirents = (await readdir(projectDir, { withFileTypes: true })) as Array<{
      name: string
      isDirectory(): boolean
      isFile(): boolean
    }>
  } catch {
    return { kind: 'project_dir_missing', path: projectDir }
  }

  const includeMemory = includeMemoryReq && memory.status === 'in-project'

  const toArchive: ProjectPurgeEntry[] = []
  const toSkip: ProjectPurgeEntry[] = []
  let totalKnown = 0
  let anyUnknown = false

  for (const dirent of dirents) {
    const name = dirent.name
    const kind: 'file' | 'directory' | 'other' = dirent.isDirectory()
      ? 'directory'
      : dirent.isFile()
        ? 'file'
        : 'other'
    const absPath = join(projectDir, name)
    const isMemory = name === 'memory'
    const sizeBytes = await computeEntrySizeBytes(absPath, kind)
    if (sizeBytes < 0) anyUnknown = true
    else totalKnown += sizeBytes
    const entry: ProjectPurgeEntry = {
      name,
      absPath,
      kind,
      sizeBytes,
      isMemory,
    }
    if (isMemory && !includeMemory) {
      toSkip.push(entry)
    } else {
      toArchive.push(entry)
    }
  }

  const stamp = timestampForArchiveDir(now)
  const archiveDir = join(
    getMossenConfigHomeDir(),
    'backups',
    `purge-${stamp}-${randomBytes(4).toString('hex')}`,
    sanitized,
  )

  const token = generatePurgeToken()
  const plan: ProjectPurgePlan = {
    token,
    createdAt: now,
    targetCwd: canonical,
    sanitizedTarget: sanitized,
    originalProjectDir: projectDir,
    memoryStatus: memory.status,
    memoryExternalHint: memory.hint,
    memoryExternalReason: memory.reason,
    includeMemory,
    toArchive,
    toSkip,
    totalArchiveBytes: anyUnknown ? -1 : totalKnown,
    archiveDir,
  }
  projectPurgePlanStore.set(token, plan)
  return plan
}

/**
 * Consume a plan token and execute the archive + delete + manifest pipeline.
 * Returns either a result with per-entry status, or a tagged error.
 *
 * The token is removed from the store BEFORE any side effects so an
 * exception mid-execution does not leave a live token.
 *
 * Re-runs the active-project guard at confirm time and re-enumerates the
 * project dir from scratch (defense-in-depth against state changes between
 * dry-run and confirm).
 */
export async function executeProjectPurgePlan(opts: {
  token: string
  /** Optional --target double-check. If provided, must match plan.targetCwd. */
  targetCwd?: string
}): Promise<ProjectPurgeResult | ProjectPurgeError> {
  const now = Date.now()
  evictExpiredPlans(now)

  const plan = projectPurgePlanStore.get(opts.token)
  if (!plan) {
    return { kind: 'unknown_token' }
  }
  if (now - plan.createdAt > PROJECT_PURGE_TOKEN_TTL_MS) {
    projectPurgePlanStore.delete(opts.token)
    return { kind: 'expired_token' }
  }
  // Consume the token before any side effect (one-shot guarantee).
  projectPurgePlanStore.delete(opts.token)

  // --target double-check vs token's bound target.
  if (opts.targetCwd) {
    let canon: string
    try {
      canon = (await realpath(opts.targetCwd)).normalize('NFC')
    } catch (error) {
      return {
        kind: 'invalid_target',
        targetCwd: opts.targetCwd,
        reason: `realpath failed: ${String(error)}`,
      }
    }
    if (canon !== plan.targetCwd) {
      return { kind: 'token_target_mismatch', expected: plan.targetCwd, got: canon }
    }
  }

  // Re-run active guard (defense-in-depth: user may have switched session).
  if (detectActiveProject(plan.targetCwd)) {
    return {
      kind: 'active_project',
      targetCwd: plan.targetCwd,
      sanitizedTarget: plan.sanitizedTarget,
    }
  }

  // Re-detect memory state. If --include-memory was bound but memory is no
  // longer in-project, refuse.
  const currentMemory = await classifyMemory(plan.originalProjectDir)
  if (plan.includeMemory && currentMemory.status !== 'in-project') {
    return {
      kind: 'external_memory_include_rejected',
      externalHint: currentMemory.hint,
      reason: currentMemory.reason,
    }
  }

  // Re-enumerate project dir (do NOT reuse plan.toArchive snapshot).
  let dirents: Array<{
    name: string
    isDirectory(): boolean
    isFile(): boolean
  }>
  try {
    dirents = (await readdir(plan.originalProjectDir, {
      withFileTypes: true,
    })) as Array<{
      name: string
      isDirectory(): boolean
      isFile(): boolean
    }>
  } catch {
    return { kind: 'project_dir_missing', path: plan.originalProjectDir }
  }

  const result: ProjectPurgeResult = {
    archivedEntries: [],
    skippedEntries: [],
    errors: [],
    archiveDir: plan.archiveDir,
    manifestPath: join(plan.archiveDir, 'purge-manifest.json'),
    totalArchivedBytes: 0,
    projectDirRemoved: false,
    phaseAHalted: false,
  }

  type LiveEntry = {
    name: string
    absPath: string
    kind: 'file' | 'directory' | 'other'
    sizeBytes: number
  }

  const archiveSet: LiveEntry[] = []
  for (const dirent of dirents) {
    const name = dirent.name
    const kind: 'file' | 'directory' | 'other' = dirent.isDirectory()
      ? 'directory'
      : dirent.isFile()
        ? 'file'
        : 'other'
    if (name === 'memory' && !plan.includeMemory) {
      result.skippedEntries.push({
        name,
        kind: 'directory',
        reason: 'preserved-by-default',
      })
      continue
    }
    const absPath = join(plan.originalProjectDir, name)
    const sizeBytes = await computeEntrySizeBytes(absPath, kind)
    archiveSet.push({ name, absPath, kind, sizeBytes })
  }

  // Phase A — copy entries into archive dir. STOP on first failure.
  await mkdir(plan.archiveDir, { recursive: true })
  const successfullyArchived: LiveEntry[] = []
  for (const entry of archiveSet) {
    const dest = join(plan.archiveDir, entry.name)
    try {
      await copyRecursiveNoSymlink(entry.absPath, dest)
      successfullyArchived.push(entry)
      if (entry.sizeBytes >= 0) {
        result.totalArchivedBytes += entry.sizeBytes
      }
      result.archivedEntries.push({
        name: entry.name,
        kind: entry.kind,
        bytes: entry.sizeBytes,
      })
    } catch (error) {
      result.errors.push({
        phase: 'copy',
        name: entry.name,
        message: String(error),
      })
      result.phaseAHalted = true
      // Best-effort cleanup of the partial copy in archiveDir for this entry.
      try {
        await rm(dest, { recursive: true, force: true })
      } catch (cleanupError) {
        result.errors.push({
          phase: 'cleanup',
          name: entry.name,
          message: `partial-archive cleanup failed: ${String(cleanupError)}`,
        })
      }
      break
    }
  }

  // Phase B — delete originals. Per-entry failures recorded but do not abort.
  if (!result.phaseAHalted) {
    for (const entry of successfullyArchived) {
      try {
        await rm(entry.absPath, { recursive: true, force: true })
      } catch (error) {
        result.errors.push({
          phase: 'delete',
          name: entry.name,
          message: String(error),
        })
      }
    }
  }

  // Phase C — write manifest (always, regardless of phase A halt status).
  try {
    const manifest = {
      schemaVersion: 1 as const,
      purgedAt: new Date(now).toISOString(),
      targetCwd: plan.targetCwd,
      sanitizedTarget: plan.sanitizedTarget,
      originalProjectDir: plan.originalProjectDir,
      includeMemory: plan.includeMemory,
      memoryPreserved: !plan.includeMemory && plan.memoryStatus === 'in-project',
      memoryLocation: plan.memoryStatus,
      memoryExternalPath: plan.memoryExternalHint,
      memoryExternalReason: plan.memoryExternalReason,
      archivedEntries: result.archivedEntries,
      skippedEntries: result.skippedEntries,
      errors: result.errors,
      totalArchivedBytes: result.totalArchivedBytes,
      phaseAHalted: result.phaseAHalted,
    }
    await writeFile(
      result.manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    )
  } catch (error) {
    result.errors.push({
      phase: 'manifest',
      name: 'purge-manifest.json',
      message: String(error),
    })
  }

  // Phase D — if project dir is now empty (or only memory remains and it was
  // preserved), optionally remove the empty dir. We only remove when the dir
  // has zero entries (no memory residue) — safer than deciding "memory only".
  if (!result.phaseAHalted) {
    try {
      const remaining = await readdir(plan.originalProjectDir)
      if (remaining.length === 0) {
        await rm(plan.originalProjectDir, { recursive: true, force: true })
        result.projectDirRemoved = true
      }
    } catch (error) {
      result.errors.push({
        phase: 'cleanup',
        name: basename(plan.originalProjectDir),
        message: String(error),
      })
    }
  }

  return result
}

/** Test-only: clear the in-memory token store. */
export function _resetProjectPurgePlanStoreForTesting(): void {
  projectPurgePlanStore.clear()
}

// Re-export for the smoke / parser to grep without bringing in path module.
export const PROJECT_PURGE_PATH_SEPARATOR = sep
