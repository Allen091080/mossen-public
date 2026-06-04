/**
 * Facade for rate limit header processing
 * This isolates mock logic from production code
 */

import {
  applyMockHeaders,
  checkMockFastModeRateLimit,
  getMockHeaderless429Message,
  getMockHeaders,
  isMockFastModeRateLimitScenario,
  shouldProcessMockLimits,
} from './mockRateLimits.js'
import { MossenAPIError } from './api/mossenSdk.js'
import { getCanonicalName } from '../utils/model/model.js'

function isFrontierModel(model: string): boolean {
  const normalized = model.toLowerCase()
  const canonical = getCanonicalName(normalized)
  return (
    canonical.includes('mossen-opus') ||
    normalized === 'opus' ||
    normalized.startsWith('opus[')
  )
}

/**
 * Process headers, applying mocks if /mock-limits command is active
 */
export function processRateLimitHeaders(
  headers: globalThis.Headers,
): globalThis.Headers {
  // Only apply mocks for internal testers using the /mock-limits command.
  if (shouldProcessMockLimits()) {
    return applyMockHeaders(headers)
  }
  return headers
}

/**
 * Check if we should process rate limits (either real subscriber or /mock-limits command)
 */
export function shouldProcessRateLimits(isSubscriber: boolean): boolean {
  return isSubscriber || shouldProcessMockLimits()
}

/**
 * Check if mock rate limits should throw a 429 error
 * Returns the error to throw, or null if no error should be thrown
 * @param currentModel The model being used for the current request
 * @param isFastModeActive Whether fast mode is currently active (for fast-mode-only mocks)
 */
export function checkMockRateLimitError(
  currentModel: string,
  isFastModeActive?: boolean,
): MossenAPIError | null {
  if (!shouldProcessMockLimits()) {
    return null
  }

  const headerlessMessage = getMockHeaderless429Message()
  if (headerlessMessage) {
    return new MossenAPIError(
      429,
      { error: { type: 'rate_limit_error', message: headerlessMessage } },
      headerlessMessage,
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      new globalThis.Headers(),
    )
  }

  const mockHeaders = getMockHeaders()
  if (!mockHeaders) {
    return null
  }

  // Check if we should throw a 429 error
  // Only throw if:
  // 1. Status is rejected AND
  // 2. Either no overage headers OR overage is also rejected
  // 3. For Frontier-tier limits, only throw if actually using a Frontier model
  const status = mockHeaders['mossen-ratelimit-unified-status']
  const overageStatus =
    mockHeaders['mossen-ratelimit-unified-overage-status']
  const rateLimitType =
    mockHeaders['mossen-ratelimit-unified-representative-claim']

  // Check if this is a Frontier-tier rate limit.
  const isFrontierLimit = rateLimitType === 'seven_day_opus'

  // Check if current model is a Frontier model (handles variants and aliases).
  const isUsingFrontier = isFrontierModel(currentModel)

  // For Frontier limits, only throw 429 if actually using Frontier.
  // This simulates the real API behavior where fallback to Balanced succeeds.
  if (isFrontierLimit && !isUsingFrontier) {
    return null
  }

  // Check for mock fast mode rate limits (handles expiry, countdown, etc.)
  if (isMockFastModeRateLimitScenario()) {
    const fastModeHeaders = checkMockFastModeRateLimit(isFastModeActive)
    if (fastModeHeaders === null) {
      return null
    }
    // Create a mock 429 error with the fast mode headers
    const error = new MossenAPIError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      'Rate limit exceeded',
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      new globalThis.Headers(
        Object.entries(fastModeHeaders).filter(([_, v]) => v !== undefined) as [
          string,
          string,
        ][],
      ),
    )
    return error
  }

  const shouldThrow429 =
    status === 'rejected' && (!overageStatus || overageStatus === 'rejected')

  if (shouldThrow429) {
    // Create a mock 429 error with the appropriate headers
    const error = new MossenAPIError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      'Rate limit exceeded',
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      new globalThis.Headers(
        Object.entries(mockHeaders).filter(([_, v]) => v !== undefined) as [
          string,
          string,
        ][],
      ),
    )
    return error
  }

  return null
}

/**
 * Check if this is a mock 429 error that shouldn't be retried
 */
export function isMockRateLimitError(error: MossenAPIError): boolean {
  return shouldProcessMockLimits() && error.status === 429
}

/**
 * Check if /mock-limits command is currently active (for UI purposes)
 */
export { shouldProcessMockLimits }
