import axios from 'axios'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getOrganizationUUID } from 'src/services/oauth/client.js'
import { getHostedOAuthTokens } from '../auth.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { getOAuthHeaders } from './api.js'

export type EnvironmentKind = 'mossen_cloud' | 'byoc' | 'bridge'
export type EnvironmentState = 'active'

export type EnvironmentResource = {
  kind: EnvironmentKind
  environment_id: string
  name: string
  created_at: string
  state: EnvironmentState
}

export type EnvironmentListResponse = {
  environments: EnvironmentResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

/**
 * Fetches the list of available environments from the Environment API
 * @returns Promise<EnvironmentResource[]> Array of available environments
 * @throws Error if the API request fails or no access token is available
 */
export async function fetchEnvironments(): Promise<EnvironmentResource[]> {
  const accessToken = getHostedOAuthTokens()?.accessToken
  if (!accessToken) {
    throw new Error(
      'Hosted web sessions require an explicit Mossen bridge adapter token. Backend API credentials alone are not sufficient. Enable MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 only when wrapping that external service, then inject the adapter token before retrying.',
    )
  }

  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  const url = `${getOauthConfig().BASE_API_URL}/v1/environment_providers`

  try {
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    const response = await axios.get<EnvironmentListResponse>(url, {
      headers,
      timeout: 15000,
    })

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch environments: ${response.status} ${response.statusText}`,
      )
    }

    return response.data.environments
  } catch (error) {
    const err = toError(error)
    logError(err)
    throw new Error(`Failed to fetch environments: ${err.message}`)
  }
}

/**
 * Creates a default Mossen cloud environment for users who have none.
 * Uses the public environment_providers route (same auth as fetchEnvironments).
 */
export async function createDefaultCloudEnvironment(
  name: string,
): Promise<EnvironmentResource> {
  const accessToken = getHostedOAuthTokens()?.accessToken
  if (!accessToken) {
    throw new Error('No access token available')
  }
  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  const url = `${getOauthConfig().BASE_API_URL}/v1/environment_providers/cloud/create`
  const response = await axios.post<EnvironmentResource>(
    url,
    {
      name,
      kind: 'mossen_cloud',
      description: '',
      config: {
        environment_type: 'mossen',
        cwd: '/home/user',
        init_script: null,
        environment: {},
        languages: [
          { name: 'python', version: '3.11' },
          { name: 'node', version: '20' },
        ],
        network_config: {
          allowed_hosts: [],
          allow_default_hosts: true,
        },
      },
    },
    {
      headers: {
        ...getOAuthHeaders(accessToken),
        'mossen-beta': 'ccr-byoc-2025-07-29',
        'x-organization-uuid': orgUUID,
      },
      timeout: 15000,
    },
  )
  return response.data
}
