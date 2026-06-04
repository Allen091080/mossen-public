import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/config/dynamicConfig.js'
import { getRateLimitTier, getSubscriptionType } from './auth.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isInternalOperatorMode } from './internalUserMode.js'

const PLAN_MODE_INTERVIEW_PHASE_KEY =
  'mossen.permission.planModeInterviewPhaseEnabled'
const PEWTER_LEDGER_VARIANT_KEY = 'mossen.permission.pewterLedgerVariant'

export function getPlanModeV2AgentCount(): number {
  // Environment variable override takes precedence
  if (process.env.MOSSEN_CODE_PLAN_V2_AGENT_COUNT) {
    const count = parseInt(process.env.MOSSEN_CODE_PLAN_V2_AGENT_COUNT, 10)
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }

  const subscriptionType = getSubscriptionType()
  const rateLimitTier = getRateLimitTier()

  if (
    subscriptionType === 'max' &&
    rateLimitTier === 'default_mossen_max_20x'
  ) {
    return 3
  }

  if (subscriptionType === 'enterprise' || subscriptionType === 'team') {
    return 3
  }

  return 1
}

export function getPlanModeV2ExploreAgentCount(): number {
  if (process.env.MOSSEN_CODE_PLAN_V2_EXPLORE_AGENT_COUNT) {
    const count = parseInt(
      process.env.MOSSEN_CODE_PLAN_V2_EXPLORE_AGENT_COUNT,
      10,
    )
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }

  return 3
}

/**
 * Check if plan mode interview phase is enabled.
 *
 * Config: internal builds always on, external builds use the native plan-mode
 * interview gate, and the env var can force either direction.
 */
export function isPlanModeInterviewPhaseEnabled(): boolean {
  // Always on for internal dogfood builds.
  if (isInternalOperatorMode()) return true

  const env = process.env.MOSSEN_CODE_PLAN_MODE_INTERVIEW_PHASE
  if (isEnvTruthy(env)) return true
  if (isEnvDefinedFalsy(env)) return false

  return getFeatureValue_CACHED_MAY_BE_STALE(
    PLAN_MODE_INTERVIEW_PHASE_KEY,
    false,
  )
}

export type PewterLedgerVariant = 'trim' | 'cut' | 'cap' | null

/**
 * Plan-file structure prompt experiment.
 *
 * Controls the Phase 4 "Final Plan" bullets in the 5-phase plan mode
 * workflow (messages.ts getPlanPhase4Section). 5-phase is 99% of plan
 * traffic; interview-phase internal dogfood is untouched as a reference
 * population.
 *
 * Arms: null (control), 'trim', 'cut', 'cap' — progressively stricter
 * guidance on plan file size.
 *
 * Baseline (control, 14d ending 2026-03-02, N=26.3M):
 *   p50 4,906 chars | p90 11,617 | mean 6,207 | 82% Opus 4.6
 *   Reject rate monotonic with size: 20% at <2K → 50% at 20K+
 *
 * Primary: session-level Avg Cost — Opus output is 5× input price so cost is
 *   an output-weighted proxy. plan length on exit is the mechanism but NOT
 *   the goal — the cap arm
 *   could shrink the plan file while increasing total output via
 *   write→count→edit cycles.
 * Guardrail: feedback-bad rate, requests/session (too-thin plans →
 *   more implementation iterations), tool error rate
 */
export function getPewterLedgerVariant(): PewterLedgerVariant {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<string | null>(
    PEWTER_LEDGER_VARIANT_KEY,
    null,
  )
  if (raw === 'trim' || raw === 'cut' || raw === 'cap') return raw
  return null
}
