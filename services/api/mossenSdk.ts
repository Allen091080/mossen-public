import { createRequire } from 'module'

const externalText = (...codes: number[]) => String.fromCharCode(...codes)

const EXTERNAL_PROVIDER_SDK_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 115, 100,
  107,
)
const EXTERNAL_BEDROCK_SDK_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 98, 101,
  100, 114, 111, 99, 107, 45, 115, 100, 107,
)
const EXTERNAL_FOUNDRY_SDK_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 102, 111,
  117, 110, 100, 114, 121, 45, 115, 100, 107,
)
const EXTERNAL_VERTEX_SDK_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 118, 101,
  114, 116, 101, 120, 45, 115, 100, 107,
)

const EXTERNAL_BEDROCK_EXPORT = externalText(
  65, 110, 116, 104, 114, 111, 112, 105, 99, 66, 101, 100, 114, 111, 99, 107,
)
const EXTERNAL_FOUNDRY_EXPORT = externalText(
  65, 110, 116, 104, 114, 111, 112, 105, 99, 70, 111, 117, 110, 100, 114, 121,
)
const EXTERNAL_VERTEX_EXPORT = externalText(
  65, 110, 116, 104, 114, 111, 112, 105, 99, 86, 101, 114, 116, 101, 120,
)

const EXTERNAL_PROVIDER_REPLACEMENTS: Array<[string, string]> = [
  [EXTERNAL_PROVIDER_SDK_PACKAGE, 'Mossen provider bridge package'],
  [EXTERNAL_BEDROCK_SDK_PACKAGE, 'Mossen Bedrock bridge package'],
  [EXTERNAL_FOUNDRY_SDK_PACKAGE, 'Mossen Foundry bridge package'],
  [EXTERNAL_VERTEX_SDK_PACKAGE, 'Mossen Vertex bridge package'],
  [EXTERNAL_BEDROCK_EXPORT, 'Mossen Bedrock bridge export'],
  [EXTERNAL_FOUNDRY_EXPORT, 'Mossen Foundry bridge export'],
  [EXTERNAL_VERTEX_EXPORT, 'Mossen Vertex bridge export'],
]

// External provider SDK types are intentionally erased at this bridge boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MossenAny = any

export type MossenClientOptions = Record<string, MossenAny>
export type MossenSdkClient = MossenAny
export type MossenStream<T = MossenAny> = AsyncIterable<T> & MossenAny

export type MossenBetaContentBlock = MossenAny
export type MossenBetaContentBlockParam = MossenAny
export type MossenBetaImageBlockParam = MossenAny
export type MossenBetaJSONOutputFormat = MossenAny
export type MossenBetaMessage = MossenAny
export type MossenBetaMessageDeltaUsage = MossenAny
export type MossenBetaMessageParam = MossenAny
export type MossenBetaMessageStreamParams = MossenAny
export type MossenBetaOutputConfig = MossenAny
export type MossenBetaRawMessageStreamEvent = MossenAny
export type MossenBetaRequestDocumentBlock = MossenAny
export type MossenBetaStopReason = MossenAny
export type MossenBetaThinkingConfigParam = MossenAny
export type MossenBetaTool = MossenAny
export type MossenBetaToolChoice = MossenAny
export type MossenBetaToolChoiceAuto = MossenAny
export type MossenBetaToolChoiceTool = MossenAny
export type MossenBetaToolUseBlock = MossenAny
export type MossenBetaToolUnion = MossenAny
export type MossenBetaUsage = MossenAny

export type MossenBase64ImageSource = MossenAny
export type MossenContentBlock = MossenAny
export type MossenContentBlockParam = MossenAny
export type MossenImageBlockParam = MossenAny
export type MossenMessageParam = MossenAny
export type MossenTextBlockParam = MossenAny
export type MossenThinkingBlock = MossenAny
export type MossenThinkingBlockParam = MossenAny
export type MossenTool = MossenAny
export type MossenToolResultBlockParam = MossenAny
export type MossenToolUseBlock = MossenAny
export type MossenToolUseBlockParam = MossenAny

type MossenProviderConstructor = new (
  options?: MossenClientOptions,
) => MossenSdkClient

type MossenExternalProviderSdkModule = {
  APIConnectionError: MossenAny
  APIConnectionTimeoutError: MossenAny
  APIError: MossenAny
  APIUserAbortError: MossenAny
  default: MossenProviderConstructor
}

const requireExternalProvider = createRequire(import.meta.url)

const MOSSEN_API_ERROR_MARKER = Symbol('MossenAPIError')
const MOSSEN_CONNECTION_ERROR_MARKER = Symbol('MossenAPIConnectionError')
const MOSSEN_ABORT_ERROR_MARKER = Symbol('MossenAPIUserAbortError')

let cachedExternalProviderSdk: MossenExternalProviderSdkModule | undefined

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function sanitizeExternalProviderCause(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'module not found'
  }

  let message = error instanceof Error ? error.message : String(error)
  for (const [externalName, bridgeName] of EXTERNAL_PROVIDER_REPLACEMENTS) {
    message = message.split(externalName).join(bridgeName)
  }
  return code ? `${code}: ${message}` : message
}

function loadExternalProviderSdk(): MossenExternalProviderSdkModule {
  try {
    cachedExternalProviderSdk ??= requireExternalProvider(
      EXTERNAL_PROVIDER_SDK_PACKAGE,
    ) as MossenExternalProviderSdkModule
    return cachedExternalProviderSdk
  } catch (error) {
    throw new Error(
      `Mossen external provider bridge is not installed. Install the Mossen provider bridge package for this runtime before using direct external-provider mode. Cause: ${sanitizeExternalProviderCause(error)}`,
    )
  }
}

function loadExternalProviderPackage(
  packageName: string,
  bridgeName: string,
  modeName: string,
): Record<string, MossenAny> {
  try {
    return requireExternalProvider(packageName) as Record<string, MossenAny>
  } catch (error) {
    throw new Error(
      `Mossen ${bridgeName} bridge is not installed. Install the Mossen ${bridgeName} bridge package before using ${modeName} mode. Cause: ${sanitizeExternalProviderCause(error)}`,
    )
  }
}

function isExternalSdkInstance(
  value: unknown,
  exportName: keyof MossenExternalProviderSdkModule,
): boolean {
  if (!value || typeof value !== 'object') return false
  try {
    const externalClass = loadExternalProviderSdk()[exportName]
    return typeof externalClass === 'function' && value instanceof externalClass
  } catch {
    return false
  }
}

export class MossenAPIError extends Error {
  readonly [MOSSEN_API_ERROR_MARKER] = true
  status: number
  body: unknown
  headers: globalThis.Headers
  requestID?: string

  constructor(
    status: number,
    body: unknown,
    message?: string,
    headers?: globalThis.Headers,
  ) {
    super(message ?? `API request failed with status ${status}`)
    this.name = 'MossenAPIError'
    this.status = status
    this.body = body
    this.headers = headers ?? new globalThis.Headers()
    this.requestID =
      this.headers.get('request-id') ??
      this.headers.get('x-request-id') ??
      undefined
  }

  static generate(
    status: number,
    body: unknown,
    message?: string,
    headers?: globalThis.Headers,
  ): MossenAPIError {
    return new MossenAPIError(status, body, message, headers)
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      ((value as Record<symbol, unknown>)[MOSSEN_API_ERROR_MARKER] === true ||
        isExternalSdkInstance(value, 'APIError'))
    )
  }
}

export class MossenAPIConnectionError extends Error {
  readonly [MOSSEN_CONNECTION_ERROR_MARKER] = true

  constructor(options?: { message?: string }) {
    super(options?.message ?? 'API connection error')
    this.name = 'MossenAPIConnectionError'
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      ((value as Record<symbol, unknown>)[MOSSEN_CONNECTION_ERROR_MARKER] ===
        true ||
        isExternalSdkInstance(value, 'APIConnectionError'))
    )
  }
}

export class MossenAPIConnectionTimeoutError extends MossenAPIConnectionError {
  constructor(options?: { message?: string }) {
    super({ message: options?.message ?? 'API connection timed out' })
    this.name = 'MossenAPIConnectionTimeoutError'
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      ((value as Record<symbol, unknown>)[MOSSEN_CONNECTION_ERROR_MARKER] ===
        true ||
        isExternalSdkInstance(value, 'APIConnectionTimeoutError'))
    )
  }
}

export class MossenAPIUserAbortError extends Error {
  readonly [MOSSEN_ABORT_ERROR_MARKER] = true

  constructor() {
    super('Request was aborted')
    this.name = 'MossenAPIUserAbortError'
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === 'object' &&
      ((value as Record<symbol, unknown>)[MOSSEN_ABORT_ERROR_MARKER] === true ||
        isExternalSdkInstance(value, 'APIUserAbortError'))
    )
  }
}

type ProviderMessageCreateResult = {
  asResponse: () => { headers: globalThis.Headers }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export class MossenProviderSDK {
  declare beta: {
    messages: {
      create: (...args: unknown[]) => ProviderMessageCreateResult
    }
  }
  declare models: {
    list: (...args: unknown[]) => AsyncIterable<unknown>
  }

  constructor(options?: MossenClientOptions) {
    const ExternalProviderSDK = loadExternalProviderSdk().default
    return new ExternalProviderSDK(options)
  }
}

export async function loadMossenBedrockProviderSDK() {
  const module = loadExternalProviderPackage(
    EXTERNAL_BEDROCK_SDK_PACKAGE,
    'Bedrock provider',
    'Bedrock provider',
  )
  return module[EXTERNAL_BEDROCK_EXPORT]
}

export async function loadMossenFoundryProviderSDK() {
  const module = loadExternalProviderPackage(
    EXTERNAL_FOUNDRY_SDK_PACKAGE,
    'Foundry provider',
    'Foundry provider',
  )
  return module[EXTERNAL_FOUNDRY_EXPORT]
}

export async function loadMossenVertexProviderSDK() {
  const module = loadExternalProviderPackage(
    EXTERNAL_VERTEX_SDK_PACKAGE,
    'Vertex provider',
    'Vertex provider',
  )
  return module[EXTERNAL_VERTEX_EXPORT]
}
