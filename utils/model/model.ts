// biome-ignore-all assist/source/organizeImports: Mossen internal import markers must not be reordered
/**
 * Ensure that any model codenames introduced here are also added to
 * scripts/excluded-strings.txt to avoid leaking them. Wrap any codename string
 * literals with build-time internal-user checks so Bun removes codenames during
 * dead code elimination.
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getCustomBackendModel, isCustomBackendEnabled } from '../customBackend.js'
import {
  getSubscriptionType,
  isHostedSubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import {
  has1mContext,
  is1mContextDisabled,
  modelSupports1M,
} from '../context.js'
import { isEnvTruthy } from '../envUtils.js'
import { isInternalOperatorMode } from '../internalUserMode.js'
import { getModelStrings, resolveOverriddenModel } from './modelStrings.js'
import { formatModelPricing, getOpus46CostTier } from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getAPIProvider } from './providers.js'
import { LIGHTNING_BOLT } from '../../constants/figures.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import {
  getInternalModelOverrideConfig,
  resolveInternalModel,
} from './internalModels.js'
import { capitalize } from '../stringUtils.js'
import { LEGACY_OPUS_FIRSTPARTY_MODEL_IDS } from './mossenCatalog.js'
import {
  externalProviderModelPrefix,
  externalProviderModelStemFromMossenId,
  externalProviderModelStemPattern,
} from './externalProviderIds.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

function getCustomBackendDefaultModel(): ModelName | null {
  if (!isCustomBackendEnabled()) {
    return null
  }
  return getCustomBackendModel() || null
}

export function getSmallFastModel(): ModelName {
  return (
    process.env.MOSSEN_CODE_SMALL_FAST_MODEL ||
    getCustomBackendDefaultModel() ||
    getDefaultHaikuModel()
  )
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  return (
    model === getModelStrings().opus40 ||
    model === getModelStrings().opus41 ||
    model === getModelStrings().opus45 ||
    model === getModelStrings().opus46
  )
}

/**
 * Helper to get the model from /model (including via /config), the --model flag, environment variable,
 * or the saved settings. The returned value can be a model alias if that's what the user specified.
 * Undefined if the user didn't configure anything, in which case we fall back to
 * the default (null).
 *
 * Priority order within this function:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. MOSSEN_CODE_MODEL environment variable
 * 4. Settings (from user's saved settings)
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    specifiedModel =
      getCustomBackendModel() ||
      process.env.MOSSEN_CODE_MODEL ||
      settings.model ||
      undefined
  }

  // Ignore the user-specified model if it's not in the availableModels allowlist.
  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

/**
 * Get the main loop model to use for the current session.
 *
 * Model Selection Priority Order:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. MOSSEN_CODE_MODEL environment variable
 * 4. Settings (from user's saved settings)
 * 5. Built-in default
 *
 * @returns The resolved model name to use
 */
export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultOpusModel()
}

// @[MODEL LAUNCH]: Update the default Frontier model.
export function getDefaultOpusModel(): ModelName {
  const customBackendModel = getCustomBackendDefaultModel()
  if (customBackendModel) {
    return customBackendModel
  }
  if (process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL) {
    return process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL
  }
  // 3P providers (Bedrock, Vertex, Foundry) — kept as a separate branch
  // even when values match, since 3P availability lags firstParty and
  // these will diverge again at the next model launch.
  if (isCustomBackendEnabled() || getAPIProvider() !== 'firstParty') {
    return getModelStrings().opus46
  }
  return getModelStrings().opus46
}

// @[MODEL LAUNCH]: Update the default Balanced model.
export function getDefaultSonnetModel(): ModelName {
  const customBackendModel = getCustomBackendDefaultModel()
  if (customBackendModel) {
    return customBackendModel
  }
  if (process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL) {
    return process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL
  }
  // Default to Balanced 4.5 for providers that may not have 4.6 yet.
  if (isCustomBackendEnabled() || getAPIProvider() !== 'firstParty') {
    return getModelStrings().sonnet45
  }
  return getModelStrings().sonnet46
}

// @[MODEL LAUNCH]: Update the default Fast model.
export function getDefaultHaikuModel(): ModelName {
  const customBackendModel = getCustomBackendDefaultModel()
  if (customBackendModel) {
    return customBackendModel
  }
  if (process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL) {
    return process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL
  }

  // Fast 4.5 is available on all bundled provider adapters.
  return getModelStrings().haiku45
}

/**
 * Get the model to use for runtime, depending on the runtime context.
 * @param params Subset of the runtime context to determine the model to use.
 * @returns The model to use
 */
export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  const { permissionMode, mainLoopModel, exceeds200kTokens = false } = params

  // opusplan uses the Frontier tier in plan mode without [1m] suffix.
  if (
    getUserSpecifiedModelSetting() === 'opusplan' &&
    permissionMode === 'plan' &&
    !exceeds200kTokens
  ) {
    return getDefaultOpusModel()
  }

  // Fast interactive mode still plans with the Balanced tier by default.
  if (getUserSpecifiedModelSetting() === 'haiku' && permissionMode === 'plan') {
    return getDefaultSonnetModel()
  }

  return mainLoopModel
}

/**
 * Get the default main loop model setting.
 *
 * This handles the built-in default:
 * - Frontier for Max and Team Premium users
 * - Balanced 4.6 for all other users (including Team Standard, Pro, Enterprise)
 *
 * @returns The default model setting to use
 */
export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  // Internal users default to flag config, or Frontier 1M if not configured.
  if (isInternalOperatorMode()) {
    return (
      getInternalModelOverrideConfig()?.defaultModel ??
      getDefaultOpusModel() + '[1m]'
    )
  }

  // Max users get Frontier as default.
  if (isMaxSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // Team Premium gets Frontier (same as Max).
  if (isTeamPremiumSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // PAYG/provider, Enterprise, Team Standard, and Pro get Balanced as default.
  return getDefaultSonnetModel()
}

/**
 * Synchronous operation to get the default main loop model to use
 * (bypassing any user-specified values).
 */
export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

// @[MODEL LAUNCH]: Add a canonical name mapping for the new model below.
function getCanonicalModelPatterns(): ReadonlyArray<{
  canonical: ModelShortName
  firstPartyNeedles: readonly string[]
  externalProviderNeedles: readonly string[]
}> {
  return [
    'mossen-opus-4-6',
    'mossen-opus-4-5',
    'mossen-opus-4-1',
    'mossen-opus-4',
    'mossen-sonnet-4-6',
    'mossen-sonnet-4-5',
    'mossen-sonnet-4',
    'mossen-haiku-4-5',
    'mossen-3-7-sonnet',
    'mossen-3-5-sonnet',
    'mossen-3-5-haiku',
    'mossen-3-opus',
    'mossen-3-sonnet',
    'mossen-3-haiku',
  ].map(canonical => ({
    canonical,
    firstPartyNeedles: [canonical],
    externalProviderNeedles: [
      externalProviderModelStemFromMossenId(canonical),
    ],
  }))
}

/**
 * Pure string-match that strips date/provider suffixes to a Mossen canonical
 * model name. External provider IDs are normalized here so the rest of the app
 * can reason in Mossen model fixtures. Does not touch settings, so safe at
 * module top-level (see MODEL_COSTS in modelCost.ts).
 */
export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  name = name.toLowerCase()
  for (const pattern of getCanonicalModelPatterns()) {
    const needles = [
      ...pattern.firstPartyNeedles,
      ...pattern.externalProviderNeedles,
    ]
    if (needles.some(needle => name.includes(needle))) {
      return pattern.canonical
    }
  }
  const mossenMatch = name.match(/(mossen-[a-z0-9]+(?:-[a-z0-9]+)*)/)
  if (mossenMatch?.[1]) {
    return mossenMatch[1]
  }
  const externalProviderMatch = name.match(externalProviderModelStemPattern())
  if (externalProviderMatch?.[1]) {
    return externalProviderMatch[1].replace(
      `${externalProviderModelPrefix()}-`,
      'mossen-',
    )
  }
  // Fall back to the original name if no pattern matches
  return name
}

/**
 * Maps a full model string to a shorter Mossen canonical version that's unified
 * across first-party and external providers. For example, dated first-party IDs
 * and provider-specific IDs for the same model family map to the same canonical
 * short name.
 * @param fullModelName The full model name
 * @returns The short canonical name if found, or the original name if no mapping exists
 */
export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  // Resolve overridden model IDs (e.g. Bedrock ARNs) back to canonical names.
  // Provider-shaped IDs are normalized to Mossen canonical names at this boundary.
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

// @[MODEL LAUNCH]: Update the default model description strings shown to users.
export function getHostedUserDefaultModelDescription(
  fastMode = false,
): string {
  if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
    if (isOpus1mMergeEnabled()) {
      return `Mossen Frontier 4.6 with 1M context · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
    }
    return `Mossen Frontier 4.6 · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
  }
  return 'Mossen Balanced 4.6 · Best for everyday tasks'
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  if (setting === 'opusplan') {
    return 'Mossen Frontier 4.6 in plan mode, else Mossen Balanced 4.6'
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

export function getOpus46PricingSuffix(fastMode: boolean): string {
  if (getAPIProvider() !== 'firstParty') return ''
  const pricing = formatModelPricing(getOpus46CostTier(fastMode))
  const fastModeIndicator = fastMode ? ` (${LIGHTNING_BOLT})` : ''
  return ` ·${fastModeIndicator} ${pricing}`
}

export function isOpus1mMergeEnabled(): boolean {
  if (
    is1mContextDisabled() ||
    isProSubscriber() ||
    getAPIProvider() !== 'firstParty'
  ) {
    return false
  }
  // Fail closed when a subscriber's subscription type is unknown. The VS Code
  // config-loading subprocess can have OAuth tokens with valid scopes but no
  // subscriptionType field (stale or partial refresh). Without this guard,
  // isProSubscriber() returns false for such users and the merge leaks
  // opus[1m] into the model dropdown — the API then rejects it with a
  // misleading "rate limit reached" error.
  if (isHostedSubscriber() && getSubscriptionType() === null) {
    return false
  }
  return true
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Mossen Plan'
  }
  if (setting === 'opus') {
    return 'Mossen Frontier'
  }
  if (setting === 'sonnet') {
    return 'Mossen Balanced'
  }
  if (setting === 'haiku') {
    return 'Mossen Fast'
  }
  if (isModelAlias(setting)) {
    return capitalize(setting)
  }
  return renderModelName(setting)
}

// @[MODEL LAUNCH]: Add display name cases for the new model (base + [1m] variant if applicable).
/**
 * Returns a human-readable display name for known public models, or null
 * if the model is not recognized as a public model.
 */
export function getPublicModelDisplayName(model: ModelName): string | null {
  switch (model) {
    case getModelStrings().opus46:
      return 'Mossen Frontier 4.6'
    case getModelStrings().opus46 + '[1m]':
      return 'Mossen Frontier 4.6 (1M context)'
    case getModelStrings().opus45:
      return 'Mossen Frontier 4.5'
    case getModelStrings().opus41:
      return 'Mossen Frontier 4.1'
    case getModelStrings().opus40:
      return 'Mossen Frontier 4'
    case getModelStrings().sonnet46 + '[1m]':
      return 'Mossen Balanced 4.6 (1M context)'
    case getModelStrings().sonnet46:
      return 'Mossen Balanced 4.6'
    case getModelStrings().sonnet45 + '[1m]':
      return 'Mossen Balanced 4.5 (1M context)'
    case getModelStrings().sonnet45:
      return 'Mossen Balanced 4.5'
    case getModelStrings().sonnet40:
      return 'Mossen Balanced 4'
    case getModelStrings().sonnet40 + '[1m]':
      return 'Mossen Balanced 4 (1M context)'
    case getModelStrings().sonnet37:
      return 'Mossen Balanced 3.7'
    case getModelStrings().sonnet35:
      return 'Mossen Balanced 3.5'
    case getModelStrings().haiku45:
      return 'Mossen Fast 4.5'
    case getModelStrings().haiku35:
      return 'Mossen Fast 3.5'
    default:
      return null
  }
}

function maskModelCodename(baseName: string): string {
  // Mask only the first dash-separated segment (the codename), preserve the rest
  // e.g. capybara-v2-fast → cap*****-v2-fast
  const [codename = '', ...rest] = baseName.split('-')
  const masked =
    codename.slice(0, 3) + '*'.repeat(Math.max(0, codename.length - 3))
  return [masked, ...rest].join('-')
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  if (isInternalOperatorMode()) {
    const resolved = parseUserSpecifiedModel(model)
    const internalModel = resolveInternalModel(model)
    if (internalModel) {
      const baseName = internalModel.model.replace(/\[1m\]$/i, '')
      const masked = maskModelCodename(baseName)
      const suffix = has1mContext(resolved) ? '[1m]' : ''
      return masked + suffix
    }
    if (resolved !== model) {
      return `${model} (${resolved})`
    }
    return resolved
  }
  return model
}

/**
 * Returns a safe author name for public display (e.g., in git commit trailers).
 * Returns "Mossen {ModelName}" for publicly known models, or "Mossen ({model})"
 * for unknown/internal models so the exact model name is preserved.
 *
 * @param model The full model name
 * @returns the Mossen public model name, or "Mossen ({model})" for non-public models
 */
export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName.startsWith('Mossen ') ? publicName : `Mossen ${publicName}`
  }
  return `Mossen (${model})`
}

/**
 * Returns a full model name for use in this session, possibly after resolving
 * a model alias.
 *
 * This function intentionally does not support version numbers to align with
 * the model switcher.
 *
 * Supports [1m] suffix on any model alias (e.g., haiku[1m], sonnet[1m]) to enable
 * 1M context window without requiring each variant to be in MODEL_ALIASES.
 *
 * @param modelInput The model alias or name provided by the user.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = modelInput.trim()
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'opusplan':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '') // Balanced is default, Frontier in plan mode.
      case 'sonnet':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':
        return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
      case 'opus':
        return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
      case 'best':
        return getBestModel()
      default:
    }
  }

  // Legacy Frontier 4/4.1 IDs are no longer available on the hosted adapter,
  // so silently remap to the current Frontier default. The 'opus'
  // alias already resolves to 4.6, so the only users on these explicit
  // strings pinned them in settings/env/--model/SDK before 4.5 launched.
  // 3P providers may not yet have 4.6 capacity, so pass through unchanged.
  if (
    !isCustomBackendEnabled() &&
    getAPIProvider() === 'firstParty' &&
    isLegacyOpusFirstParty(modelString) &&
    isLegacyModelRemapEnabled()
  ) {
    return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
  }

  if (isInternalOperatorMode()) {
    const has1mInternalTag = has1mContext(normalizedModel)
    const baseInternalModel = normalizedModel.replace(/\[1m]$/i, '').trim()

    const internalModel = resolveInternalModel(baseInternalModel)
    if (internalModel) {
      const suffix = has1mInternalTag ? '[1m]' : ''
      return internalModel.model + suffix
    }

    // Fall through to the alias string if we cannot load the config. The API calls
    // will fail with this string, but we should hear about it through feedback and
    // can tell the user to restart/wait for flag cache refresh to get the latest values.
  }

  // Preserve original case for custom model names (e.g., Azure Foundry deployment IDs)
  // Only strip [1m] suffix if present, maintaining case of the base model
  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

/**
 * Resolves a skill's `model:` frontmatter against the current model, carrying
 * the `[1m]` suffix over when the target family supports it.
 *
 * A skill author writing `model: opus` means "use frontier-tier reasoning" — not
 * "downgrade to 200K". If the user is on opus[1m] at 230K tokens and invokes a
 * skill with `model: opus`, passing the bare alias through drops the effective
 * context window from 1M to 200K, which trips autocompact at 23% apparent usage
 * and surfaces "Context limit reached" even though nothing overflowed.
 *
 * We only carry [1m] when the target actually supports it (balanced/frontier). A skill
 * with `model: haiku` on a 1M session still downgrades — the fast tier has no 1M variant,
 * so the autocompact that follows is correct. Skills that already specify [1m]
 * are left untouched.
 */
export function resolveSkillModelOverride(
  skillModel: string,
  currentModel: string,
): string {
  if (has1mContext(skillModel) || !has1mContext(currentModel)) {
    return skillModel
  }
  // modelSupports1M matches on canonical IDs.
  // a bare frontier alias falls through getCanonicalName unmatched. Resolve first.
  if (modelSupports1M(parseUserSpecifiedModel(skillModel))) {
    return skillModel + '[1m]'
  }
  return skillModel
}

function isLegacyOpusFirstParty(model: string): boolean {
  return LEGACY_OPUS_FIRSTPARTY_MODEL_IDS.includes(
    model as (typeof LEGACY_OPUS_FIRSTPARTY_MODEL_IDS)[number],
  )
}

/**
 * Opt-out for the legacy Frontier 4.0/4.1 → current Frontier remap.
 */
export function isLegacyModelRemapEnabled(): boolean {
  return !isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_LEGACY_MODEL_REMAP)
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    if (isInternalOperatorMode()) {
      return `Default for internal users (${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`
    } else if (isHostedSubscriber()) {
      return `Default (${getHostedUserDefaultModelDescription()})`
    }
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

// @[MODEL LAUNCH]: Add a marketing name mapping for the new model below.
export function getMarketingNameForModel(modelId: string): string | undefined {
  if (getAPIProvider() === 'foundry') {
    // deployment ID is user-defined in Foundry, so it may have no relation to the actual model
    return undefined
  }

  const has1m = modelId.toLowerCase().includes('[1m]')
  const canonical = getCanonicalName(modelId)

  if (canonical.includes('mossen-opus-4-6')) {
    return has1m
      ? 'Mossen Frontier 4.6 (with 1M context)'
      : 'Mossen Frontier 4.6'
  }
  if (canonical.includes('mossen-opus-4-5')) {
    return 'Mossen Frontier 4.5'
  }
  if (canonical.includes('mossen-opus-4-1')) {
    return 'Mossen Frontier 4.1'
  }
  if (canonical.includes('mossen-opus-4')) {
    return 'Mossen Frontier 4'
  }
  if (canonical.includes('mossen-sonnet-4-6')) {
    return has1m
      ? 'Mossen Balanced 4.6 (with 1M context)'
      : 'Mossen Balanced 4.6'
  }
  if (canonical.includes('mossen-sonnet-4-5')) {
    return has1m
      ? 'Mossen Balanced 4.5 (with 1M context)'
      : 'Mossen Balanced 4.5'
  }
  if (canonical.includes('mossen-sonnet-4')) {
    return has1m
      ? 'Mossen Balanced 4 (with 1M context)'
      : 'Mossen Balanced 4'
  }
  if (canonical.includes('mossen-3-7-sonnet')) {
    return 'Mossen Balanced 3.7'
  }
  if (canonical.includes('mossen-3-5-sonnet')) {
    return 'Mossen Balanced 3.5'
  }
  if (canonical.includes('mossen-haiku-4-5')) {
    return 'Mossen Fast 4.5'
  }
  if (canonical.includes('mossen-3-5-haiku')) {
    return 'Mossen Fast 3.5'
  }

  return undefined
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
