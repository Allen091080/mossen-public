import { createFallbackStorage } from './fallbackStorage.js'
import { libsecretStorage } from './libsecretStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { plainTextStorage } from './plainTextStorage.js'
import type { SecureStorage } from './types.js'

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  if (process.platform === 'linux') {
    return createFallbackStorage(libsecretStorage, plainTextStorage)
  }

  return plainTextStorage
}
