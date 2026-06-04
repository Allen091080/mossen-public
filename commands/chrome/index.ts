import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import { canUseChromeIntegration } from '../../utils/hostedFeatureGates.js'

const command: Command = {
  name: 'chrome',
  description: `${getProductDisplayName()} in Chrome (Beta) settings`,
  isEnabled: () =>
    !getIsNonInteractiveSession() &&
    !isCustomBackendEnabled() &&
    canUseChromeIntegration(),
  get isHidden() {
    return !canUseChromeIntegration() || isCustomBackendEnabled()
  },
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command
