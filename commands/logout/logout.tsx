import * as React from 'react'
import { Text } from '../../ink.js'
import { refreshDynamicConfigAfterAuthChange } from '../../services/config/dynamicConfig.js'
import {
  getGroveNoticeConfig,
  getGroveSettings,
} from '../../services/api/grove.js'
import { clearPolicyLimitsCache } from '../../services/policyLimits/index.js'
import { clearRemoteManagedSettingsCache } from '../../services/remoteManagedSettings/index.js'
import { getHostedOAuthTokens, removeApiKey } from '../../utils/auth.js'
import { clearBetasCaches } from '../../utils/betas.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { resetUserCache } from '../../utils/user.js'

export async function performLogout({
  clearOnboarding = false,
}): Promise<void> {
  await removeApiKey()

  const secureStorage = getSecureStorage()
  secureStorage.delete()
  await clearAuthRelatedCaches()

  saveGlobalConfig(current => {
    const updated = { ...current }
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false
      updated.subscriptionNoticeCount = 0
      updated.hasAvailableSubscription = false
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: [],
        }
      }
    }
    updated.oauthAccount = undefined
    return updated
  })
}

export async function clearAuthRelatedCaches(): Promise<void> {
  getHostedOAuthTokens.cache?.clear?.()
  clearBetasCaches()
  clearToolSchemaCache()
  resetUserCache()
  refreshDynamicConfigAfterAuthChange()
  getGroveNoticeConfig.cache?.clear?.()
  getGroveSettings.cache?.clear?.()
  await clearRemoteManagedSettingsCache()
  await clearPolicyLimitsCache()
}

export async function call(): Promise<React.ReactNode> {
  if (isCustomBackendEnabled()) {
    return (
      <Text>
        {getLocalizedText({
          en: 'Custom backend mode does not keep a separate built-in account session.',
          zh: '当前已启用自定义后端模式。该模式下没有独立的内置账号会话可退出。',
        })}
      </Text>
    )
  }

  await performLogout({ clearOnboarding: true })
  const message = (
    <Text>Successfully cleared local credential state for the current backend.</Text>
  )
  setTimeout(() => {
    gracefulShutdownSync(0, 'logout')
  }, 200)
  return message
}
