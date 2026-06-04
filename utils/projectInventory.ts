import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import {
  getOriginalCwd,
  getProjectRoot,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getMossenConfigHomeDir } from './envUtils.js'
import {
  getProjectsDir,
  sanitizePath,
} from './sessionStoragePortable.js'
import { getSettingsForSource } from './settings/settings.js'
import { isSessionStale } from './staleSession.js'

// ---------------------------------------------------------------------------
// W56 read-only inventory of ~/.mossen/projects/ for /project list and
// /project status. Pure metadata: never reads file contents, never mutates.
//
// Distinct from utils/projectPurge.ts (W55 R2): this module never archives
// or deletes — it only walks and reports. The two files share zero engine
// helpers; they only share the same path conventions
// (sanitizePath / getProjectsDir / active guard sources).
// ---------------------------------------------------------------------------

export type MemoryLocationStatus = 'in-project' | 'external' | 'absent'

export type ProjectInventoryEntry = {
  /** Directory basename inside ~/.mossen/projects/. */
  sanitizedId: string
  /** Absolute path of the project dir. */
  projectDir: string
  /** Best-effort cwd inferred from sanitizedId. May be incorrect when the
   *  original cwd contained `-` or exceeded MAX_SANITIZED_LENGTH (hash
   *  fallback). Display only — never used for path resolution. */
  inferredCwd: string
  /** True when sanitizedId likely came from a deeply nested path (suffix
   *  hash present). When true, inferredCwd is just a prefix; display the
   *  sanitizedId verbatim. */
  inferredCwdConfidence: 'high' | 'low'
  /** Number of *.jsonl files at the top level. */
  sessionJsonlCount: number
  /** Number of subdirectories at the top level (excluding `memory`). */
  subSessionDirCount: number
  /** True iff `<projectDir>/memory/` exists as a directory. */
  hasMemoryDir: boolean
  /** Number of regular files under memory/ (recursive). 0 when no memory. */
  memoryFileCount: number
  /** Total bytes under memory/ (recursive). 0 when no memory. */
  memoryBytes: number
  /** Total bytes of the entire project dir (recursive). -1 on error. */
  totalBytes: number
  /** mtime of the project dir itself (ms). */
  modifiedMs: number
  /** True iff modifiedMs corresponds to >= STALE_SESSION_THRESHOLD_DAYS. */
  stale: boolean
  /** True iff sanitizedId matches one of the active project markers
   *  (originalCwd / projectRoot / sessionProjectDir). */
  active: boolean
}

export type ProjectInventoryResult = {
  /** Resolved ~/.mossen/projects/. */
  projectsDir: string
  /** Sorted entries, descending by modifiedMs. */
  entries: ProjectInventoryEntry[]
  /** Summed totalBytes across entries (-1 if any entry totalBytes < 0). */
  aggregateBytes: number
  /** True when projectsDir does not exist (entries will be []). */
  missingProjectsDir: boolean
  /** Active sanitized markers — used by callers to highlight rows. */
  activeMarkers: ActiveProjectMarkers
}

export type ActiveProjectMarkers = {
  originalCwd: string
  projectRoot: string
  sessionProjectDir: string | null
  /** Set of sanitized ids that should be flagged active. */
  activeSanitized: Set<string>
}

export type CacheSizeSummary = {
  /** Path that was scanned. */
  path: string
  /** True iff the path exists on disk. */
  exists: boolean
  /** Total bytes (-1 on walk error). */
  totalBytes: number
  /** Top-level entry count (files + dirs); -1 on error. */
  entryCount: number
}

export type MemoryStateSummary = {
  status: MemoryLocationStatus
  /** Path being measured (in-project => <projectDir>/memory/, external => override path). */
  path: string | null
  reason: 'env.MOSSEN_WORKSPACE_MEMORY_PATH_OVERRIDE'
    | 'env.MOSSEN_CODE_REMOTE_MEMORY_DIR'
    | 'settings.policySettings.autoMemoryDirectory'
    | 'settings.flagSettings.autoMemoryDirectory'
    | 'settings.localSettings.autoMemoryDirectory'
    | 'settings.userSettings.autoMemoryDirectory'
    | 'default-in-project'
    | 'absent'
  /** Number of regular files under path (recursive). 0 when absent / unknown for external. */
  fileCount: number
  /** Total bytes under path (recursive). 0 when absent. -1 on walk error. */
  totalBytes: number
}

// ---------------------------------------------------------------------------
// Active markers
// ---------------------------------------------------------------------------

export function computeActiveMarkers(): ActiveProjectMarkers {
  const originalCwd = getOriginalCwd()
  const projectRoot = getProjectRoot()
  const sessionProjectDir = getSessionProjectDir()

  const activeSanitized = new Set<string>()
  activeSanitized.add(sanitizePath(originalCwd))
  activeSanitized.add(sanitizePath(projectRoot))
  if (sessionProjectDir) {
    activeSanitized.add(basename(sessionProjectDir))
  }
  return {
    originalCwd,
    projectRoot,
    sessionProjectDir,
    activeSanitized,
  }
}

// ---------------------------------------------------------------------------
// Memory override classification (read-only mirror of projectPurge logic;
// kept local so this module is independent of projectPurge).
// ---------------------------------------------------------------------------

function detectMemoryOverride():
  | { override: false }
  | {
      override: true
      hint: string
      reason: MemoryStateSummary['reason']
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
          reason: `settings.${source}.autoMemoryDirectory` as MemoryStateSummary['reason'],
        }
      }
    } catch (error) {
      logForDebugging(
        `projectInventory: settings probe ${source} failed: ${String(error)}`,
      )
    }
  }
  return { override: false }
}

// ---------------------------------------------------------------------------
// Recursive size walker — counts regular files only; symlinks are not
// followed. -1 on any unrecoverable error.
// ---------------------------------------------------------------------------

async function walkSize(
  dir: string,
): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0
  let fileCount = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const child = join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        const sub = await walkSize(child)
        if (sub.bytes < 0) return { bytes: -1, fileCount: -1 }
        bytes += sub.bytes
        fileCount += sub.fileCount
      } else if (e.isFile()) {
        try {
          bytes += (await stat(child)).size
          fileCount += 1
        } catch {
          return { bytes: -1, fileCount: -1 }
        }
      }
    }
    return { bytes, fileCount }
  } catch {
    return { bytes: -1, fileCount: -1 }
  }
}

// ---------------------------------------------------------------------------
// Cwd inference — pure decoration; never used as a path.
// ---------------------------------------------------------------------------

function inferCwd(sanitizedId: string): {
  inferredCwd: string
  confidence: 'high' | 'low'
} {
  // sanitizePath replaces all non-alphanumeric with '-'. The most common
  // shape is leading '-' followed by path components separated by '-'.
  // If a hash suffix is present (sanitized > 200 chars in the original),
  // we can't reliably reconstruct.
  // Heuristic: sanitizedId of exactly the leading-`-`-then-segments shape
  // becomes a slash-separated path; we report 'low' confidence whenever
  // the basename looks like a base36 hash (>= 7 chars, all alnum).
  if (!sanitizedId.startsWith('-')) {
    return { inferredCwd: sanitizedId, confidence: 'low' }
  }
  const inferred = sanitizedId.replace(/-/g, '/')
  // Very rough hash detection: trailing segment looks like base36.
  const tail = sanitizedId.split('-').pop() ?? ''
  const looksHashed = /^[a-z0-9]{7,}$/.test(tail)
  return {
    inferredCwd: inferred,
    confidence: looksHashed ? 'low' : 'high',
  }
}

// ---------------------------------------------------------------------------
// Project enumerator
// ---------------------------------------------------------------------------

async function inventoryProjectDir(
  projectsDir: string,
  sanitizedId: string,
  activeMarkers: ActiveProjectMarkers,
): Promise<ProjectInventoryEntry | null> {
  const projectDir = join(projectsDir, sanitizedId)
  let entries: Array<{
    name: string
    isDirectory(): boolean
    isFile(): boolean
  }>
  try {
    entries = (await readdir(projectDir, { withFileTypes: true })) as Array<{
      name: string
      isDirectory(): boolean
      isFile(): boolean
    }>
  } catch {
    return null
  }

  let sessionJsonlCount = 0
  let subSessionDirCount = 0
  let hasMemoryDir = false
  for (const e of entries) {
    if (e.name === 'memory' && e.isDirectory()) {
      hasMemoryDir = true
      continue
    }
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      sessionJsonlCount += 1
    } else if (e.isDirectory()) {
      subSessionDirCount += 1
    }
  }

  let memoryFileCount = 0
  let memoryBytes = 0
  if (hasMemoryDir) {
    const memWalk = await walkSize(join(projectDir, 'memory'))
    memoryFileCount = memWalk.fileCount < 0 ? 0 : memWalk.fileCount
    memoryBytes = memWalk.bytes < 0 ? 0 : memWalk.bytes
  }

  const total = await walkSize(projectDir)
  const totalBytes = total.bytes

  let modifiedMs = 0
  try {
    modifiedMs = (await stat(projectDir)).mtimeMs
  } catch {
    modifiedMs = 0
  }

  const { inferredCwd, confidence } = inferCwd(sanitizedId)
  const stale = modifiedMs > 0 ? isSessionStale(new Date(modifiedMs)) : false
  const active = activeMarkers.activeSanitized.has(sanitizedId)

  return {
    sanitizedId,
    projectDir,
    inferredCwd,
    inferredCwdConfidence: confidence,
    sessionJsonlCount,
    subSessionDirCount,
    hasMemoryDir,
    memoryFileCount,
    memoryBytes,
    totalBytes,
    modifiedMs,
    stale,
    active,
  }
}

export async function buildProjectInventory(): Promise<ProjectInventoryResult> {
  const activeMarkers = computeActiveMarkers()
  const projectsDir = getProjectsDir()
  let dirents: Array<{ name: string; isDirectory(): boolean }>
  try {
    dirents = (await readdir(projectsDir, { withFileTypes: true })) as Array<{
      name: string
      isDirectory(): boolean
    }>
  } catch {
    return {
      projectsDir,
      entries: [],
      aggregateBytes: 0,
      missingProjectsDir: true,
      activeMarkers,
    }
  }

  const entries: ProjectInventoryEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const inv = await inventoryProjectDir(
      projectsDir,
      dirent.name,
      activeMarkers,
    )
    if (inv) entries.push(inv)
  }
  entries.sort((a, b) => b.modifiedMs - a.modifiedMs)
  let aggregateBytes = 0
  let anyUnknown = false
  for (const e of entries) {
    if (e.totalBytes < 0) anyUnknown = true
    else aggregateBytes += e.totalBytes
  }
  return {
    projectsDir,
    entries,
    aggregateBytes: anyUnknown ? -1 : aggregateBytes,
    missingProjectsDir: false,
    activeMarkers,
  }
}

// ---------------------------------------------------------------------------
// Single-project status (active project)
// ---------------------------------------------------------------------------

export type ActiveProjectStatus = {
  activeMarkers: ActiveProjectMarkers
  /** Same shape as inventory entry, but for the active originalCwd's project dir. */
  inventory: ProjectInventoryEntry | null
  /** Memory state of the active originalCwd. */
  memory: MemoryStateSummary
  /** purgeEligibility.eligible is always false for the active project; the
   *  reason field tells the caller why so the UI can suggest the right next
   *  command. */
  purgeEligibility: {
    eligible: false
    reason:
      | 'active-original-cwd'
      | 'active-project-root'
      | 'active-session-project'
  }
  /** Number of jsonl sessions at top level. */
  sessionCount: number
  /** Optional sibling cache size summaries (debug/, backups/). */
  caches: CacheSizeSummary[]
}

export async function describeActiveProjectStatus(): Promise<ActiveProjectStatus> {
  const activeMarkers = computeActiveMarkers()
  const projectsDir = getProjectsDir()
  const sanitizedActive = sanitizePath(activeMarkers.originalCwd)
  const inv = await inventoryProjectDir(
    projectsDir,
    sanitizedActive,
    activeMarkers,
  )
  const memory = await describeMemoryState(
    inv ? inv.projectDir : join(projectsDir, sanitizedActive),
  )
  const sessionCount = inv ? inv.sessionJsonlCount : 0

  const caches = await Promise.all([
    summarizeCacheDir(join(getMossenConfigHomeDir(), 'debug')),
    summarizeCacheDir(join(getMossenConfigHomeDir(), 'backups')),
    summarizeCacheDir(join(getMossenConfigHomeDir(), 'plugins')),
  ])

  return {
    activeMarkers,
    inventory: inv,
    memory,
    purgeEligibility: {
      eligible: false,
      reason: 'active-original-cwd',
    },
    sessionCount,
    caches,
  }
}

// ---------------------------------------------------------------------------
// Memory state describer — never reads memory contents; only stat + walk.
// ---------------------------------------------------------------------------

export async function describeMemoryState(
  candidateInProjectDir: string,
): Promise<MemoryStateSummary> {
  const override = detectMemoryOverride()
  if (override.override) {
    // External path: do NOT walk it. We don't want /memory or /project status
    // to perform IO inside an arbitrary user-configured directory.
    return {
      status: 'external',
      path: override.hint,
      reason: override.reason,
      fileCount: 0,
      totalBytes: 0,
    }
  }
  const memDir = join(candidateInProjectDir, 'memory')
  try {
    const st = await stat(memDir)
    if (!st.isDirectory()) {
      return {
        status: 'absent',
        path: null,
        reason: 'absent',
        fileCount: 0,
        totalBytes: 0,
      }
    }
  } catch {
    return {
      status: 'absent',
      path: null,
      reason: 'absent',
      fileCount: 0,
      totalBytes: 0,
    }
  }
  const walk = await walkSize(memDir)
  return {
    status: 'in-project',
    path: memDir,
    reason: 'default-in-project',
    fileCount: walk.fileCount < 0 ? 0 : walk.fileCount,
    totalBytes: walk.bytes < 0 ? -1 : walk.bytes,
  }
}

// ---------------------------------------------------------------------------
// Cache size summary — read-only walk of a single dir.
// ---------------------------------------------------------------------------

export async function summarizeCacheDir(
  path: string,
): Promise<CacheSizeSummary> {
  try {
    await stat(path)
  } catch {
    return { path, exists: false, totalBytes: 0, entryCount: 0 }
  }
  let entryCount = 0
  try {
    const top = await readdir(path)
    entryCount = top.length
  } catch {
    entryCount = -1
  }
  const walk = await walkSize(path)
  return {
    path,
    exists: true,
    totalBytes: walk.bytes,
    entryCount,
  }
}
