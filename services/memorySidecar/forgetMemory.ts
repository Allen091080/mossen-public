// W419b — Prefix lookup helper for /forget.
//
// Wraps listUserMemory({ kind: 'archive' }) + prefix-filter so the
// /forget command can resolve a user-typed id prefix (e.g. "evt_a3f0c2")
// to the full archiveEventId, then hand off to W419's tombstoneArchive-
// Event for the actual deletion.
//
// Pure REUSE; no memory-sidecar core changes.
import {
  getDefaultMemorySidecarConfigPath,
  listUserMemory,
  loadMemorySidecarConfig,
  type UserMemorySummary,
} from '../../memory-sidecar/src/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

export type ForgetLookupResult =
  | {
      ok: true
      matches: UserMemorySummary[]
    }
  | {
      ok: false
      reason: 'sidecar_disabled' | 'config_error' | 'list_failed'
      detail?: string
    }

const FORGET_LOOKUP_SCAN_LIMIT = 500

export async function findArchiveEventByPrefix(options: {
  projectId: string
  prefix: string
}): Promise<ForgetLookupResult> {
  const prefix = options.prefix.trim()

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    logForDebugging(
      `[forget] config load failed: ${errorMessage(error)}`,
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

  let entries: UserMemorySummary[]
  try {
    entries = await listUserMemory({
      rootDir: config.homeDir,
      projectId: options.projectId,
      kind: 'archive',
      limit: FORGET_LOOKUP_SCAN_LIMIT,
    })
  } catch (error) {
    logForDebugging(
      `[forget] list failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'list_failed',
      detail: errorMessage(error),
    }
  }

  const matches = entries.filter(entry => entry.id.startsWith(prefix))
  return { ok: true, matches }
}
