import type { Command, CommandAvailability } from '../../commands.js'
import { getSubscriptionType } from '../../utils/auth.js'
import {
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

const HOSTED_AVAILABILITY: CommandAvailability[] = ['hosted']

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  get description() {
    return getLocalizedText({
      en: 'Open plan and billing options for the current backend',
      zh: '打开当前后端的套餐和账单选项',
    })
  },
  get availability() {
    return isCustomBackendEnabled() ? undefined : HOSTED_AVAILABILITY
  },
  isEnabled: () =>
    !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND) &&
    (!isCustomBackendEnabled() || hasConfiguredHostedPlatformUrls()) &&
    (isCustomBackendEnabled() || getSubscriptionType() !== 'enterprise') &&
    !isCustomBackendEnabled(),
  get isHidden() {
    return isCustomBackendEnabled()
  },
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
