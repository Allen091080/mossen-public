// W432 — /memory-review slash command.
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const memoryReview: Command = {
  type: 'local-jsx',
  name: 'memory-review',
  description: t('cmd.memory-review.description'),
  load: () => import('./memory-review.js'),
}

export default memoryReview
