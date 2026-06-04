import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/config/dynamicConfig.js'
import { isCustomVoiceEnabled } from '../utils/customBackend.js'
import {
  getHostedOAuthTokens,
  isMossenHostedAuthEnabled,
} from '../utils/auth.js'

/**
 * Kill-switch check for voice mode. Returns true unless the
 * local voice-disabled gate is flipped on (emergency
 * off). Default `false` means a missing/stale disk cache reads as "not
 * killed" — so fresh installs get voice working immediately without
 * waiting for remote config. Use this for deciding whether voice mode
 * should be *visible* (e.g., command registration, config UI).
 */
export function isVoiceRolloutEnabled(): boolean {
  // Positive ternary pattern — see docs/feature-gating.md.
  // Negative pattern (if (!feature(...)) return) does not eliminate
  // inline string literals from external builds.
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('mossen.voice.disabled', false)
    : false
}

/**
 * Auth-only check for voice mode. Returns true when the user has a configured
 * custom voice backend or an explicit hosted voice adapter token. Backed by the memoized getHostedOAuthTokens —
 * first call spawns `security` on macOS (~20-50ms), subsequent calls are
 * cache hits. The memoize clears on token refresh (~once/hour), so one
 * cold spawn per refresh is expected. Cheap enough for usage-time checks.
 */
export function hasVoiceAuth(): boolean {
  if (isCustomVoiceEnabled()) {
    return true
  }

  // Hosted voice is an explicit external adapter path. It is not part of the
  // default Mossen auth flow and is not available through plain API keys,
  // Bedrock, Vertex, or Foundry.
  if (!isMossenHostedAuthEnabled()) {
    return false
  }
  // isMossenHostedAuthEnabled only checks the auth *provider*, not whether
  // a token exists. Without this check, the voice UI renders but
  // connectVoiceStream fails silently when the user isn't logged in.
  const tokens = getHostedOAuthTokens()
  return Boolean(tokens?.accessToken)
}

/**
 * Full runtime check: auth + local kill-switch. Callers: `/voice`
 * (voice.ts, voice/index.ts), ConfigTool, VoiceModeNotice — command-time
 * paths where a fresh keychain read is acceptable. For React render
 * paths use useVoiceEnabled() instead (memoizes the auth half).
 */
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceRolloutEnabled()
}
