import {
  calculateTokenWarningState,
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
} from '../services/compact/autoCompact.js'
import type { Message } from '../types/message.js'
import { getCustomBackendBaseUrl, isCustomBackendEnabled } from './customBackend.js'
import type { EffortValue } from './effort.js'
import { findLastCompactBoundaryIndex, getMessagesAfterCompactBoundary } from './messages.js'
import {
  getConfiguredExecutionProfile,
  getCurrentReasoningProfile,
  reasoningProfileToEffort,
} from './profile.js'
import type { SettingsJson } from './settings/types.js'
import { tokenCountWithEstimation } from './tokens.js'
import { getInteractiveLanguageFooterLabel } from './uiLanguage.js'
import { getCurrentWorktreeObservabilitySnapshot } from './worktree.js'

// OpenAI-compatible providers may emit placeholder all-zero usage; estimate
// instead so ctx does not stick at 0%.
const STATUS_LINE_TOKEN_OPTIONS = { ignoreEmptyUsage: true } as const

type ProfileSettings = Pick<
  SettingsJson,
  'executionProfile' | 'reasoningProfile' | 'effortLevel'
>

export function getDisplayedModelTierFromBaseUrl(
  baseUrl: string | null | undefined,
): 'local' | 'cloud' {
  if (!baseUrl) {
    return 'cloud'
  }
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('127.')
    ) {
      return 'local'
    }
  } catch {}
  return 'cloud'
}

export function getDisplayedModelTier(): 'local' | 'cloud' {
  if (!isCustomBackendEnabled()) {
    return 'cloud'
  }
  return getDisplayedModelTierFromBaseUrl(getCustomBackendBaseUrl())
}

export function buildStatusLineObservabilityInput(
  messages: Message[],
  mainLoopModel: string,
  effortValue: EffortValue | undefined,
  settings: ProfileSettings,
  options?: {
    autoCompactEnabled?: boolean
    modelTier?: 'local' | 'cloud'
  },
): {
  model_tier: 'local' | 'cloud'
  interactive_language: string
  worktree?: {
    name: string
    path: string
    branch: string | null
    original_cwd: string
    original_branch: string | null
  }
  profiles: {
    execution: string
    reasoning: string
    effort_level: string
  }
  context_observability: {
    pressure_percent: number
    auto_compact_enabled: boolean
    auto_compact_threshold_percent: number | null
    auto_compact_threshold_tokens: number | null
    threshold_reached: boolean
    recent_compact: string
  }
} {
  const compactAwareMessages = getMessagesAfterCompactBoundary(messages)
  const currentTokens = tokenCountWithEstimation(
    compactAwareMessages,
    STATUS_LINE_TOKEN_OPTIONS,
  )
  const effectiveWindow = getEffectiveContextWindowSize(mainLoopModel)
  const contextPercent = Math.min(
    100,
    Math.round((currentTokens / effectiveWindow) * 100),
  )
  const autoCompactEnabled = options?.autoCompactEnabled ?? isAutoCompactEnabled()
  const autoCompactThreshold = autoCompactEnabled
    ? getAutoCompactThreshold(mainLoopModel)
    : null
  const thresholdReached =
    options?.autoCompactEnabled === undefined
      ? calculateTokenWarningState(currentTokens, mainLoopModel)
          .isAboveAutoCompactThreshold
      : autoCompactThreshold !== null && currentTokens >= autoCompactThreshold
  const compactBoundaryIndex = findLastCompactBoundaryIndex(messages)
  const recentCompact =
    compactBoundaryIndex === -1
      ? 'none'
      : `${Math.max(0, messages.length - compactBoundaryIndex - 1)} messages since last compact`

  const executionProfile = getConfiguredExecutionProfile(settings)
  const reasoningProfile = getCurrentReasoningProfile(effortValue, settings)
  const worktreeSnapshot = getCurrentWorktreeObservabilitySnapshot()

  return {
    model_tier: options?.modelTier ?? getDisplayedModelTier(),
    interactive_language: getInteractiveLanguageFooterLabel(),
    ...(worktreeSnapshot && {
      worktree: {
        name: worktreeSnapshot.name,
        path: worktreeSnapshot.path,
        branch: worktreeSnapshot.branch,
        original_cwd: worktreeSnapshot.originalCwd,
        original_branch: worktreeSnapshot.originalBranch,
      },
    }),
    profiles: {
      execution: executionProfile,
      reasoning: reasoningProfile,
      effort_level: reasoningProfileToEffort(reasoningProfile),
    },
    context_observability: {
      pressure_percent: contextPercent,
      auto_compact_enabled: autoCompactEnabled,
      auto_compact_threshold_percent:
        autoCompactThreshold === null
          ? null
          : Math.round((autoCompactThreshold / effectiveWindow) * 100),
      auto_compact_threshold_tokens: autoCompactThreshold,
      threshold_reached: thresholdReached,
      recent_compact: recentCompact,
    },
  }
}
