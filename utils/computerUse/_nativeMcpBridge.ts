/**
 * Mossen-local facade for the upstream computer-use MCP package.
 *
 * This file is the ONLY place in the Mossen runtime that names the
 * underlying upstream MCP package (and its `/types` and
 * `/sentinelApps` subpaths). All other Mossen code consumes the native
 * MCP surface through the symbols exported here so the upstream package
 * name does not leak into business code or user-facing errors.
 *
 * The value exports are lazy wrappers. A clean source checkout can typecheck
 * without the optional native packages installed, and the package is required
 * only when the computer-use feature is actually exercised.
 */

export type CoordinateMode = 'pixels' | 'normalized'

export type CuSubGates = {
  autoTargetDisplay: boolean
  clipboardGuard: boolean
  clipboardPasteMultiline: boolean
  hideBeforeAction: boolean
  mouseAnimation: boolean
  pixelValidation: boolean
}

export type Logger = {
  silly(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type DisplayGeometry = {
  width: number
  height: number
  scaleFactor: number
  displayId?: number
  originX?: number
  originY?: number
}

export type FrontmostApp = {
  bundleId?: string
  displayName?: string
  path?: string
}

export type InstalledApp = {
  bundleId?: string
  displayName?: string
  path?: string
}

export type RunningApp = InstalledApp

export type ResolvePrepareCaptureResult = unknown

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
  displayId?: number
  displayWidth?: number
  displayHeight?: number
  originX?: number
  originY?: number
}

export type ScreenshotDims = Omit<ScreenshotResult, 'base64'>

export type CuPermissionRequest = {
  apps: Array<{
    alreadyGranted?: boolean
    requestedName: string
    resolved?: {
      bundleId: string
      displayName: string
    }
  }>
  flags?: Partial<typeof DEFAULT_GRANT_FLAGS>
  tccState?: {
    accessibility: boolean
    screenRecording: boolean
  }
  [key: string]: unknown
}

export type CuPermissionResponse = {
  granted: Array<{ bundleId: string; displayName?: string }>
  denied: Array<{ bundleId: string; displayName?: string }>
  flags: typeof DEFAULT_GRANT_FLAGS
}

export type CuCallToolResult = {
  content?:
    | Array<{
        type: string
        text?: string
        mimeType?: string
        data?: string
      }>
    | unknown
  telemetry?: { error_kind?: string }
  [key: string]: unknown
}

export type ComputerExecutor = {
  capabilities: Record<string, unknown>
  listInstalledApps: () => Promise<InstalledApp[]>
  [key: string]: unknown
}

export type ComputerUseHostAdapter = {
  cropRawPatch: (...args: unknown[]) => unknown
  ensureOsPermissions: () => Promise<
    | { granted: true }
    | { granted: false; accessibility: boolean; screenRecording: boolean }
  >
  executor: ComputerExecutor
  getAutoUnhideEnabled: () => boolean
  getSubGates: () => CuSubGates
  isDisabled: () => boolean
  logger: Logger
  serverName: string
}

type NativeMcpServer = {
  close: () => Promise<void>
  connect: (transport: unknown) => Promise<void>
  setRequestHandler: (...args: unknown[]) => void
}

type NativeMcpModule = {
  API_RESIZE_PARAMS?: unknown
  bindSessionContext: (
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
    ctx: ComputerUseSessionContext,
  ) => (name: string, args: unknown) => Promise<CuCallToolResult>
  buildComputerUseTools: (
    capabilities: Record<string, unknown>,
    coordinateMode: CoordinateMode,
    installedAppNames?: string[],
  ) => Array<{ name: string; [key: string]: unknown }>
  createComputerUseMcpServer: (
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
  ) => NativeMcpServer
  targetImageSize: (
    width: number,
    height: number,
    params: unknown,
  ) => [number, number]
}

export const DEFAULT_GRANT_FLAGS = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
} as const

export const API_RESIZE_PARAMS: unknown = {}

export type SentinelCategory = 'filesystem' | 'shell' | 'system_settings'

const UPSTREAM_NATIVE_SCOPE = '@' + 'internal'
const UPSTREAM_NATIVE_MCP_PACKAGE = `${UPSTREAM_NATIVE_SCOPE}/computer-use-mcp`
const UPSTREAM_SENTINEL_APPS_PACKAGE = `${UPSTREAM_NATIVE_MCP_PACKAGE}/sentinelApps`

// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireNativeMcpModule = (): NativeMcpModule =>
  require(UPSTREAM_NATIVE_MCP_PACKAGE) as NativeMcpModule

export function targetImageSize(
  width: number,
  height: number,
  params: unknown,
): [number, number] {
  const native = requireNativeMcpModule()
  return native.targetImageSize(width, height, params)
}

export function buildComputerUseTools(
  capabilities: Record<string, unknown>,
  coordinateMode: CoordinateMode,
  installedAppNames?: string[],
): Array<{ name: string; [key: string]: unknown }> {
  return requireNativeMcpModule().buildComputerUseTools(
    capabilities,
    coordinateMode,
    installedAppNames,
  )
}

export function createComputerUseMcpServer(
  adapter: ComputerUseHostAdapter,
  coordinateMode: CoordinateMode,
): NativeMcpServer {
  return requireNativeMcpModule().createComputerUseMcpServer(
    adapter,
    coordinateMode,
  )
}

export type ComputerUseSessionContext = {
  [key: string]: unknown
}

export function bindSessionContext(
  adapter: ComputerUseHostAdapter,
  coordinateMode: CoordinateMode,
  ctx: ComputerUseSessionContext,
): (name: string, args: unknown) => Promise<CuCallToolResult> {
  return requireNativeMcpModule().bindSessionContext(adapter, coordinateMode, ctx)
}

export function getSentinelCategory(
  ...args: unknown[]
): SentinelCategory | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(UPSTREAM_SENTINEL_APPS_PACKAGE) as {
    getSentinelCategory: (...values: unknown[]) => SentinelCategory | null
  }
  return mod.getSentinelCategory(...args)
}
