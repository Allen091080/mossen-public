/**
 * Mossen-local facade for the upstream computer-use Rust input package.
 *
 * This file is the ONLY place in the Mossen runtime that imports the
 * underlying upstream input npm package. All other Mossen
 * code consumes the input bridge through the symbols re-exported here
 * so the upstream package name does not leak into business code or
 * user-facing errors.
 */

export type ComputerUseInputAPI = {
  getFrontmostAppInfo: () => { appName?: string; bundleId?: string } | null
  key: (key: string, action: 'press' | 'release') => Promise<void>
  keys: (keys: readonly string[]) => Promise<void>
  mouseButton: (
    button: string,
    action: 'click' | 'press' | 'release',
    count?: number,
  ) => Promise<void>
  mouseLocation: () => Promise<{ x: number; y: number }>
  mouseScroll: (
    amount: number,
    axis: 'vertical' | 'horizontal',
  ) => Promise<void>
  moveMouse: (x: number, y: number, animated?: boolean) => Promise<void>
  typeText: (text: string) => Promise<void>
}

export type ComputerUseInput =
  | ({ isSupported: true } & ComputerUseInputAPI)
  | { isSupported: false; reason?: string }

const UPSTREAM_NATIVE_SCOPE = '@' + 'internal'
const UPSTREAM_NATIVE_INPUT_PACKAGE = `${UPSTREAM_NATIVE_SCOPE}/computer-use-input`

// CommonJS resolver kept in this facade so business code never has to
// touch the underlying package name.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const requireNativeInputModule = (): unknown =>
  require(UPSTREAM_NATIVE_INPUT_PACKAGE)
