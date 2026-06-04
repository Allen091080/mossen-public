import type { Command } from '../../commands.js'
import { isHostedSubscriber } from '../../utils/auth.js'
import { t } from '../../utils/i18n/index.js'

const rateLimitOptions = {
  type: 'local-jsx',
  name: 'rate-limit-options',
  description: t('cmd.rate-limit-options.description'),
  isEnabled: () => {
    if (!isHostedSubscriber()) {
      return false
    }

    return true
  },
  isHidden: true, // Hidden from help - only used internally
  load: () => import('./rate-limit-options.js'),
} satisfies Command

export default rateLimitOptions
