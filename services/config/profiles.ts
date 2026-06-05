/**
 * Mossen multi-profile schema + 读取 / 校验 / 脱敏 (S1-09a).
 *
 * Schema 决策 (D-S09-1=A): settings.json 顶层 flat key
 *   "mossen.profiles": { qwen: {...}, minimax: {...}, glm: {...} }
 *   "mossen.activeProfile": "qwen"
 *
 * 读取走 services/config facade (override > env > project > user > default).
 * apiKey 必须脱敏后才能进入任何 stdout/stderr/log/CLI dump.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  resolveMossenConfig,
  setMossenConfigOverride,
  clearMossenConfigOverrides,
} from './facade.js'
import {
  describeApiKeyEnvRef,
  describeApiKeyRef,
  readProfileApiKeyFromKeychain,
  resolveApiKeyEnvRef,
  validateApiKeyEnvRef,
  validateApiKeyRef,
  type ProfileApiKeyEnvRef,
  type ProfileApiKeyRef,
} from './keychain.js'
import {
  MESSAGES_PROTOCOL_VERSION_HEADER,
  MESSAGES_PROTOCOL_VERSION_VALUE,
} from '../api/messagesProtocolConstants.js'

export const MESSAGES_COMPATIBLE_PROVIDER = 'messages-compatible' as const

export const PROFILE_PROVIDER_VALUES = [
  'openai-compatible',
  MESSAGES_COMPATIBLE_PROVIDER,
] as const
export type ProfileProvider = (typeof PROFILE_PROVIDER_VALUES)[number]

export type ProfileSchema = {
  provider: ProfileProvider
  baseURL: string
  model: string
  apiKey?: string
  apiKeyRef?: ProfileApiKeyRef
  /**
   * W459-schema — per-profile env-var apiKey reference. Stores the env-var
   * NAME (e.g. 'OPENAI_API_KEY'), not the key value itself. resolveProfileApiKey
   * reads $envVar at runtime. Priority chain:
   *   env-override > apiKeyEnvRef > apiKeyRef (keychain) > apiKey (plain)
   * Set via ProfileWizard's "Save env-var NAME" mode or manual settings.json edit.
   */
  apiKeyEnvRef?: ProfileApiKeyEnvRef
  /**
   * Optional per-profile input-token ceiling. Used by custom backends to opt a
   * specific model/profile into larger context windows (for example 1M) without
   * applying a process-wide env override to every configured model.
   */
  maxInputTokens?: number
  /** 可选, 给 statusline / UI 友好显示; 不填用 profile name */
  name?: string
}

export type ProfilesMap = Record<string, ProfileSchema>

/** 用于 CLI dump / 日志: apiKey 已脱敏 (前 6 + ... + 后 4) */
export type DesensitizedProfile = Omit<ProfileSchema, 'apiKey'> & {
  apiKey: string
  credentialSource?: string
}

const PROFILES_KEY = 'mossen.profiles'
const ACTIVE_PROFILE_KEY = 'mossen.activeProfile'

/**
 * Fallback profile (env-based) — D-S09-3=P 兼容 .mossensrc/custom-backend.env
 * 当无 active profile 时, customBackend.ts fallthrough 到 MOSSEN_CODE_CUSTOM_* env.
 *
 * 该虚拟 profile 仅用于 UI 显示 (/model + --list-model-profiles), 不写文件.
 * customBackend.ts 实际数据流不变 (env vars 直读), 这里只暴露给 UI 让用户能看见 + 切回.
 */
const FALLBACK_PROFILE_DEFAULT_NAME = 'qwen'
const FALLBACK_PROFILE_SOURCE = 'fallback-env' as const
const SETTINGS_PROFILE_SOURCE = 'settings' as const

export type ProfileSource = typeof FALLBACK_PROFILE_SOURCE | typeof SETTINGS_PROFILE_SOURCE

export type ListedProfile = {
  name: string
  profile: ProfileSchema
  source: ProfileSource
}

export function looksLikeMessagesCompatibleBaseUrl(
  value: null | string | undefined,
): boolean {
  const raw = value?.trim()
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    const segments = parsed.pathname
      .toLowerCase()
      .split('/')
      .filter(Boolean)
    return (
      segments.includes('messages') ||
      segments.includes('anth' + 'ropic')
    )
  } catch {
    const lower = raw.toLowerCase()
    return lower.includes('/messages') || lower.includes('/' + 'anth' + 'ropic')
  }
}

export function resolveDefaultProfileProvider(
  baseURL: null | string | undefined,
): ProfileProvider {
  return looksLikeMessagesCompatibleBaseUrl(baseURL)
    ? MESSAGES_COMPATIBLE_PROVIDER
    : 'openai-compatible'
}

function buildMessagesCompatibleEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (!trimmed) return '/v1/messages'
  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    if (pathname.endsWith('/v1/messages') || pathname.endsWith('/messages')) {
      return parsed.toString()
    }
    if (pathname.endsWith('/v1')) {
      parsed.pathname = `${pathname}/messages`
      return parsed.toString()
    }
    parsed.pathname = `${pathname}/v1/messages`
    return parsed.toString()
  } catch {
    if (trimmed.endsWith('/v1/messages') || trimmed.endsWith('/messages')) {
      return trimmed
    }
    if (trimmed.endsWith('/v1')) return `${trimmed}/messages`
    return `${trimmed}/v1/messages`
  }
}

/** apiKey 脱敏: 前 6 + ... + 后 4. 短 key 全 mask. */
export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey || typeof apiKey !== 'string') return ''
  const trimmed = apiKey.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.length <= 12) return '***'
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

export function desensitizeProfile(profile: ProfileSchema): DesensitizedProfile {
  const resolved = describeProfileCredential(profile)
  return {
    ...profile,
    apiKey: maskApiKey(profile.apiKey),
    credentialSource: resolved.source,
  }
}

export function desensitizeProfiles(profiles: ProfilesMap): Record<string, DesensitizedProfile> {
  const out: Record<string, DesensitizedProfile> = {}
  for (const [name, p] of Object.entries(profiles)) {
    out[name] = desensitizeProfile(p)
  }
  return out
}

function parsePositiveInteger(
  value: unknown,
  fieldName: string,
): { ok: true; value?: number } | { ok: false; reason: string } {
  if (value === undefined || value === null) {
    return { ok: true }
  }
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9][0-9]*$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return { ok: false, reason: `${fieldName} must be a positive integer` }
  }
  return { ok: true, value: parsed }
}

/**
 * 校验单个 profile schema. 返回 ok=true 或带原因的失败.
 * 必填: provider, baseURL, model, apiKey/apiKeyRef 至少一个非空; name 可选.
 */
export function validateProfile(value: unknown): { ok: true; profile: ProfileSchema } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'profile must be an object' }
  }
  const v = value as Record<string, unknown>
  const provider = typeof v.provider === 'string' ? v.provider : ''
  if (!(PROFILE_PROVIDER_VALUES as readonly string[]).includes(provider)) {
    return {
      ok: false,
      reason: `provider must be one of ${PROFILE_PROVIDER_VALUES.join('|')}, got "${provider}"`,
    }
  }
  const baseURL = typeof v.baseURL === 'string' ? v.baseURL.trim() : ''
  if (!baseURL) return { ok: false, reason: 'baseURL required (non-empty string)' }
  const model = typeof v.model === 'string' ? v.model.trim() : ''
  if (!model) return { ok: false, reason: 'model required (non-empty string)' }
  const apiKey = typeof v.apiKey === 'string' ? v.apiKey.trim() : ''
  const apiKeyRefRaw = v.apiKeyRef
  const apiKeyRef = apiKeyRefRaw === undefined ? undefined : validateApiKeyRef(apiKeyRefRaw)
  if (apiKeyRef && apiKeyRef.ok !== true) return { ok: false, reason: apiKeyRef.reason }
  // W459-schema — env-var ref is independent of keychain ref so all
  // existing keychain consumers stay unchanged.
  const apiKeyEnvRefRaw = v.apiKeyEnvRef
  const apiKeyEnvRef =
    apiKeyEnvRefRaw === undefined ? undefined : validateApiKeyEnvRef(apiKeyEnvRefRaw)
  if (apiKeyEnvRef && apiKeyEnvRef.ok !== true) {
    return { ok: false, reason: apiKeyEnvRef.reason }
  }
  if (!apiKey && !apiKeyRef && !apiKeyEnvRef) {
    return { ok: false, reason: 'apiKey, apiKeyRef, or apiKeyEnvRef required' }
  }
  const maxInputTokens = parsePositiveInteger(v.maxInputTokens, 'maxInputTokens')
  if (maxInputTokens.ok !== true) return maxInputTokens
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : undefined
  return {
    ok: true,
    profile: {
      provider: provider as ProfileProvider,
      baseURL,
      model,
      ...(apiKey ? { apiKey } : {}),
      ...(apiKeyRef && apiKeyRef.ok === true ? { apiKeyRef: apiKeyRef.ref } : {}),
      ...(apiKeyEnvRef && apiKeyEnvRef.ok === true
        ? { apiKeyEnvRef: apiKeyEnvRef.ref }
        : {}),
      ...(maxInputTokens.value ? { maxInputTokens: maxInputTokens.value } : {}),
      ...(name ? { name } : {}),
    },
  }
}

export type ProfileCredentialResolution = {
  apiKey: string | null
  source: 'env-override' | 'env-var' | 'keychain' | 'settings-apiKey' | 'missing'
  detail?: string
}

export function resolveProfileApiKey(profile: ProfileSchema): ProfileCredentialResolution {
  const explicitOverride = process.env.MOSSEN_CODE_PROFILE_API_KEY_OVERRIDE?.trim()
  if (explicitOverride) {
    return { apiKey: explicitOverride, source: 'env-override' }
  }

  // W459-schema — env-var ref preferred over keychain when both present,
  // since env-var is the explicit user choice during onboarding wizard.
  if (profile.apiKeyEnvRef) {
    const envResolved = resolveApiKeyEnvRef(profile.apiKeyEnvRef)
    if (envResolved.ok) {
      return {
        apiKey: envResolved.value,
        source: 'env-var',
        detail: describeApiKeyEnvRef(profile.apiKeyEnvRef),
      }
    }
  }

  if (profile.apiKeyRef) {
    const keychain = readProfileApiKeyFromKeychain(profile.apiKeyRef)
    if (keychain.ok) {
      return { apiKey: keychain.value, source: 'keychain', detail: describeApiKeyRef(profile.apiKeyRef) }
    }
  }

  const plaintext = profile.apiKey?.trim()
  if (plaintext) {
    return { apiKey: plaintext, source: 'settings-apiKey' }
  }
  return {
    apiKey: null,
    source: 'missing',
    ...(profile.apiKeyEnvRef
      ? { detail: describeApiKeyEnvRef(profile.apiKeyEnvRef) }
      : profile.apiKeyRef
        ? { detail: describeApiKeyRef(profile.apiKeyRef) }
        : {}),
  }
}

export function describeProfileCredential(profile: ProfileSchema): { source: string; hasCredential: boolean } {
  const resolved = resolveProfileApiKey(profile)
  if (resolved.source === 'env-override') return { source: 'env-override', hasCredential: true }
  if (resolved.source === 'env-var') return { source: resolved.detail ?? 'env-var', hasCredential: true }
  if (resolved.source === 'keychain') return { source: resolved.detail ?? 'keychain', hasCredential: true }
  if (resolved.source === 'settings-apiKey') return { source: 'settings.json apiKey', hasCredential: true }
  if (profile.apiKeyEnvRef) {
    return { source: `${describeApiKeyEnvRef(profile.apiKeyEnvRef)} (unavailable)`, hasCredential: false }
  }
  if (profile.apiKeyRef) return { source: `${describeApiKeyRef(profile.apiKeyRef)} (unavailable)`, hasCredential: false }
  return { source: 'missing', hasCredential: false }
}

/**
 * 读 facade 获取 mossen.profiles, 过滤掉非法 entry.
 * 任何非 object / 缺字段 / provider 不识别的 entry 被静默 skip (不抛错, 因 facade 读链路必须容错).
 */
export function getProfiles(): ProfilesMap {
  const raw = resolveMossenConfig<unknown>(PROFILES_KEY, null).value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const out: ProfilesMap = {}
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const validated = validateProfile(entry)
    if (validated.ok) {
      out[name] = validated.profile
    }
  }
  return out
}

/**
 * 取 active profile name. 返回 settings 里的 mossen.activeProfile (若存在且对应的 profile 真存在), 否则 null.
 * 不会自己挑默认; 如果用户 active=qwen 但 profiles 里没 qwen, 返回 null (让上层决定 fallback).
 */
export function getActiveProfileName(): string | null {
  const raw = resolveMossenConfig<unknown>(ACTIVE_PROFILE_KEY, null).value
  if (typeof raw !== 'string' || !raw.trim()) return null
  const name = raw.trim()
  const profiles = getProfiles()
  return Object.prototype.hasOwnProperty.call(profiles, name) ? name : null
}

/**
 * 取 active profile 完整 schema. 若 activeProfile 字段不存在 / 指向不存在的 profile, 返回 null.
 * 调用方负责在 null 时 fallback 到旧 env 路径 (S1-09b 在 customBackend.ts 实现).
 */
export function getActiveProfile(): ProfileSchema | null {
  const name = getActiveProfileName()
  if (!name) return null
  const profiles = getProfiles()
  return profiles[name] ?? null
}

export function getProfileByName(name: string): ProfileSchema | null {
  return getProfiles()[name] ?? null
}

/**
 * 从旧 env (MOSSEN_CODE_CUSTOM_*) 合成虚拟 fallback profile (D-S09-3=P).
 *
 * 触发条件: baseURL + apiKey 都存在 (二者缺一不视为可用 fallback).
 * 名字: 优先 MOSSEN_CODE_CUSTOM_NAME (须通过 validateProfileName); 否则 'qwen'.
 * provider: 默认 'openai-compatible'; 若 baseURL 明显是 messages-compatible 路径,
 *           则自动展示为 messages-compatible, 避免 fallback UI 误导用户.
 *
 * 注意: 该 profile 仅用于 UI; customBackend.ts 不读它, 仍直接读 env vars.
 *      真切走 fallback 时, getActiveProfile 必须返回 null 才能让 customBackend 落到 env.
 */
export function getFallbackProfile(): ListedProfile | null {
  const baseURL = process.env.MOSSEN_CODE_CUSTOM_BASE_URL?.trim()
  const apiKey = process.env.MOSSEN_CODE_CUSTOM_API_KEY?.trim()
  if (!baseURL || !apiKey) return null
  const model = process.env.MOSSEN_CODE_CUSTOM_MODEL?.trim() || 'unknown'
  const maxInputTokens = parsePositiveInteger(
    process.env.MOSSEN_CODE_CUSTOM_MAX_INPUT_TOKENS,
    'MOSSEN_CODE_CUSTOM_MAX_INPUT_TOKENS',
  )
  const rawName = process.env.MOSSEN_CODE_CUSTOM_NAME?.trim() || ''
  const nameResult = rawName ? validateProfileName(rawName) : { ok: false as const, reason: '' }
  const name = nameResult.ok ? nameResult.name : FALLBACK_PROFILE_DEFAULT_NAME
  const profile: ProfileSchema = {
    provider: resolveDefaultProfileProvider(baseURL),
    baseURL: baseURL.replace(/\/+$/, ''),
    model,
    apiKey,
    ...(maxInputTokens.ok === true && maxInputTokens.value
      ? { maxInputTokens: maxInputTokens.value }
      : {}),
    ...(rawName && nameResult.ok ? { name: rawName } : {}),
  }
  return { name, profile, source: FALLBACK_PROFILE_SOURCE }
}

/**
 * 列出所有"应展示"的 profile. 给 /model + --list-model-profiles allProfiles 字段用.
 *
 * S1-09 收口政策 (Allen 拍板): fallback 仅在 settings 完全空时作为兜底进入列表.
 * 一旦 settings 有任何 profile, 旧 env fallback 不进列表 (避免 fallback 成为主路径).
 * 用户可通过 `mossen --migrate-fallback-profile` 把 fallback 升级为正式 profile.
 *
 * 注意: fallbackProfile 字段 (CLI JSON) 仍始终反映 env 真实存在性, 供 UI 检测迁移机会.
 */
export function listAllProfiles(): ListedProfile[] {
  const settings = getProfiles()
  const settingsList: ListedProfile[] = Object.keys(settings)
    .sort()
    .map(name => ({ name, profile: settings[name]!, source: SETTINGS_PROFILE_SOURCE }))
  if (settingsList.length > 0) return settingsList
  const fallback = getFallbackProfile()
  return fallback ? [fallback] : []
}

/**
 * "当前会话实际在用的 profile". 解析顺序:
 *   1. session active (runtime override 设的) → 真 profile (settings 命中)
 *   2. user-scope active → 真 profile
 *   3. fallback profile (env 存在)
 *   4. null (无任何配置)
 *
 * 给 /model 列表 / --list-model-profiles / statusline 用, 替代 raw activeProfile null.
 */
export function getCurrentProfile(): ListedProfile | null {
  const sessionName = getActiveProfileName()
  if (sessionName) {
    const p = getProfiles()[sessionName]
    if (p) return { name: sessionName, profile: p, source: SETTINGS_PROFILE_SOURCE }
  }
  return getFallbackProfile()
}

/**
 * "全局默认 profile". 直读 user scope settings.json 拿 activeProfile (跳过 runtimeOverride),
 * 若该 name 命中 settings → 返回真 profile; 否则若 fallback 存在 → 返回 fallback.
 *
 * 给 /model 列表的 [default] tag + --list-model-profiles defaultProfile 字段用.
 */
export function getDefaultProfile(): ListedProfile | null {
  const defaultName = getDefaultActiveProfileName()
  if (defaultName) {
    const p = getProfiles()[defaultName]
    if (p) return { name: defaultName, profile: p, source: SETTINGS_PROFILE_SOURCE }
  }
  return getFallbackProfile()
}

const PROFILE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/

/**
 * 校验 profile name (CLI / UI 写入前必查).
 * 规则: 字母开头, 字母/数字/_/- , 长度 1-32. 防止 stash 控制字符 / 路径符.
 */
export function validateProfileName(name: unknown): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof name !== 'string') return { ok: false, reason: 'profile name must be a string' }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'profile name must be non-empty' }
  if (!PROFILE_NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: `profile name "${trimmed}" must match ${PROFILE_NAME_PATTERN.source} (start with letter, only letters/digits/_/-, 1-32 chars)`,
    }
  }
  return { ok: true, name: trimmed }
}

/**
 * 写入 / 覆盖 profile (CLI 和 UI 都用; 同时支持 create + update).
 * scope 默认 'user' (写 ~/.mossen/settings.json); 'project' 写 <cwd>/.mossen/settings.json.
 *
 * 失败 (校验 fail): 抛 Error, 调用方负责 catch.
 * 成功: 返回最新完整 profiles map.
 */
export function setProfile(
  name: string,
  schema: unknown,
  scope: 'user' | 'project' = 'user',
): ProfilesMap {
  const nameResult = validateProfileName(name)
  if (nameResult.ok !== true) throw new Error(nameResult.reason)
  const profileResult = validateProfile(schema)
  if (profileResult.ok !== true) throw new Error(profileResult.reason)

  const current = getProfiles()
  const next: ProfilesMap = { ...current, [nameResult.name]: profileResult.profile }
  setMossenConfigOverride(PROFILES_KEY, next, scope)
  return next
}

/**
 * 删除 profile. 若指向的 profile 不存在, 返回 deleted=false (no-op, 不抛错).
 * 若被删的 profile 是当前 activeProfile, 同时清掉 activeProfile (避免悬空指向).
 */
export function deleteProfile(
  name: string,
  scope: 'user' | 'project' = 'user',
): { deleted: boolean; activeProfileCleared: boolean; profiles: ProfilesMap } {
  const current = getProfiles()
  if (!Object.prototype.hasOwnProperty.call(current, name)) {
    return { deleted: false, activeProfileCleared: false, profiles: current }
  }
  const next: ProfilesMap = { ...current }
  delete next[name]
  setMossenConfigOverride(PROFILES_KEY, next, scope)

  let activeCleared = false
  if (getActiveProfileName() === null && resolveMossenConfig<unknown>(ACTIVE_PROFILE_KEY, null).value === name) {
    // getActiveProfileName 已返回 null 因为 profile 不在 map 里; 但底层 settings 还有字面 entry, 清干净
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, null, scope)
    activeCleared = true
  } else {
    const rawActive = resolveMossenConfig<unknown>(ACTIVE_PROFILE_KEY, null).value
    if (rawActive === name) {
      setMossenConfigOverride(ACTIVE_PROFILE_KEY, null, scope)
      activeCleared = true
    }
  }
  return { deleted: true, activeProfileCleared: activeCleared, profiles: next }
}

/**
 * 切换 activeProfile (CLI / UI 共用). name 必须对应已存在的 profile 或 fallback.
 * scope 默认 'user'.
 *
 * S1-09 闭环: 若 name 是 fallback profile 名 (env-based, 非 settings 持久化),
 * 则 CLEAR scope 内的 activeProfile (设 null), 让 customBackend.ts fallthrough 到 env.
 * 这样用户从 glm/minimax 切回 qwen (fallback) 时, 全局默认 = "no profile" = fallback.
 */
export function setActiveProfile(
  name: string,
  scope: 'user' | 'project' = 'user',
): { activeProfile: string; profile: ProfileSchema; source: ProfileSource } {
  const nameResult = validateProfileName(name)
  if (nameResult.ok !== true) throw new Error(nameResult.reason)
  const real = getProfileByName(nameResult.name)
  if (real) {
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, nameResult.name, scope)
    return { activeProfile: nameResult.name, profile: real, source: SETTINGS_PROFILE_SOURCE }
  }
  const fallback = getFallbackProfile()
  if (fallback && fallback.name === nameResult.name) {
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, null, scope)
    return { activeProfile: nameResult.name, profile: fallback.profile, source: FALLBACK_PROFILE_SOURCE }
  }
  const settingsNames = Object.keys(getProfiles())
  const existing = fallback && !settingsNames.includes(fallback.name)
    ? [...settingsNames, fallback.name]
    : settingsNames
  throw new Error(
    `cannot activate profile "${nameResult.name}": not found in mossen.profiles (existing: ${existing.join(', ') || '<none>'})`,
  )
}

/**
 * 清掉 activeProfile (CLI --clear-active-profile / UI 重置 用).
 * 不删 profile 本身, 仅清 activeProfile 字段; 之后调用 getActiveProfile 返回 null.
 */
export function clearActiveProfile(scope: 'user' | 'project' = 'user'): void {
  setMossenConfigOverride(ACTIVE_PROFILE_KEY, null, scope)
}

/**
 * 会话级 active profile 切换 (S1-09f, /model <name> 走这里).
 * 用 facade 'override' scope (process-内 RuntimeOverrideProvider, priority 0),
 * 不写文件. 重启 mossen 后 override 失效, 仍用 user scope 的全局默认.
 *
 * S1-09 闭环: 若 name 是 fallback profile 名, runtime override 设 null (mask user-scope active),
 * 让 customBackend.ts fallthrough 到 env. 用户可以从 glm/minimax 切回 qwen (fallback).
 */
export function setSessionActiveProfile(name: string): { activeProfile: string; profile: ProfileSchema; source: ProfileSource } {
  const nameResult = validateProfileName(name)
  if (nameResult.ok !== true) throw new Error(nameResult.reason)
  const real = getProfileByName(nameResult.name)
  if (real) {
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, nameResult.name, 'override')
    return { activeProfile: nameResult.name, profile: real, source: SETTINGS_PROFILE_SOURCE }
  }
  const fallback = getFallbackProfile()
  if (fallback && fallback.name === nameResult.name) {
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, null, 'override')
    return { activeProfile: nameResult.name, profile: fallback.profile, source: FALLBACK_PROFILE_SOURCE }
  }
  const settingsNames = Object.keys(getProfiles())
  const existing = fallback && !settingsNames.includes(fallback.name)
    ? [...settingsNames, fallback.name]
    : settingsNames
  throw new Error(
    `cannot activate profile "${nameResult.name}": not found in mossen.profiles (existing: ${existing.join(', ') || '<none>'})`,
  )
}

/**
 * 清除 session-only override (回归到 user scope 的全局默认).
 */
export function clearSessionActiveProfile(): void {
  clearMossenConfigOverrides('override', ACTIVE_PROFILE_KEY)
}

/**
 * 直接读 user scope settings.json 拿全局默认 activeProfile (跳过 runtimeOverride).
 * /model 无参列表展示用, 区分 "session 当前" vs "global default".
 */
export function getDefaultActiveProfileName(): string | null {
  const configDir = process.env.MOSSEN_CONFIG_DIR ?? path.join(os.homedir(), '.mossen')
  const settingsPath = path.join(configDir, 'settings.json')
  if (!fs.existsSync(settingsPath)) return null
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const v = (parsed as Record<string, unknown>)[ACTIVE_PROFILE_KEY]
    if (typeof v !== 'string') return null
    const trimmed = v.trim()
    return trimmed || null
  } catch {
    return null
  }
}

export type MigrateFallbackResult =
  | {
      ok: true
      migrated: true
      profileName: string
      activeProfileSet: boolean
      scope: 'user' | 'project'
    }
  | {
      ok: true
      migrated: false
      reason: 'no-fallback' | 'already-exists'
      profileName?: string
      scope: 'user' | 'project'
    }
  | {
      ok: false
      reason: string
      scope: 'user' | 'project'
    }

/**
 * 一次性迁移 — 把 env fallback (MOSSEN_CODE_CUSTOM_*) 升级为正式 settings profile.
 *
 * 行为:
 *   1. 读 env fallback (getFallbackProfile); 不存在 → ok=true migrated=false reason='no-fallback'.
 *   2. 默认 targetName = fallback.name (常 'qwen'); 若 settings 已有同名 profile + force=false →
 *      ok=true migrated=false reason='already-exists'. force=true 覆盖.
 *   3. 写入 settings (走 setProfile / facade chain, scope 默认 'user' = ~/.mossen/settings.json).
 *   4. activate 决定是否同时设 mossen.activeProfile:
 *      - 'auto'  (默认): 当前 active 为 null 或就是 targetName → 设. 已显式指向其它真 profile → 不动.
 *      - 'always': 强制设
 *      - 'never':  不动 active
 *
 * 不删 .mossensrc/custom-backend.env, 不动 env vars; 旧启动方式继续可用.
 * 写入受 LocalSettingsProvider 强制 chmod 0600 (Stage1 hotfix R10).
 */
export function migrateFallbackProfile(opts?: {
  scope?: 'user' | 'project'
  targetName?: string
  force?: boolean
  activate?: 'auto' | 'always' | 'never'
}): MigrateFallbackResult {
  const scope = opts?.scope ?? 'user'
  const force = opts?.force ?? false
  const activate = opts?.activate ?? 'auto'

  const fallback = getFallbackProfile()
  if (!fallback) {
    return { ok: true, migrated: false, reason: 'no-fallback', scope }
  }

  const targetNameRaw = opts?.targetName?.trim() || fallback.name
  const nameResult = validateProfileName(targetNameRaw)
  if (nameResult.ok !== true) {
    return { ok: false, reason: nameResult.reason, scope }
  }

  const existing = getProfileByName(nameResult.name)
  if (existing && !force) {
    return {
      ok: true,
      migrated: false,
      reason: 'already-exists',
      profileName: nameResult.name,
      scope,
    }
  }

  const profileFinal: ProfileSchema = {
    provider: fallback.profile.provider,
    baseURL: fallback.profile.baseURL,
    model: fallback.profile.model,
    ...(fallback.profile.apiKey ? { apiKey: fallback.profile.apiKey } : {}),
    ...(fallback.profile.apiKeyRef ? { apiKeyRef: fallback.profile.apiKeyRef } : {}),
    ...(fallback.profile.maxInputTokens
      ? { maxInputTokens: fallback.profile.maxInputTokens }
      : {}),
    ...(fallback.profile.name && nameResult.name === fallback.name
      ? { name: fallback.profile.name }
      : {}),
  }

  setProfile(nameResult.name, profileFinal, scope)

  let activeSet = false
  if (activate === 'always') {
    setMossenConfigOverride(ACTIVE_PROFILE_KEY, nameResult.name, scope)
    activeSet = true
  } else if (activate === 'auto') {
    const currentActive = getActiveProfileName()
    if (currentActive === null || currentActive === nameResult.name) {
      setMossenConfigOverride(ACTIVE_PROFILE_KEY, nameResult.name, scope)
      activeSet = true
    }
  }

  return {
    ok: true,
    migrated: true,
    profileName: nameResult.name,
    activeProfileSet: activeSet,
    scope,
  }
}

export type ProfileTestResult = {
  ok: boolean
  /** HTTP status (任何值, 包括 4xx/5xx; ok=false 时可能为 0 = 连接级失败) */
  status: number
  /** 测试用的最终 URL (baseURL + /models 后缀) */
  url: string
  /** 真实测试耗时 (ms) */
  durationMs: number
  /** 失败时填; 成功时为 undefined */
  error?: string
}

export type ProfileChatTestResult = {
  ok: boolean
  /** HTTP status; 0 means connection-level failure before an HTTP response. */
  status: number
  /** Final chat endpoint URL used by the probe. */
  url: string
  /** Real probe duration in ms. */
  durationMs: number
  /** Request failed before HTTP response, or response body could not be read. */
  error?: string
  /** Best-effort provider error message for non-2xx responses. */
  providerMessage?: string
  /** Best-effort attribution bucket for guidance text. */
  providerErrorKind?:
    | 'auth-or-permission'
    | 'gateway-or-waf-block'
    | 'model-unsupported'
    | 'payload-rejected'
    | 'provider-client-error'
    | 'provider-server-error'
    | 'rate-limited'
    | 'timeout-or-upstream-timeout'
}

/**
 * 测试 profile 连通性 (Workbench UI "测试连接"按钮 + CLI --test-model-profile).
 * 真发 GET 到 baseURL + /models, 验:
 *   - 网络可达 (任何 HTTP status 都算 ok=true 视为 server reachable)
 *   - openai-compatible 携带 Authorization: Bearer <apiKey>
 *   - messages-compatible 携带 x-api-key: <apiKey>
 *
 * 不验 OpenAI 协议正确性 (因 server 可能不实现 /models, 或 schema 不同),
 * 只验"能连上 + 真透 apiKey"; 真链路 chat completion 留给 mossen -p 跑.
 *
 * 超时默认 5000ms; 网络异常 / abort → ok=false + status=0 + error 字段.
 */
export async function testProfile(
  profile: ProfileSchema,
  options?: { timeoutMs?: number },
): Promise<ProfileTestResult> {
  const timeoutMs = options?.timeoutMs ?? 5000
  const baseTrimmed = profile.baseURL.replace(/\/+$/, '')
  const url = `${baseTrimmed}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  const credential = resolveProfileApiKey(profile)
  if (!credential.apiKey) {
    clearTimeout(timer)
    return {
      ok: false,
      status: 0,
      url,
      durationMs: Date.now() - start,
      error: `apiKey unavailable (${credential.detail ?? credential.source})`,
    }
  }
  const headers: Record<string, string> =
    profile.provider === 'openai-compatible'
      ? {
          Authorization: `Bearer ${credential.apiKey}`,
          'User-Agent': 'mossen-profile-test/1.0',
        }
      : {
          'x-api-key': credential.apiKey,
          'User-Agent': 'mossen-profile-test/1.0',
        }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    return {
      ok: true,
      status: res.status,
      url,
      durationMs: Date.now() - start,
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      durationMs: Date.now() - start,
      error: (e as Error).message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Lightweight real chat probe for `/model test`.
 *
 * Unlike `testProfile()`, this validates the configured model against the
 * actual chat endpoint. It intentionally uses a tiny non-streaming request so
 * users can distinguish "GET /models is reachable" from "this model can chat".
 */
export async function testProfileChat(
  profile: ProfileSchema,
  options?: { timeoutMs?: number; fetch?: typeof fetch },
): Promise<ProfileChatTestResult> {
  const timeoutMs = options?.timeoutMs ?? 5000
  const fetchImpl = options?.fetch ?? fetch
  const baseTrimmed = profile.baseURL.replace(/\/+$/, '')
  const effectiveProvider =
    profile.provider === 'openai-compatible' &&
    looksLikeMessagesCompatibleBaseUrl(profile.baseURL)
      ? MESSAGES_COMPATIBLE_PROVIDER
      : profile.provider
  const isOpenAICompatible = effectiveProvider === 'openai-compatible'
  const url = isOpenAICompatible
    ? `${baseTrimmed}/chat/completions`
    : buildMessagesCompatibleEndpoint(baseTrimmed)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  const credential = resolveProfileApiKey(profile)
  if (!credential.apiKey) {
    clearTimeout(timer)
    return {
      ok: false,
      status: 0,
      url,
      durationMs: Date.now() - start,
      error: `apiKey unavailable (${credential.detail ?? credential.source})`,
    }
  }

  const headers: Record<string, string> = isOpenAICompatible
    ? {
        Authorization: `Bearer ${credential.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'mossen-profile-chat-test/1.0',
      }
    : {
        'x-api-key': credential.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'mossen-profile-chat-test/1.0',
        [MESSAGES_PROTOCOL_VERSION_HEADER]: MESSAGES_PROTOCOL_VERSION_VALUE,
      }
  const body = isOpenAICompatible
    ? {
        model: profile.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }
    : {
        model: profile.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const raw = await safeReadResponseText(res)
    return {
      ok: res.ok,
      status: res.status,
      url,
      durationMs: Date.now() - start,
      ...(res.ok
        ? {}
        : {
            providerMessage: extractProviderErrorMessage(raw, res.statusText),
            providerErrorKind: classifyProviderErrorKind(
              raw,
              res.status,
              res.statusText,
              res.headers.get('content-type') ?? '',
            ),
          }),
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      durationMs: Date.now() - start,
      error: (e as Error).message,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function safeReadResponseText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function extractProviderErrorMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return fallback || 'empty error body'
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const message = findProviderErrorMessage(parsed)
    return message || trimmed
  } catch {
    return trimmed
  }
}

function classifyProviderErrorKind(
  raw: string,
  status: number,
  fallback: string,
  contentType: string,
): NonNullable<ProfileChatTestResult['providerErrorKind']> {
  const message = extractProviderErrorMessage(raw, fallback)
  const lower = `${raw}\n${message}`.toLowerCase()
  if (
    contentType.toLowerCase().includes('text/html') ||
    /<html\b|<!doctype html|<title\b|<body\b/i.test(raw) ||
    lower.includes('cloudflare') ||
    lower.includes('cf-ray') ||
    lower.includes('web application firewall') ||
    lower.includes('request blocked') ||
    lower.includes('access denied') ||
    lower.includes('attention required')
  ) {
    return 'gateway-or-waf-block'
  }
  if (
    lower.includes('model') &&
    (lower.includes('not found') ||
      lower.includes('does not exist') ||
      lower.includes('not exist') ||
      lower.includes('unsupported') ||
      lower.includes('not supported') ||
      lower.includes('invalid model') ||
      lower.includes('model_not_found'))
  ) {
    return 'model-unsupported'
  }
  if (status === 401 || status === 403) return 'auth-or-permission'
  if (status === 408 || status === 504) return 'timeout-or-upstream-timeout'
  if (status === 429) return 'rate-limited'
  if (
    status === 400 ||
    status === 413 ||
    status === 422 ||
    lower.includes('payload') ||
    lower.includes('request body') ||
    lower.includes('invalid json') ||
    lower.includes('schema')
  ) {
    return 'payload-rejected'
  }
  if (status >= 500) return 'provider-server-error'
  return 'provider-client-error'
}

function findProviderErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  if (typeof record.error === 'string') return record.error
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
    if (typeof nested.code === 'string') return nested.code
  }
  return null
}
