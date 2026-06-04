import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/config/dynamicConfig.js'
import { isEnvTruthy } from './envUtils.js'
import { isInternalOperatorMode } from './internalUserMode.js'

/**
 * Check if --agent-teams flag is provided via CLI.
 * Checks process.argv directly to avoid import cycles with bootstrap/state.
 * Note: The flag is only shown in help for internal operators, but if external
 * users pass it anyway, it will work (subject to the killswitch).
 */
function isAgentTeamsFlagSet(): boolean {
  return process.argv.includes('--agent-teams')
}

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Internal builds: always enabled.
 * External builds require both:
 * 1. Opt-in via MOSSEN_CODE_EXPERIMENTAL_AGENT_TEAMS env var OR --agent-teams flag
 * 2. Local dynamic-config gate enabled (killswitch)
 */
export function isAgentSwarmsEnabled(): boolean {
  // Internal dogfood builds: always on
  if (isInternalOperatorMode()) {
    return true
  }

  // External: require opt-in via env var or --agent-teams flag
  if (
    !isEnvTruthy(process.env.MOSSEN_CODE_EXPERIMENTAL_AGENT_TEAMS) &&
    !isAgentTeamsFlagSet()
  ) {
    return false
  }

  // Killswitch — always respected for external users
  if (!getFeatureValue_CACHED_MAY_BE_STALE('mossen.agentSwarms.enabled', true)) {
    return false
  }

  return true
}
