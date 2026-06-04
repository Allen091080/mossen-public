import type { Command } from '../../commands.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  availability: ['hosted', 'console'],
  isEnabled: () => isFastModeEnabled() && !isCustomBackendEnabled(),
  get isHidden() {
    return !isFastModeEnabled() || isCustomBackendEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
