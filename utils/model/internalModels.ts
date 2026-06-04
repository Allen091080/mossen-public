import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/config/dynamicConfig.js'
import type { EffortLevel } from '../effort.js'
import { isInternalOperatorMode } from '../internalUserMode.js'

const INTERNAL_MODEL_OVERRIDE_CONFIG_KEY = 'mossen.model.internalOverride'

export type InternalModel = {
  alias: string
  model: string
  label: string
  description?: string
  defaultEffortValue?: number
  defaultEffortLevel?: EffortLevel
  contextWindow?: number
  defaultMaxTokens?: number
  upperMaxTokensLimit?: number
  /** Model defaults to adaptive thinking and rejects `thinking: { type: 'disabled' }`. */
  alwaysOnThinking?: boolean
}

export type InternalModelSwitchCalloutConfig = {
  modelAlias?: string
  description: string
  version: string
}

export type InternalModelOverrideConfig = {
  defaultModel?: string
  defaultModelEffortLevel?: EffortLevel
  defaultSystemPromptSuffix?: string
  internalModels?: InternalModel[]
  switchCallout?: InternalModelSwitchCalloutConfig
}

// @[MODEL LAUNCH]: Update the internal model override config with new models.
// @[MODEL LAUNCH]: Add any launch codename to scripts/excluded-strings.txt before shipping external builds.
export function getInternalModelOverrideConfig(): InternalModelOverrideConfig | null {
  if (!isInternalOperatorMode()) {
    return null
  }
  return getFeatureValue_CACHED_MAY_BE_STALE<InternalModelOverrideConfig | null>(
    INTERNAL_MODEL_OVERRIDE_CONFIG_KEY,
    null,
  )
}

export function getInternalModels(): InternalModel[] {
  if (!isInternalOperatorMode()) {
    return []
  }
  return getInternalModelOverrideConfig()?.internalModels ?? []
}

export function resolveInternalModel(
  model: string | undefined,
): InternalModel | undefined {
  if (!isInternalOperatorMode()) {
    return undefined
  }
  if (model === undefined) {
    return undefined
  }
  const lower = model.toLowerCase()
  return getInternalModels().find(
    m => m.alias === model || lower.includes(m.model.toLowerCase()),
  )
}
