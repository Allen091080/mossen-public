import * as React from 'react'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { EffortLevel } from '../../utils/effort.js'
import {
  EXECUTION_PROFILES,
  type ExecutionProfile,
  getConfiguredExecutionProfile,
  getCurrentReasoningProfile,
  getExecutionProfileDefaults,
  getExecutionProfileDescription,
  getReasoningProfileDescription,
  isExecutionProfile,
  isReasoningProfile,
  REASONING_PROFILES,
  type ReasoningProfile,
  reasoningProfileToEffort,
} from '../../utils/profile.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type ProfileCommandResult = {
  message: string
  appStateUpdate?: {
    effortValue: EffortLevel
    settingsPatch: {
      executionProfile: ExecutionProfile
      reasoningProfile: ReasoningProfile
      effortLevel: EffortLevel
    }
  }
}

const COMMON_HELP_ARGS = ['help', '-h', '--help']

function summarizeCurrentProfiles(
  executionProfile: ExecutionProfile,
  reasoningProfile: ReasoningProfile,
): string {
  return [
    getLocalizedText({
      en: `Current execution profile: ${executionProfile} (${getExecutionProfileDescription(executionProfile)})`,
      zh: `当前执行配置：${executionProfile}（${getExecutionProfileDescription(executionProfile)}）`,
    }),
    getLocalizedText({
      en: `Current reasoning profile: ${reasoningProfile} (${getReasoningProfileDescription(reasoningProfile)})`,
      zh: `当前推理配置：${reasoningProfile}（${getReasoningProfileDescription(reasoningProfile)}）`,
    }),
    getLocalizedText({
      en: `Mapped effort level: ${reasoningProfileToEffort(reasoningProfile)}`,
      zh: `映射后的 effort 级别：${reasoningProfileToEffort(reasoningProfile)}`,
    }),
  ].join('\n')
}

function parseProfileArgs(
  args: string,
):
  | {
      executionProfile: ExecutionProfile
      reasoningProfile: ReasoningProfile
    }
  | {
      error: string
    } {
  const parts = args
    .split(/\s+/)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

  let executionProfile: ExecutionProfile | undefined
  let reasoningProfile: ReasoningProfile | undefined

  for (const part of parts) {
    if (isExecutionProfile(part)) {
      if (executionProfile !== undefined) {
        return {
          error: getLocalizedText({
            en: 'Only one execution profile may be set at a time.',
            zh: '一次只能设置一个执行配置。',
          }),
        }
      }
      executionProfile = part
      continue
    }

    if (isReasoningProfile(part)) {
      if (reasoningProfile !== undefined) {
        return {
          error: getLocalizedText({
            en: 'Only one reasoning profile may be set at a time.',
            zh: '一次只能设置一个推理配置。',
          }),
        }
      }
      reasoningProfile = part
      continue
    }

    return {
      error: getLocalizedText({
        en:
          `Invalid profile argument: ${part}. ` +
          `Execution profiles: ${EXECUTION_PROFILES.join(', ')}. ` +
          `Reasoning profiles: ${REASONING_PROFILES.join(', ')}.`,
        zh:
          `无效的 profile 参数：${part}。` +
          `执行配置：${EXECUTION_PROFILES.join(', ')}。` +
          `推理配置：${REASONING_PROFILES.join(', ')}。`,
      }),
    }
  }

  if (!executionProfile && !reasoningProfile) {
    return {
      error: getLocalizedText({
        en:
          `No profile supplied. Execution profiles: ${EXECUTION_PROFILES.join(', ')}. ` +
          `Reasoning profiles: ${REASONING_PROFILES.join(', ')}.`,
        zh:
          `未提供 profile。执行配置：${EXECUTION_PROFILES.join(', ')}。` +
          `推理配置：${REASONING_PROFILES.join(', ')}。`,
      }),
    }
  }

  const finalExecutionProfile = executionProfile ?? 'coding'
  const finalReasoningProfile =
    reasoningProfile ??
    getExecutionProfileDefaults(finalExecutionProfile).reasoningProfile

  return {
    executionProfile: finalExecutionProfile,
    reasoningProfile: finalReasoningProfile,
  }
}

function executeProfile(args: string): ProfileCommandResult {
  const parsed = parseProfileArgs(args)
  if ('error' in parsed) {
    return { message: parsed.error }
  }

  const effortLevel = reasoningProfileToEffort(parsed.reasoningProfile)
  const result = updateSettingsForSource('userSettings', {
    executionProfile: parsed.executionProfile,
    reasoningProfile: parsed.reasoningProfile,
    effortLevel,
  })
  if (result.error) {
    return {
      message: getLocalizedText({
        en: `Failed to set profile: ${result.error.message}`,
        zh: `设置 profile 失败：${result.error.message}`,
      }),
    }
  }

  return {
    message: [
      getLocalizedText({
        en: `Set execution profile to ${parsed.executionProfile} (${getExecutionProfileDescription(parsed.executionProfile)})`,
        zh: `已将执行配置设置为 ${parsed.executionProfile}（${getExecutionProfileDescription(parsed.executionProfile)}）`,
      }),
      getLocalizedText({
        en: `Set reasoning profile to ${parsed.reasoningProfile} (${getReasoningProfileDescription(parsed.reasoningProfile)})`,
        zh: `已将推理配置设置为 ${parsed.reasoningProfile}（${getReasoningProfileDescription(parsed.reasoningProfile)}）`,
      }),
      getLocalizedText({
        en: `Mapped effort level: ${effortLevel}`,
        zh: `映射后的 effort 级别：${effortLevel}`,
      }),
    ].join('\n'),
    appStateUpdate: {
      effortValue: effortLevel,
      settingsPatch: {
        executionProfile: parsed.executionProfile,
        reasoningProfile: parsed.reasoningProfile,
        effortLevel,
      },
    },
  }
}

function ShowCurrentProfile({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue)
  const settings = useAppState(s => s.settings)
  const executionProfile = getConfiguredExecutionProfile(settings)
  const reasoningProfile = getCurrentReasoningProfile(effortValue, settings)

  onDone(summarizeCurrentProfiles(executionProfile, reasoningProfile))
  return null
}

function ApplyProfileAndClose({
  result,
  onDone,
}: {
  result: ProfileCommandResult
  onDone: (result: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const { appStateUpdate, message } = result

  React.useEffect(() => {
    if (appStateUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: appStateUpdate.effortValue,
        settings: {
          ...prev.settings,
          ...appStateUpdate.settingsPatch,
        },
      }))
    }
    onDone(message)
  }, [setAppState, appStateUpdate, message, onDone])

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
          'Usage: /profile [executionProfile] [reasoningProfile]\n\n' +
          `Execution profiles: ${EXECUTION_PROFILES.join(', ')}\n` +
          `Reasoning profiles: ${REASONING_PROFILES.join(', ')}\n\n` +
          'Examples:\n' +
          '/profile coding\n' +
          '/profile review\n' +
          '/profile deep\n' +
          '/profile review deep',
        zh:
          '用法：/profile [executionProfile] [reasoningProfile]\n\n' +
          `执行配置：${EXECUTION_PROFILES.join(', ')}\n` +
          `推理配置：${REASONING_PROFILES.join(', ')}\n\n` +
          '示例：\n' +
          '/profile coding\n' +
          '/profile review\n' +
          '/profile deep\n' +
          '/profile review deep',
      }),
    )
    return
  }

  if (!args || args === 'current' || args === 'status') {
    return <ShowCurrentProfile onDone={onDone} />
  }

  const result = executeProfile(args)
  return <ApplyProfileAndClose result={result} onDone={onDone} />
}
