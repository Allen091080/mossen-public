import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from 'src/services/config/dynamicConfig.js'
import { getIsNonInteractiveSession, getSdkBetas } from '../bootstrap/state.js'
import {
  BEDROCK_EXTRA_PARAMS_HEADERS,
  MOSSEN_CODE_20250219_BETA_HEADER,
  CLI_INTERNAL_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER,
  TOKEN_EFFICIENT_TOOLS_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_1P,
  TOOL_SEARCH_BETA_HEADER_3P,
  WEB_SEARCH_BETA_HEADER,
} from '../constants/betas.js'
import { OAUTH_BETA_HEADER } from '../constants/oauth.js'
import { isHostedSubscriber } from './auth.js'
import { has1mContext } from './context.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isInternalOperatorMode } from './internalUserMode.js'
import { getCanonicalName } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getAPIProvider } from './model/providers.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * SDK-provided betas that are allowed for API key users.
 * Only betas in this list can be passed via SDK options.
 */
const ALLOWED_SDK_BETAS = [CONTEXT_1M_BETA_HEADER]
const AUTO_MODE_CONFIG_KEY = 'mossen.ui.autoModeConfig'
const CONNECTOR_TEXT_SUMMARIZATION_GATE =
  'mossen.sdk.agentProgressSummariesEnabled'
const STRICT_TOOL_USE_GATE = 'mossen.tool.strictSchemaEnabled'
const LEGACY_CONFIG_PREFIX = 'ten' + 'gu_'
const TOKEN_EFFICIENT_TOOLS_GATE = `${LEGACY_CONFIG_PREFIX}amber_json_tools`

/**
 * Filter betas to only include those in the allowlist.
 * Returns allowed and disallowed betas separately.
 */
function partitionBetasByAllowlist(betas: string[]): {
  allowed: string[]
  disallowed: string[]
} {
  const allowed: string[] = []
  const disallowed: string[] = []
  for (const beta of betas) {
    if (ALLOWED_SDK_BETAS.includes(beta)) {
      allowed.push(beta)
    } else {
      disallowed.push(beta)
    }
  }
  return { allowed, disallowed }
}

/**
 * Filter SDK betas to only include allowed ones.
 * Warns about disallowed betas and subscriber restrictions.
 * Returns undefined if no valid betas remain or if user is a subscriber.
 */
export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  if (!sdkBetas || sdkBetas.length === 0) {
    return undefined
  }

  if (isHostedSubscriber()) {
    // biome-ignore lint/suspicious/noConsole: intentional warning
    console.warn(
      'Warning: Custom betas are only available for API key users. Ignoring provided betas.',
    )
    return undefined
  }

  const { allowed, disallowed } = partitionBetasByAllowlist(sdkBetas)
  for (const beta of disallowed) {
    // biome-ignore lint/suspicious/noConsole: intentional warning
    console.warn(
      `Warning: Beta header '${beta}' is not allowed. Only the following betas are supported: ${ALLOWED_SDK_BETAS.join(', ')}`,
    )
  }
  return allowed.length > 0 ? allowed : undefined
}

// Generally, foundry supports all 1P features;
// however out of an abundance of caution, we do not enable any which are behind an experiment

export function modelSupportsISP(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(
    model,
    'interleaved_thinking',
  )
  if (supported3P !== undefined) {
    return supported3P
  }
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  // Foundry supports interleaved thinking for all models
  if (provider === 'foundry') {
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('mossen-3-')
  }
  return (
    canonical.includes('mossen-opus-4') ||
    canonical.includes('mossen-sonnet-4')
  )
}

function vertexModelSupportsWebSearch(model: string): boolean {
  const canonical = getCanonicalName(model)
  // Web search only supported on Mossen 4.0+ provider models on Vertex.
  return (
    canonical.includes('mossen-opus-4') ||
    canonical.includes('mossen-sonnet-4') ||
    canonical.includes('mossen-haiku-4')
  )
}

// Context management is supported on Mossen 4+ models.
export function modelSupportsContextManagement(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  if (provider === 'foundry') {
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('mossen-3-')
  }
  return (
    canonical.includes('mossen-opus-4') ||
    canonical.includes('mossen-sonnet-4') ||
    canonical.includes('mossen-haiku-4')
  )
}

// @[MODEL LAUNCH]: Add the new model ID to this list if it supports structured outputs.
export function modelSupportsStructuredOutputs(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  // Structured outputs only supported on firstParty and Foundry (not Bedrock/Vertex yet)
  if (provider !== 'firstParty' && provider !== 'foundry') {
    return false
  }
  return (
    canonical.includes('mossen-sonnet-4-6') ||
    canonical.includes('mossen-sonnet-4-5') ||
    canonical.includes('mossen-opus-4-1') ||
    canonical.includes('mossen-opus-4-5') ||
    canonical.includes('mossen-opus-4-6') ||
    canonical.includes('mossen-haiku-4-5')
  )
}

// @[MODEL LAUNCH]: Add the new model if it supports auto mode (specifically PI probes) — ask in #proj-mossen-code-safety-research.
export function modelSupportsAutoMode(model: string): boolean {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const m = getCanonicalName(model)
    // External: firstParty-only at launch (PI probes not wired for
    // Bedrock/Vertex/Foundry yet). Checked before allowModels so the remote
    // override can't enable auto mode on unsupported providers.
    if (!isInternalOperatorMode() && getAPIProvider() !== 'firstParty') {
      return false
    }
    // Remote-config override: autoModeConfig.allowModels force-enables
    // auto mode for listed models, bypassing the denylist/allowlist below.
    // Exact model IDs (e.g. "mossen-strudel-v6-p") match only that model;
    // canonical names (e.g. "mossen-strudel") match the whole family.
    const config = getFeatureValue_CACHED_MAY_BE_STALE<{
      allowModels?: string[]
    }>(AUTO_MODE_CONFIG_KEY, {})
    const rawLower = model.toLowerCase()
    if (
      config?.allowModels?.some(
        am => am.toLowerCase() === rawLower || am.toLowerCase() === m,
      )
    ) {
      return true
    }
    if (isInternalOperatorMode()) {
      // Denylist: block known-unsupported Mossen models, allow internal models.
      if (m.includes('mossen-3-')) return false
      // mossen-*-4 not followed by -[6-9]: blocks bare -4, dated -4, and -4-0 thru -4-5.
      if (/mossen-(opus|sonnet|haiku)-4(?!-[6-9])/.test(m)) return false
      return true
    }
    // External allowlist (firstParty already checked above).
    return /^mossen-(opus|sonnet)-4-6/.test(m)
  }
  return false
}

/**
 * Get the correct tool search beta header for the current API provider.
 * - Mossen API / Foundry: advanced-tool-use-2025-11-20
 * - Vertex AI / Bedrock: tool-search-tool-2025-10-19
 */
export function getToolSearchBetaHeader(): string {
  const provider = getAPIProvider()
  if (provider === 'vertex' || provider === 'bedrock') {
    return TOOL_SEARCH_BETA_HEADER_3P
  }
  return TOOL_SEARCH_BETA_HEADER_1P
}

/**
 * Check if experimental betas should be included.
 * These are betas that are only available on firstParty provider
 * and may not be supported by proxies or other providers.
 */
export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return (
    (getAPIProvider() === 'firstParty' || getAPIProvider() === 'foundry') &&
    !isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_EXPERIMENTAL_BETAS)
  )
}

/**
 * Global-scope prompt caching is firstParty only. Foundry is excluded because
 * The remote rollout never bucketed Foundry users into the experiment — the
 * treatment data is firstParty-only.
 */
export function shouldUseGlobalCacheScope(): boolean {
  return (
    getAPIProvider() === 'firstParty' &&
    !isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_EXPERIMENTAL_BETAS)
  )
}

export const getAllModelBetas = memoize((model: string): string[] => {
  const betaHeaders = []
  const isHaiku = getCanonicalName(model).includes('haiku')
  const provider = getAPIProvider()
  const includeFirstPartyOnlyBetas = shouldIncludeFirstPartyOnlyBetas()

  if (!isHaiku) {
    betaHeaders.push(MOSSEN_CODE_20250219_BETA_HEADER)
    if (
      isInternalOperatorMode() &&
      process.env.MOSSEN_CODE_ENTRYPOINT === 'cli'
    ) {
      if (CLI_INTERNAL_BETA_HEADER) {
        betaHeaders.push(CLI_INTERNAL_BETA_HEADER)
      }
    }
  }
  if (isHostedSubscriber()) {
    betaHeaders.push(OAUTH_BETA_HEADER)
  }
  if (has1mContext(model)) {
    betaHeaders.push(CONTEXT_1M_BETA_HEADER)
  }
  if (
    !isEnvTruthy(process.env.DISABLE_INTERLEAVED_THINKING) &&
    modelSupportsISP(model)
  ) {
    betaHeaders.push(INTERLEAVED_THINKING_BETA_HEADER)
  }

  // Skip the API-side Haiku thinking summarizer — the summary is only used
  // for ctrl+o display, which interactive users rarely open. The API returns
  // redacted_thinking blocks instead; AssistantRedactedThinkingMessage already
  // renders those as a stub. SDK / print-mode keep summaries because callers
  // may iterate over thinking content. Users can opt back in via settings.json
  // showThinkingSummaries.
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsISP(model) &&
    !getIsNonInteractiveSession() &&
    getInitialSettings().showThinkingSummaries !== true
  ) {
    betaHeaders.push(REDACT_THINKING_BETA_HEADER)
  }

  // POC: server-side connector-text summarization (anti-distillation). The
  // API buffers assistant text between tool calls, summarizes it, and returns
  // the summary with a signature so the original can be restored on subsequent
  // turns — same mechanism as thinking blocks. Internal-only while we measure
  // TTFT/TTLT/capacity; betas already flow to API success telemetry for splitting.
  // Backend independently requires the Mossen internal research capability.
  //
  // USE_CONNECTOR_TEXT_SUMMARIZATION is tri-state: =1 forces on (opt-in even
  // if remote rollout is off), =0 forces off (opt-out of a rollout you were
  // bucketed into), unset defers to remote config.
  if (
    SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER &&
    isInternalOperatorMode() &&
    includeFirstPartyOnlyBetas &&
    !isEnvDefinedFalsy(process.env.USE_CONNECTOR_TEXT_SUMMARIZATION) &&
    (isEnvTruthy(process.env.USE_CONNECTOR_TEXT_SUMMARIZATION) ||
      getFeatureValue_CACHED_MAY_BE_STALE(
        CONNECTOR_TEXT_SUMMARIZATION_GATE,
        false,
      ))
  ) {
    betaHeaders.push(SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER)
  }

  // Add context management beta for internal tool clearing opt-in or thinking preservation.
  const internalOptedIntoToolClearing =
    isEnvTruthy(process.env.USE_API_CONTEXT_MANAGEMENT) &&
    isInternalOperatorMode()

  const thinkingPreservationEnabled = modelSupportsContextManagement(model)

  if (
    shouldIncludeFirstPartyOnlyBetas() &&
    (internalOptedIntoToolClearing || thinkingPreservationEnabled)
  ) {
    betaHeaders.push(CONTEXT_MANAGEMENT_BETA_HEADER)
  }
  // Add strict tool use beta if experiment is enabled.
  // Gate on includeFirstPartyOnlyBetas: MOSSEN_CODE_DISABLE_EXPERIMENTAL_BETAS
  // already strips schema.strict from tool bodies at api.ts's choke point, but
  // this header was escaping that kill switch. Proxy gateways that look like
  // firstParty but forward to Vertex reject this header with 400.
  // See provider-compat issue #5.
  const strictToolsEnabled =
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE(STRICT_TOOL_USE_GATE)
  // 3P default: false. API rejects strict + token-efficient-tools together
  // (tool_use.py:139), so these are mutually exclusive — strict wins.
  const tokenEfficientToolsEnabled =
    !strictToolsEnabled &&
    getFeatureValue_CACHED_MAY_BE_STALE(TOKEN_EFFICIENT_TOOLS_GATE, false)
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsStructuredOutputs(model) &&
    strictToolsEnabled
  ) {
    betaHeaders.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }
  // JSON tool_use format (FC v3) — ~4.5% output token reduction vs ANTML.
  // Sends the v2 header (2026-03-28) to isolate the CC A/B cohort from
  // ~9.2M/week existing v1 senders. Internal-only
  // while the restored JsonToolUseOutputParser soaks.
  if (
    isInternalOperatorMode() &&
    includeFirstPartyOnlyBetas &&
    tokenEfficientToolsEnabled
  ) {
    betaHeaders.push(TOKEN_EFFICIENT_TOOLS_BETA_HEADER)
  }

  // Add web search beta for Vertex Mossen 4.0+ provider models only.
  if (provider === 'vertex' && vertexModelSupportsWebSearch(model)) {
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }
  // Foundry only ships models that already support Web Search
  if (provider === 'foundry') {
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }

  // Always send the beta header for 1P. The header is a no-op without a scope field.
  if (includeFirstPartyOnlyBetas) {
    betaHeaders.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // If MOSSEN_CODE_BETAS is set, split it by commas and add to betaHeaders.
  // This is an explicit user opt-in, so honor it regardless of model.
  if (process.env.MOSSEN_CODE_BETAS) {
    betaHeaders.push(
      ...process.env.MOSSEN_CODE_BETAS.split(',')
        .map(_ => _.trim())
        .filter(Boolean),
    )
  }
  return betaHeaders
})

export const getModelBetas = memoize((model: string): string[] => {
  const modelBetas = getAllModelBetas(model)
  if (getAPIProvider() === 'bedrock') {
    return modelBetas.filter(b => !BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  }
  return modelBetas
})

export const getBedrockExtraBodyParamsBetas = memoize(
  (model: string): string[] => {
    const modelBetas = getAllModelBetas(model)
    return modelBetas.filter(b => BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  },
)

/**
 * Merge SDK-provided betas with auto-detected model betas.
 * SDK betas are read from global state (set via setSdkBetas in main.tsx).
 * The betas are pre-filtered by filterAllowedSdkBetas which handles
 * subscriber checks and allowlist validation with warnings.
 *
 * @param options.isAgenticQuery - When true, ensures the beta headers needed
 *   for agentic queries are present. For non-fast-tier models these are already
 *   included by getAllModelBetas(); for the fast tier they're excluded since
 *   non-agentic calls (compaction, classifiers, token estimation) don't need them.
 */
export function getMergedBetas(
  model: string,
  options?: { isAgenticQuery?: boolean },
): string[] {
  const baseBetas = [...getModelBetas(model)]

  // Agentic queries always need mossen-code and cli-internal beta headers.
  // For non-fast-tier models these are already in baseBetas; for the fast tier they're
  // excluded by getAllModelBetas() since non-agentic fast-tier calls don't need them.
  if (options?.isAgenticQuery) {
    if (!baseBetas.includes(MOSSEN_CODE_20250219_BETA_HEADER)) {
      baseBetas.push(MOSSEN_CODE_20250219_BETA_HEADER)
    }
    if (
      isInternalOperatorMode() &&
      process.env.MOSSEN_CODE_ENTRYPOINT === 'cli' &&
      CLI_INTERNAL_BETA_HEADER &&
      !baseBetas.includes(CLI_INTERNAL_BETA_HEADER)
    ) {
      baseBetas.push(CLI_INTERNAL_BETA_HEADER)
    }
  }

  const sdkBetas = getSdkBetas()

  if (!sdkBetas || sdkBetas.length === 0) {
    return baseBetas
  }

  // Merge SDK betas without duplicates (already filtered by filterAllowedSdkBetas)
  return [...baseBetas, ...sdkBetas.filter(b => !baseBetas.includes(b))]
}

export function clearBetasCaches(): void {
  getAllModelBetas.cache?.clear?.()
  getModelBetas.cache?.clear?.()
  getBedrockExtraBodyParamsBetas.cache?.clear?.()
}
