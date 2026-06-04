import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isCustomBackendEnabled } from '../customBackend.js'
import { isEnvTruthy } from '../envUtils.js'
import { isInternalOperatorMode } from '../internalUserMode.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.MOSSEN_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.MOSSEN_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if the Mossen API base URL points at a native hosted API URL.
 */
export function isFirstPartyMossenBaseUrl(): boolean {
  if (isCustomBackendEnabled()) {
    return false
  }
  const baseUrl = process.env.MOSSEN_CODE_API_BASE_URL
  if (!baseUrl) {
    return false
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.mossen.invalid']
    if (isInternalOperatorMode()) {
      allowedHosts.push('api-staging.mossen.invalid')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
