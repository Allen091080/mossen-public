import * as React from 'react'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  isEffortLevel,
  toPersistableEffort,
} from '../../utils/effort.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { EffortPicker } from './EffortPicker.js'

const COMMON_HELP_ARGS = ['help', '-h', '--help']

type EffortCommandResult = {
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue)
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    })
    if (result.error) {
      return {
        message: getLocalizedText({
          en: `Failed to set effort level: ${result.error.message}`,
          zh: `设置 effort 级别失败：${result.error.message}`,
        }),
      }
    }
  }

  logMossenEvent('mossen.model.effortCommand', {
    effort:
      effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.MOSSEN_CODE_EFFORT_LEVEL
    if (persistable === undefined) {
      return {
        message: getLocalizedText({
          en: `Not applied: MOSSEN_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
          zh: `未生效：MOSSEN_CODE_EFFORT_LEVEL=${envRaw} 覆盖了当前会话的 effort，而 ${effortValue} 仅对当前会话生效（不会保存）`,
        }),
        effortUpdate: { value: effortValue },
      }
    }
    return {
      message: getLocalizedText({
        en: `MOSSEN_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
        zh: `MOSSEN_CODE_EFFORT_LEVEL=${envRaw} 覆盖了当前会话——清除后才会由 ${effortValue} 接管`,
      }),
      effortUpdate: { value: effortValue },
    }
  }

  const description = getEffortValueDescription(effortValue)
  const suffix =
    persistable !== undefined
      ? ''
      : getLocalizedText({
          en: ' (this session only)',
          zh: '（仅当前会话）',
        })

  return {
    message: getLocalizedText({
      en: `Set effort level to ${effortValue}${suffix}: ${description}`,
      zh: `已将 effort 级别设置为 ${effortValue}${suffix}：${description}`,
    }),
    effortUpdate: { value: effortValue },
  }
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
): EffortCommandResult {
  const envOverride = getEffortEnvOverride()
  const effectiveValue =
    envOverride === null ? undefined : envOverride ?? appStateEffort

  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort)
    return {
      message: getLocalizedText({
        en: `Effort level: auto (currently ${level})`,
        zh: `当前 effort 级别：自动（当前为 ${level}）`,
      }),
    }
  }

  const description = getEffortValueDescription(effectiveValue)
  return {
    message: getLocalizedText({
      en: `Current effort level: ${effectiveValue} (${description})`,
      zh: `当前 effort 级别：${effectiveValue}（${description}）`,
    }),
  }
}

function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  })
  if (result.error) {
    return {
      message: getLocalizedText({
        en: `Failed to set effort level: ${result.error.message}`,
        zh: `设置 effort 级别失败：${result.error.message}`,
      }),
    }
  }

  logMossenEvent('mossen.model.effortCommand', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.MOSSEN_CODE_EFFORT_LEVEL
    return {
      message: getLocalizedText({
        en: `Cleared effort from settings, but MOSSEN_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
        zh: `已从设置中清除 effort，但 MOSSEN_CODE_EFFORT_LEVEL=${envRaw} 仍在控制当前会话`,
      }),
      effortUpdate: { value: undefined },
    }
  }

  return {
    message: getLocalizedText({
      en: 'Effort level set to auto',
      zh: '已将 effort 级别设置为自动',
    }),
    effortUpdate: { value: undefined },
  }
}

export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase()
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel()
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: getLocalizedText({
        en: `Invalid argument: ${args}. Valid options are: low, medium, high, max, auto`,
        zh: `无效参数：${args}。可用选项为：low、medium、high、max、auto`,
      }),
    }
  }

  return setEffortValue(normalized)
}

function ShowCurrentEffort({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue)
  const model = useMainLoopModel()
  const { message } = showCurrentEffort(effortValue, model)
  onDone(message)
  return null
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult
  onDone: (result: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const { effortUpdate, message } = result

  React.useEffect(() => {
    if (effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: effortUpdate.value,
      }))
    }
    onDone(message)
  }, [setAppState, effortUpdate, message, onDone])

  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  args = args?.trim() || ''

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      getLocalizedText({
        en:
          'Usage: /effort [low|medium|high|max|auto]\n\n' +
          'Effort levels:\n' +
          '- low: Quick, straightforward implementation\n' +
          '- medium: Balanced approach with standard testing\n' +
          '- high: Comprehensive implementation with extensive testing\n' +
          '- max: Maximum capability with deepest reasoning (requires current backend/model support)\n' +
          '- auto: Use the default effort level for your model',
        zh:
          '用法：/effort [low|medium|high|max|auto]\n\n' +
          'Effort 级别：\n' +
          '- low：快速、直接的实现\n' +
          '- medium：带标准测试的平衡实现\n' +
          '- high：带广泛测试的完整实现\n' +
          '- max：最强能力与最深推理（需要当前 backend/model 支持）\n' +
          '- auto：使用当前模型的默认 effort 级别',
      }),
    )
    return
  }

  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />
  }

  // W57 C1: no-args opens the interactive picker. The legacy 'show current'
  // behaviour is still reachable via /effort current or /effort status, and
  // /effort low|medium|high|max|auto continues to apply directly without a
  // picker (exactly as before).
  if (!args) {
    return <EffortPicker onComplete={onDone} />
  }

  const result = executeEffort(args)
  return <ApplyEffortAndClose result={result} onDone={onDone} />
}
