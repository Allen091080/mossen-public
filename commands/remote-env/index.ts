import type { Command } from '../../commands.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { isHostedSubscriber } from '../../utils/auth.js'
import { t } from '../../utils/i18n/index.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: t('cmd.remote-env.description'),
  isEnabled: () =>
    isHostedSubscriber() && isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isHostedSubscriber() || !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-env.js'),
} satisfies Command
