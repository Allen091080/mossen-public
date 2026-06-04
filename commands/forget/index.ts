// W419b — /forget <id-prefix> slash command.
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const forget: Command = {
  type: 'local-jsx',
  name: 'forget',
  description: t('cmd.forget.description'),
  argumentHint: '<archive-event-id-prefix>',
  load: () => import('./forget.js'),
}

export default forget
