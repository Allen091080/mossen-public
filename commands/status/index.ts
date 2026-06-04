import type { Command } from '../../commands.js'
import { getProductAssistantName } from '../../constants/product.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    `Show ${getProductAssistantName()} status including version, model, backend, API connectivity, and tool statuses`,
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status
