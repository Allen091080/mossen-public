import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { isInternalOperatorMode } from '../internalUserMode.js'
import { getPlatform } from '../platform.js'

/**
 * Get the path to the managed settings directory based on the current platform.
 */
export const getManagedFilePath = memoize(function (): string {
  // Allow override for testing/demos (internal-only, eliminated from external builds)
  if (
    isInternalOperatorMode() &&
    process.env.MOSSEN_CODE_MANAGED_SETTINGS_PATH
  ) {
    return process.env.MOSSEN_CODE_MANAGED_SETTINGS_PATH
  }

  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/Mossen'
    case 'windows':
      return 'C:\\Program Files\\Mossen'
    default:
      return '/etc/mossen'
  }
})

/**
 * Get the path to the managed-settings.d/ drop-in directory.
 * managed-settings.json is merged first (base), then files in this directory
 * are merged alphabetically on top (drop-ins override base, later files win).
 */
export const getManagedSettingsDropInDir = memoize(function (): string {
  return join(getManagedFilePath(), 'managed-settings.d')
})
