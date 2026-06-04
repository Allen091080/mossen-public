import type { Command, CommandAvailability } from '../../commands.js'
import {
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function isSupportedPlatform(): boolean {
  if (process.platform === 'darwin') {
    return true
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return true
  }
  return false
}

const HOSTED_AVAILABILITY: CommandAvailability[] = ['hosted']

const desktop = {
  type: 'local-jsx',
  name: 'desktop',
  aliases: ['app'],
  get description() {
    return getLocalizedText({
      en: 'Continue the current session in the desktop companion app',
      zh: '在桌面 companion app 中继续当前会话',
    })
  },
  get availability() {
    return isCustomBackendEnabled() ? undefined : HOSTED_AVAILABILITY
  },
  isEnabled: () =>
    isSupportedPlatform() &&
    (!isCustomBackendEnabled() || hasConfiguredHostedPlatformUrls()) &&
    !isCustomBackendEnabled(),
  get isHidden() {
    return !isSupportedPlatform() || isCustomBackendEnabled()
  },
  load: () => import('./desktop.js'),
} satisfies Command

export default desktop
