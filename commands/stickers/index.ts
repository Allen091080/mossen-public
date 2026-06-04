import type { Command } from '../../commands.js'
import { getProductDisplayName } from '../../constants/product.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'

const stickers = {
  type: 'local',
  name: 'stickers',
  description: `Order ${getProductDisplayName()} stickers`,
  isEnabled: () => isDeferredSlashCommandEnabled('stickers'),
  supportsNonInteractive: false,
  load: () => import('./stickers.js'),
} satisfies Command

export default stickers
