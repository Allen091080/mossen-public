import type { Command } from '../../commands.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'
import { t } from '../../utils/i18n/index.js'

const releaseNotes: Command = {
  description: t('cmd.release-notes.description'),
  name: 'release-notes',
  type: 'local',
  isEnabled: () => isDeferredSlashCommandEnabled('release-notes'),
  supportsNonInteractive: true,
  load: () => import('./release-notes.js'),
}

export default releaseNotes
