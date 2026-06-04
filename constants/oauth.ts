import { isEnvTruthy } from 'src/utils/envUtils.js'

// Default to prod config; use Mossen-named env flags for local/staging.
type OauthConfigType = 'prod' | 'staging' | 'local'

function getOauthConfigType(): OauthConfigType {
  if (isEnvTruthy(process.env.MOSSEN_CODE_USE_LOCAL_OAUTH)) {
    return 'local'
  }
  if (isEnvTruthy(process.env.MOSSEN_CODE_USE_STAGING_OAUTH)) {
    return 'staging'
  }
  return 'prod'
}

export function fileSuffixForOauthConfig(): string {
  if (process.env.MOSSEN_CODE_CUSTOM_OAUTH_URL) {
    return '-custom-oauth'
  }
  switch (getOauthConfigType()) {
    case 'local':
      return '-local-oauth'
    case 'staging':
      return '-staging-oauth'
    case 'prod':
      // No suffix for production config
      return ''
  }
}

export const HOSTED_INFERENCE_SCOPE = 'user:inference' as const
export const HOSTED_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  HOSTED_PROFILE_SCOPE,
] as const

// Hosted OAuth scopes - for hosted subscribers (Pro/Max/Team/Enterprise)
export const HOSTED_OAUTH_SCOPES = [
  HOSTED_PROFILE_SCOPE,
  HOSTED_INFERENCE_SCOPE,
  'user:sessions:mossen_code',
  'user:mcp_servers',
  'user:file_upload',
] as const

// All OAuth scopes - union of all scopes used in Mossen CLI
// When logging in, request all scopes in order to handle both Console -> hosted redirect
// Ensure that `OAuthConsentPage` in apps repo is kept in sync with this list.
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...HOSTED_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  HOSTED_AUTHORIZE_URL: string
  /**
   * The hosted web origin. Separate from HOSTED_AUTHORIZE_URL because
   * some deployments may route auth through a different path — deriving
   * .origin from it could break links to /code,
   * /settings/connectors, and other hosted web pages.
   */
  HOSTED_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  HOSTED_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

// Production OAuth configuration - Used in normal operation
const PROD_OAUTH_CONFIG = {
  BASE_API_URL: 'https://api.mossen.invalid',
  CONSOLE_AUTHORIZE_URL: 'https://platform.mossen.invalid/oauth/authorize',
  HOSTED_AUTHORIZE_URL: 'https://platform.mossen.invalid/oauth/authorize',
  HOSTED_ORIGIN: 'https://platform.mossen.invalid',
  TOKEN_URL: 'https://platform.mossen.invalid/v1/oauth/token',
  API_KEY_URL: 'https://api.mossen.invalid/api/oauth/mossen_cli/create_api_key',
  ROLES_URL: 'https://api.mossen.invalid/api/oauth/mossen_cli/roles',
  CONSOLE_SUCCESS_URL:
    'https://platform.mossen.invalid/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dmossen-code',
  HOSTED_SUCCESS_URL:
    'https://platform.mossen.invalid/oauth/code/success?app=mossen-code',
  MANUAL_REDIRECT_URL: 'https://platform.mossen.invalid/oauth/code/callback',
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  // No suffix for production config
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: 'https://mcp-proxy.mossen.invalid',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const

/**
 * Client ID Metadata Document URL for MCP OAuth (CIMD / SEP-991).
 * When an MCP auth server advertises client_id_metadata_document_supported: true,
 * Mossen uses this URL as its client_id instead of Dynamic Client Registration.
 * The URL must point to a JSON document hosted by Mossen.
 * See: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
export const MCP_CLIENT_METADATA_URL =
  'https://platform.mossen.invalid/oauth/mossen-code-client-metadata'

const STAGING_OAUTH_CONFIG = {
  BASE_API_URL: 'https://api-staging.mossen.invalid',
  CONSOLE_AUTHORIZE_URL:
    'https://platform.staging.mossen.invalid/oauth/authorize',
  HOSTED_AUTHORIZE_URL:
    'https://hosted.staging.mossen.invalid/oauth/authorize',
  HOSTED_ORIGIN: 'https://hosted.staging.mossen.invalid',
  TOKEN_URL: 'https://platform.staging.mossen.invalid/v1/oauth/token',
  API_KEY_URL:
    'https://api-staging.mossen.invalid/api/oauth/mossen_cli/create_api_key',
  ROLES_URL: 'https://api-staging.mossen.invalid/api/oauth/mossen_cli/roles',
  CONSOLE_SUCCESS_URL:
    'https://platform.staging.mossen.invalid/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dmossen-code',
  HOSTED_SUCCESS_URL:
    'https://platform.staging.mossen.invalid/oauth/code/success?app=mossen-code',
  MANUAL_REDIRECT_URL:
    'https://platform.staging.mossen.invalid/oauth/code/callback',
  CLIENT_ID: '22422756-60c9-4084-8eb7-27705fd5cf9a',
  OAUTH_FILE_SUFFIX: '-staging-oauth',
  MCP_PROXY_URL: 'https://mcp-proxy-staging.mossen.invalid',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const

// Three local dev servers: :8000 API proxy (`api dev start -g ccr`),
// :4000 hosted frontend, :3000 Console frontend. Env vars let
// scripts/mossen-localhost override if your layout differs.
function getLocalOauthConfig(): OauthConfig {
  const api =
    process.env.MOSSEN_LOCAL_OAUTH_API_BASE?.replace(/\/$/, '') ??
    'http://localhost:8000'
  const apps =
    process.env.MOSSEN_LOCAL_OAUTH_APPS_BASE?.replace(/\/$/, '') ??
    'http://localhost:4000'
  const consoleBase =
    process.env.MOSSEN_LOCAL_OAUTH_CONSOLE_BASE?.replace(/\/$/, '') ??
    'http://localhost:3000'
  return {
    BASE_API_URL: api,
    CONSOLE_AUTHORIZE_URL: `${consoleBase}/oauth/authorize`,
    HOSTED_AUTHORIZE_URL: `${apps}/oauth/authorize`,
    HOSTED_ORIGIN: apps,
    TOKEN_URL: `${api}/v1/oauth/token`,
    API_KEY_URL: `${api}/api/oauth/mossen_cli/create_api_key`,
    ROLES_URL: `${api}/api/oauth/mossen_cli/roles`,
    CONSOLE_SUCCESS_URL: `${consoleBase}/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dmossen-code`,
    HOSTED_SUCCESS_URL: `${consoleBase}/oauth/code/success?app=mossen-code`,
    MANUAL_REDIRECT_URL: `${consoleBase}/oauth/code/callback`,
    CLIENT_ID: '22422756-60c9-4084-8eb7-27705fd5cf9a',
    OAUTH_FILE_SUFFIX: '-local-oauth',
    MCP_PROXY_URL: 'http://localhost:8205',
    MCP_PROXY_PATH: '/v1/toolbox/shttp/mcp/{server_id}',
  }
}

// Allowed base URLs for MOSSEN_CODE_CUSTOM_OAUTH_URL override.
// Only FedStart/PubSec deployments are permitted to prevent OAuth tokens
// from being sent to arbitrary endpoints.
const ALLOWED_OAUTH_BASE_URLS = [
  'https://beacon.staging.mossen.invalid',
  'https://mossen.fedstart.invalid',
  'https://mossen-staging.fedstart.invalid',
]

// Default to prod config; use Mossen-named env flags for local/staging.
export function getOauthConfig(): OauthConfig {
  let config: OauthConfig = (() => {
    switch (getOauthConfigType()) {
      case 'local':
        return getLocalOauthConfig()
      case 'staging':
        return STAGING_OAUTH_CONFIG
      case 'prod':
        return PROD_OAUTH_CONFIG
    }
  })()

  // Allow overriding all OAuth URLs to point to an approved FedStart deployment.
  // Only allowlisted base URLs are accepted to prevent credential leakage.
  const oauthBaseUrl = process.env.MOSSEN_CODE_CUSTOM_OAUTH_URL
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '')
    if (!ALLOWED_OAUTH_BASE_URLS.includes(base)) {
      throw new Error(
        'MOSSEN_CODE_CUSTOM_OAUTH_URL is not an approved endpoint.',
      )
    }
    config = {
      ...config,
      BASE_API_URL: base,
      CONSOLE_AUTHORIZE_URL: `${base}/oauth/authorize`,
      HOSTED_AUTHORIZE_URL: `${base}/oauth/authorize`,
      HOSTED_ORIGIN: base,
      TOKEN_URL: `${base}/v1/oauth/token`,
      API_KEY_URL: `${base}/api/oauth/mossen_cli/create_api_key`,
      ROLES_URL: `${base}/api/oauth/mossen_cli/roles`,
      CONSOLE_SUCCESS_URL: `${base}/oauth/code/success?app=mossen-code`,
      HOSTED_SUCCESS_URL: `${base}/oauth/code/success?app=mossen-code`,
      MANUAL_REDIRECT_URL: `${base}/oauth/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    }
  }

  // Allow CLIENT_ID override via environment variable (e.g., for Xcode integration)
  const clientIdOverride = process.env.MOSSEN_CODE_OAUTH_CLIENT_ID
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    }
  }

  return config
}
