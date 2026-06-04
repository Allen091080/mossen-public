import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { t } from '../../utils/i18n/index.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: t('cmd.memory.description', { product: getProductDisplayName() }),
  load: () => import('./memory.js'),
}

export default memory
