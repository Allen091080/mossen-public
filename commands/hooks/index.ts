import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: t('cmd.hooks.description'),
  immediate: true,
  load: () => import('./hooks.js'),
} satisfies Command

export default hooks
