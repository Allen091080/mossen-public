import type { LocalCommandResult } from '../../commands.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import { openBrowser } from '../../utils/browser.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { getHostedPlatformUrls } from '../../utils/customBackend.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

const SLACK_APP_URL = `${getHostedPlatformUrls().remoteBaseUrl}/integrations/slack/install`

export async function call(): Promise<LocalCommandResult> {
  logMossenEvent('mossen.integration.slackAppInstallClicked', {})

  // Track that user has clicked to install
  saveGlobalConfig(current => ({
    ...current,
    slackAppInstallCount: (current.slackAppInstallCount ?? 0) + 1,
  }))

  const success = await openBrowser(SLACK_APP_URL)

  if (success) {
    return {
      type: 'text',
      value: getLocalizedText({
        en: 'Opening Slack app installation page in browser…',
        zh: '正在浏览器中打开 Slack app 安装页面…',
      }),
    }
  } else {
    return {
      type: 'text',
      value: getLocalizedText({
        en: `Couldn't open browser. Visit: ${SLACK_APP_URL}`,
        zh: `无法打开浏览器。请访问：${SLACK_APP_URL}`,
      }),
    }
  }
}
