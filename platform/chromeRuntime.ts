import { access } from 'fs/promises'
import { join } from 'path'
import { getChromeFlagOverride } from '../bootstrap/state.js'
import { getAllNativeMessagingHostsDirs } from '../utils/mossenInChrome/common.js'
import {
  isChromeExtensionInstalled,
  shouldAutoEnableMossenInChrome,
  shouldEnableMossenInChrome,
} from '../utils/mossenInChrome/setup.js'
import {
  getChromeIntegrationUrls,
  hasChromeCommandAccess,
} from '../utils/customBackend.js'
import { getMossenConfigHomeDir } from '../utils/envUtils.js'
import type { ChromeRuntimeSnapshot } from './runtimeTypes.js'

const NATIVE_HOST_MANIFEST_NAME =
  'com.mossen.mossen_code_browser_extension.json'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function getChromeRuntimeSnapshot(): Promise<ChromeRuntimeSnapshot> {
  const { extensionUrl } = getChromeIntegrationUrls()
  const cliOverride = getChromeFlagOverride()
  const shouldEnable = shouldEnableMossenInChrome(cliOverride)
  const commandAccess = hasChromeCommandAccess()
  const extensionInstalled = await isChromeExtensionInstalled()
  const wrapperPath = join(getMossenConfigHomeDir(), 'chrome', 'chrome-native-host')
  const nativeHostWrapperExists = await pathExists(wrapperPath)
  const manifestChecks = await Promise.all(
    getAllNativeMessagingHostsDirs().map(async ({ path }) =>
      pathExists(join(path, NATIVE_HOST_MANIFEST_NAME)),
    ),
  )
  const nativeHostManifestCount = manifestChecks.filter(Boolean).length
  const nativeHostInstalled =
    nativeHostWrapperExists && nativeHostManifestCount > 0

  let statusReason: string | null = null
  if (shouldEnable && !commandAccess) {
    statusReason =
      'Chrome integration is not enabled for the current provider or backend configuration.'
  } else if (shouldEnable && !extensionInstalled) {
    statusReason = nativeHostInstalled
      ? `Chrome native host is installed, but the browser extension is not detected. Install it from ${extensionUrl}`
      : `Chrome native host is not fully installed and the browser extension is not detected. Install the extension from ${extensionUrl}`
  }

  return {
    cliOverride: cliOverride ?? null,
    shouldEnable,
    autoEnable: shouldAutoEnableMossenInChrome(),
    extensionInstalled,
    nativeHostInstalled,
    nativeHostWrapperExists,
    nativeHostManifestCount,
    installUrl: commandAccess ? extensionUrl : null,
    statusReason,
  }
}
