/**
 * Cost command - minimal metadata only.
 * Implementation is lazy-loaded from cost.ts to reduce startup time.
 */
import type { Command } from '../../commands.js'
import { isHostedAuthAdapterEnabled, isHostedSubscriber } from '../../utils/auth.js'
import { t } from '../../utils/i18n/index.js'

const cost = {
  type: 'local',
  name: 'cost',
  description: t('cmd.cost.description'),
  get isHidden() {
    // Keep visible for internal users even if they're subscribers (they see cost breakdowns)
    if (isCostInternalUser()) {
      return false
    }
    return isHostedAuthAdapterEnabled() && isHostedSubscriber()
  },
  supportsNonInteractive: true,
  load: () => import('./cost.js'),
} satisfies Command

export default cost

import { isInternalOperatorMode } from '../../utils/internalUserMode.js'

// Module-local helper preserves i18n hardcoded allowlist line numbers.
function isCostInternalUser(): boolean {
  return isInternalOperatorMode()
}
