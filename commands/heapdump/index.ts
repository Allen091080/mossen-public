import type { Command } from '../../commands.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'
import { t } from '../../utils/i18n/index.js'

const heapDump = {
  type: 'local',
  name: 'heapdump',
  description: t('cmd.heapdump.description'),
  isEnabled: () => isDeferredSlashCommandEnabled('heapdump'),
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./heapdump.js'),
} satisfies Command

export default heapDump
