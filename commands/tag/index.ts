import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const tag = {
  type: 'local-jsx',
  name: 'tag',
  description: t('cmd.tag.description'),
  isEnabled: isTagInternalUser,
  argumentHint: '<tag-name>',
  load: () => import('./tag.js'),
} satisfies Command

export default tag

import { isInternalOperatorMode } from '../../utils/internalUserMode.js'

function isTagInternalUser(): boolean {
  return isInternalOperatorMode()
}
