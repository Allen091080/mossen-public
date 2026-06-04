import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const bg = {
  type: 'local-jsx',
  name: 'bg',
  description: t('cmd.bg.description'),
  argumentHint: '<task>',
  load: () => import('./bg.js'),
} satisfies Command

export default bg
