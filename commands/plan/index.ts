import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const plan = {
  type: 'local-jsx',
  name: 'plan',
  description: t('cmd.plan.description'),
  argumentHint: '[open|<description>]',
  load: () => import('./plan.js'),
} satisfies Command

export default plan
