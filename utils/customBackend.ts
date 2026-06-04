import { isEnvDefinedFalsy, isEnvTruthy } from './envBooleans.js'
import {
  getActiveProfile,
  looksLikeMessagesCompatibleBaseUrl,
  resolveProfileApiKey,
  type ProfileSchema,
} from '../services/config/profiles.js'

export { looksLikeMessagesCompatibleBaseUrl } from '../services/config/profiles.js'

/**
 * S1-09b: backend reader 内部 helper. 优先级: active profile > 旧 env > null.
 * 任何 getter 在改 profile-aware 前都先调它拿当前 active profile (可能 null).
 *
 * 注意: 不缓存; getActiveProfile 内部读 facade chain (含 settings.json 读盘).
 * 8 getter 在同一 query 调多次 → 8 次读盘. 与原 process.env 读相比可接受.
 * 如未来真成瓶颈, 可在 S2+ 阶段加 mtime/进程内缓存.
 */
function activeProfileOrNull(): ProfileSchema | null {
  try {
    return getActiveProfile()
  } catch {
    // facade 任何异常 → fallback 到旧 env 路径; 不向 105 consumer 抛
    return null
  }
}

export type CustomBackendConfig = {
  apiKey: null | string
  authToken: null | string
  baseUrl: string
  headers: Record<string, string>
  maxInputTokens: null | number
  model: null | string
  name: string
  protocol: CustomBackendProtocol
}

export const MESSAGES_COMPATIBLE_PROTOCOL = 'messages-compatible' as const

export const CUSTOM_BACKEND_PROTOCOLS = [
  'mossen-compatible',
  'openai-compatible',
  MESSAGES_COMPATIBLE_PROTOCOL,
  'private',
] as const

export type CustomBackendProtocol = (typeof CUSTOM_BACKEND_PROTOCOLS)[number]

export function isMessagesCompatibleProtocol(protocol: string): boolean {
  return (
    protocol === 'mossen-compatible' ||
    protocol === MESSAGES_COMPATIBLE_PROTOCOL
  )
}

function normalizeProtocolForBaseUrl(
  protocol: CustomBackendProtocol,
  baseUrl: null | string | undefined,
): CustomBackendProtocol {
  if (
    protocol === 'openai-compatible' &&
    looksLikeMessagesCompatibleBaseUrl(baseUrl)
  ) {
    return MESSAGES_COMPATIBLE_PROTOCOL
  }
  return protocol
}

export type ChromeIntegrationUrls = {
  docsUrl: string
  extensionUrl: string
  focusTabUrlBase: string
  permissionsUrl: string
  reconnectUrl: string
}

export type HostedPlatformUrls = {
  bedrockDocsUrl: string
  connectorsUrl: string
  desktopDocsUrl: string
  desktopMacDownloadUrl: string
  desktopWindowsDownloadUrl: string
  foundryDocsUrl: string
  githubAppUrl: string
  githubActionsDocsUrl: string
  privacyUrl: string
  remoteBaseUrl: string
  remoteEnvironmentUrl: string
  remoteSetupUrl: string
  remoteWebUrl: string
  securityDocsUrl: string
  upgradeUrl: string
  usageUrl: string
  vertexDocsUrl: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function strip1mSuffix(value: string): string {
  return value.replace(/\[1m\]$/i, '').trim()
}

export function isPlaceholderHostedPlatformUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    // W146.2 P2-6: also flag the RFC 6761 reserved `.invalid` TLD
    // (and the literal `mossen.invalid` brand-neutral fallback used
    // when MOSSEN_CODE_PLATFORM_BASE_URL is unset). Without this
    // hasConfiguredHostedPlatformUrls() reported `true` for URLs that
    // can never resolve — masking missing operator setup.
    return (
      hostname === 'platform.example' ||
      hostname.endsWith('.example') ||
      hostname === 'invalid' ||
      hostname.endsWith('.invalid')
    )
  } catch {
    return true
  }
}

export function hasConfiguredHostedPlatformUrls(): boolean {
  if (!isCustomBackendEnabled()) {
    return true
  }

  const urls = getHostedPlatformUrls()
  return Object.values(urls).every(url => !isPlaceholderHostedPlatformUrl(url))
}

export function hasConfiguredChromeIntegrationUrls(): boolean {
  if (!isCustomBackendEnabled()) {
    return true
  }

  const urls = getChromeIntegrationUrls()
  return (
    !isPlaceholderHostedPlatformUrl(urls.docsUrl) &&
    !isPlaceholderHostedPlatformUrl(urls.extensionUrl) &&
    !isPlaceholderHostedPlatformUrl(urls.focusTabUrlBase) &&
    !isPlaceholderHostedPlatformUrl(urls.permissionsUrl) &&
    !isPlaceholderHostedPlatformUrl(urls.reconnectUrl)
  )
}

export function hasConfiguredFeedbackUrls(): boolean {
  if (!isCustomBackendEnabled()) {
    return true
  }

  const remoteBaseUrl = getHostedPlatformUrls().remoteBaseUrl
  const issueUrl =
    process.env.MOSSEN_CODE_PLATFORM_ISSUES_URL?.trim() ||
    `${remoteBaseUrl}/support/issues`
  const feedbackUrl =
    process.env.MOSSEN_CODE_PLATFORM_FEEDBACK_URL?.trim() ||
    `${remoteBaseUrl}/api/feedback`

  return (
    !isPlaceholderHostedPlatformUrl(issueUrl) &&
    !isPlaceholderHostedPlatformUrl(feedbackUrl)
  )
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) {
    return {}
  }

  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => {
            return typeof entry[0] === 'string' && typeof entry[1] === 'string'
          })
          .map(([key, value]) => [key.trim(), value.trim()]),
      )
    } catch {
      return {}
    }
  }

  const headers: Record<string, string> = {}
  for (const line of trimmed.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }
    const name = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (name) {
      headers[name] = value
    }
  }
  return headers
}

function resolveCustomFeatureFlag(
  envName: string,
  defaultValueWhenCustomBackend = false,
): boolean {
  if (isEnvTruthy(process.env[envName])) {
    return true
  }
  if (isEnvDefinedFalsy(process.env[envName])) {
    return false
  }
  return isCustomBackendEnabled() ? defaultValueWhenCustomBackend : false
}

export function isCustomBackendEnabled(): boolean {
  // S1-09b: active profile 存在 → 视为启用 (即使没有 MOSSEN_CODE_USE_CUSTOM_BACKEND 旧 env)
  if (activeProfileOrNull()) return true
  return (
    isEnvTruthy(process.env.MOSSEN_CODE_USE_CUSTOM_BACKEND) ||
    !!process.env.MOSSEN_CODE_CUSTOM_BASE_URL
  )
}

export function getCustomBackendBaseUrl(): null | string {
  const profile = activeProfileOrNull()
  if (profile?.baseURL) return trimTrailingSlash(profile.baseURL)
  const raw = process.env.MOSSEN_CODE_CUSTOM_BASE_URL?.trim()
  return raw ? trimTrailingSlash(raw) : null
}

export function getCustomBackendApiKey(): null | string {
  const profile = activeProfileOrNull()
  if (profile) {
    const credential = resolveProfileApiKey(profile)
    if (credential.apiKey) return credential.apiKey
  }
  return process.env.MOSSEN_CODE_CUSTOM_API_KEY?.trim() || null
}

export function getCustomBackendAuthToken(): null | string {
  // ProfileSchema 当前不含 authToken 字段; env fallback only.
  //
  // W146.2 P2-7: when an active profile defines an apiKey, suppress the
  // env-based authToken so we don't accidentally cross-pollinate
  // credentials from a previously-active backend's exported env. The
  // profile shape carries no authToken slot today, so the only correct
  // semantics for "profile X is active and has its own apiKey" is to
  // use the profile's apiKey via getCustomBackendApiKey() and ignore
  // any stale MOSSEN_CODE_CUSTOM_AUTH_TOKEN exported in this shell.
  // Pure env-only configs are unaffected (no profile → env fallback).
  const profile = activeProfileOrNull()
  if (profile && resolveProfileApiKey(profile).apiKey) return null
  return process.env.MOSSEN_CODE_CUSTOM_AUTH_TOKEN?.trim() || null
}

export function getCustomBackendModel(): null | string {
  const profile = activeProfileOrNull()
  if (profile?.model) return profile.model
  return process.env.MOSSEN_CODE_CUSTOM_MODEL?.trim() || null
}

export function getCustomBackendMaxInputTokens(): null | number {
  const profile = activeProfileOrNull()
  if (profile) {
    return profile.maxInputTokens ?? null
  }
  const raw = process.env.MOSSEN_CODE_CUSTOM_MAX_INPUT_TOKENS?.trim()
  if (!raw) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function customBackendCapabilityAppliesToModel(model: string): boolean {
  if (!isCustomBackendEnabled()) {
    return false
  }
  const configuredModel = getCustomBackendModel()
  if (!configuredModel) {
    return true
  }
  return (
    strip1mSuffix(model).toLowerCase() ===
    strip1mSuffix(configuredModel).toLowerCase()
  )
}

export function getCustomBackendHeaders(): Record<string, string> {
  return parseHeaders(process.env.MOSSEN_CODE_CUSTOM_HEADERS)
}

function hasHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): boolean {
  const target = name.toLowerCase()
  return Object.keys(headers).some(key => key.toLowerCase() === target)
}

function deleteHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): void {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      delete headers[key]
    }
  }
}

function deleteKnownAuthHeaders(headers: Record<string, string>): void {
  deleteHeaderCaseInsensitive(headers, 'Authorization')
  deleteHeaderCaseInsensitive(headers, 'x-api-key')
}

export function getCustomBackendAuthHeaders(): Record<string, string> {
  const headers = { ...getCustomBackendHeaders() }
  const profile = activeProfileOrNull()
  const profileApiKey = profile ? resolveProfileApiKey(profile).apiKey : null
  const authToken = getCustomBackendAuthToken()
  const apiKey = getCustomBackendApiKey()
  const protocol = getCustomBackendProtocol()

  if (profileApiKey && apiKey) {
    // Active profiles own authentication. Keep non-auth custom headers, but
    // prevent stale env-level Authorization/x-api-key values from a previously
    // exported backend from shadowing the selected profile's apiKey.
    deleteKnownAuthHeaders(headers)
    if (protocol === 'openai-compatible') {
      headers.Authorization = `Bearer ${apiKey}`
    } else {
      headers['x-api-key'] = apiKey
    }
    return headers
  }

  if (authToken && !hasHeaderCaseInsensitive(headers, 'Authorization')) {
    headers.Authorization = `Bearer ${authToken}`
  }
  if (
    apiKey &&
    !hasHeaderCaseInsensitive(headers, 'x-api-key') &&
    !hasHeaderCaseInsensitive(headers, 'Authorization')
  ) {
    // openai-compatible 走 OpenAI 官方约定 `Authorization: Bearer <key>` —
    // qwen/GLM 两者都接受 (历史 x-api-key 跑得通), MiniMax 只接受 Bearer
    // (x-api-key → 401). Bearer 是 OpenAI 协议唯一通用标准.
    // mossen-compatible protocol uses x-api-key header style for backward compatibility.
    if (protocol === 'openai-compatible') {
      headers.Authorization = `Bearer ${apiKey}`
    } else {
      headers['x-api-key'] = apiKey
    }
  }

  return headers
}

export function hasCustomBackendAuth(): boolean {
  return Object.keys(getCustomBackendAuthHeaders()).length > 0
}

export function getCustomBackendName(): string {
  const profile = activeProfileOrNull()
  if (profile) {
    return profile.name?.trim() || profile.model || 'Custom backend'
  }
  return process.env.MOSSEN_CODE_CUSTOM_NAME?.trim() || 'Custom backend'
}

export function getCustomBackendProtocol(): CustomBackendProtocol {
  const profile = activeProfileOrNull()
  if (profile) {
    if ((CUSTOM_BACKEND_PROTOCOLS as readonly string[]).includes(profile.provider)) {
      return normalizeProtocolForBaseUrl(
        profile.provider as CustomBackendProtocol,
        profile.baseURL,
      )
    }
  }
  const value = process.env.MOSSEN_CODE_CUSTOM_BACKEND_PROTOCOL?.trim()
  if (
    value &&
    (CUSTOM_BACKEND_PROTOCOLS as readonly string[]).includes(value)
  ) {
    return normalizeProtocolForBaseUrl(
      value as CustomBackendProtocol,
      getCustomBackendBaseUrl(),
    )
  }
  if (looksLikeMessagesCompatibleBaseUrl(getCustomBackendBaseUrl())) {
    return MESSAGES_COMPATIBLE_PROTOCOL
  }
  return 'mossen-compatible'
}

export function isCustomChromeEnabled(): boolean {
  return resolveCustomFeatureFlag('MOSSEN_CODE_ENABLE_CHROME', false)
}

export function isCustomVoiceEnabled(): boolean {
  return (
    resolveCustomFeatureFlag('MOSSEN_CODE_ENABLE_VOICE', true) &&
    hasCustomBackendAuth()
  )
}

export function hasChromeCommandAccess(): boolean {
  return isCustomChromeEnabled() && hasConfiguredChromeIntegrationUrls()
}

export function getChromeIntegrationUrls(): ChromeIntegrationUrls {
  const isCustomBackend = isCustomBackendEnabled()
  const remoteBaseUrl =
    process.env.MOSSEN_CODE_PLATFORM_BASE_URL?.trim() ||
    (isCustomBackend ? 'https://platform.example' : 'https://platform.mossen.invalid')
  return {
    extensionUrl:
      process.env.MOSSEN_CODE_CHROME_EXTENSION_URL?.trim() ||
      `${remoteBaseUrl}/chrome`,
    focusTabUrlBase:
      process.env.MOSSEN_CODE_CHROME_FOCUS_TAB_URL_BASE?.trim() ||
      `${remoteBaseUrl}/chrome/tab/`,
    permissionsUrl:
      process.env.MOSSEN_CODE_CHROME_PERMISSIONS_URL?.trim() ||
      `${remoteBaseUrl}/chrome/permissions`,
    reconnectUrl:
      process.env.MOSSEN_CODE_CHROME_RECONNECT_URL?.trim() ||
      `${remoteBaseUrl}/chrome/reconnect`,
    docsUrl:
      process.env.MOSSEN_CODE_CHROME_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/chrome`,
  }
}

export function getHostedPlatformUrls(): HostedPlatformUrls {
  const isCustomBackend = isCustomBackendEnabled()
  const remoteBaseUrl =
    process.env.MOSSEN_CODE_PLATFORM_BASE_URL?.trim() ||
    (isCustomBackend ? 'https://platform.example' : 'https://platform.mossen.invalid')
  const remoteWebUrl =
    process.env.MOSSEN_CODE_PLATFORM_WEB_URL?.trim() || `${remoteBaseUrl}/code`

  return {
    bedrockDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_BEDROCK_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/providers/amazon-bedrock`,
    connectorsUrl:
      process.env.MOSSEN_CODE_PLATFORM_CONNECTORS_URL?.trim() ||
      `${remoteBaseUrl}/settings/connectors`,
    desktopDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_DESKTOP_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/desktop`,
    desktopMacDownloadUrl:
      process.env.MOSSEN_CODE_PLATFORM_DESKTOP_MAC_URL?.trim() ||
      `${remoteBaseUrl}/downloads/desktop/macos`,
    desktopWindowsDownloadUrl:
      process.env.MOSSEN_CODE_PLATFORM_DESKTOP_WINDOWS_URL?.trim() ||
      `${remoteBaseUrl}/downloads/desktop/windows`,
    foundryDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_FOUNDRY_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/providers/microsoft-foundry`,
    githubAppUrl:
      process.env.MOSSEN_CODE_PLATFORM_GITHUB_APP_URL?.trim() ||
      `${remoteBaseUrl}/integrations/github/install`,
    githubActionsDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_GITHUB_ACTIONS_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/github-actions`,
    privacyUrl:
      process.env.MOSSEN_CODE_PLATFORM_PRIVACY_URL?.trim() ||
      `${remoteBaseUrl}/settings/privacy`,
    remoteBaseUrl,
    remoteEnvironmentUrl:
      process.env.MOSSEN_CODE_PLATFORM_REMOTE_ENV_URL?.trim() ||
      `${remoteWebUrl}/environments`,
    remoteSetupUrl:
      process.env.MOSSEN_CODE_PLATFORM_REMOTE_SETUP_URL?.trim() ||
      `${remoteWebUrl}/setup`,
    remoteWebUrl,
    securityDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_SECURITY_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/security`,
    upgradeUrl:
      process.env.MOSSEN_CODE_PLATFORM_UPGRADE_URL?.trim() ||
      `${remoteBaseUrl}/billing/upgrade`,
    usageUrl:
      process.env.MOSSEN_CODE_PLATFORM_USAGE_URL?.trim() ||
      `${remoteBaseUrl}/billing/usage`,
    vertexDocsUrl:
      process.env.MOSSEN_CODE_PLATFORM_VERTEX_DOCS_URL?.trim() ||
      `${remoteBaseUrl}/docs/providers/google-vertex-ai`,
  }
}

export function getDesktopCompanionName(): string {
  return 'Mossen Desktop'
}

export function getCustomVoiceStreamBaseUrl(): null | string {
  const explicit = process.env.MOSSEN_CODE_CUSTOM_VOICE_BASE_URL?.trim()
  if (explicit) {
    return trimTrailingSlash(explicit)
  }
  return getCustomBackendBaseUrl()
}

export function getCustomBackendConfig(): CustomBackendConfig | null {
  if (!isCustomBackendEnabled()) {
    return null
  }

  const baseUrl = getCustomBackendBaseUrl()
  if (!baseUrl) {
    return null
  }

  return {
    apiKey: getCustomBackendApiKey(),
    authToken: getCustomBackendAuthToken(),
    baseUrl,
    headers: getCustomBackendAuthHeaders(),
    maxInputTokens: getCustomBackendMaxInputTokens(),
    model: getCustomBackendModel(),
    name: getCustomBackendName(),
    protocol: getCustomBackendProtocol(),
  }
}
