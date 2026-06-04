// Zero-dependency leaf module exposing the USER_TYPE accessor. Kept separate
// from sessionStorage.ts so callers anywhere in the import graph (including
// boot-time pre-init paths reachable through utils/auth.ts) can read
// USER_TYPE without dragging in sessionStorage's heavy transitive imports.
//
// Wave 5 Phase 7 (mockRateLimits.ts) had to fall back to a module-local
// helper because importing utils/sessionStorage.ts there closed a TDZ cycle
// through commands/tools. This leaf module is the structural fix.
//
// Wave 7 Door Lock: getUserType() now defers to normalizeUserType() so SDK /
// test / mcp callers that bypass entrypoints/cli.tsx still see the locked
// public value unless MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE=1 is set.
import { normalizeUserType } from './userTypeRuntimeLock.js'

export function getUserType(): string {
  return normalizeUserType(process.env.USER_TYPE)
}
