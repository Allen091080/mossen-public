import type { LocalJSXCommandCall } from '../../types/command.js'
import { t } from '../../utils/i18n/index.js'
import {
  getConfiguredInteractiveLanguageTag,
  getInteractiveLanguageDisplayName,
  getInteractiveLanguageTag,
  setInteractiveLanguagePreference,
  toPersistedLanguagePreference,
} from '../../utils/uiLanguage.js'

const HELP_ARGS = new Set(['help', '-h', '--help'])

function setLanguagePreference(preference: string | undefined): string {
  setInteractiveLanguagePreference(
    preference === '中文' ? 'zh' : preference === 'English' ? 'en' : undefined,
  )

  if (preference === undefined) {
    return t('lang.cleared.message')
  }
  // 切换反馈强制按目标语言渲染（不依赖 set→get 同步性）：
  // 用户切到中文就看到中文反馈，切到英文就看到英文反馈。
  const targetLang = preference === '中文' ? 'zh' : 'en'
  return t('lang.switched.message', undefined, targetLang)
}

function buildUsageMessage(): string {
  const effective = getInteractiveLanguageDisplayName(getInteractiveLanguageTag())
  const configured = getConfiguredInteractiveLanguageTag()
  const preferenceLabel = configured
    ? getInteractiveLanguageDisplayName(configured)
    : t('lang.preference.auto')

  return [
    t('lang.current.label', { language: effective }),
    t('lang.preference.label', { preference: preferenceLabel }),
    '',
    t('lang.usage.line'),
    t('lang.usage.shortcut'),
    t('lang.usage.note'),
  ].join('\n')
}

function resolveLanguageCommand(
  args: string,
): string | undefined | null | 'toggle' {
  const trimmed = args.trim()
  if (!trimmed) return null

  const lowered = trimmed.toLowerCase()
  if (HELP_ARGS.has(lowered)) return null
  if (lowered === 'toggle' || lowered === 'switch') return 'toggle'
  if (['default', 'auto', 'system', 'follow', 'clear'].includes(lowered)) {
    return undefined
  }

  return toPersistedLanguagePreference(trimmed) ?? null
}

export const call: LocalJSXCommandCall = async (
  onDone,
  _context,
  args = '',
) => {
  const command = resolveLanguageCommand(args)

  if (command === null) {
    onDone(buildUsageMessage(), { display: 'system' })
    return null
  }

  if (command === 'toggle') {
    const nextPreference = getInteractiveLanguageTag() === 'zh' ? 'English' : '中文'
    onDone(setLanguagePreference(nextPreference), { display: 'system' })
    return null
  }

  onDone(setLanguagePreference(command), { display: 'system' })
  return null
}
