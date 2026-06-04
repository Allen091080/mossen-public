import {
  getCustomBackendConfig,
  getCustomBackendProtocol,
  hasCustomBackendAuth,
  isCustomBackendEnabled,
} from '../utils/customBackend.js'
import { getAPIProvider } from '../utils/model/providers.js'
import type { ModelTier, ProviderRuntimeSnapshot } from './runtimeTypes.js'

function inferCustomBackendTier(baseUrl: string | null): ModelTier {
  if (!baseUrl) return 'cloud'
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('127.')
    ) {
      return 'local'
    }
  } catch {
    // Ignore malformed URLs and fall back to the safest default below.
  }
  return 'cloud'
}

export function getProviderRuntimeSnapshot(): ProviderRuntimeSnapshot {
  if (isCustomBackendEnabled()) {
    const config = getCustomBackendConfig()
    const authConfigured = hasCustomBackendAuth()
    return {
      kind: 'custom-backend',
      name: config?.name ?? 'Custom backend',
      tier: inferCustomBackendTier(config?.baseUrl ?? null),
      protocol: getCustomBackendProtocol(),
      baseUrl: config?.baseUrl ?? null,
      model: config?.model ?? null,
      capabilities: {
        streaming: true,
        toolUse: true,
        structuredOutput: true,
        auth: authConfigured,
      },
    }
  }

  const provider = getAPIProvider()
  return {
    kind:
      provider === 'firstParty'
        ? 'first-party'
        : provider,
    name: provider,
    tier: 'cloud',
    protocol: provider === 'firstParty' ? 'mossen-compatible' : null,
    baseUrl: null,
    model: null,
    capabilities: {
      streaming: true,
      toolUse: true,
      structuredOutput: true,
      auth: true,
    },
  }
}
