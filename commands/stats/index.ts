import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: `Show your ${getProductDisplayName()} usage statistics and activity`,
  load: () => import('./stats.js'),
} satisfies Command

export default stats
