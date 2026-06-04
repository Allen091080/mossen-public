import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import {
  checkCachedPassesEligibility,
  getCachedReferrerReward,
} from '../../services/api/referral.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'
import { isHostedAuthAdapterEnabled } from '../../utils/auth.js'

export default {
  type: 'local-jsx',
  name: 'passes',
  isEnabled: () =>
    isHostedAuthAdapterEnabled() && isDeferredSlashCommandEnabled('passes'),
  get description() {
    const reward = getCachedReferrerReward()
    if (reward) {
      return `Share a free week of ${getProductDisplayName()} with friends and earn extra usage`
    }
    return `Share a free week of ${getProductDisplayName()} with friends`
  },
  get isHidden() {
    if (!isHostedAuthAdapterEnabled()) return true
    const { eligible, hasCache } = checkCachedPassesEligibility()
    return !eligible || !hasCache
  },
  load: () => import('./passes.js'),
} satisfies Command
