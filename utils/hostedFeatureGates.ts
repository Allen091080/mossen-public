import { isHostedSubscriber } from './auth.js'
import {
  hasChromeCommandAccess,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from './customBackend.js'

export function hasConfiguredPlatformForCurrentBackend(): boolean {
  return !isCustomBackendEnabled() || hasConfiguredHostedPlatformUrls()
}

export function canUseChromeIntegration(): boolean {
  return hasChromeCommandAccess() || (!isCustomBackendEnabled() && isHostedSubscriber())
}

export function canUseHostedWorkspaceFeatures(): boolean {
  return isCustomBackendEnabled()
    ? hasConfiguredHostedPlatformUrls()
    : isHostedSubscriber()
}
