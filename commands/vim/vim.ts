import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export const call: LocalCommandCall = async () => {
  const config = getGlobalConfig()
  let currentMode = config.editorMode || 'normal'

  // Handle backward compatibility - treat 'emacs' as 'normal'
  if (currentMode === 'emacs') {
    currentMode = 'normal'
  }

  const newMode = currentMode === 'normal' ? 'vim' : 'normal'

  saveGlobalConfig(current => ({
    ...current,
    editorMode: newMode,
  }))

  logMossenEvent('mossen.config.editorModeChanged', {
    mode: newMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      'command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return {
    type: 'text',
    value: getLocalizedText({
      en: `Editor mode set to ${newMode}. ${
        newMode === 'vim'
          ? 'Use Escape key to toggle between INSERT and NORMAL modes.'
          : 'Using standard (readline) keyboard bindings.'
      }`,
      zh: `编辑器模式已设置为 ${newMode}。${
        newMode === 'vim'
          ? '使用 Escape 键在 INSERT 和 NORMAL 模式之间切换。'
          : '当前使用标准（readline）键盘绑定。'
      }`,
    }),
  }
}
