import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const files = {
  type: 'local',
  name: 'files',
  description: t('cmd.files.description'),
  isEnabled: isFilesInternalUser,
  supportsNonInteractive: true,
  load: () => import('./files.js'),
} satisfies Command

export default files

import { isInternalOperatorMode } from '../../utils/internalUserMode.js'

function isFilesInternalUser(): boolean {
  return isInternalOperatorMode()
}
