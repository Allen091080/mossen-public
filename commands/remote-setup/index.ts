import type { Command, CommandAvailability } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/config/dynamicConfig.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import {
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'

const HOSTED_AVAILABILITY: CommandAvailability[] = ['hosted']

const web = {
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Set up hosted remote workspaces and GitHub access',
  get availability() {
    return isCustomBackendEnabled() ? undefined : HOSTED_AVAILABILITY
  },
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('mossen.remote.setupEnabled', false) &&
    isPolicyAllowed('allow_remote_sessions') &&
    (!isCustomBackendEnabled() || hasConfiguredHostedPlatformUrls()) &&
    !isCustomBackendEnabled(),
  get isHidden() {
    return !isPolicyAllowed('allow_remote_sessions') || isCustomBackendEnabled()
  },
  load: () => import('./remote-setup.js'),
} satisfies Command

export default web
