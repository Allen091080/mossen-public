import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: t('cmd.ide.description'),
  argumentHint: '[open]',
  load: () => import('./ide.js'),
} satisfies Command

export default ide
