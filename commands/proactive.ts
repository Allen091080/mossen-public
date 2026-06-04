import type { Command } from '../types/command.js'
import { isDeferredSlashCommandEnabled } from '../utils/deferredSlashCommands.js'
import { t } from '../utils/i18n/index.js'

const proactive: Command = {
  type: 'local',
  name: 'proactive',
  description: t('cmd.proactive.description'),
  supportsNonInteractive: true,
  isEnabled: () => isDeferredSlashCommandEnabled('proactive'),
  load: () => import('./proactive/proactive.js'),
}

export default proactive
