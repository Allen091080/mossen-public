import { useCallback, useState } from 'react'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { verifyApiKey } from '../services/api/mossen.js'
import {
  getMossenApiKeyWithSource,
  getApiKeyFromApiKeyHelper,
  isMossenHostedAuthEnabled,
  isHostedSubscriber,
} from '../utils/auth.js'
import {
  hasCustomBackendAuth,
  isCustomBackendEnabled,
} from '../utils/customBackend.js'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}

export function getInitialApiKeyVerificationStatus(): VerificationStatus {
  if (isCustomBackendEnabled()) {
    return hasCustomBackendAuth() ? 'valid' : 'missing'
  }
  if (!isMossenHostedAuthEnabled() || isHostedSubscriber()) {
    return 'valid'
  }
  // Use skipRetrievingKeyFromApiKeyHelper to avoid executing apiKeyHelper
  // before trust dialog is shown (security: prevents RCE via settings.json)
  const { key, source } = getMossenApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  // If apiKeyHelper is configured, we have a key source even though we
  // haven't executed it yet - return 'loading' to indicate we'll verify later
  if (key || source === 'apiKeyHelper') {
    return 'loading'
  }
  return 'missing'
}

export function useApiKeyVerification(): ApiKeyVerificationResult {
  const [status, setStatus] = useState<VerificationStatus>(
    getInitialApiKeyVerificationStatus,
  )
  const [error, setError] = useState<Error | null>(null)

  const verify = useCallback(async (): Promise<void> => {
    if (isCustomBackendEnabled()) {
      setError(null)
      setStatus(hasCustomBackendAuth() ? 'valid' : 'missing')
      return
    }
    if (!isMossenHostedAuthEnabled() || isHostedSubscriber()) {
      setError(null)
      setStatus('valid')
      return
    }
    // Warm the apiKeyHelper cache (no-op if not configured), then read from
    // all sources. getMossenApiKeyWithSource() reads the now-warm cache.
    await getApiKeyFromApiKeyHelper(getIsNonInteractiveSession())
    const { key: apiKey, source } = getMossenApiKeyWithSource()
    if (!apiKey) {
      if (source === 'apiKeyHelper') {
        setStatus('error')
        setError(new Error('API key helper did not return a valid key'))
        return
      }
      setError(null)
      const newStatus = 'missing'
      setStatus(newStatus)
      return
    }

    try {
      setError(null)
      const isValid = await verifyApiKey(apiKey, false)
      const newStatus = isValid ? 'valid' : 'invalid'
      setStatus(newStatus)
      return
    } catch (error) {
      // This happens when there an error response from the API but it's not an invalid API key error
      // In this case, we still mark the API key as invalid - but we also log the error so we can
      // display it to the user to be more helpful
      setError(error as Error)
      const newStatus = 'error'
      setStatus(newStatus)
      return
    }
  }, [])

  return {
    status,
    reverify: verify,
    error,
  }
}
