import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const lsp = {
  type: 'local-jsx',
  name: 'lsp',
  description: t('cmd.lsp.description'),
  immediate: true,
  argumentHint: '[status|doctor|templates|enable|disable|tool status]',
  load: () => import('./lsp.js'),
} satisfies Command

export default lsp
