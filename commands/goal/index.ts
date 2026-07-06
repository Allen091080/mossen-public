import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description: t('cmd.goal.description'),
  argumentHint: '[set <goal>|status|board [--json]|clear|pause|resume|done]',
  load: () => import('./goal.js'),
} satisfies Command

export default goal
