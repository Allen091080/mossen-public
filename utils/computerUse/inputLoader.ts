import {
  requireNativeInputModule,
  type ComputerUseInput,
  type ComputerUseInputAPI,
} from './_nativeInputBridge.js'

let cached: ComputerUseInputAPI | undefined

/**
 * The native input bridge reads COMPUTER_USE_INPUT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through
 * to the node_modules prebuilds/ path).
 *
 * The bridge exports a discriminated union on `isSupported` — narrowed here
 * once so callers get the bare `ComputerUseInputAPI` without re-checking.
 *
 * key()/keys() dispatch enigo work onto DispatchQueue.main via
 * dispatch2::run_on_main, then block a tokio worker on a channel. Under
 * Electron (CFRunLoop drains the main queue) this works; under libuv
 * (Node/bun) the main queue never drains and the promise hangs. The executor
 * calls these inside drainRunLoop().
 */
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  const input = requireNativeInputModule() as ComputerUseInput
  if (!input.isSupported) {
    throw new Error(
      'Mossen computer-use input bridge is unavailable on this platform.',
    )
  }
  return (cached = input)
}
