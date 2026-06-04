import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: t('cmd.theme.description'),
  load: () => import('./theme.js'),
} satisfies Command

export default theme
