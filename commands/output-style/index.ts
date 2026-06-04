import type { Command } from '../../commands.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'
import { t } from '../../utils/i18n/index.js'

const outputStyle = {
  type: 'local-jsx',
  name: 'output-style',
  description: t('cmd.output-style.description'),
  isEnabled: () => isDeferredSlashCommandEnabled('output-style'),
  isHidden: true,
  load: () => import('./output-style.js'),
} satisfies Command

export default outputStyle
