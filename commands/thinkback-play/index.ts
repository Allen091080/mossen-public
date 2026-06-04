import type { Command } from '../../commands.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/config/dynamicConfig.js'
import { t } from '../../utils/i18n/index.js'

// Hidden command that just plays the animation
// Called by the thinkback skill after generation is complete
const thinkbackPlay = {
  type: 'local',
  name: 'thinkback-play',
  description: t('cmd.thinkback-play.description'),
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('mossen.session.thinkbackEnabled'),
  isHidden: true,
  supportsNonInteractive: false,
  load: () => import('./thinkback-play.js'),
} satisfies Command

export default thinkbackPlay
