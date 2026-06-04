import type { EffortLevel, EffortValue } from './effort.js'
import type { SettingsJson } from './settings/types.js'

export const REASONING_PROFILES = ['fast', 'standard', 'deep'] as const
export type ReasoningProfile = (typeof REASONING_PROFILES)[number]

export const EXECUTION_PROFILES = [
  'coding',
  'review',
  'long-context',
  'low-cost',
] as const
export type ExecutionProfile = (typeof EXECUTION_PROFILES)[number]

const REASONING_PROFILE_TO_EFFORT: Record<ReasoningProfile, EffortLevel> = {
  fast: 'low',
  standard: 'medium',
  deep: 'high',
}

const EXECUTION_PROFILE_DEFAULTS: Record<
  ExecutionProfile,
  {
    reasoningProfile: ReasoningProfile
    description: string
  }
> = {
  coding: {
    reasoningProfile: 'standard',
    description: 'Balanced day-to-day coding and debugging',
  },
  review: {
    reasoningProfile: 'deep',
    description: 'Thorough analysis and review with more reasoning budget',
  },
  'long-context': {
    reasoningProfile: 'standard',
    description: 'Favor continuity in long-running sessions and large context',
  },
  'low-cost': {
    reasoningProfile: 'fast',
    description: 'Prefer faster, lighter reasoning for lower cost and latency',
  },
}

export function isReasoningProfile(value: string): value is ReasoningProfile {
  return (REASONING_PROFILES as readonly string[]).includes(value)
}

export function isExecutionProfile(value: string): value is ExecutionProfile {
  return (EXECUTION_PROFILES as readonly string[]).includes(value)
}

export function reasoningProfileToEffort(
  profile: ReasoningProfile,
): EffortLevel {
  return REASONING_PROFILE_TO_EFFORT[profile]
}

export function effortValueToReasoningProfile(
  value: EffortValue | undefined,
): ReasoningProfile {
  if (value === 'low') return 'fast'
  if (value === 'medium') return 'standard'
  if (value === 'high' || value === 'xhigh' || value === 'max' || value === 'ultracode') {
    return 'deep'
  }
  if (typeof value === 'number') {
    if (value <= 50) return 'fast'
    if (value <= 85) return 'standard'
    return 'deep'
  }
  return 'standard'
}

export function getExecutionProfileDefaults(profile: ExecutionProfile): {
  reasoningProfile: ReasoningProfile
  description: string
} {
  return EXECUTION_PROFILE_DEFAULTS[profile]
}

export function getReasoningProfileDescription(
  profile: ReasoningProfile,
): string {
  switch (profile) {
    case 'fast':
      return 'Quick responses with lighter reasoning'
    case 'standard':
      return 'Balanced reasoning for everyday work'
    case 'deep':
      return 'Deeper reasoning for harder coding tasks'
  }
}

export function getExecutionProfileDescription(
  profile: ExecutionProfile,
): string {
  return EXECUTION_PROFILE_DEFAULTS[profile].description
}

function getExplicitReasoningProfile(
  settings: Pick<SettingsJson, 'reasoningProfile' | 'effortLevel'>,
): ReasoningProfile | undefined {
  if (settings.reasoningProfile && isReasoningProfile(settings.reasoningProfile)) {
    return settings.reasoningProfile
  }
  if (settings.effortLevel) {
    return effortValueToReasoningProfile(settings.effortLevel)
  }
  return undefined
}

export function getConfiguredReasoningProfile(
  settings: Pick<SettingsJson, 'reasoningProfile' | 'effortLevel'>,
): ReasoningProfile {
  return getExplicitReasoningProfile(settings) ?? 'standard'
}

export function getConfiguredExecutionProfile(
  settings: Pick<SettingsJson, 'executionProfile'>,
): ExecutionProfile {
  if (settings.executionProfile && isExecutionProfile(settings.executionProfile)) {
    return settings.executionProfile
  }
  return 'coding'
}

export function getCurrentReasoningProfile(
  appStateEffort: EffortValue | undefined,
  settings: Pick<SettingsJson, 'reasoningProfile' | 'effortLevel'>,
): ReasoningProfile {
  if (appStateEffort !== undefined) {
    return effortValueToReasoningProfile(appStateEffort)
  }
  return getConfiguredReasoningProfile(settings)
}

export function getExplicitPersistedReasoningEffort(
  settings: Pick<SettingsJson, 'reasoningProfile' | 'effortLevel'>,
): EffortLevel | undefined {
  const profile = getExplicitReasoningProfile(settings)
  return profile ? reasoningProfileToEffort(profile) : undefined
}
