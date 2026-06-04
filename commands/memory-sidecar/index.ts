import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const memorySidecar: Command = {
  type: 'local-jsx',
  name: 'memory-sidecar',
  description: t('cmd.memory-sidecar.description'),
  load: () => import('./memory-sidecar.js'),
}

export default memorySidecar
