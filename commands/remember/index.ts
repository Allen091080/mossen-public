// W418 S3 — /remember slash command.
//
// Bypasses captureFilters (which run inside turnCapture.ts) by going straight
// to ingestConversationEvent with a manually-constructed ConversationEvent.
// The write happens in project scope of the cwd at command time.
//
// Triggers the same toast pipeline (captureEvents) as automatic capture, so
// the user sees a confirmation in the bottom notification.
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const remember: Command = {
  type: 'local-jsx',
  name: 'remember',
  description: t('cmd.remember.description'),
  argumentHint: '<text to memorize>',
  load: () => import('./remember.js'),
}

export default remember
