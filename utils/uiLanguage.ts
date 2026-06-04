import { saveGlobalConfig } from './config.js'
import { getGlobalMossenFile } from './env.js'
import { getFsImplementation } from './fsOperations.js'
import { getSystemLocaleLanguage } from './intl.js'
import { stripBOM } from './jsonRead.js'
import { getInitialSettings } from './settings/settings.js'

export type InteractiveLanguageTag = 'en' | 'zh'

let observedInteractiveLanguageTag: InteractiveLanguageTag | undefined

function readPersistedSettingsLanguagePreference():
  | string
  | undefined {
  try {
    const globalConfigText = getFsImplementation().readFileSync(
      getGlobalMossenFile(),
      { encoding: 'utf-8' },
    )
    const parsed = JSON.parse(stripBOM(globalConfigText))
    if (
      parsed &&
      typeof parsed === 'object' &&
      'language' in parsed &&
      typeof parsed.language === 'string'
    ) {
      return parsed.language
    }
  } catch {
    return undefined
  }
  return undefined
}

function readPersistedInteractiveLanguagePreferenceSetting():
  | string
  | undefined {
  try {
    const globalConfigText = getFsImplementation().readFileSync(
      getGlobalMossenFile(),
      { encoding: 'utf-8' },
    )
    const parsed = JSON.parse(stripBOM(globalConfigText))
    if (
      parsed &&
      typeof parsed === 'object' &&
      'interactiveLanguagePreference' in parsed &&
      typeof parsed.interactiveLanguagePreference === 'string'
    ) {
      return parsed.interactiveLanguagePreference
    }
  } catch {
    return undefined
  }
  return undefined
}

function readPersistedInteractiveLanguagePreference():
  | string
  | undefined {
  try {
    const globalConfigText = getFsImplementation().readFileSync(
      getGlobalMossenFile(),
      { encoding: 'utf-8' },
    )
    const parsed = JSON.parse(stripBOM(globalConfigText))
    if (
      parsed &&
      typeof parsed === 'object' &&
      'lastInteractiveLanguageTag' in parsed &&
      typeof parsed.lastInteractiveLanguageTag === 'string'
    ) {
      return parsed.lastInteractiveLanguageTag
    }
  } catch {
    return undefined
  }
  return undefined
}

function getPersistedInteractiveLanguageTag():
  | InteractiveLanguageTag
  | undefined {
  return normalizeLanguagePreference(readPersistedInteractiveLanguagePreference())
}

function getConfiguredInteractiveLanguageTagInternal():
  | InteractiveLanguageTag
  | undefined {
  return normalizeLanguagePreference(
    readPersistedInteractiveLanguagePreferenceSetting(),
  )
}

function persistObservedInteractiveLanguageTag(
  tag: InteractiveLanguageTag,
): void {
  try {
    saveGlobalConfig(current =>
      current.lastInteractiveLanguageTag === tag
        ? current
        : { ...current, lastInteractiveLanguageTag: tag },
    )
  } catch {
    // Startup and other early-render paths may localize text before config
    // access is allowed. Dynamic language persistence is best-effort only.
  }
}

export function normalizeLanguagePreference(
  value: string | undefined,
): InteractiveLanguageTag | undefined {
  if (!value) return undefined

  const lower = value.trim().toLowerCase()
  if (!lower) return undefined

  if (
    lower === 'zn' ||
    lower === 'cn' ||
    lower.startsWith('zh') ||
    lower.includes('中文') ||
    lower.includes('汉语') ||
    lower.includes('漢語') ||
    lower.includes('简体') ||
    lower.includes('繁体') ||
    lower.includes('繁體') ||
    lower.includes('chinese') ||
    lower.includes('mandarin')
  ) {
    return 'zh'
  }

  if (
    lower === 'en' ||
    lower.startsWith('en-') ||
    lower.startsWith('en_') ||
    lower.includes('english') ||
    lower.includes('英文') ||
    lower.includes('英语') ||
    lower.includes('英語')
  ) {
    return 'en'
  }

  if (
    lower === 'default' ||
    lower === 'auto' ||
    lower === 'system' ||
    lower === 'follow' ||
    lower === 'automatic'
  ) {
    return undefined
  }

  return undefined
}

export function toPersistedLanguagePreference(
  value: string | undefined,
): string | undefined {
  const tag = normalizeLanguagePreference(value)
  if (!tag) return undefined
  return tag === 'zh' ? '中文' : 'English'
}

export function inferInteractiveLanguageTagFromText(
  value: string | undefined,
): InteractiveLanguageTag | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(trimmed)) {
    return 'zh'
  }

  const latinWords = trimmed.match(/[A-Za-z]+/g)
  if (!latinWords || latinWords.length < 2) {
    return undefined
  }

  return latinWords.join('').length >= 8 ? 'en' : undefined
}

export function observeInteractiveLanguage(
  value: string | undefined,
): InteractiveLanguageTag | undefined {
  const inferred = inferInteractiveLanguageTagFromText(value)
  if (inferred) {
    observedInteractiveLanguageTag = inferred
    persistObservedInteractiveLanguageTag(inferred)
  }
  return inferred
}

export function setInteractiveLanguagePreference(
  tag: InteractiveLanguageTag | undefined,
): void {
  saveGlobalConfig(current => ({
    ...current,
    interactiveLanguagePreference: tag,
    ...(tag ? { lastInteractiveLanguageTag: tag } : {}),
  }))
}

export function resetObservedInteractiveLanguageForTesting(): void {
  observedInteractiveLanguageTag = undefined
}

export function getInteractiveLanguageTag(): InteractiveLanguageTag {
  const configured = getConfiguredInteractiveLanguageTagInternal()
  if (configured) {
    return configured
  }

  if (observedInteractiveLanguageTag) {
    return observedInteractiveLanguageTag
  }

  const persisted = getPersistedInteractiveLanguageTag()
  if (persisted) {
    return persisted
  }

  const system = normalizeLanguagePreference(getSystemLocaleLanguage())
  return system ?? 'en'
}

export function getInteractiveLanguagePreference(): string | undefined {
  const configured = getInitialSettings().language?.trim()
  if (configured) {
    const configuredTag = normalizeLanguagePreference(configured)
    if (
      configuredTag &&
      observedInteractiveLanguageTag &&
      observedInteractiveLanguageTag !== configuredTag
    ) {
      return getInteractiveLanguageDisplayName(observedInteractiveLanguageTag)
    }
    return configuredTag
      ? getInteractiveLanguageDisplayName(configuredTag)
      : configured
  }

  const persistedConfigured = readPersistedSettingsLanguagePreference()?.trim()
  if (persistedConfigured) {
    const configuredTag = normalizeLanguagePreference(persistedConfigured)
    if (
      configuredTag &&
      observedInteractiveLanguageTag &&
      observedInteractiveLanguageTag !== configuredTag
    ) {
      return getInteractiveLanguageDisplayName(observedInteractiveLanguageTag)
    }
    return configuredTag
      ? getInteractiveLanguageDisplayName(configuredTag)
      : persistedConfigured
  }

  if (observedInteractiveLanguageTag) {
    return getInteractiveLanguageDisplayName(observedInteractiveLanguageTag)
  }

  const persisted = getPersistedInteractiveLanguageTag()
  return persisted ? getInteractiveLanguageDisplayName(persisted) : undefined
}

export function getConfiguredInteractiveLanguageTag():
  | InteractiveLanguageTag
  | undefined {
  return getConfiguredInteractiveLanguageTagInternal()
}

export function getInteractiveLanguageDisplayName(
  tag: InteractiveLanguageTag,
): string {
  return tag === 'zh' ? '中文' : 'English'
}

export function getInteractiveLanguageFooterLabel(): string {
  const effective = getInteractiveLanguageTag()
  const label = getInteractiveLanguageDisplayName(effective)

  if (getConfiguredInteractiveLanguageTagInternal()) {
    return label
  }

  return getLocalizedText({
    en: `${label} (auto)`,
    zh: `${label}（自动）`,
  })
}

export function getLocalizedText<T extends string>(messages: {
  en: T
  zh?: T
}): T {
  const tag = getInteractiveLanguageTag()
  return messages[tag] ?? messages.en
}
