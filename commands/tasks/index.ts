import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const tasks = {
  type: 'local-jsx',
  name: 'tasks',
  aliases: ['bashes'],
  description: t('cmd.tasks.description'),
  load: () => import('./tasks.js'),
} satisfies Command

export default tasks
