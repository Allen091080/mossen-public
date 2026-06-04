/**
 * W158 — synchronous atomic JSON write helper for sensitive config.
 *
 * Used by callers that hold the config (LLM API key env names, OAuth
 * tokens, custom backend profiles, plugin/MCP settings) and must NOT
 * lose those credentials to a crash, partial write, or accidental
 * "default empty config" overwrite.
 *
 * Guards (all four):
 *
 *   1. Atomic temp+rename — write to `<path>.tmp.<pid>.<ts>.<rand>`,
 *      fsync, then rename onto the target. Either the rename succeeds
 *      (target equals new payload) or fails (target unchanged). No
 *      torn writes.
 *   2. fsync — explicit `fsyncSync(fd)` before close so the rename's
 *      durability guarantee is real.
 *   3. Original file mode preserved — sensitive configs are routinely
 *      `0o600`. We chmod the temp to match the existing file before
 *      renaming so the new file inherits the tighter permission.
 *   4. Auth-loss guard — optional callback that lets the caller refuse
 *      writes which would silently drop credentials (e.g. `apiKeyEnv`
 *      going from set to unset without an explicit user delete).
 *
 * Note: this helper is intentionally synchronous because the existing
 * memory-sidecar setters (`setMemorySidecarLlmConfig` etc.) are sync
 * and the call sites are low frequency (interactive `/memory-sidecar
 * llm config`). Sync also keeps the API surface small — proper-lockfile
 * is async-only, so dropping locking from this helper avoids forcing
 * an async migration on every caller. For higher-frequency write
 * paths (e.g. the global config or future custom-backend profiles),
 * an async sister helper with proper-lockfile can be added without
 * breaking this one.
 */

import {
  closeSync,
  chmodSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'fs'
import { randomBytes } from 'crypto'

// Inline ENOENT check so this helper is self-contained — the
// memory-sidecar subproject imports it via relative path
// (`../../../utils/atomicWriteJson.js`) and we want to avoid pulling
// in main-repo utils transitively.
function isENOENT(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
  )
}

const DEFAULT_SENSITIVE_MODE = 0o600

export type AuthLossGuard = (current: unknown, next: unknown) => string | null

export type AtomicWriteJsonSyncOptions = {
  /** File mode if the target does not yet exist. Defaults to 0o600 for sensitive configs. */
  defaultMode?: number
  /** Spaces for JSON indentation. Defaults to 2. */
  indent?: number
  /** Trailing newline written after the JSON payload. Defaults to true. */
  trailingNewline?: boolean
  /**
   * Optional auth-loss guard. Receives `current` (parsed previous file
   * contents, or `null` if the file did not exist) and `next` (the
   * payload about to be written). Return a non-null string to abort
   * the write — the returned string becomes the thrown error message.
   * Return null to allow the write.
   */
  authLossGuard?: AuthLossGuard
  /**
   * Lazy parser for `current` so callers that don't pass an
   * authLossGuard don't pay the read+parse cost on every write. The
   * helper calls this iff `authLossGuard` is set.
   */
  parseCurrent?: (raw: string) => unknown
}

export class AuthLossGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthLossGuardError'
  }
}

/**
 * Atomically write a JSON document to `path`.
 *
 * Throws AuthLossGuardError if `options.authLossGuard` rejects the
 * write. Throws the underlying fs error if the rename fails (e.g.
 * cross-device, permission denied). Cleans up the temp file on any
 * non-rename failure path.
 */
export function atomicWriteJsonSync(
  path: string,
  data: unknown,
  options: AtomicWriteJsonSyncOptions = {},
): void {
  const indent = options.indent ?? 2
  const trailingNewline = options.trailingNewline ?? true
  const payload =
    JSON.stringify(data, null, indent) + (trailingNewline ? '\n' : '')

  // 1. Determine target mode: preserve existing file's mode if present,
  //    otherwise fall back to defaultMode (0o600 for sensitive configs).
  let targetMode = options.defaultMode ?? DEFAULT_SENSITIVE_MODE
  let targetExists = false
  let existingRaw: string | undefined
  try {
    const stats = statSync(path)
    targetMode = stats.mode & 0o777
    targetExists = true
  } catch (e) {
    if (!isENOENT(e)) {
      throw e
    }
  }

  // 2. Auth-loss guard. Read+parse only if a guard was supplied.
  if (options.authLossGuard) {
    let current: unknown = null
    if (targetExists) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        existingRaw = (require('fs') as typeof import('fs')).readFileSync(
          path,
          'utf8',
        )
        current = options.parseCurrent
          ? options.parseCurrent(existingRaw)
          : JSON.parse(existingRaw)
      } catch {
        // If the previous file is unreadable / corrupt, the guard runs
        // with current=null. The guard can decide whether overwriting a
        // corrupt file with a known-good one is acceptable; default
        // behavior (no guard) would silently overwrite.
      }
    }
    const veto = options.authLossGuard(current, data)
    if (veto !== null) {
      throw new AuthLossGuardError(veto)
    }
  }

  // 3. Write to a unique temp path beside the target. Including pid +
  //    timestamp + random suffix avoids collisions even when two
  //    processes race; the loser will simply rename onto the same final
  //    path (still atomic).
  const tempPath = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  const fd = openSync(tempPath, 'w', targetMode)
  let renamed = false
  try {
    writeSync(fd, payload)
    fsyncSync(fd)
    closeSync(fd)
    // The fd is closed; if any of the steps below fails we still need
    // to unlink the tempPath, but we must not closeSync(fd) twice.
  } catch (e) {
    try {
      closeSync(fd)
    } catch {
      // best-effort
    }
    try {
      unlinkSync(tempPath)
    } catch {
      // best-effort
    }
    throw e
  }

  // 4. Restore mode on the temp explicitly (open() honors mode only on
  //    create, but a pre-existing temp from a previous failed write
  //    would not match — defense in depth) and rename onto target.
  try {
    chmodSync(tempPath, targetMode)
    renameSync(tempPath, path)
    renamed = true
  } finally {
    if (!renamed) {
      try {
        unlinkSync(tempPath)
      } catch {
        // best-effort
      }
    }
  }
}
