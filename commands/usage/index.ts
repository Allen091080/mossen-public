import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: t('cmd.usage.description'),
  availability: ['hosted'],
  load: () => import('./usage.js'),
} satisfies Command
