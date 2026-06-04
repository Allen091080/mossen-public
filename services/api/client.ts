import { randomUUID } from 'crypto'
import {
  getMossenApiKey,
  getApiKeyFromApiKeyHelper,
  isHostedAuthAdapterEnabled,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from 'src/utils/auth.js'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getCustomBackendAuthHeaders,
  getCustomBackendConfig,
  getCustomBackendProtocol,
  isMessagesCompatibleProtocol,
  isCustomBackendEnabled,
} from 'src/utils/customBackend.js'
import { getUserAgent } from 'src/utils/http.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyMossenBaseUrl,
} from 'src/utils/model/providers.js'
import { externalProviderMessagesRoute } from 'src/utils/model/externalProviderIds.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { isDebugToStdErr, logForDebugging } from '../../utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '../../utils/envUtils.js'
import { createOpenAICompatibleClient } from './openaiCompatibleClient.js'
import { createMessagesCompatibleClient } from './messagesCompatibleClient.js'
import {
  loadMossenBedrockProviderSDK,
  loadMossenFoundryProviderSDK,
  loadMossenVertexProviderSDK,
  MossenProviderSDK,
  type MossenClientOptions,
} from './mossenSdk.js'

const AZURE_FOUNDRY_MESSAGES_ROUTE = externalProviderMessagesRoute()

type BedrockClientOptions = MossenClientOptions & {
  awsRegion: string
  skipAuth?: boolean
  defaultHeaders?: Record<string, string>
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
}

/**
 * Environment variables for different client types:
 *
 * Direct API:
 * - MOSSEN_CODE_API_KEY: Required for Mossen direct-provider access
 *
 * AWS Bedrock:
 * - AWS credentials configured via aws-sdk defaults
 * - AWS_REGION or AWS_DEFAULT_REGION: Sets the AWS region for all models (default: us-east-1)
 * - MOSSEN_CODE_SMALL_FAST_MODEL_AWS_REGION: Optional. Override AWS region specifically for the fast tier
 *
 * Foundry (Azure):
 * - MOSSEN_CODE_FOUNDRY_RESOURCE: Your Azure resource name (e.g., 'my-resource')
 *   The client appends the external provider messages route before /v1/messages.
 * - MOSSEN_CODE_FOUNDRY_BASE_URL: Optional. Alternative to resource - provide full base URL directly
 *   (e.g., 'https://my-resource.services.ai.azure.com')
 *
 * Authentication (one of the following):
 * - MOSSEN_CODE_FOUNDRY_API_KEY: Your Microsoft Foundry API key (if using API key auth)
 * - Azure AD authentication: If no API key is provided, uses DefaultAzureCredential
 *   which supports multiple auth methods (environment variables, managed identity,
 *   Azure CLI, etc.). See: https://docs.microsoft.com/en-us/javascript/api/@azure/identity
 *
 * Vertex AI:
 * - Model-specific region variables (highest priority):
 *   - VERTEX_REGION_MOSSEN_3_5_HAIKU: Region for Mossen Fast 3.5 model
 *   - VERTEX_REGION_MOSSEN_HAIKU_4_5: Region for Mossen Fast 4.5 model
 *   - VERTEX_REGION_MOSSEN_3_5_SONNET: Region for Mossen Balanced 3.5 model
 *   - VERTEX_REGION_MOSSEN_3_7_SONNET: Region for Mossen Balanced 3.7 model
 *   - VERTEX_REGION_MOSSEN_4_0_OPUS: Region for Mossen Frontier 4 model
 *   - VERTEX_REGION_MOSSEN_4_0_SONNET: Region for Mossen Balanced 4 model
 *   - VERTEX_REGION_MOSSEN_4_1_OPUS: Region for Mossen Frontier 4.1 model
 *   - VERTEX_REGION_MOSSEN_4_5_SONNET: Region for Mossen Balanced 4.5 model
 *   - VERTEX_REGION_MOSSEN_4_6_SONNET: Region for Mossen Balanced 4.6 model
 * - CLOUD_ML_REGION: Optional. The default GCP region to use for all models
 *   If specific model region not specified above
 * - MOSSEN_CODE_VERTEX_PROJECT_ID: Required. Your GCP project ID
 * - Standard GCP credentials configured via google-auth-library
 *
 * Priority for determining region:
 * 1. Hardcoded model-specific environment variables
 * 2. Global CLOUD_ML_REGION variable
 * 3. Default region from config
 * 4. Fallback region (us-east5)
 */

function createStderrLogger(): MossenClientOptions['logger'] {
  return {
    error: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Provider SDK ERROR]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    warn: (msg, ...args) => console.error('[Provider SDK WARN]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    info: (msg, ...args) => console.error('[Provider SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Provider SDK DEBUG]', msg, ...args),
  }
}

const VERTEX_GOOGLE_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
]

type VertexGoogleAuth = {
  getClient: () => unknown
}

type VertexGoogleAuthCacheEntry = {
  cacheKey: string
  googleAuth: VertexGoogleAuth
}

let vertexGoogleAuthCache: VertexGoogleAuthCacheEntry | undefined

function getVertexProjectEnvValue(): string | undefined {
  return (
    process.env['GCLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['gcloud_project'] ||
    process.env['google_cloud_project']
  )
}

function getVertexKeyFileEnvValue(): string | undefined {
  return (
    process.env['GOOGLE_APPLICATION_CREDENTIALS'] ||
    process.env['google_application_credentials']
  )
}

function buildVertexGoogleAuthCacheKey({
  skipAuth,
  projectEnvValue,
  keyFileEnvValue,
  fallbackProjectId,
}: {
  skipAuth: boolean
  projectEnvValue?: string
  keyFileEnvValue?: string
  fallbackProjectId?: string
}): string {
  return JSON.stringify({
    skipAuth,
    projectEnvValue: projectEnvValue ?? '',
    keyFileEnvValue: keyFileEnvValue ?? '',
    fallbackProjectId: fallbackProjectId ?? '',
  })
}

function getCachedVertexGoogleAuth({
  cacheKey,
  createGoogleAuth,
}: {
  cacheKey: string
  createGoogleAuth: () => VertexGoogleAuth
}): VertexGoogleAuth {
  if (vertexGoogleAuthCache?.cacheKey === cacheKey) {
    return vertexGoogleAuthCache.googleAuth
  }

  const googleAuth = createGoogleAuth()
  vertexGoogleAuthCache = { cacheKey, googleAuth }
  return googleAuth
}

function createSkipVertexGoogleAuth(): VertexGoogleAuth {
  return {
    // Mock GoogleAuth for testing/proxy scenarios
    getClient: () => ({
      getRequestHeaders: () => ({}),
    }),
  }
}

export async function getMossenClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: MossenClientOptions['fetch']
  source?: string
}): Promise<MossenProviderSDK> {
  const containerId = process.env.MOSSEN_CODE_CONTAINER_ID
  const remoteSessionId = process.env.MOSSEN_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.MOSSEN_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const customBackend = getCustomBackendConfig()
  const customBackendHeaders = isCustomBackendEnabled()
    ? getCustomBackendAuthHeaders()
    : {}
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Mossen-Code-Session-Id': getSessionId(),
    ...customBackendHeaders,
    ...customHeaders,
    ...(containerId ? { 'x-mossen-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-mossen-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  // Log API client configuration for HFI debugging
  logForDebugging(
    `[API:request] Creating client, MOSSEN_CODE_CUSTOM_HEADERS present: ${!!process.env.MOSSEN_CODE_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Add additional protection header if enabled via env var
  const additionalProtectionEnabled = isEnvTruthy(
    process.env.MOSSEN_CODE_ADDITIONAL_PROTECTION,
  )
  if (additionalProtectionEnabled) {
    defaultHeaders['x-mossen-additional-protection'] = 'true'
  }

  if (isCustomBackendEnabled() && !customBackend) {
    throw new Error(
      'Custom backend mode requires MOSSEN_CODE_CUSTOM_BASE_URL to be set.',
    )
  }

  if (!isCustomBackendEnabled()) {
    await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession())
  }

  const resolvedFetch = buildFetch(fetchOverride, source)

  const ARGS = {
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({
      forProviderAPI: !isCustomBackendEnabled(),
    }) as MossenClientOptions['fetchOptions'],
    ...(resolvedFetch && {
      fetch: resolvedFetch,
    }),
  }
  if (
    isCustomBackendEnabled() &&
    customBackend &&
    getCustomBackendProtocol() === 'openai-compatible'
  ) {
    // Only `openai-compatible` translates canonical tool_use/tool_result into
    // OpenAI tool_calls/role:'tool' at this boundary. Messages-compatible
    // protocols keep canonical tool semantics and fall through to
    // MossenProviderSDK below.
    return createOpenAICompatibleClient({
      baseUrl: customBackend.baseUrl,
      defaultHeaders,
      fetch: resolvedFetch ?? globalThis.fetch,
      timeoutMs: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    }) as unknown as MossenProviderSDK
  }
  if (
    isCustomBackendEnabled() &&
    customBackend &&
    isMessagesCompatibleProtocol(getCustomBackendProtocol())
  ) {
    // Personal-edition messages-compatible providers should not require the
    // optional direct external-provider bridge package. Keep canonical
    // tool_use/tool_result payloads and speak the Messages HTTP API natively.
    return createMessagesCompatibleClient({
      baseUrl: customBackend.baseUrl,
      defaultHeaders,
      fetch: resolvedFetch ?? globalThis.fetch,
      timeoutMs: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    }) as unknown as MossenProviderSDK
  }
  if (isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK)) {
    const MossenBedrockProviderSDK = await loadMossenBedrockProviderSDK()
    // Use region override for small fast model if specified
    const awsRegion =
      model === getSmallFastModel() &&
      process.env.MOSSEN_CODE_SMALL_FAST_MODEL_AWS_REGION
        ? process.env.MOSSEN_CODE_SMALL_FAST_MODEL_AWS_REGION
        : getAWSRegion()

    const bedrockProviderOptions: Record<string, string> = {}
    if (process.env.MOSSEN_CODE_BEDROCK_BASE_URL) {
      bedrockProviderOptions.baseURL = process.env.MOSSEN_CODE_BEDROCK_BASE_URL
    }

    const bedrockArgs: BedrockClientOptions = {
      ...ARGS,
      ...bedrockProviderOptions,
      awsRegion,
      ...(isEnvTruthy(process.env.MOSSEN_CODE_SKIP_BEDROCK_AUTH) && {
        skipAuth: true,
      }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }

    // Add API key authentication if available
    if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
      bedrockArgs.skipAuth = true
      // Add the Bearer token for Bedrock API key authentication
      bedrockArgs.defaultHeaders = {
        ...bedrockArgs.defaultHeaders,
        Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
      }
    } else if (!isEnvTruthy(process.env.MOSSEN_CODE_SKIP_BEDROCK_AUTH)) {
      // Refresh auth and get credentials with cache clearing
      const cachedCredentials = await refreshAndGetAwsCredentials()
      if (cachedCredentials) {
        bedrockArgs.awsAccessKey = cachedCredentials.accessKeyId
        bedrockArgs.awsSecretKey = cachedCredentials.secretAccessKey
        bedrockArgs.awsSessionToken = cachedCredentials.sessionToken
      }
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new MossenBedrockProviderSDK(
      bedrockArgs,
    ) as unknown as MossenProviderSDK
  }
  if (isEnvTruthy(process.env.MOSSEN_CODE_USE_FOUNDRY)) {
    const MossenFoundryProviderSDK = await loadMossenFoundryProviderSDK()
    // Determine Azure AD token provider based on configuration
    const foundryApiKey = process.env.MOSSEN_CODE_FOUNDRY_API_KEY
    const foundryResource = process.env.MOSSEN_CODE_FOUNDRY_RESOURCE
    const foundryBaseURL =
      process.env.MOSSEN_CODE_FOUNDRY_BASE_URL ||
      (foundryResource
        ? `https://${foundryResource}.services.ai.azure.com${AZURE_FOUNDRY_MESSAGES_ROUTE}`
        : undefined)
    let azureADTokenProvider: (() => Promise<string>) | undefined
    if (!foundryApiKey) {
      if (isEnvTruthy(process.env.MOSSEN_CODE_SKIP_FOUNDRY_AUTH)) {
        // Mock token provider for testing/proxy scenarios (similar to Vertex mock GoogleAuth)
        azureADTokenProvider = () => Promise.resolve('')
      } else {
        // Use real Azure AD authentication with DefaultAzureCredential
        const {
          DefaultAzureCredential: AzureCredential,
          getBearerTokenProvider,
        } = await import('@azure/identity')
        azureADTokenProvider = getBearerTokenProvider(
          new AzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        )
      }
    }

    const foundryProviderOptions: Record<string, string> = {}
    if (foundryApiKey) {
      foundryProviderOptions.apiKey = foundryApiKey
    }
    if (foundryBaseURL) {
      foundryProviderOptions.baseURL = foundryBaseURL
    }

    const foundryArgs: ConstructorParameters<
      typeof MossenFoundryProviderSDK
    >[0] = {
      ...ARGS,
      ...foundryProviderOptions,
      ...(azureADTokenProvider && { azureADTokenProvider }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new MossenFoundryProviderSDK(
      foundryArgs,
    ) as unknown as MossenProviderSDK
  }
  if (isEnvTruthy(process.env.MOSSEN_CODE_USE_VERTEX)) {
    const skipVertexAuth = isEnvTruthy(process.env.MOSSEN_CODE_SKIP_VERTEX_AUTH)
    // Refresh GCP credentials if gcpAuthRefresh is configured and credentials are expired
    // This is similar to how we handle AWS credential refresh for Bedrock
    if (!skipVertexAuth) {
      await refreshGcpCredentialsIfNeeded()
    }

    const [MossenVertexProviderSDK, { GoogleAuth }] = await Promise.all([
      loadMossenVertexProviderSDK(),
      import('google-auth-library'),
    ])

    // Prevent metadata server timeout by providing projectId as fallback
    // google-auth-library checks project ID in this order:
    // 1. Environment variables (GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT, etc.)
    // 2. Credential files (service account JSON, ADC file)
    // 3. gcloud config
    // 4. GCE metadata server (causes 12s timeout outside GCP)
    //
    // We only set projectId if user hasn't configured other discovery methods
    // to avoid interfering with their existing auth setup

    // Check project environment variables in same order as google-auth-library
    // See: https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
    const projectEnvValue = getVertexProjectEnvValue()

    // Check for credential file paths (service account or ADC)
    // Note: We're checking both standard and lowercase variants to be safe,
    // though we should verify what google-auth-library actually checks
    const keyFileEnvValue = getVertexKeyFileEnvValue()
    const vertexProjectId = process.env.MOSSEN_CODE_VERTEX_PROJECT_ID

    const googleAuth = getCachedVertexGoogleAuth({
      cacheKey: buildVertexGoogleAuthCacheKey({
        skipAuth: skipVertexAuth,
        projectEnvValue,
        keyFileEnvValue,
        fallbackProjectId: vertexProjectId,
      }),
      createGoogleAuth: () =>
        skipVertexAuth
          ? createSkipVertexGoogleAuth()
          : new GoogleAuth({
              scopes: VERTEX_GOOGLE_AUTH_SCOPES,
              // Only use MOSSEN_CODE_VERTEX_PROJECT_ID as last resort fallback
              // This prevents the 12-second metadata server timeout when:
              // - No project env vars are set AND
              // - No credential keyfile is specified AND
              // - ADC file exists but lacks project_id field
              //
              // Risk: If auth project != API target project, this could cause billing/audit issues
              // Mitigation: Users can set GOOGLE_CLOUD_PROJECT to override
              ...(projectEnvValue || keyFileEnvValue
                ? {}
                : {
                    projectId: vertexProjectId,
                  }),
            }),
    })

    const vertexProviderOptions: Record<string, string> = {}
    if (process.env.MOSSEN_CODE_VERTEX_BASE_URL) {
      vertexProviderOptions.baseURL = process.env.MOSSEN_CODE_VERTEX_BASE_URL
    }
    if (process.env.MOSSEN_CODE_VERTEX_PROJECT_ID) {
      vertexProviderOptions.projectId = process.env.MOSSEN_CODE_VERTEX_PROJECT_ID
    }

    const vertexArgs: ConstructorParameters<typeof MossenVertexProviderSDK>[0] = {
      ...ARGS,
      ...vertexProviderOptions,
      region: getVertexRegionForModel(model),
      googleAuth,
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new MossenVertexProviderSDK(
      vertexArgs,
    ) as unknown as MossenProviderSDK
  }

  // Determine authentication method based on available tokens
  const clientConfig: ConstructorParameters<typeof MossenProviderSDK>[0] = {
    apiKey: isCustomBackendEnabled()
      ? (customBackend?.apiKey ??
        (customBackend?.authToken ? undefined : 'custom-backend'))
      : apiKey || getMossenApiKey(),
    authToken: isCustomBackendEnabled()
      ? customBackend?.authToken ?? undefined
      : undefined,
    ...(isCustomBackendEnabled() && customBackend
      ? { baseURL: customBackend.baseUrl }
      : { baseURL: getMossenApiBaseUrl() }),
    ...ARGS,
    ...(isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  return new MossenProviderSDK(clientConfig)
}

async function configureApiKeyHeaders(
  headers: Record<string, string>,
  isNonInteractiveSession: boolean,
): Promise<void> {
  const token =
    process.env.MOSSEN_CODE_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper(isNonInteractiveSession))
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
}

function getMossenApiBaseUrl(): string {
  if (process.env.MOSSEN_CODE_API_BASE_URL) {
    return process.env.MOSSEN_CODE_API_BASE_URL
  }
  if (isHostedAuthAdapterEnabled()) {
    return getOauthConfig().BASE_API_URL
  }
  throw new Error(
    'No Mossen backend is configured. For personal edition, set MOSSEN_CODE_CUSTOM_BASE_URL and MOSSEN_CODE_CUSTOM_API_KEY (or MOSSEN_CODE_CUSTOM_AUTH_TOKEN), or set MOSSEN_CODE_API_BASE_URL for an explicit hosted adapter.',
  )
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.MOSSEN_CODE_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function buildFetch(
  fetchOverride: MossenClientOptions['fetch'],
  source: string | undefined,
): MossenClientOptions['fetch'] {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const inner = fetchOverride ?? globalThis.fetch
  // Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
  // and unknown headers risk rejection by strict proxies (inc-4029 class).
  const injectClientRequestId =
    getAPIProvider() === 'firstParty' && isFirstPartyMossenBaseUrl()
  return (input, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    // Generate a client-side request ID so timeouts (which return no server
    // request ID) can still be correlated with server logs by the API team.
    // Callers that want to track the ID themselves can pre-set the header.
    if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'}`,
      )
    } catch {
      // never let logging crash the fetch
    }
    return inner(input, { ...init, headers })
  }
}
