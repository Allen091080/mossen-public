import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const docs = {
  type: 'local-jsx',
  name: 'docs',
  description: t('cmd.docs.description'),
  argumentHint: '[topic]',
  load: () => import('./docs.js'),
} satisfies Command

export default docs
