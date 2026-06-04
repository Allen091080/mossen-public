import {
  requireNativeSwiftModule,
  type ComputerUseAPI,
} from './_nativeSwiftBridge.js'

let cached: ComputerUseAPI | undefined

/**
 * The native Swift bridge reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through
 * to the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('Mossen computer-use Swift bridge is macOS-only.')
  }
  return (cached ??= requireNativeSwiftModule() as ComputerUseAPI)
}

export type { ComputerUseAPI }
