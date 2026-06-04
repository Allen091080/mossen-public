import { checkRecordingAvailability } from '../services/voice.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { isVoiceStreamAvailable } from '../services/voiceStreamSTT.js'
import {
  hasVoiceAuth,
  isVoiceRolloutEnabled,
  isVoiceModeEnabled,
} from '../voice/voiceModeEnabled.js'
import type { VoiceRuntimeSnapshot } from './runtimeTypes.js'

export async function getVoiceRuntimeSnapshot(): Promise<VoiceRuntimeSnapshot> {
  const settings = getInitialSettings()
  const recording = await checkRecordingAvailability()

  return {
    visible: isVoiceModeEnabled(),
    rolloutEnabled: isVoiceRolloutEnabled(),
    authAvailable: hasVoiceAuth(),
    streamAvailable: isVoiceStreamAvailable(),
    recordingAvailable: recording.available,
    recordingReason: recording.reason,
    userEnabled: settings.voiceEnabled === true,
  }
}
