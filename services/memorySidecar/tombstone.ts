// W419 S2 — Tombstone helper for the memory sidecar.
//
// Wraps the existing two-phase delete API in memory-sidecar/src/management/
// userMemory.ts (createDeleteDryRun + confirmDelete) into a single
// fire-and-forget call suitable for the /undo slash command and any future
// "delete one entry" UX.
//
// Contract:
//   - Pure REUSE of public memory-sidecar APIs; no internal schema change.
//   - Errors are classified into a typed reason union; callers receive a
//     result object instead of thrown exceptions (UX-facing path).
//   - The dry-run plan token is consumed immediately; the on-disk plan file
//     is removed by confirmDelete on success. On dry-run-then-error, the
//     plan file is left for the 10-min TTL auto-cleanup.
import { join } from 'node:path'
import {
  confirmDelete,
  createDeleteDryRun,
  getDefaultMemorySidecarConfigPath,
  getProjectMemoryDir,
  loadMemorySidecarConfig,
  type UserMemoryConfirmResult,
  type UserMemoryPaths,
} from '../../memory-sidecar/src/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

export type TombstoneResult =
  | {
      ok: true
      archiveEventId: string
      /** Total records physically removed (one per archive target). */
      deletedRecords: number
    }
  | {
      ok: false
      archiveEventId: string
      reason:
        | 'sidecar_disabled'
        | 'config_error'
        | 'not_found'
        | 'failed'
      detail?: string
    }

function buildUserMemoryPaths(home: string, projectId: string): UserMemoryPaths {
  // W419c: `home` is `config.homeDir` from loadMemorySidecarConfig, which is
  // ALREADY the sidecar root (defaults to ~/.mossen/memory-sidecar via
  // SIDECAR_HOME_ENV / getDefaultMemorySidecarHome). The pre-fix version
  // appended an extra "/memory-sidecar" segment, producing
  // ~/.mossen/memory-sidecar/memory-sidecar/projects/<pid>/memory — which
  // doesn't exist. That made W419's /undo always fail with "archive event
  // not found" because the archive lookup hit an empty directory.
  // listUserMemory in /memory-review / /memory-export / /forget passes
  // config.homeDir directly as rootDir (no double-join), which is what
  // tombstone now mirrors.
  const root = home
  const memoryDir = getProjectMemoryDir({ rootDir: root, projectId })
  return {
    home,
    root,
    configPath: join(root, 'config.json'),
    projectId,
    memoryDir,
    sqlitePath: join(memoryDir, 'memory.db'),
  }
}

function countDeletedRecords(result: UserMemoryConfirmResult): number {
  const payload = result.result as
    | { deleted?: Array<{ records?: number }> }
    | undefined
  if (!payload?.deleted) return 0
  return payload.deleted.reduce<number>(
    (sum, entry) => sum + (typeof entry.records === 'number' ? entry.records : 0),
    0,
  )
}

export async function tombstoneArchiveEvent(options: {
  archiveEventId: string
  projectId: string
}): Promise<TombstoneResult> {
  const { archiveEventId, projectId } = options

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    logForDebugging(
      `[memory-sidecar:tombstone] config load failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      archiveEventId,
      reason: 'config_error',
      detail: errorMessage(error),
    }
  }

  if (!config.enabled) {
    return { ok: false, archiveEventId, reason: 'sidecar_disabled' }
  }

  const paths = buildUserMemoryPaths(config.homeDir, projectId)

  let token: string
  try {
    const dryRun = await createDeleteDryRun({
      rootDir: paths.root,
      projectId: paths.projectId,
      paths,
      kind: 'archive',
      id: archiveEventId,
    })
    // W419c: defensive fallback. createDeleteDryRun currently THROWS when
    // no targets match (see catch below), so this branch is dormant —
    // kept in case a future memory-sidecar API change soft-fails instead.
    if (!Array.isArray(dryRun.targets) || dryRun.targets.length === 0) {
      return { ok: false, archiveEventId, reason: 'not_found' }
    }
    token = dryRun.token
  } catch (error) {
    const msg = errorMessage(error)
    // W419c: memory-sidecar throws `Error("archive event not found: <id>")`
    // when the id doesn't match anything in the archive. Remap to
    // reason:'not_found' so /undo and /forget surface the friendly i18n
    // notFound copy and clear the latest-for-undo pointer (W419 contract).
    if (/^archive event not found:/i.test(msg)) {
      return { ok: false, archiveEventId, reason: 'not_found' }
    }
    logForDebugging(
      `[memory-sidecar:tombstone] dry-run failed: ${msg}`,
      { level: 'error' },
    )
    return {
      ok: false,
      archiveEventId,
      reason: 'failed',
      detail: msg,
    }
  }

  try {
    const result = await confirmDelete({
      rootDir: paths.root,
      projectId: paths.projectId,
      paths,
      token,
    })
    const deletedRecords = countDeletedRecords(result)
    return { ok: true, archiveEventId, deletedRecords }
  } catch (error) {
    logForDebugging(
      `[memory-sidecar:tombstone] confirm failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      archiveEventId,
      reason: 'failed',
      detail: errorMessage(error),
    }
  }
}
