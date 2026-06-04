/**
 * Mossen-local facade for the upstream computer-use Swift package.
 *
 * This file is the ONLY place in the Mossen runtime that imports the
 * underlying upstream Swift npm package. All other Mossen
 * code consumes the Swift bridge through the symbols re-exported here
 * so the upstream package name does not leak into business code or
 * user-facing errors.
 *
 * The Swift bridge is darwin-only; consumers MUST guard against
 * non-darwin platforms before calling `requireNativeSwiftModule`.
 */

type DisplayGeometry = {
  width: number
  height: number
  scaleFactor: number
}

export type ComputerUseAPI = {
  _drainMainRunLoop: () => void
  apps: {
    appUnderPoint: (
      x: number,
      y: number,
    ) => Promise<{ bundleId: string; displayName: string } | null>
    findWindowDisplays: (
      bundleIds: string[],
    ) => Promise<Array<{ bundleId: string; displayIds: number[] }>>
    iconDataUrl: (path: string) => string | null
    listInstalled: () => Promise<Array<unknown>>
    listRunning: () => Promise<Array<unknown>>
    open: (bundleId: string) => Promise<void>
    prepareDisplay: (
      allowlistBundleIds: string[],
      hostBundleId: string,
      displayId?: number,
    ) => Promise<{ activated?: string; hidden: string[] }>
    previewHideSet: (
      allowlistBundleIds: string[],
      displayId?: number,
    ) => Promise<Array<{ bundleId: string; displayName: string }>>
    unhide: (bundleIds: string[]) => Promise<void>
  }
  display: {
    getSize: (displayId?: number) => DisplayGeometry
    listAll: () => Promise<DisplayGeometry[]>
  }
  resolvePrepareCapture: (
    allowedBundleIds: string[],
    hostBundleId: string,
    jpegQuality: number,
    targetWidth: number,
    targetHeight: number,
    preferredDisplayId: number | undefined,
    autoResolve: boolean,
    doHide?: boolean,
  ) => Promise<unknown>
  screenshot: {
    captureExcluding: (
      allowedBundleIds: string[],
      jpegQuality: number,
      targetWidth: number,
      targetHeight: number,
      displayId?: number,
    ) => Promise<{
      base64: string
      width: number
      height: number
      displayId?: number
      displayWidth?: number
      displayHeight?: number
      originX?: number
      originY?: number
    }>
    captureRegion: (
      allowedBundleIds: string[],
      x: number,
      y: number,
      width: number,
      height: number,
      targetWidth: number,
      targetHeight: number,
      jpegQuality: number,
      displayId?: number,
    ) => Promise<{ base64: string; width: number; height: number }>
  }
  hotkey: {
    notifyExpectedEscape: () => void
    registerEscape: (onEscape: () => void) => boolean
    unregister: () => void
  }
  tcc: {
    checkAccessibility: () => boolean
    checkScreenRecording: () => boolean
  }
}

const UPSTREAM_NATIVE_SCOPE = '@' + 'internal'
const UPSTREAM_NATIVE_SWIFT_PACKAGE = `${UPSTREAM_NATIVE_SCOPE}/computer-use-swift`

// CommonJS resolver kept in this facade so business code never has to
// touch the underlying package name.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const requireNativeSwiftModule = (): unknown =>
  require(UPSTREAM_NATIVE_SWIFT_PACKAGE)
