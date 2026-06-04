/**
 * Mossen i18n facade.
 *
 * Public API:
 *   - t(key, params?) — localized lookup; falls back to en, then to key string itself
 *     (W1-D6 = A loud failure: missing keys appear as the literal key in UI)
 *   - hasI18nKey(key) — runtime predicate (uses en table as authoritative)
 *   - getMissingI18nKeys() — diagnostic for guard scripts; pairs with scripts/i18n_self_check.py
 *
 * Migration policy:
 *   - New user-visible text MUST use t(). Existing inline `getLocalizedText({en, zh})`
 *     calls remain as a compat layer. Slices that touch a file SHOULD migrate
 *     text in that file to t() and append keys to strings.{en,zh}.ts.
 *
 * Dependency direction (do not break):
 *   strings.en.ts → keys.ts → strings.zh.ts → index.ts → utils/uiLanguage.ts
 *
 * No file outside utils/i18n/ should import from strings.en.ts / strings.zh.ts /
 * keys.ts directly. All consumers go through this index.
 */

import { getInteractiveLanguageTag, type InteractiveLanguageTag } from '../uiLanguage.js'
import type { I18nKey } from './keys.js'
import { STRINGS_EN } from './strings.en.js'
import { STRINGS_ZH } from './strings.zh.js'

export type { I18nKey }

function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

export function t(
  key: I18nKey,
  params?: Record<string, string | number>,
  langOverride?: InteractiveLanguageTag,
): string {
  const tag = langOverride ?? getInteractiveLanguageTag()
  const tmpl =
    (tag === 'zh' ? STRINGS_ZH[key] : STRINGS_EN[key]) ?? STRINGS_EN[key]
  if (!tmpl) {
    if (process.env.MOSSEN_DEBUG_I18N) {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key: ${String(key)}`)
    }
    return String(key)
  }
  return params ? format(tmpl, params) : tmpl
}

export function hasI18nKey(key: string): key is I18nKey {
  return Object.prototype.hasOwnProperty.call(STRINGS_EN, key)
}

export function getMissingI18nKeys(): {
  missingInZh: I18nKey[]
  missingInEn: string[]
} {
  const enKeys = Object.keys(STRINGS_EN) as I18nKey[]
  const zhKeys = Object.keys(STRINGS_ZH)
  const missingInZh = enKeys.filter(k => !(k in STRINGS_ZH))
  const missingInEn = zhKeys.filter(k => !(k in STRINGS_EN))
  return { missingInZh, missingInEn }
}
