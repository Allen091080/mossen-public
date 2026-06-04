// W419 S3 — /undo slash command. Tombstones the most-recently-captured
// memory entry that W418's emit pipeline tagged with an archiveEventId.
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const undoMemory: Command = {
  type: 'local-jsx',
  name: 'undo',
  description: t('cmd.undo.description'),
  load: () => import('./undo-memory.js'),
}

export default undoMemory
