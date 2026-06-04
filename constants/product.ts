import {
  getHostedPlatformUrls,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../utils/customBackend.js'

export const PRODUCT_URL = isCustomBackendEnabled() && hasConfiguredHostedPlatformUrls()
  ? getHostedPlatformUrls().remoteBaseUrl
  : 'https://mossen.invalid/code'

export function getProductDisplayName(): string {
  return 'Mossen'
}

export function getProductAssistantName(): string {
  return 'Mossen'
}

export function getProductWelcomeMessage(): string {
  return `Welcome to ${getProductDisplayName()}`
}

export function getProductCliName(): string {
  return 'mossen'
}

export function getProjectInstructionsDisplayName(): string {
  return 'MOSSEN.md'
}

export function getProductConfigDirName(): string {
  return '.mossen'
}

export function getProductConfigHomeDisplayPath(): string {
  return '~/.mossen'
}

export function getDesktopProductName(): string {
  return 'Mossen Desktop'
}

// Hosted remote session URLs backed by hosted surfaces
export const HOSTED_BASE_URL =
  process.env.MOSSEN_HOSTED_BASE_URL ?? 'https://hosted.mossen.invalid'
export const HOSTED_STAGING_BASE_URL =
  process.env.MOSSEN_HOSTED_STAGING_BASE_URL ??
  'https://hosted-staging.mossen.invalid'
export const HOSTED_LOCAL_BASE_URL =
  process.env.MOSSEN_HOSTED_LOCAL_BASE_URL ?? 'http://localhost:4000'

/**
 * Determine if we're in a staging environment for remote sessions.
 * Checks session ID format and ingress URL.
 */
export function isRemoteSessionStaging(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  return (
    sessionId?.includes('_staging_') === true ||
    ingressUrl?.includes('staging') === true
  )
}

/**
 * Determine if we're in a local-dev environment for remote sessions.
 * Checks session ID format (e.g. `session_local_...`) and ingress URL.
 */
export function isRemoteSessionLocal(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  return (
    sessionId?.includes('_local_') === true ||
    ingressUrl?.includes('localhost') === true
  )
}

/**
 * Get the base URL for the hosted runtime based on environment.
 */
export function getHostedBaseUrl(
  sessionId?: string,
  ingressUrl?: string,
): string {
  if (isCustomBackendEnabled()) {
    return getHostedPlatformUrls().remoteBaseUrl
  }
  if (isRemoteSessionLocal(sessionId, ingressUrl)) {
    return HOSTED_LOCAL_BASE_URL
  }
  if (isRemoteSessionStaging(sessionId, ingressUrl)) {
    return HOSTED_STAGING_BASE_URL
  }
  return HOSTED_BASE_URL
}

/**
 * Get the full session URL for a remote session.
 *
 * The cse_→session_ translation is a temporary compatibility shim. Worker
 * endpoints (/v1/code/sessions/{id}/worker/*) want `cse_*` but the hosted frontend currently routes on `session_*` (compat/convert.go:27 validates TagSession).
 * Same UUID body, different tag prefix. Once the server tags by
 * environment_kind and the frontend accepts `cse_*` directly, flip the gate
 * off. No-op for IDs already in `session_*` form. See toCompatSessionId in
 * src/bridge/sessionIdCompat.ts for the canonical helper (lazy-required here
 * to keep constants/ leaf-of-DAG at module-load time).
 */
export function getRemoteSessionUrl(
  sessionId: string,
  ingressUrl?: string,
): string {
  const baseUrl = getHostedBaseUrl(sessionId, ingressUrl)
  return `${baseUrl}/code/${sessionId}`
}
