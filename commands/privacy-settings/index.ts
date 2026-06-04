import type { Command } from '../../commands.js'
import { isConsumerSubscriber } from '../../utils/auth.js'
import {
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { t } from '../../utils/i18n/index.js'

const privacySettings = {
  type: 'local-jsx',
  name: 'privacy-settings',
  description: t('cmd.privacy-settings.description'),
  isEnabled: () => {
    return (
      isConsumerSubscriber() ||
      (isCustomBackendEnabled() && hasConfiguredHostedPlatformUrls())
    )
  },
  load: () => import('./privacy-settings.js'),
} satisfies Command

export default privacySettings
