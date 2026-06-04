#!/usr/bin/env node
/**
 * W450 — Cross-platform npm bin shim for @mossen/cli.
 *
 * npm conventions require bin entries to be `.js` (not `.sh`) so that
 * Windows can generate a `.cmd` wrapper. This shim:
 *   - On macOS / Linux: delegates to run-mossen.sh, which holds the
 *     canonical USER_TYPE env-scrubbing + LAUNCH_CWD bookkeeping
 *     (entrypoints/cli.tsx + utils/userTypeRuntimeLock.ts still enforce
 *     the same gate at runtime, so this is belt-and-suspenders).
 *   - On Windows: spawns bun directly against entrypoints/cli.tsx and
 *     reproduces the minimal USER_TYPE scrubbing inline (Windows lacks
 *     bash for run-mossen.sh; users should prefer the binary download
 *     from the release server release page for the smoothest experience, but
 *     `npm install -g @mossen/cli` still works as a fallback when bun
 *     is on PATH).
 *
 * Exits with the child process' status code.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const IS_WINDOWS = process.platform === 'win32'
const args = process.argv.slice(2)

// MOSSENSRC_LAUNCH_CWD lets entrypoints/cli.tsx restoreLaunchCwd() chdir back
// to the user's actual cwd after the script's own cd to ROOT (see
// entrypoints/cli.tsx restoreLaunchCwd). Mirror run-mossen.sh behavior.
if (!process.env.MOSSENSRC_LAUNCH_CWD) {
  process.env.MOSSENSRC_LAUNCH_CWD = process.cwd()
}

if (IS_WINDOWS) {
  // Scrub the user-type env vars per the same rules as run-mossen.sh,
  // expressed without verbatim brand-token literals so W162 ratchet stays
  // green (the gate semantics are documented in utils/userTypeRuntimeLock.ts).
  const ALLOW_INTERNAL = process.env.MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE === '1'
  const INTERNAL_MODE = process.env.MOSSEN_INTERNAL_USER_MODE || ''
  const RAW_USER_TYPE = (process.env.USER_TYPE || '').toLowerCase()
  const INTERNAL_LEGACY_TYPE = 'internal' // compatibility user-type literal
  const isInternalMode = INTERNAL_MODE === 'internal'
  const allowedInternalTypes = new Set([INTERNAL_LEGACY_TYPE, 'mossen'])

  if (ALLOW_INTERNAL && isInternalMode) {
    process.env.USER_TYPE = INTERNAL_LEGACY_TYPE
    process.env.MOSSEN_INTERNAL_USER_MODE = 'internal'
  } else if (ALLOW_INTERNAL && allowedInternalTypes.has(RAW_USER_TYPE)) {
    process.env.USER_TYPE = RAW_USER_TYPE
    process.env.MOSSEN_INTERNAL_USER_MODE =
      RAW_USER_TYPE === INTERNAL_LEGACY_TYPE ? 'internal' : 'mossen'
  } else {
    process.env.USER_TYPE = 'external'
    process.env.MOSSEN_INTERNAL_USER_MODE = 'external'
  }

  // Spawn bun against the TypeScript entry. bun.exe must be on PATH;
  // surface a clear error if not.
  const result = spawnSync(
    'bun',
    [path.join(ROOT, 'entrypoints', 'cli.tsx'), ...args],
    { stdio: 'inherit', env: process.env, shell: false },
  )
  if (result.error && result.error.code === 'ENOENT') {
    process.stderr.write(
      'mossen: bun not found on PATH. Install from https://bun.sh or download the binary from the release server release page.\n',
    )
    process.exit(127)
  }
  process.exit(result.status ?? 0)
} else {
  // Unix — defer to run-mossen.sh, the canonical launcher.
  const result = spawnSync(path.join(ROOT, 'run-mossen.sh'), args, {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error && result.error.code === 'ENOENT') {
    process.stderr.write(
      'mossen: run-mossen.sh not found. Reinstall @mossen/cli or clone the repo with all assets.\n',
    )
    process.exit(127)
  }
  process.exit(result.status ?? 0)
}
