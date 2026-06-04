import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js'
import { getHostedOAuthTokens } from 'src/utils/auth.js'
import { isCustomBackendEnabled } from 'src/utils/customBackend.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvDefinedFalsy } from 'src/utils/envUtils.js'
import { clearMcpAuthCache } from './client.js'
import { normalizeNameForMCP } from './normalization.js'
import type { ScopedMcpServerConfig } from './types.js'

type HostedMcpServer = {
  type: 'mcp_server'
  id: string
  display_name: string
  url: string
  created_at: string
}

type HostedMcpServersResponse = {
  data: HostedMcpServer[]
  has_more: boolean
  next_page: string | null
}

const FETCH_TIMEOUT_MS = 5000
const MCP_SERVERS_BETA_HEADER = 'mcp-servers-2025-12-04'

/**
 * Fetches MCP server configurations from hosted org configs.
 * These servers are managed by the organization via hosted settings.
 *
 * Results are memoized for the session lifetime (fetch once per CLI session).
 */
export const fetchHostedMcpConfigsIfEligible = memoize(
  async (): Promise<Record<string, ScopedMcpServerConfig>> => {
    try {
      if (isCustomBackendEnabled()) {
        logForDebugging('[hosted-mcp] Disabled: custom backend mode')
        return {}
      }

      if (isEnvDefinedFalsy(process.env.ENABLE_HOSTED_MCP_SERVERS)) {
        logForDebugging('[hosted-mcp] Disabled via env var')
        logMossenEvent('mossen.mcp.hostedEligibility', {
          state:
            'disabled_env_var' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      const tokens = getHostedOAuthTokens()
      if (!tokens?.accessToken) {
        logForDebugging('[hosted-mcp] No access token')
        logMossenEvent('mossen.mcp.hostedEligibility', {
          state:
            'no_oauth_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      // Check for user:mcp_servers scope directly instead of isHostedSubscriber().
      // In non-interactive mode, isHostedSubscriber() returns false when MOSSEN_CODE_API_KEY
      // is set (even with valid hosted tokens) because preferThirdPartyAuthentication() causes
      // isMossenHostedAuthEnabled() to return false. Checking the scope directly allows users
      // with both API keys and hosted tokens to access hosted MCPs in print mode.
      if (!tokens.scopes?.includes('user:mcp_servers')) {
        logForDebugging(
          `[hosted-mcp] Missing user:mcp_servers scope (scopes=${tokens.scopes?.join(',') || 'none'})`,
        )
        logMossenEvent('mossen.mcp.hostedEligibility', {
          state:
            'missing_scope' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      const baseUrl = getOauthConfig().BASE_API_URL
      const url = `${baseUrl}/v1/mcp_servers?limit=1000`

      logForDebugging(`[hosted-mcp] Fetching from ${url}`)

      const response = await axios.get<HostedMcpServersResponse>(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'mossen-beta': MCP_SERVERS_BETA_HEADER,
          'mossen-version': '2023-06-01',
        },
        timeout: FETCH_TIMEOUT_MS,
      })

      const configs: Record<string, ScopedMcpServerConfig> = {}
      // Track used normalized names to detect collisions and assign (2), (3), etc. suffixes.
      // We check the final normalized name (including suffix) to handle edge cases where
      // a suffixed name collides with another server's base name (e.g., "Example Server 2"
      // colliding with "Example Server! (2)" which both normalize to hosted_Example_Server_2).
      const usedNormalizedNames = new Set<string>()

      for (const server of response.data.data) {
        const baseName = `hosted ${server.display_name}`

        // Try without suffix first, then increment until we find an unused normalized name
        let finalName = baseName
        let finalNormalized = normalizeNameForMCP(finalName)
        let count = 1
        while (usedNormalizedNames.has(finalNormalized)) {
          count++
          finalName = `${baseName} (${count})`
          finalNormalized = normalizeNameForMCP(finalName)
        }
        usedNormalizedNames.add(finalNormalized)

        configs[finalName] = {
          type: 'hosted-proxy',
          url: server.url,
          id: server.id,
          scope: 'hosted',
        }
      }

      logForDebugging(
        `[hosted-mcp] Fetched ${Object.keys(configs).length} servers`,
      )
      logMossenEvent('mossen.mcp.hostedEligibility', {
        state:
          'eligible' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return configs
    } catch {
      logForDebugging(`[hosted-mcp] Fetch failed`)
      return {}
    }
  },
)

/**
 * Clears the memoized cache for fetchHostedMcpConfigsIfEligible.
 * Call this after login so the next fetch will use the new auth tokens.
 */
export function clearHostedMcpConfigsCache(): void {
  fetchHostedMcpConfigsIfEligible.cache.clear?.()
  // Also clear the auth cache so freshly-authorized servers get re-connected
  clearMcpAuthCache()
}

/**
 * Record that a hosted connector successfully connected. Idempotent.
 *
 * Gates the "N connectors unavailable/need auth" startup notifications: a
 * connector that was working yesterday and is now failed is a state change
 * worth surfacing; an org-configured connector that's been needs-auth since
 * it showed up is one the user has demonstrably ignored.
 */
export function markHostedMcpConnected(name: string): void {
  saveGlobalConfig(current => {
    const seen = current.hostedMcpEverConnected ?? []
    if (seen.includes(name)) return current
    return { ...current, hostedMcpEverConnected: [...seen, name] }
  })
}

export function hasHostedMcpEverConnected(name: string): boolean {
  return (getGlobalConfig().hostedMcpEverConnected ?? []).includes(name)
}
