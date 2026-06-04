// biome-ignore-all assist/source/organizeImports: internal import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isHostedSubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getCustomBackendModel, isCustomBackendEnabled } from '../customBackend.js'
import { getModelStrings } from './modelStrings.js'
import {
  COST_TIER_3_15,
  COST_HAIKU_35,
  COST_HAIKU_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getInternalModels } from './internalModels.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getHostedUserDefaultModelDescription,
  getDefaultSonnetModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  getOpus46PricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'
import { isInternalOperatorMode } from '../internalUserMode.js'
import { getLocalizedText } from '../uiLanguage.js'

// @[MODEL LAUNCH]: Update all available and default Mossen model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

function usesThirdPartyModelSurface(): boolean {
  return isCustomBackendEnabled() || getAPIProvider() !== 'firstParty'
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  const defaultLabel = getLocalizedText({
    en: 'Default (recommended)',
    zh: '默认（推荐）',
  })
  if (isInternalOperatorMode()) {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: defaultLabel,
      description: getLocalizedText({
        en: `Use the default model for internal users (currently ${currentModel})`,
        zh: `使用内部默认模型（当前为 ${currentModel}）`,
      }),
      descriptionForModel: getLocalizedText({
        en: `Default model (currently ${currentModel})`,
        zh: `默认模型（当前为 ${currentModel}）`,
      }),
    }
  }

  if (isCustomBackendEnabled()) {
    const customBackendModel = getCustomBackendModel()
    const currentModel = customBackendModel
      ? renderDefaultModelSetting(customBackendModel)
      : 'the configured backend default'
    return {
      value: null,
      label: defaultLabel,
      description: getLocalizedText({
        en: `Use the custom backend default (currently ${currentModel})`,
        zh: `使用自定义后端默认模型（当前为 ${currentModel}）`,
      }),
      descriptionForModel: getLocalizedText({
        en: `Custom backend default model (currently ${currentModel})`,
        zh: `自定义后端默认模型（当前为 ${currentModel}）`,
      }),
    }
  }

  // Subscribers
  if (isHostedSubscriber()) {
    return {
      value: null,
      label: defaultLabel,
      description: getHostedUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const is3P = usesThirdPartyModelSurface()
  return {
    value: null,
    label: defaultLabel,
    description: getLocalizedText({
      en: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
      zh: `使用默认模型（当前为 ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    }),
  }
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = usesThirdPartyModelSurface()
  const customSonnetModel = process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL
  // When a provider user has a custom balanced-tier model string, show it directly.
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    const defaultDescription = getLocalizedText({
      en: `Custom balanced model${is1m ? ' (1M context)' : ''}`,
      zh: `自定义均衡模型${is1m ? '（1M 上下文）' : ''}`,
    })
    return {
      value: 'sonnet',
      label:
        process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL_NAME ?? customSonnetModel,
      description:
        process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL_DESCRIPTION ??
        defaultDescription,
      descriptionForModel: `${process.env.MOSSEN_CODE_DEFAULT_SONNET_MODEL_DESCRIPTION ?? defaultDescription} (${customSonnetModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add option helpers with the new model labels and
// descriptions. These appear in the /model picker.
function getSonnet46Option(): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: is3P ? getModelStrings().sonnet46 : 'sonnet',
    label: 'Mossen Balanced',
    description: getLocalizedText({
      en: `Mossen Balanced 4.6 · Best for everyday tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
      zh: `Mossen Balanced 4.6 · 适合日常任务${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Balanced 4.6 - best for everyday tasks. Generally recommended for most coding tasks',
      zh: 'Mossen Balanced 4.6 - 适合日常任务，通常推荐用于大多数编码任务',
    }),
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = usesThirdPartyModelSurface()
  const customOpusModel = process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL
  // When a provider user has a custom frontier-tier model string, show it directly.
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    const defaultDescription = getLocalizedText({
      en: `Custom frontier model${is1m ? ' (1M context)' : ''}`,
      zh: `自定义前沿模型${is1m ? '（1M 上下文）' : ''}`,
    })
    return {
      value: 'opus',
      label: process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL_NAME ?? customOpusModel,
      description:
        process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL_DESCRIPTION ??
        defaultDescription,
      descriptionForModel: `${process.env.MOSSEN_CODE_DEFAULT_OPUS_MODEL_DESCRIPTION ?? defaultDescription} (${customOpusModel})`,
    }
  }
}

function getOpus41Option(): ModelOption {
  return {
    value: 'opus',
    label: 'Mossen Frontier 4.1',
    description: getLocalizedText({
      en: 'Mossen Frontier 4.1 · Legacy',
      zh: 'Mossen Frontier 4.1 · 旧版',
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Frontier 4.1 - legacy version',
      zh: 'Mossen Frontier 4.1 - 旧版',
    }),
  }
}

function getOpus46Option(fastMode = false): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: is3P ? getModelStrings().opus46 : 'opus',
    label: 'Mossen Frontier',
    description: getLocalizedText({
      en: `Mossen Frontier 4.6 · Most capable for complex work${getOpus46PricingSuffix(fastMode)}`,
      zh: `Mossen Frontier 4.6 · 最适合复杂任务${getOpus46PricingSuffix(fastMode)}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Frontier 4.6 - most capable for complex work',
      zh: 'Mossen Frontier 4.6 - 最适合复杂任务',
    }),
  }
}

export function getSonnet46_1MOption(): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: is3P ? getModelStrings().sonnet46 + '[1m]' : 'sonnet[1m]',
    label: getLocalizedText({
      en: 'Mossen Balanced (1M context)',
      zh: 'Mossen Balanced（1M 上下文）',
    }),
    description: getLocalizedText({
      en: `Mossen Balanced 4.6 for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
      zh: `Mossen Balanced 4.6 · 适合长会话${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Balanced 4.6 with 1M context window - for long sessions with large codebases',
      zh: 'Mossen Balanced 4.6 · 1M 上下文窗口，适合大型代码库的长会话',
    }),
  }
}

export function getOpus46_1MOption(fastMode = false): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'opus[1m]',
    label: getLocalizedText({
      en: 'Mossen Frontier (1M context)',
      zh: 'Mossen Frontier（1M 上下文）',
    }),
    description: getLocalizedText({
      en: `Mossen Frontier 4.6 for long sessions${getOpus46PricingSuffix(fastMode)}`,
      zh: `Mossen Frontier 4.6 · 适合长会话${getOpus46PricingSuffix(fastMode)}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Frontier 4.6 with 1M context window - for long sessions with large codebases',
      zh: 'Mossen Frontier 4.6 · 1M 上下文窗口，适合大型代码库的长会话',
    }),
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = usesThirdPartyModelSurface()
  const customHaikuModel = process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL
  // When a provider user has a custom fast-tier model string, show it directly.
  if (is3P && customHaikuModel) {
    const defaultDescription = getLocalizedText({
      en: 'Custom fast model',
      zh: '自定义快速模型',
    })
    return {
      value: 'haiku',
      label: process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL_NAME ?? customHaikuModel,
      description:
        process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL_DESCRIPTION ??
        defaultDescription,
      descriptionForModel: `${process.env.MOSSEN_CODE_DEFAULT_HAIKU_MODEL_DESCRIPTION ?? defaultDescription} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: 'haiku',
    label: 'Mossen Fast',
    description: getLocalizedText({
      en: `Mossen Fast 4.5 · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_45)}`}`,
      zh: `Mossen Fast 4.5 · 最适合快速回答${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_45)}`}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Fast 4.5 - fastest for quick answers. Lower cost but less capable than Mossen Balanced 4.6.',
      zh: 'Mossen Fast 4.5 - 最适合快速回答，成本更低，但能力弱于 Mossen Balanced 4.6。',
    }),
  }
}

function getHaiku35Option(): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: 'haiku',
    label: 'Mossen Fast',
    description: getLocalizedText({
      en: `Mossen Fast 3.5 for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_35)}`}`,
      zh: `Mossen Fast 3.5 · 适合简单任务${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_35)}`}`,
    }),
    descriptionForModel: getLocalizedText({
      en: 'Mossen Fast 3.5 - faster and lower cost, but less capable than Mossen Balanced. Use for simple tasks.',
      zh: 'Mossen Fast 3.5 - 更快且成本更低，但能力弱于 Mossen Balanced，适合简单任务。',
    }),
  }
}

function getHaikuOption(): ModelOption {
  // Return correct Haiku option based on provider
  const haikuModel = getDefaultHaikuModel()
  return haikuModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  return {
    value: 'opus',
    label: 'Mossen Frontier',
    description: `Mossen Frontier 4.6 · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`,
  }
}

export function getMaxSonnet46_1MOption(): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  const billingInfo = isHostedSubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'sonnet[1m]',
    label: 'Mossen Balanced (1M context)',
    description: `Mossen Balanced 4.6 with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

export function getMaxOpus46_1MOption(fastMode = false): ModelOption {
  const billingInfo = isHostedSubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'opus[1m]',
    label: 'Mossen Frontier (1M context)',
    description: `Mossen Frontier 4.6 with 1M context${billingInfo}${getOpus46PricingSuffix(fastMode)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = usesThirdPartyModelSurface()
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'opus[1m]',
    label: 'Mossen Frontier (1M context)',
    description: `Mossen Frontier 4.6 with 1M context · Most capable for complex work${!is3P && fastMode ? getOpus46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      'Mossen Frontier 4.6 with 1M context - most capable for complex work',
  }
}

const MaxSonnet46Option: ModelOption = {
  value: 'sonnet',
  label: 'Mossen Balanced',
  description: 'Mossen Balanced 4.6 · Best for everyday tasks',
}

const MaxHaiku45Option: ModelOption = {
  value: 'haiku',
  label: 'Mossen Fast',
  description: 'Mossen Fast 4.5 · Fastest for quick answers',
}

function getOpusPlanOption(): ModelOption {
  return {
    value: 'opusplan',
    label: 'Mossen Plan Mode',
    description: 'Use Mossen Frontier 4.6 in plan mode, Mossen Balanced 4.6 otherwise',
  }
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (isInternalOperatorMode()) {
    // Build options from internal model config.
    const internalModelOptions: ModelOption[] = getInternalModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[INTERNAL] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...internalModelOptions,
      getMergedOpus1MOption(fastMode),
      getSonnet46Option(),
      getSonnet46_1MOption(),
      getHaiku45Option(),
    ]
  }

  if (isCustomBackendEnabled()) {
    return [getDefaultOptionForUser(fastMode)]
  }

  if (isHostedSubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: Frontier is default, show Balanced as alternative.
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
        premiumOptions.push(getMaxOpus46_1MOption(fastMode))
      }

      premiumOptions.push(MaxSonnet46Option)
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet46_1MOption())
      }

      premiumOptions.push(MaxHaiku45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: Balanced is default, show Frontier as alternative.
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet46_1MOption())
    }

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption(fastMode))
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus46_1MOption(fastMode))
      }
    }

    standardOptions.push(MaxHaiku45Option)
    return standardOptions
  }

  // PAYG provider API: Default (Balanced) + Balanced 1M + Frontier + Fast.
  if (!usesThirdPartyModelSurface()) {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet46_1MOption())
    }
    if (isOpus1mMergeEnabled()) {
      payg1POptions.push(getMergedOpus1MOption(fastMode))
    } else {
      payg1POptions.push(getOpus46Option(fastMode))
      if (checkOpus1mAccess()) {
        payg1POptions.push(getOpus46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getHaiku45Option())
    return payg1POptions
  }

  // PAYG provider API: default Balanced + optional custom tier mappings.
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    // Add Balanced 4.6 since an older Balanced mapping can be the provider default.
    payg3pOptions.push(getSonnet46Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet46_1MOption())
    }
  }

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Add legacy/current Frontier mappings.
    payg3pOptions.push(getOpus41Option())
    payg3pOptions.push(getOpus46Option(fastMode))
    if (checkOpus1mAccess()) {
      payg3pOptions.push(getOpus46_1MOption(fastMode))
    }
  }
  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // Balanced family
  if (
    canonical.includes('mossen-sonnet-4-6') ||
    canonical.includes('mossen-sonnet-4-5') ||
    canonical.includes('mossen-sonnet-4-') ||
    canonical.includes('mossen-3-7-sonnet') ||
    canonical.includes('mossen-3-5-sonnet')
  ) {
    const currentName = getMarketingNameForModel(getDefaultSonnetModel())
    if (currentName) {
      return { alias: 'Mossen Balanced', currentVersionName: currentName }
    }
  }

  // Frontier family
  if (canonical.includes('mossen-opus-4')) {
    const currentName = getMarketingNameForModel(getDefaultOpusModel())
    if (currentName) {
      return { alias: 'Mossen Frontier', currentVersionName: currentName }
    }
  }

  // Fast family
  if (
    canonical.includes('mossen-haiku') ||
    canonical.includes('mossen-3-5-haiku')
  ) {
    const currentName = getMarketingNameForModel(getDefaultHaikuModel())
    if (currentName) {
      return { alias: 'Mossen Fast', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known public model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the MOSSEN_CODE_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.MOSSEN_CODE_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.MOSSEN_CODE_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.MOSSEN_CODE_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        getLocalizedText({
          en: `Custom model (${envCustomModel})`,
          zh: `自定义模型（${envCustomModel}）`,
        }),
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'opusplan') {
    return filterModelOptionsByAllowlist([...options, getOpusPlanOption()])
  } else if (customModel === 'opus' && !usesThirdPartyModelSurface()) {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxOpusOption(fastMode),
    ])
  } else if (customModel === 'opus[1m]' && !usesThirdPartyModelSurface()) {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedOpus1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known provider models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: getLocalizedText({
          en: 'Custom model',
          zh: '自定义模型',
        }),
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
