import { getModelStrings } from './modelStrings.js'

export type MossenFrontierModelFamily = 'opus' | 'sonnet' | 'haiku'

export type MossenFrontierModelIds = Readonly<
  Record<MossenFrontierModelFamily, string>
>

const MOSSEN_FIRST_PARTY_MODEL_PREFIX = 'mossen'

function mossenFirstPartyModelId(...parts: string[]): string {
  return [MOSSEN_FIRST_PARTY_MODEL_PREFIX, ...parts].join('-')
}

/**
 * Mossen-facing aliases for the current frontier model family.
 * The returned values are still provider-required IDs; this helper keeps the
 * adapter boundary in one place so user-facing code can talk about Mossen
 * families without hardcoding the raw provider strings.
 */
export function getMossenFrontierModelIds(): MossenFrontierModelIds {
  const modelStrings = getModelStrings()
  return {
    opus: modelStrings.opus46,
    sonnet: modelStrings.sonnet46,
    haiku: modelStrings.haiku45,
  }
}

export const LEGACY_OPUS_FIRSTPARTY_MODEL_IDS = [
  mossenFirstPartyModelId('opus', '4', '20250514'),
  mossenFirstPartyModelId('opus', '4', '1', '20250805'),
  mossenFirstPartyModelId('opus', '4', '0'),
  mossenFirstPartyModelId('opus', '4', '1'),
] as const

export const LEGACY_SONNET_45_FIRSTPARTY_MODEL_IDS = [
  mossenFirstPartyModelId('sonnet', '4', '5', '20250929'),
  `${mossenFirstPartyModelId('sonnet', '4', '5', '20250929')}[1m]`,
] as const
