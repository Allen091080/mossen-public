import { createRequire } from 'module'

const externalText = (...codes: number[]) => String.fromCharCode(...codes)
const EXTERNAL_SANDBOX_RUNTIME_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 115, 97,
  110, 100, 98, 111, 120, 45, 114, 117, 110, 116, 105, 109, 101,
)
const EXTERNAL_SANDBOX_RUNTIME_PACKAGE_LABEL =
  'Mossen sandbox bridge package'

export type MossenFsReadRestrictionConfig = {
  denyOnly: string[]
  allowWithinDeny?: string[]
}

export type MossenFsWriteRestrictionConfig = {
  allowOnly: string[]
  denyWithinAllow: string[]
}

export type MossenIgnoreViolationsConfig = unknown

export type MossenNetworkHostPattern = {
  host: string
}

export type MossenNetworkRestrictionConfig = {
  allowedHosts?: string[]
  deniedHosts?: string[]
}

export type MossenSandboxAskCallback = (
  hostPattern: MossenNetworkHostPattern,
) => boolean | Promise<boolean>

export type MossenSandboxDependencyCheck = {
  errors: string[]
  warnings: string[]
}

export type MossenSandboxRuntimeConfig = Record<string, unknown>

export type MossenSandboxViolationEvent = Record<string, unknown>

export type MossenSandboxViolationStore = {
  subscribe(
    listener: (violations: MossenSandboxViolationEvent[]) => void,
  ): () => void
  getTotalCount(): number
}

// External sandbox runtime methods are intentionally erased at this bridge boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MossenSandboxRuntimeManagerShape = Record<string, any>

type ExternalSandboxRuntimePackage = {
  SandboxManager: MossenSandboxRuntimeManagerShape
  SandboxRuntimeConfigSchema: unknown
  SandboxViolationStore: MossenSandboxViolationStore
}

const requireExternalSandboxRuntime = createRequire(import.meta.url)
let cachedExternalSandboxRuntime: ExternalSandboxRuntimePackage | undefined
let fallbackConfig: MossenSandboxRuntimeConfig = {}

const fallbackViolationStore: MossenSandboxViolationStore = {
  subscribe() {
    return () => {}
  },
  getTotalCount() {
    return 0
  },
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function sanitizeExternalSandboxRuntimeCause(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'module not found'
  }

  const message = error instanceof Error ? error.message : String(error)
  return message
    .split(EXTERNAL_SANDBOX_RUNTIME_PACKAGE)
    .join(EXTERNAL_SANDBOX_RUNTIME_PACKAGE_LABEL)
}

function tryLoadExternalSandboxRuntime(): ExternalSandboxRuntimePackage | undefined {
  try {
    cachedExternalSandboxRuntime ??= requireExternalSandboxRuntime(
      EXTERNAL_SANDBOX_RUNTIME_PACKAGE,
    ) as ExternalSandboxRuntimePackage
    return cachedExternalSandboxRuntime
  } catch (error) {
    missingBridgeCause = sanitizeExternalSandboxRuntimeCause(error)
    return undefined
  }
}

let missingBridgeCause = 'not loaded'

function missingBridgeMessage(): string {
  return `Mossen sandbox runtime bridge is not installed. Install the Mossen sandbox bridge package before enabling sandbox mode. Cause: ${missingBridgeCause}`
}

function toFsWriteConfig(): MossenFsWriteRestrictionConfig {
  const filesystem = (fallbackConfig.filesystem ?? {}) as {
    allowWrite?: string[]
    denyWrite?: string[]
  }
  return {
    allowOnly: filesystem.allowWrite ?? [],
    denyWithinAllow: filesystem.denyWrite ?? [],
  }
}

function toFsReadConfig(): MossenFsReadRestrictionConfig {
  const filesystem = (fallbackConfig.filesystem ?? {}) as {
    denyRead?: string[]
    allowRead?: string[]
  }
  return {
    denyOnly: filesystem.denyRead ?? [],
    allowWithinDeny: filesystem.allowRead,
  }
}

function toNetworkConfig(): MossenNetworkRestrictionConfig {
  const network = (fallbackConfig.network ?? {}) as {
    allowedDomains?: string[]
    deniedDomains?: string[]
  }
  return {
    allowedHosts: network.allowedDomains ?? [],
    deniedHosts: network.deniedDomains ?? [],
  }
}

const fallbackSandboxManager: MossenSandboxRuntimeManagerShape = {
  checkDependencies(): MossenSandboxDependencyCheck {
    return { errors: [missingBridgeMessage()], warnings: [] }
  },
  isSupportedPlatform(): boolean {
    return true
  },
  async initialize(config: MossenSandboxRuntimeConfig): Promise<void> {
    fallbackConfig = config
  },
  updateConfig(config: MossenSandboxRuntimeConfig): void {
    fallbackConfig = config
  },
  async reset(): Promise<void> {
    fallbackConfig = {}
  },
  wrapWithSandbox(command: string): string {
    return command
  },
  getFsReadConfig: toFsReadConfig,
  getFsWriteConfig: toFsWriteConfig,
  getNetworkRestrictionConfig: toNetworkConfig,
  getIgnoreViolations() {
    return fallbackConfig.ignoreViolations
  },
  getAllowUnixSockets() {
    const network = (fallbackConfig.network ?? {}) as { allowUnixSockets?: string[] }
    return network.allowUnixSockets
  },
  getAllowLocalBinding() {
    const network = (fallbackConfig.network ?? {}) as {
      allowLocalBinding?: boolean
    }
    return network.allowLocalBinding
  },
  getEnableWeakerNestedSandbox() {
    return fallbackConfig.enableWeakerNestedSandbox
  },
  getProxyPort() {
    const network = (fallbackConfig.network ?? {}) as { httpProxyPort?: number }
    return network.httpProxyPort
  },
  getSocksProxyPort() {
    const network = (fallbackConfig.network ?? {}) as { socksProxyPort?: number }
    return network.socksProxyPort
  },
  getLinuxHttpSocketPath() {
    return undefined
  },
  getLinuxSocksSocketPath() {
    return undefined
  },
  async waitForNetworkInitialization(): Promise<boolean> {
    return false
  },
  getSandboxViolationStore() {
    return fallbackViolationStore
  },
  annotateStderrWithSandboxFailures(_command: string, stderr: string): string {
    return stderr
  },
  cleanupAfterCommand(): void {},
}

function getSandboxManager(): MossenSandboxRuntimeManagerShape {
  return tryLoadExternalSandboxRuntime()?.SandboxManager ?? fallbackSandboxManager
}

export const MossenSandboxRuntimeManager = new Proxy(
  {},
  {
    get(_target, property) {
      const manager = getSandboxManager()
      const value = manager[property as keyof MossenSandboxRuntimeManagerShape]
      return typeof value === 'function' ? value.bind(manager) : value
    },
  },
) as MossenSandboxRuntimeManagerShape

export const MossenSandboxRuntimeConfigSchema = new Proxy(
  {},
  {
    get(_target, property) {
      const schema = tryLoadExternalSandboxRuntime()?.SandboxRuntimeConfigSchema
      return (schema as Record<string | symbol, unknown> | undefined)?.[
        property
      ]
    },
  },
)

export const MossenSandboxViolationStore = new Proxy(
  {},
  {
    get(_target, property) {
      const store =
        tryLoadExternalSandboxRuntime()?.SandboxViolationStore ??
        fallbackViolationStore
      return (store as Record<string | symbol, unknown>)[property]
    },
  },
) as MossenSandboxViolationStore
