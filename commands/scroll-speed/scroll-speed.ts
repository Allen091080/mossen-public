import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { t } from '../../utils/i18n/index.js'

const SCROLL_SPEED_ENV = 'MOSSEN_CODE_SCROLL_SPEED'
const MIN_SCROLL_SPEED = 0.1
const MAX_SCROLL_SPEED = 20

const PRESETS: Record<string, number> = {
  slow: 0.5,
  normal: 1,
  fast: 3,
}

function formatSpeed(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function parseScrollSpeedValue(input: string):
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'invalid' } {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return { ok: false, reason: 'empty' }

  const preset = PRESETS[trimmed]
  if (preset !== undefined) return { ok: true, value: preset }

  const numeric = Number(trimmed)
  if (
    !Number.isFinite(numeric) ||
    numeric < MIN_SCROLL_SPEED ||
    numeric > MAX_SCROLL_SPEED
  ) {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, value: numeric }
}

export function getConfiguredScrollSpeed(): number {
  const raw =
    process.env[SCROLL_SPEED_ENV] ??
    getGlobalConfig().env?.[SCROLL_SPEED_ENV] ??
    ''
  const parsed = parseScrollSpeedValue(raw)
  return parsed.ok ? parsed.value : 1
}

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

export const call: LocalCommandCall = async args => {
  const trimmed = args.trim()
  if (!trimmed) {
    const speed = formatSpeed(getConfiguredScrollSpeed())
    return text(
      `${t('cmd.scrollSpeed.current', { speed })}\n${t('cmd.scrollSpeed.usage')}`,
    )
  }

  const parsed = parseScrollSpeedValue(trimmed)
  if (!parsed.ok) {
    return text(
      `${t('cmd.scrollSpeed.invalid', { value: trimmed })}\n${t('cmd.scrollSpeed.usage')}`,
    )
  }

  const speed = formatSpeed(parsed.value)
  process.env[SCROLL_SPEED_ENV] = speed
  saveGlobalConfig(current => ({
    ...current,
    env: {
      ...current.env,
      [SCROLL_SPEED_ENV]: speed,
    },
  }))

  return text(t('cmd.scrollSpeed.updated', { speed }))
}
