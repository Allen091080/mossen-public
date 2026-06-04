import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { t } from '../../utils/i18n/index.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: t('cmd.login.description', { product: getProductDisplayName() }),
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
