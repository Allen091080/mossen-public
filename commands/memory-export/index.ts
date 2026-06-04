// W433 — /memory-export slash command.
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const memoryExport: Command = {
  type: 'local-jsx',
  name: 'memory-export',
  description: t('cmd.memory-export.description'),
  argumentHint: '[markdown|json]',
  load: () => import('./memory-export.js'),
}

export default memoryExport
