export type HostedOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
}

export type McpOAuthDiscoveryState = {
  authorizationServerUrl?: string
  resourceMetadataUrl?: string
  resourceMetadata?: unknown
  authorizationServerMetadata?: unknown
}

export type McpOAuthEntry = {
  serverName?: string
  serverUrl?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  clientId?: string
  clientSecret?: string
  stepUpScope?: string
  discoveryState?: McpOAuthDiscoveryState
  [key: string]: unknown
}

export type McpOAuthClientConfigEntry = {
  clientSecret?: string
  [key: string]: unknown
}

export type McpXaaIdpEntry = {
  idToken: string
  expiresAt: number
}

export type McpXaaIdpConfigEntry = {
  clientSecret?: string
}

export type SecureStorageData = {
  primaryApiKey?: string
  hostedOauth?: HostedOAuthTokens
  mcpOAuth?: Record<string, McpOAuthEntry>
  mcpOAuthClientConfig?: Record<string, McpOAuthClientConfigEntry>
  mcpXaaIdp?: Record<string, McpXaaIdpEntry>
  mcpXaaIdpConfig?: Record<string, McpXaaIdpConfigEntry>
  pluginSecrets?: Record<string, Record<string, string>>
  [key: string]: unknown
}

export type SecureStorage = {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}
