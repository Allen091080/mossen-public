import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

export const context: Command = {
  name: 'context',
  description: t('cmd.context.visualDescription'),
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('./context.js'),
}

export const contextNonInteractive: Command = {
  type: 'local',
  name: 'context',
  supportsNonInteractive: true,
  description: t('cmd.context.description'),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./context-noninteractive.js'),
}
