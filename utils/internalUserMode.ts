// Mossen-side neutral helpers for the legacy internal user-type gate.
//
// Background: a set of source sites still use the legacy inline
// internal-user comparison because that exact expression is what the
// upstream bundler's `--define` constant-folds at build time.
// Replacing those inline checks with a function call would defeat the
// dead-code elimination and ship internal-only branches into the
// public Mossen bundle. So those inline checks stay where they are.
//
// What W162-D does add is a *runtime* helper layer for the cases that
// don't run through the bundler's --define path (SDK callers,
// dynamically-loaded scripts, smoke tests, future code that doesn't
// need DCE). Those callers should use `isInternalOperatorMode()` or
// the related neutral helpers below instead of writing the raw
// legacy operator literal.
//
// Safety: every helper here goes through `getUserType()` →
// `normalizeUserType()` (in utils/userTypeRuntimeLock.ts), which is
// the existing Door Lock that collapses USER_TYPE back to `'external'`
// unless `MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE=1` is set. So a normal
// user who happens to export the legacy operator value never sees
// `isInternalOperatorMode() === true`.
//
// This file is zero-dependency apart from utils/userType.ts, which is
// itself zero-dependency, so it's safe to import from anywhere.

import { getUserType } from './userType.js'

/** True when the locked, normalized USER_TYPE is the legacy operator value.
 *  The upstream bundler used this gate for internal operator features (insights,
 *  internal commands, telemetry knobs).
 */
export function isInternalOperatorMode(): boolean {
  return getUserType() === 'internal'
}

/** True when the locked, normalized USER_TYPE is `'mossen'`. Reserved
 *  for the legacy build that targeted Mossen-internal users — see
 *  the historical Mossen Distributed deployments.
 */
export function isInternalMossenMode(): boolean {
  return getUserType() === 'mossen'
}

/** True when *either* internal user-type is unlocked (i.e. when the
 *  Door Lock has let `USER_TYPE` through). Use for surfaces that don't
 *  care which internal flavour is active.
 */
export function isAnyInternalUserType(): boolean {
  const t = getUserType()
  return t === 'internal' || t === 'mossen'
}

/** Diagnostic snapshot. Useful for `/doctor`-style reporting without
 *  exposing whether the legacy unlock is in place to general code.
 *  Returns `'inactive'` when the Door Lock has collapsed USER_TYPE
 *  back to `'external'` (the default for normal Mossen users).
 */
export type InternalUserTypeStatus =
  | 'inactive'
  | 'internal'
  | 'mossen'

export type InternalUserModeStatus =
  | 'inactive'
  | 'internal'
  | 'mossen'

export function getInternalUserTypeStatus(): InternalUserTypeStatus {
  const t = getUserType()
  if (t === 'internal') return 'internal'
  if (t === 'mossen') return 'mossen'
  return 'inactive'
}

export function getInternalUserModeStatus(): InternalUserModeStatus {
  const t = getUserType()
  if (t === 'internal') return 'internal'
  if (t === 'mossen') return 'mossen'
  return 'inactive'
}
