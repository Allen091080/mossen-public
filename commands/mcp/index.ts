import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const mcp = {
  type: 'local-jsx',
  name: 'mcp',
  description: t('cmd.mcp.description'),
  immediate: true,
  argumentHint: '[status|doctor|usage|templates|add-template|enable|disable [server-name]]',
  load: () => import('./mcp.js'),
} satisfies Command

export default mcp
