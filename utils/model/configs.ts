import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'
import {
  externalBedrockModelId,
  externalFoundryModelId,
  externalVertexModelId,
} from './externalProviderIds.js'

/**
 * firstParty is the Mossen-owned fixture ID. The other fields are raw external
 * provider model IDs and intentionally stay provider-shaped at the adapter boundary.
 */
export type ModelConfig = Record<APIProvider, ModelName>

// @[MODEL LAUNCH]: Add a new MOSSEN_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const MOSSEN_3_7_SONNET_CONFIG = {
  firstParty: 'mossen-3-7-sonnet-20250219',
  bedrock: externalBedrockModelId('3-7-sonnet', {
    region: 'us',
    date: '20250219',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('3-7-sonnet', { date: '20250219' }),
  foundry: externalFoundryModelId('3-7-sonnet'),
} as const satisfies ModelConfig

export const MOSSEN_3_5_V2_SONNET_CONFIG = {
  firstParty: 'mossen-3-5-sonnet-20241022',
  bedrock: externalBedrockModelId('3-5-sonnet', {
    date: '20241022',
    variant: 'v2:0',
  }),
  vertex: externalVertexModelId('3-5-sonnet', {
    date: '20241022',
    variant: 'v2',
  }),
  foundry: externalFoundryModelId('3-5-sonnet'),
} as const satisfies ModelConfig

export const MOSSEN_3_5_HAIKU_CONFIG = {
  firstParty: 'mossen-3-5-haiku-20241022',
  bedrock: externalBedrockModelId('3-5-haiku', {
    region: 'us',
    date: '20241022',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('3-5-haiku', { date: '20241022' }),
  foundry: externalFoundryModelId('3-5-haiku'),
} as const satisfies ModelConfig

export const MOSSEN_HAIKU_4_5_CONFIG = {
  firstParty: 'mossen-haiku-4-5-20251001',
  bedrock: externalBedrockModelId('haiku-4-5', {
    region: 'us',
    date: '20251001',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('haiku-4-5', { date: '20251001' }),
  foundry: externalFoundryModelId('haiku-4-5'),
} as const satisfies ModelConfig

export const MOSSEN_SONNET_4_CONFIG = {
  firstParty: 'mossen-sonnet-4-20250514',
  bedrock: externalBedrockModelId('sonnet-4', {
    region: 'us',
    date: '20250514',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('sonnet-4', { date: '20250514' }),
  foundry: externalFoundryModelId('sonnet-4'),
} as const satisfies ModelConfig

export const MOSSEN_SONNET_4_5_CONFIG = {
  firstParty: 'mossen-sonnet-4-5-20250929',
  bedrock: externalBedrockModelId('sonnet-4-5', {
    region: 'us',
    date: '20250929',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('sonnet-4-5', { date: '20250929' }),
  foundry: externalFoundryModelId('sonnet-4-5'),
} as const satisfies ModelConfig

export const MOSSEN_OPUS_4_CONFIG = {
  firstParty: 'mossen-opus-4-20250514',
  bedrock: externalBedrockModelId('opus-4', {
    region: 'us',
    date: '20250514',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('opus-4', { date: '20250514' }),
  foundry: externalFoundryModelId('opus-4'),
} as const satisfies ModelConfig

export const MOSSEN_OPUS_4_1_CONFIG = {
  firstParty: 'mossen-opus-4-1-20250805',
  bedrock: externalBedrockModelId('opus-4-1', {
    region: 'us',
    date: '20250805',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('opus-4-1', { date: '20250805' }),
  foundry: externalFoundryModelId('opus-4-1'),
} as const satisfies ModelConfig

export const MOSSEN_OPUS_4_5_CONFIG = {
  firstParty: 'mossen-opus-4-5-20251101',
  bedrock: externalBedrockModelId('opus-4-5', {
    region: 'us',
    date: '20251101',
    variant: 'v1:0',
  }),
  vertex: externalVertexModelId('opus-4-5', { date: '20251101' }),
  foundry: externalFoundryModelId('opus-4-5'),
} as const satisfies ModelConfig

export const MOSSEN_OPUS_4_6_CONFIG = {
  firstParty: 'mossen-opus-4-6',
  bedrock: externalBedrockModelId('opus-4-6', {
    region: 'us',
    variant: 'v1',
  }),
  vertex: externalVertexModelId('opus-4-6'),
  foundry: externalFoundryModelId('opus-4-6'),
} as const satisfies ModelConfig

export const MOSSEN_SONNET_4_6_CONFIG = {
  firstParty: 'mossen-sonnet-4-6',
  bedrock: externalBedrockModelId('sonnet-4-6', { region: 'us' }),
  vertex: externalVertexModelId('sonnet-4-6'),
  foundry: externalFoundryModelId('sonnet-4-6'),
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: MOSSEN_3_5_HAIKU_CONFIG,
  haiku45: MOSSEN_HAIKU_4_5_CONFIG,
  sonnet35: MOSSEN_3_5_V2_SONNET_CONFIG,
  sonnet37: MOSSEN_3_7_SONNET_CONFIG,
  sonnet40: MOSSEN_SONNET_4_CONFIG,
  sonnet45: MOSSEN_SONNET_4_5_CONFIG,
  sonnet46: MOSSEN_SONNET_4_6_CONFIG,
  opus40: MOSSEN_OPUS_4_CONFIG,
  opus41: MOSSEN_OPUS_4_1_CONFIG,
  opus45: MOSSEN_OPUS_4_5_CONFIG,
  opus46: MOSSEN_OPUS_4_6_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'mossen-opus-4-6' | 'mossen-sonnet-4-5-20250929' | ... */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
