/**
 * I18nKey — derived from STRINGS_EN as the single source of truth.
 *
 * Dependency direction (must remain one-way; circular import is a hard error):
 *   strings.en.ts → keys.ts → strings.zh.ts → index.ts
 *
 * Do NOT import keys.ts from strings.en.ts. STRINGS_ZH uses
 *   `satisfies Record<I18nKey, string>` to enforce key parity at compile time.
 */

import { STRINGS_EN } from './strings.en.js'

export type I18nKey = keyof typeof STRINGS_EN
