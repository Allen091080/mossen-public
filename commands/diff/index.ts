import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

export default {
  type: 'local-jsx',
  name: 'diff',
  description: t('cmd.diff.description'),
  load: () => import('./diff.js'),
} satisfies Command
