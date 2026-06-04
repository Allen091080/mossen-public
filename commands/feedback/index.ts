import type { Command } from '../../types/command.js'
import { getProductDisplayName } from '../../constants/product.js'
import { t } from '../../utils/i18n/index.js'

function isEnvTruthyLocal(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  return ['1', 'true', 'yes', 'on'].includes(envVar.toLowerCase().trim())
}

function isFeedbackPolicyAllowed(): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isPolicyAllowed } =
      require('../../services/policyLimits/index.js') as typeof import('../../services/policyLimits/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return isPolicyAllowed('allow_product_feedback')
  } catch {
    return true
  }
}

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: t('cmd.feedback.description', { product: getProductDisplayName() }),
  argumentHint: '[report]',
  isEnabled: () =>
    !(
      isEnvTruthyLocal(process.env.MOSSEN_CODE_USE_BEDROCK) ||
      isEnvTruthyLocal(process.env.MOSSEN_CODE_USE_VERTEX) ||
      isEnvTruthyLocal(process.env.MOSSEN_CODE_USE_FOUNDRY) ||
      isEnvTruthyLocal(process.env.DISABLE_FEEDBACK_COMMAND) ||
      isEnvTruthyLocal(process.env.DISABLE_BUG_COMMAND) ||
      Boolean(process.env.MOSSEN_CODE_DISABLE_NONESSENTIAL_TRAFFIC) ||
      isFeedbackInternalUser() ||
      !isFeedbackPolicyAllowed()
    ),
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback

import { isInternalOperatorMode } from '../../utils/internalUserMode.js'

// Module-local helper preserves i18n hardcoded allowlist line numbers.
function isFeedbackInternalUser(): boolean {
  return isInternalOperatorMode()
}
