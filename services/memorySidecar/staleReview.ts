// W432 — Stale archive review.
//
// Minimal-scope helper: list the OLDEST archive entries for /memory-review.
// Uses createdAt as the staleness proxy; no last_recalled_at tracking (left
// to a possible W432b). Reuses listUserMemory(); no memory-sidecar core
// changes.
import {
  getDefaultMemorySidecarConfigPath,
  listUserMemory,
  loadMemorySidecarConfig,
  type UserMemorySummary,
} from '../../memory-sidecar/src/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

export type StaleReviewResult =
  | {
      ok: true
      entries: UserMemorySummary[]
      totalCount: number
      generatedAt: string
    }
  | {
      ok: false
      reason: 'sidecar_disabled' | 'config_error' | 'list_failed'
      detail?: string
    }

const STALE_REVIEW_DEFAULT_LIMIT = 20
const STALE_REVIEW_LIST_OVERSCAN = 200

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Compact human-readable age, e.g. "9mo", "2d", "3h", "now". Approximate;
 * intended for a 4-character column in /memory-review's table. */
export function humanAge(createdAt: string | undefined, now: Date = new Date()): string {
  if (!createdAt) return '?'
  const ts = Date.parse(createdAt)
  if (Number.isNaN(ts)) return '?'
  const diff = now.getTime() - ts
  if (diff < 0) return 'now'
  const days = Math.floor(diff / MS_PER_DAY)
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  if (days >= 1) return `${days}d`
  const hours = Math.floor(diff / (60 * 60 * 1000))
  if (hours >= 1) return `${hours}h`
  return 'now'
}

export async function listStaleArchiveEntries(options: {
  projectId: string
  limit?: number
}): Promise<StaleReviewResult> {
  const limit = options.limit ?? STALE_REVIEW_DEFAULT_LIMIT

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    logForDebugging(
      `[memory-review] config load failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'config_error',
      detail: errorMessage(error),
    }
  }

  if (!config.enabled) {
    return { ok: false, reason: 'sidecar_disabled' }
  }

  // Overscan: listUserMemory returns newest-first when sorting by updatedAt;
  // we want oldest, so request a larger window then re-sort ascending and
  // trim to `limit`. STALE_REVIEW_LIST_OVERSCAN keeps a reasonable cap.
  let entries: UserMemorySummary[]
  try {
    entries = await listUserMemory({
      rootDir: config.homeDir,
      projectId: options.projectId,
      kind: 'archive',
      limit: STALE_REVIEW_LIST_OVERSCAN,
    })
  } catch (error) {
    logForDebugging(
      `[memory-review] list failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'list_failed',
      detail: errorMessage(error),
    }
  }

  const sorted = [...entries].sort((a, b) => {
    const aKey = a.createdAt ?? a.updatedAt ?? ''
    const bKey = b.createdAt ?? b.updatedAt ?? ''
    return aKey.localeCompare(bKey)
  })

  return {
    ok: true,
    entries: sorted.slice(0, limit),
    totalCount: entries.length,
    generatedAt: new Date().toISOString(),
  }
}
