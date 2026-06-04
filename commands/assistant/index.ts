import type { Command } from '../../types/command.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'
import { t } from '../../utils/i18n/index.js'

const assistant: Command = {
  type: 'local',
  name: 'assistant',
  description: t('cmd.assistant.description'),
  supportsNonInteractive: true,
  isEnabled: () => isDeferredSlashCommandEnabled('assistant'),
  load: () => import('./assistant.js'),
}

export default assistant
