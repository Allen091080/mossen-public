import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const agents = {
  type: 'local-jsx',
  name: 'agents',
  description: t('cmd.agents.description'),
  load: () => import('./agents.js'),
} satisfies Command

export default agents
