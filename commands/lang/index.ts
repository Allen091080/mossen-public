import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'lang',
  description: t('cmd.lang.description'),
  argumentHint: '[zh|en|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./lang.js'),
} satisfies Command
