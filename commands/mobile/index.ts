import type { Command } from '../../commands.js'
import {
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { t } from '../../utils/i18n/index.js'

const mobile = {
  type: 'local-jsx',
  name: 'mobile',
  aliases: ['ios', 'android'],
  description: t('cmd.mobile.description'),
  isEnabled: () =>
    !isCustomBackendEnabled() || hasConfiguredHostedPlatformUrls(),
  load: () => import('./mobile.js'),
} satisfies Command

export default mobile
