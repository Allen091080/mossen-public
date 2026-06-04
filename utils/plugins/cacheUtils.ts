import { randomBytes } from 'crypto'
import { realpathSync } from 'fs'
import { readdir, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { clearCommandsCache } from '../../commands.js'
import { clearAllOutputStylesCache } from '../../constants/outputStyles.js'
import { clearAgentDefinitionsCache } from '../../tools/AgentTool/loadAgentsDir.js'
import { clearPromptCache } from '../../tools/SkillTool/prompt.js'
import { resetSentSkillNames } from '../attachments.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { logError } from '../log.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'
import { clearPluginAgentCache } from './loadPluginAgents.js'
import { clearPluginCommandCache } from './loadPluginCommands.js'
import {
  clearPluginHookCache,
  pruneRemovedPluginHooks,
} from './loadPluginHooks.js'
import { clearPluginOutputStyleCache } from './loadPluginOutputStyles.js'
import { clearPluginCache, getPluginCachePath } from './pluginLoader.js'
import { clearPluginOptionsCache } from './pluginOptionsStorage.js'
import { isPluginZipCacheEnabled } from './zipCache.js'

const ORPHANED_AT_FILENAME = '.orphaned_at'
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function clearAllPluginCaches(): void {
  clearPluginCache()
  clearPluginCommandCache()
  clearPluginAgentCache()
  clearPluginHookCache()
  // Prune hooks from plugins no longer in the enabled set so uninstalled/
  // disabled plugins stop firing immediately (gh-36995). Prune-only: hooks
  // from newly-enabled plugins are NOT added here — they wait for
  // /reload-plugins like commands/agents/MCP do. Fire-and-forget: old hooks
  // stay valid until the prune completes (preserves gh-29767). No-op when
  // STATE.registeredHooks is empty (test/preload.ts beforeEach clears it via
  // resetStateForTests before reaching here).
  pruneRemovedPluginHooks().catch(e => logError(e))
  clearPluginOptionsCache()
  clearPluginOutputStyleCache()
  clearAllOutputStylesCache()
}

export function clearAllCaches(): void {
  clearAllPluginCaches()
  clearCommandsCache()
  clearAgentDefinitionsCache()
  clearPromptCache()
  resetSentSkillNames()
}

/**
 * Mark a plugin version as orphaned.
 * Called when a plugin is uninstalled or updated to a new version.
 */
export async function markPluginVersionOrphaned(
  versionPath: string,
): Promise<void> {
  try {
    await writeFile(getOrphanedAtPath(versionPath), `${Date.now()}`, 'utf-8')
  } catch (error) {
    logForDebugging(`Failed to write .orphaned_at: ${versionPath}: ${error}`)
  }
}

/**
 * Clean up orphaned plugin versions that have been orphaned for more than 7 days.
 *
 * Pass 1: Remove .orphaned_at from installed versions (clears stale markers)
 * Pass 2: For each cached version not in installed_plugins.json:
 *   - If no .orphaned_at exists: create it (handles old CC versions, manual edits)
 *   - If .orphaned_at exists and > 7 days old: delete the version
 */
export async function cleanupOrphanedPluginVersionsInBackground(): Promise<void> {
  // Zip cache mode stores plugins as .zip files, not directories. readSubdirs
  // filters to directories only, so removeIfEmpty would see plugin dirs as empty
  // and delete them (including the ZIPs). Skip cleanup entirely in zip mode.
  if (isPluginZipCacheEnabled()) {
    return
  }
  try {
    const installedVersions = getInstalledVersionPaths()
    if (!installedVersions) return

    const cachePath = getPluginCachePath()

    const now = Date.now()

    // Pass 1: Remove .orphaned_at from installed versions
    // This handles cases where a plugin was reinstalled after being orphaned
    await Promise.all(
      [...installedVersions].map(p => removeOrphanedAtMarker(p)),
    )

    // Pass 2: Process orphaned versions
    for (const marketplace of await readSubdirs(cachePath)) {
      const marketplacePath = join(cachePath, marketplace)

      for (const plugin of await readSubdirs(marketplacePath)) {
        const pluginPath = join(marketplacePath, plugin)

        for (const version of await readSubdirs(pluginPath)) {
          const versionPath = join(pluginPath, version)
          if (isInstalledVersionPath(versionPath, installedVersions)) continue
          await processOrphanedPluginVersion(versionPath, now)
        }

        await removeIfEmpty(pluginPath)
      }

      await removeIfEmpty(marketplacePath)
    }
  } catch (error) {
    logForDebugging(`Plugin cache cleanup failed: ${error}`)
  }
}

function getOrphanedAtPath(versionPath: string): string {
  return join(versionPath, ORPHANED_AT_FILENAME)
}

async function removeOrphanedAtMarker(versionPath: string): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)
  try {
    await unlink(orphanedAtPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return
    logForDebugging(`Failed to remove .orphaned_at: ${versionPath}: ${error}`)
  }
}

export function buildInstalledVersionPathSet(
  installPaths: Iterable<string>,
): Set<string> {
  const paths = new Set<string>()
  for (const installPath of installPaths) {
    paths.add(installPath)
    try {
      paths.add(realpathSync(installPath))
    } catch {
      // Missing cache paths stay represented by their raw registry value.
    }
  }
  return paths
}

export function isInstalledVersionPath(
  versionPath: string,
  installedVersions: Set<string>,
): boolean {
  if (installedVersions.has(versionPath)) return true
  try {
    return installedVersions.has(realpathSync(versionPath))
  } catch {
    return false
  }
}

function getInstalledVersionPaths(): Set<string> | null {
  try {
    const paths: string[] = []
    const diskData = loadInstalledPluginsFromDisk()
    for (const installations of Object.values(diskData.plugins)) {
      for (const entry of installations) {
        paths.push(entry.installPath)
      }
    }
    return buildInstalledVersionPathSet(paths)
  } catch (error) {
    logForDebugging(`Failed to load installed plugins: ${error}`)
    return null
  }
}

async function processOrphanedPluginVersion(
  versionPath: string,
  now: number,
): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)

  let orphanedAt: number
  try {
    orphanedAt = (await stat(orphanedAtPath)).mtimeMs
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      await markPluginVersionOrphaned(versionPath)
      return
    }
    logForDebugging(`Failed to stat orphaned marker: ${versionPath}: ${error}`)
    return
  }

  if (now - orphanedAt > CLEANUP_AGE_MS) {
    try {
      await rm(versionPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(
        `Failed to delete orphaned version: ${versionPath}: ${error}`,
      )
    }
  }
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  if ((await readSubdirs(dirPath)).length === 0) {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(`Failed to remove empty dir: ${dirPath}: ${error}`)
    }
  }
}

async function readSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// User-facing prune (W55): /plugin prune dry-run + confirm-token flow.
//
// The background pruner above (cleanupOrphanedPluginVersionsInBackground)
// runs without user input: marks unmarked orphans, deletes orphans whose
// .orphaned_at marker is older than CLEANUP_AGE_MS. The /plugin prune
// command exposes the *same* policy to the user — never bypassing the
// 7-day grace period, never modifying installed_plugins.json, never
// touching the marketplaces/ tree or installed paths — but with a
// dry-run preview and an explicit confirm step.
//
// Two-step flow:
//   1. getPluginPrunePlan() builds a read-only plan and mints a one-shot
//      base32 token (TTL = PRUNE_PLAN_TOKEN_TTL_MS). No filesystem
//      mutation occurs here — no marker writes, no deletes.
//   2. executePluginPrunePlan(token) consumes the token, re-validates
//      against the current installed registry (defense-in-depth in case
//      the user installed/uninstalled between dry-run and confirm), then:
//        * marks unmarkedOrphans with .orphaned_at
//        * deletes expiredOrphans (>= 7 days old marker)
//        * cleans up empty parent dirs
//
// freshOrphans (marker present but < 7 days old) are surfaced for the
// user to *see*, but the plan never touches them: the grace period is
// the safety net.
// ---------------------------------------------------------------------------

/** TTL for prune-plan tokens. After this, confirm requests are rejected. */
export const PRUNE_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type PrunePlanEntry = {
  versionPath: string
  marketplace: string
  plugin: string
  version: string
  /** mtime of `.orphaned_at` if present, otherwise null. */
  orphanedAtMs: number | null
  /** Age of the `.orphaned_at` marker in days; null when no marker. */
  ageDays: number | null
  /** Approximate disk size in bytes. -1 on stat failure. */
  sizeBytes: number
}

export type PluginPrunePlan = {
  /** Single-use base32 token, 8 hex chars. */
  token: string
  /** Date.now() at plan creation. Plan expires at createdAt + TTL. */
  createdAt: number
  /** Versions with `.orphaned_at` >= 7 days old — will be deleted. */
  expiredOrphans: PrunePlanEntry[]
  /** Versions not in installed registry, no marker yet — will be marked. */
  unmarkedOrphans: PrunePlanEntry[]
  /** Versions marked but < 7 days old — will NOT be touched. */
  freshOrphans: PrunePlanEntry[]
  /** Versions in installed registry — protected, never touched. */
  installedSkipped: PrunePlanEntry[]
  /** True iff zip cache mode is active (prune is a no-op then). */
  zipCacheMode: boolean
}

export type PluginPruneResult = {
  marked: string[]
  deleted: string[]
  cleanedDirs: string[]
  errors: Array<{
    path: string
    phase: 'mark' | 'delete' | 'cleanup'
    message: string
  }>
}

/**
 * Module-level token store. Populated by getPluginPrunePlan, drained by
 * executePluginPrunePlan. Tokens are deleted before any side effects so
 * a thrown error mid-execution does not leave the token live.
 */
const prunePlanStore = new Map<string, PluginPrunePlan>()

function evictExpiredPlans(now: number = Date.now()): void {
  for (const [token, plan] of prunePlanStore) {
    if (now - plan.createdAt > PRUNE_PLAN_TOKEN_TTL_MS) {
      prunePlanStore.delete(token)
    }
  }
}

function generatePruneToken(): string {
  return randomBytes(4).toString('hex')
}

async function computeDirSizeBytes(dirPath: string): Promise<number> {
  try {
    let total = 0
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const child = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await computeDirSizeBytes(child)
      } else if (entry.isFile()) {
        try {
          total += (await stat(child)).size
        } catch {
          /* skip unreadable file */
        }
      }
    }
    return total
  } catch {
    return -1
  }
}

async function buildPlanEntry(
  versionPath: string,
  marketplace: string,
  plugin: string,
  version: string,
  now: number,
): Promise<PrunePlanEntry> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)
  let orphanedAtMs: number | null = null
  try {
    orphanedAtMs = (await stat(orphanedAtPath)).mtimeMs
  } catch (error) {
    const code = getErrnoCode(error)
    if (code !== 'ENOENT') {
      logForDebugging(`Failed to stat orphaned marker: ${versionPath}: ${error}`)
    }
    orphanedAtMs = null
  }
  const ageDays =
    orphanedAtMs === null
      ? null
      : Math.floor((now - orphanedAtMs) / (24 * 60 * 60 * 1000))
  const sizeBytes = await computeDirSizeBytes(versionPath)
  return {
    versionPath,
    marketplace,
    plugin,
    version,
    orphanedAtMs,
    ageDays,
    sizeBytes,
  }
}

/**
 * Build a dry-run prune plan. Read-only — does NOT write `.orphaned_at`,
 * does NOT delete anything. The returned plan carries a single-use token;
 * pass it back to executePluginPrunePlan within PRUNE_PLAN_TOKEN_TTL_MS to
 * commit. Stale/old plans are evicted lazily on each call.
 */
export async function getPluginPrunePlan(): Promise<PluginPrunePlan> {
  const now = Date.now()
  evictExpiredPlans(now)

  const expiredOrphans: PrunePlanEntry[] = []
  const unmarkedOrphans: PrunePlanEntry[] = []
  const freshOrphans: PrunePlanEntry[] = []
  const installedSkipped: PrunePlanEntry[] = []
  const zipCacheMode = isPluginZipCacheEnabled()

  if (!zipCacheMode) {
    const installedVersions = getInstalledVersionPaths() ?? new Set<string>()
    const cachePath = getPluginCachePath()
    for (const marketplace of await readSubdirs(cachePath)) {
      const marketplacePath = join(cachePath, marketplace)
      for (const plugin of await readSubdirs(marketplacePath)) {
        const pluginPath = join(marketplacePath, plugin)
        for (const version of await readSubdirs(pluginPath)) {
          const versionPath = join(pluginPath, version)
          const entry = await buildPlanEntry(
            versionPath,
            marketplace,
            plugin,
            version,
            now,
          )
          if (isInstalledVersionPath(versionPath, installedVersions)) {
            installedSkipped.push(entry)
            continue
          }
          if (entry.orphanedAtMs === null) {
            unmarkedOrphans.push(entry)
          } else if (now - entry.orphanedAtMs > CLEANUP_AGE_MS) {
            expiredOrphans.push(entry)
          } else {
            freshOrphans.push(entry)
          }
        }
      }
    }
  }

  const token = generatePruneToken()
  const plan: PluginPrunePlan = {
    token,
    createdAt: now,
    expiredOrphans,
    unmarkedOrphans,
    freshOrphans,
    installedSkipped,
    zipCacheMode,
  }
  prunePlanStore.set(token, plan)
  return plan
}

export type PluginPruneError =
  | { kind: 'unknown_token' }
  | { kind: 'expired_token' }
  | { kind: 'zip_cache_mode' }

/**
 * Consume a previously-issued prune token and execute the plan. On
 * success returns the per-path mutation result. On failure (expired or
 * unknown token, or zip-cache mode) returns a tagged error — the caller
 * surfaces it to the user without crashing the dialog.
 *
 * The token is removed from the store BEFORE any side effects so an
 * error mid-execution does not leave a live token.
 *
 * Re-validates against the current installed registry: a version that
 * was orphan at dry-run time but appears in the registry now (user
 * reinstalled in the gap) is silently skipped.
 */
export async function executePluginPrunePlan(
  token: string,
): Promise<PluginPruneResult | PluginPruneError> {
  const now = Date.now()
  evictExpiredPlans(now)

  const plan = prunePlanStore.get(token)
  if (!plan) {
    return { kind: 'unknown_token' }
  }
  if (now - plan.createdAt > PRUNE_PLAN_TOKEN_TTL_MS) {
    prunePlanStore.delete(token)
    return { kind: 'expired_token' }
  }
  // Consume token before any mutation.
  prunePlanStore.delete(token)

  if (plan.zipCacheMode) {
    return { kind: 'zip_cache_mode' }
  }

  const result: PluginPruneResult = {
    marked: [],
    deleted: [],
    cleanedDirs: [],
    errors: [],
  }

  // Re-load the installed registry at confirm time so a reinstall during
  // the dry-run/confirm gap is honored.
  const currentInstalled = getInstalledVersionPaths() ?? new Set<string>()
  const isStillOrphan = (versionPath: string): boolean =>
    !isInstalledVersionPath(versionPath, currentInstalled)

  // Phase 1: mark unmarked orphans (write .orphaned_at).
  for (const entry of plan.unmarkedOrphans) {
    if (!isStillOrphan(entry.versionPath)) continue
    try {
      await markPluginVersionOrphaned(entry.versionPath)
      result.marked.push(entry.versionPath)
    } catch (error) {
      result.errors.push({
        path: entry.versionPath,
        phase: 'mark',
        message: String(error),
      })
    }
  }

  // Phase 2: delete expired orphans. Re-stat the marker so we never delete
  // a path whose marker was removed (re-installed) or whose age suddenly
  // dropped below the threshold.
  const parentDirsToCheck = new Set<string>()
  for (const entry of plan.expiredOrphans) {
    if (!isStillOrphan(entry.versionPath)) continue
    try {
      const orphanedAtMs = (await stat(getOrphanedAtPath(entry.versionPath)))
        .mtimeMs
      if (now - orphanedAtMs <= CLEANUP_AGE_MS) {
        // Marker mtime got updated since dry-run — fall back to grace.
        continue
      }
      await rm(entry.versionPath, { recursive: true, force: true })
      result.deleted.push(entry.versionPath)
      // The plugin dir is the parent of versionPath; the marketplace dir
      // is its grandparent. Check both for emptiness once we're done.
      const pluginDir = join(entry.versionPath, '..')
      const marketplaceDir = join(pluginDir, '..')
      parentDirsToCheck.add(pluginDir)
      parentDirsToCheck.add(marketplaceDir)
    } catch (error) {
      result.errors.push({
        path: entry.versionPath,
        phase: 'delete',
        message: String(error),
      })
    }
  }

  // Phase 3: clean up empty parent dirs (plugin/, marketplace/) so the
  // cache tree doesn't accumulate empty husks. Order matters: plugin
  // dirs first, then marketplace dirs (a marketplace dir becomes empty
  // only after all its plugin dirs are cleaned).
  const parents = [...parentDirsToCheck].sort((a, b) => b.length - a.length)
  for (const dir of parents) {
    try {
      const subdirs = await readSubdirs(dir)
      if (subdirs.length === 0) {
        await rm(dir, { recursive: true, force: true })
        result.cleanedDirs.push(dir)
      }
    } catch (error) {
      result.errors.push({
        path: dir,
        phase: 'cleanup',
        message: String(error),
      })
    }
  }

  return result
}

/** Test-only: clear the in-memory token store. Not exported for runtime use. */
export function _resetPrunePlanStoreForTesting(): void {
  prunePlanStore.clear()
}

// ---------------------------------------------------------------------------
// W56 read-only summary: counts orphan / installed / fresh buckets without
// minting a plan token. Used by /plugin status. No filesystem mutation.
// ---------------------------------------------------------------------------

export type PluginCacheSummary = {
  zipCacheMode: boolean
  cachePath: string
  marketplaceCount: number
  /** Distinct (marketplace, plugin) pairs visible under cache. */
  uniquePluginCount: number
  /** Total cached version directories across all plugins. */
  cacheVersionCount: number
  installedCount: number
  expiredOrphanCount: number
  unmarkedOrphanCount: number
  freshOrphanCount: number
  installedSkippedCount: number
  /** Total bytes under cache (-1 on walk error). */
  cacheBytes: number
}

async function dirBytes(path: string): Promise<number> {
  try {
    let total = 0
    const entries = await readdir(path, { withFileTypes: true })
    for (const e of entries) {
      const child = join(path, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        const sub = await dirBytes(child)
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

export async function summarizePluginCache(): Promise<PluginCacheSummary> {
  const cachePath = getPluginCachePath()
  const zipCacheMode = isPluginZipCacheEnabled()
  if (zipCacheMode) {
    return {
      zipCacheMode: true,
      cachePath,
      marketplaceCount: 0,
      uniquePluginCount: 0,
      cacheVersionCount: 0,
      installedCount: 0,
      expiredOrphanCount: 0,
      unmarkedOrphanCount: 0,
      freshOrphanCount: 0,
      installedSkippedCount: 0,
      cacheBytes: -1,
    }
  }
  const now = Date.now()
  const installedVersions = getInstalledVersionPaths() ?? new Set<string>()
  let marketplaceCount = 0
  let uniquePluginCount = 0
  let cacheVersionCount = 0
  let expiredOrphanCount = 0
  let unmarkedOrphanCount = 0
  let freshOrphanCount = 0
  let installedSkippedCount = 0

  for (const marketplace of await readSubdirs(cachePath)) {
    marketplaceCount += 1
    const marketplacePath = join(cachePath, marketplace)
    for (const plugin of await readSubdirs(marketplacePath)) {
      uniquePluginCount += 1
      const pluginPath = join(marketplacePath, plugin)
      for (const version of await readSubdirs(pluginPath)) {
        cacheVersionCount += 1
        const versionPath = join(pluginPath, version)
        if (isInstalledVersionPath(versionPath, installedVersions)) {
          installedSkippedCount += 1
          continue
        }
        let orphanedAtMs: number | null = null
        try {
          orphanedAtMs = (await stat(getOrphanedAtPath(versionPath))).mtimeMs
        } catch {
          orphanedAtMs = null
        }
        if (orphanedAtMs === null) {
          unmarkedOrphanCount += 1
        } else if (now - orphanedAtMs > CLEANUP_AGE_MS) {
          expiredOrphanCount += 1
        } else {
          freshOrphanCount += 1
        }
      }
    }
  }

  const cacheBytes = await dirBytes(cachePath)

  return {
    zipCacheMode: false,
    cachePath,
    marketplaceCount,
    uniquePluginCount,
    cacheVersionCount,
    installedCount: installedVersions.size,
    expiredOrphanCount,
    unmarkedOrphanCount,
    freshOrphanCount,
    installedSkippedCount,
    cacheBytes,
  }
}
