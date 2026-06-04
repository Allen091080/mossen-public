import type { ReactNode } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { openBrowser } from '../../utils/browser.js'
import {
  getCustomBackendName,
  getHostedPlatformUrls,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { logError } from '../../utils/log.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<ReactNode | null> {
  if (isCustomBackendEnabled() && !hasConfiguredHostedPlatformUrls()) {
    setTimeout(
      onDone,
      0,
      getLocalizedText({
        en: `${getCustomBackendName()} has no hosted billing URL configured for this build.`,
        zh: `${getCustomBackendName()} 尚未为这个构建配置托管计费 URL。`,
      }),
    )
    return null
  }

  const url = getHostedPlatformUrls().upgradeUrl

  try {
    const opened = await openBrowser(url)
    setTimeout(
      onDone,
      0,
      getLocalizedText({
        en: opened
          ? `Opened plan and billing options: ${url}`
          : `Open plan and billing options: ${url}`,
        zh: opened ? `已打开套餐与计费选项：${url}` : `打开套餐与计费选项：${url}`,
      }),
    )
  } catch (error) {
    logError(error as Error)
    setTimeout(
      onDone,
      0,
      getLocalizedText({
        en: `Failed to open browser. Please visit ${url} to continue.`,
        zh: `打开浏览器失败。请访问 ${url} 继续。`,
      }),
    )
  }

  return null
}
