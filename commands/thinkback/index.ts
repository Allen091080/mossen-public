import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/config/dynamicConfig.js'

const thinkback = {
  type: 'local-jsx',
  name: 'think-back',
  description: `Your 2025 ${getProductDisplayName()} year in review`,
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('mossen.session.thinkbackEnabled'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback
