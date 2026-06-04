import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { t } from '../../utils/i18n/index.js'

const installSlackApp = {
  type: 'local',
  name: 'install-slack-app',
  description: t('cmd.install-slack-app.description', { product: getProductDisplayName() }),
  availability: ['hosted'],
  supportsNonInteractive: false,
  load: () => import('./install-slack-app.js'),
} satisfies Command

export default installSlackApp
