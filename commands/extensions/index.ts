import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const extensions = {
  type: 'local-jsx',
  name: 'extensions',
  aliases: ['extension'],
  description: t('cmd.extensions.description'),
  immediate: true,
  argumentHint: '[status|doctor|report|examples]',
  load: () => import('./extensions.js'),
} satisfies Command

export default extensions
