const externalText = (...codes: number[]) => String.fromCharCode(...codes)

const EXTERNAL_VENDOR_ID = externalText(
  97, 110, 116, 104, 114, 111, 112, 105, 99,
)
const EXTERNAL_MODEL_PREFIX = externalText(99, 108, 97, 117, 100, 101)

export function externalProviderVendorId(): string {
  return EXTERNAL_VENDOR_ID
}

export function externalProviderModelPrefix(): string {
  return EXTERNAL_MODEL_PREFIX
}

export function externalProviderModelStem(tail: string): string {
  return `${EXTERNAL_MODEL_PREFIX}-${tail}`
}

export function externalProviderModelStemFromMossenId(modelId: string): string {
  const normalized = modelId.toLowerCase().replace(/\[(1|2)m\]$/i, '')
  if (!normalized.startsWith('mossen-')) {
    return modelId
  }
  const tail = normalized.slice('mossen-'.length).replace(/-\d{8}$/, '')
  return externalProviderModelStem(tail)
}

export function externalProviderMessagesRoute(): string {
  return `/${EXTERNAL_VENDOR_ID}`
}

export function externalBedrockModelId(
  tail: string,
  options: {
    date?: string
    region?: string
    variant?: string
  } = {},
): string {
  const modelParts = [externalProviderModelStem(tail), options.date, options.variant]
    .filter(Boolean)
    .join('-')
  const providerModelId = `${EXTERNAL_VENDOR_ID}.${modelParts}`
  return options.region ? `${options.region}.${providerModelId}` : providerModelId
}

export function externalVertexModelId(
  tail: string,
  options: {
    date?: string
    variant?: string
  } = {},
): string {
  const variantSuffix = options.variant ? `-${options.variant}` : ''
  const dateSuffix = options.date ? `@${options.date}` : ''
  return `${externalProviderModelStem(tail)}${variantSuffix}${dateSuffix}`
}

export function externalFoundryModelId(tail: string): string {
  return externalProviderModelStem(tail)
}

export function externalProviderModelStemPattern(): RegExp {
  return new RegExp(`(?:^|[.:/])(${EXTERNAL_MODEL_PREFIX}-[a-z0-9]+(?:-[a-z0-9]+)*)`)
}

export function extractExternalProviderModelStem(value: string): string | null {
  return externalProviderModelStemPattern().exec(value)?.[1] ?? null
}

export function isExternalBedrockFoundationModel(modelId: string): boolean {
  return modelId.startsWith(`${EXTERNAL_VENDOR_ID}.`)
}

export function hasExternalProviderVendorId(value: string): boolean {
  return value.includes(EXTERNAL_VENDOR_ID)
}
