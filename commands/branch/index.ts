import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  aliases: [],
  description: t('cmd.branch.description'),
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
