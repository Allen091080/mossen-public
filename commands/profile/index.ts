import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'profile',
  description: t('cmd.profile.description'),
  argumentHint: '[profile]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./profile.js'),
} satisfies Command
