import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'
import {
  isVoiceRolloutEnabled,
  isVoiceModeEnabled,
} from '../../voice/voiceModeEnabled.js'
import { isDeferredSlashCommandEnabled } from '../../utils/deferredSlashCommands.js'

const voice = {
  type: 'local',
  name: 'voice',
  description: t('cmd.voice.description'),
  isEnabled: () =>
    isDeferredSlashCommandEnabled('voice') &&
    isVoiceRolloutEnabled() &&
    isVoiceModeEnabled(),
  get isHidden() {
    return !isVoiceModeEnabled()
  },
  supportsNonInteractive: false,
  load: () => import('./voice.js'),
} satisfies Command

export default voice
