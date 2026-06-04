// Zero-dependency runtime lock that normalizes process.env.USER_TYPE for the
// public Mossen build. Internal user types ('internal', 'mossen') only pass through
// when the explicit unlock env var is set; everything else collapses to
// 'external'. This prevents accidental activation of internal-only paths via
// exporting the legacy operator value while preserving an explicit escape hatch for
// internal/enterprise/controlled-test deployments.
//
// Must remain zero-import: callable from any layer including pre-bootstrap
// entrypoint code without dragging in sessionStorage / config / auth / tools.

const PUBLIC_USER_TYPE = 'external'
const PUBLIC_INTERNAL_MODE = 'external'
const OPERATOR_INTERNAL_MODE = 'internal'
const MOSSEN_INTERNAL_MODE = 'mossen'

export function isInternalUserTypeUnlocked(): boolean {
  return process.env.MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE === '1'
}

export function normalizeUserType(
  raw: string | undefined = process.env.USER_TYPE,
  rawInternalMode: string | undefined = process.env.MOSSEN_INTERNAL_USER_MODE,
): string {
  if (isInternalUserTypeUnlocked()) {
    if (rawInternalMode === OPERATOR_INTERNAL_MODE) return 'internal'
    if (rawInternalMode === MOSSEN_INTERNAL_MODE) return 'mossen'
  }
  if (raw === PUBLIC_USER_TYPE) return PUBLIC_USER_TYPE
  if (!raw) return PUBLIC_USER_TYPE
  if ((raw === 'internal' || raw === 'mossen') && isInternalUserTypeUnlocked()) {
    return raw
  }
  return PUBLIC_USER_TYPE
}

export function normalizeInternalUserMode(
  rawInternalMode: string | undefined = process.env.MOSSEN_INTERNAL_USER_MODE,
  rawUserType: string | undefined = process.env.USER_TYPE,
): string {
  const normalizedUserType = normalizeUserType(rawUserType, rawInternalMode)
  if (normalizedUserType === 'internal') return OPERATOR_INTERNAL_MODE
  if (normalizedUserType === 'mossen') return MOSSEN_INTERNAL_MODE
  return PUBLIC_INTERNAL_MODE
}

export function applyUserTypeRuntimeLock(): void {
  process.env.USER_TYPE = normalizeUserType(
    process.env.USER_TYPE,
    process.env.MOSSEN_INTERNAL_USER_MODE,
  )
  process.env.MOSSEN_INTERNAL_USER_MODE = normalizeInternalUserMode(
    process.env.MOSSEN_INTERNAL_USER_MODE,
    process.env.USER_TYPE,
  )
}
