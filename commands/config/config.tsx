import * as React from 'react'
import { Settings } from '../../components/Settings/Settings.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import {
  getLocalizedText,
  toPersistedLanguagePreference,
} from '../../utils/uiLanguage.js'

const HELP_ARGS = new Set(['help', '-h', '--help'])

function resolveLanguageOverride(args: string): string | undefined | null {
  const trimmed = args.trim()
  if (!trimmed) return null

  const normalized = trimmed.replace(/^language\s+/i, '').trim()
  if (!normalized) return null

  const lowered = normalized.toLowerCase()
  if (HELP_ARGS.has(lowered)) return null

  if (['default', 'auto', 'system', 'follow'].includes(lowered)) {
    return undefined
  }

  return toPersistedLanguagePreference(normalized) ?? null
}

export const call: LocalJSXCommandCall = async (
  onDone,
  context,
  args = '',
) => {
  const trimmedArgs = args.trim()
  const languageOverride = resolveLanguageOverride(trimmedArgs)

  if (trimmedArgs) {
    if (languageOverride !== null) {
      const result = updateSettingsForSource('userSettings', {
        language: languageOverride,
      })
      if (result.error) {
        onDone(result.error.message, { display: 'system' })
        return null
      }

      if (languageOverride === '中文' || languageOverride === 'English') {
        saveGlobalConfig(current => ({
          ...current,
          lastInteractiveLanguageTag:
            languageOverride === '中文' ? 'zh' : 'en',
        }))
      }

      onDone(
        languageOverride === undefined
          ? getLocalizedText({
              en: 'Language preference cleared. Runtime messages now follow your recent conversation or system language.',
              zh: '已清除语言偏好。运行态提示现在会跟随你最近的对话语言或系统语言。',
            })
          : languageOverride === '中文'
            ? '已切换为中文。后续运行态提示会优先显示中文。'
            : 'Language switched to English. Future runtime prompts will prefer English.',
        { display: 'system' },
      )
      return null
    }

    if (!HELP_ARGS.has(trimmedArgs.toLowerCase())) {
      onDone(
        getLocalizedText({
          en: 'Usage: /config [zh|zn|cn|en|english|中文|default]\n\nUse /config by itself to open the full config panel.',
          zh: '用法：/config [zh|zn|cn|en|english|中文|default]\n\n单独使用 /config 会打开完整配置面板。',
        }),
        { display: 'system' },
      )
      return null
    }
  }

  return <Settings onClose={onDone} context={context} defaultTab="Config" />
}
