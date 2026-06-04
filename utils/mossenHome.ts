// W456 — Centralized resolver for Mossen's per-user state directory.
//
// Resolution order (per Distribution Plan §3.4 data_paths +
// cli-harness R4 §B.6 home-migration policy):
//
//   1. process.env.MOSSEN_HOME             — explicit override; used for
//                                            test isolation, alternative
//                                            install locations
//                                            (e.g. ~/Library/...), or
//                                            future home migration.
//   2. process.env.MOSSEN_CONFIG_DIR       — legacy alias predating W456
//                                            (services/config/* already
//                                            honored this; kept as a
//                                            non-breaking bridge).
//   3. join(os.homedir(), '.mossen')       — canonical default.
//
// This module is the single source of truth. New code SHOULD use
// getMossenHome() instead of recomputing the path inline.
//
// **Migration plan**: callsites in memory-sidecar/ /
// services/config/ / skills/bundled/ etc. still recompute the path inline
// (10+ sites as of 2026-05-25). Migrating them is a follow-up wave
// (W456-full backlog) gated on cli-harness or another integrator
// actually using MOSSEN_HOME in production. Until then, MOSSEN_HOME
// works for any callsite that opts into getMossenHome() (notably any
// new code added in W457+).
//
// **What this does NOT do**:
//   - No auto-migration from ~/.mossen to a new MOSSEN_HOME location.
//     Per Distribution Plan §3.4, that is a separate user-facing
//     decision: if MOSSEN_HOME is set but the target dir is empty and
//     ~/.mossen has data, getMossenHome() does NOT copy — it returns
//     the configured path verbatim and lets the user decide. Future
//     wave can add a `migrateMossenHome()` helper if demand emerges.

import { homedir } from 'node:os'
import { resolve } from 'node:path'

// Env var name documented in dev/mossen-contract.json
// stable_surface.data_paths.mossen_home_env.
export const MOSSEN_HOME_ENV = 'MOSSEN_HOME'

// Legacy alias kept for back-compat with W456-pre code that read this
// directly from process.env. Will be deprecated when MOSSEN_HOME is
// widely adopted; see W456-deprecate-MOSSEN_CONFIG_DIR backlog.
export const MOSSEN_HOME_LEGACY_ENV = 'MOSSEN_CONFIG_DIR'

/**
 * Returns the absolute path to the user's mossen state directory.
 *
 * Honors $MOSSEN_HOME (W456), then $MOSSEN_CONFIG_DIR (legacy alias),
 * then defaults to ~/.mossen. The returned path is NOT guaranteed to
 * exist on disk — callers create the dir as needed.
 *
 * Pure function. Reads env at call time (does not memoize) so test
 * harnesses can mutate env between calls. If you need stability
 * across a single bootstrap pass, capture the result once.
 */
export function getMossenHome(): string {
  const explicit = process.env[MOSSEN_HOME_ENV]
  if (explicit && explicit.trim().length > 0) {
    return resolve(explicit)
  }
  const legacy = process.env[MOSSEN_HOME_LEGACY_ENV]
  if (legacy && legacy.trim().length > 0) {
    return resolve(legacy)
  }
  return resolve(homedir(), '.mossen')
}

/**
 * Returns whether MOSSEN_HOME is configured (either via the canonical
 * env var or the legacy alias). Useful for surfacing "you're using a
 * non-default home location" messages in onboarding / doctor.
 */
export function isMossenHomeOverridden(): boolean {
  return Boolean(
    (process.env[MOSSEN_HOME_ENV] || '').trim() ||
      (process.env[MOSSEN_HOME_LEGACY_ENV] || '').trim(),
  )
}
