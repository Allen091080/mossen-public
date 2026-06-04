import * as React from 'react'
import type { Notification } from '../context/notifications.js'
import { Text } from '../ink.js'
import { logForDebugging } from '../utils/debug.js'
import { checkAndInstallOfficialMarketplace } from '../utils/plugins/officialMarketplaceStartupCheck.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { useStartupNotification } from './notifs/useStartupNotification.js'

export function useOfficialMarketplaceNotification(): void {
  useStartupNotification(async () => {
    const result = await checkAndInstallOfficialMarketplace()
    const notifs: Notification[] = []

    if (result.configSaveFailed) {
      logForDebugging('Showing marketplace config save failure notification')
      notifs.push({
        key: 'marketplace-config-save-failed',
        jsx: (
          <Text color="error">
            {getLocalizedText({
              en: 'Failed to save marketplace retry info · Check ~/.mossen.json permissions',
              zh: '无法保存插件市场重试信息 · 请检查 ~/.mossen.json 权限',
            })}
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 10000,
      })
    }

    if (result.installed) {
      logForDebugging('Showing marketplace installation success notification')
      notifs.push({
        key: 'marketplace-installed',
        jsx: (
          <Text color="success">
            {getLocalizedText({
              en: '✓ Mossen marketplace installed · /plugin to see available plugins',
              zh: '✓ Mossen 插件市场已安装 · 输入 /plugin 查看可用插件',
            })}
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 7000,
      })
    } else if (result.skipped && result.reason === 'unknown') {
      logForDebugging('Showing marketplace installation failure notification')
      notifs.push({
        key: 'marketplace-install-failed',
        jsx: (
          <Text color="warning">
            {getLocalizedText({
              en: 'Mossen marketplace sync failed · Will retry on next startup',
              zh: 'Mossen 插件市场同步失败 · 下次启动时会重试',
            })}
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 8000,
      })
    }

    return notifs
  })
}
