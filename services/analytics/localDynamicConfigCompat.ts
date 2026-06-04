/**
 * Local dynamic-config compatibility wrapper.
 *
 * The old remote flag client has been collapsed into this local facade. All
 * reads now resolve through services/config using the normal provider chain
 * (override > env > project > user > default), and lifecycle hooks are no-op
 * or local refresh subscriptions.
 */

import {
  onMossenConfigRefresh,
  resolveMossenConfig,
  setMossenConfigOverride,
  clearMossenConfigOverrides,
  getAllMossenConfigValues,
  resolveAliasedKey,
} from '../config/index.js'
import { getHostedPlatformUrls } from '../../utils/customBackend.js'
import {
  type GitHubActionsMetadata,
} from '../../utils/user.js'

// ============================================================================
// 公共类型 (保留外部调用方可能 import 的 type)
// ============================================================================

/** Dynamic-config user attributes; retained for the internal analytics payload. */
export type DynamicConfigUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: GitHubActionsMetadata
}

// ============================================================================
// 内部 facade-first helper
// ============================================================================

/**
 * Resolve a key through the Mossen facade. Legacy aliases are normalized before
 * reading the provider chain; unknown keys fall back to the caller default.
 */
function resolveViaFacade<T>(configKey: string, defaultValue: T): T {
  const aliased = resolveAliasedKey(configKey)
  const r = resolveMossenConfig<T>(aliased, defaultValue)
  return r.value
}

// ============================================================================
// Public API: feature value / dynamic config / gate
// ============================================================================

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  return resolveViaFacade(feature, defaultValue)
}

/**
 * @deprecated refresh interval 参数被忽略 (Mossen 本地配置无定时刷新需要).
 * 使用 getFeatureValue_CACHED_MAY_BE_STALE.
 */
export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return resolveViaFacade(feature, defaultValue)
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  config: string,
  defaultValue: T,
): T {
  return resolveViaFacade(config, defaultValue)
}

/**
 * G6-2 后行为: 立即解析 (无 init 阻塞), 因为本地 facade 是同步的.
 * 保留 async 签名给 backward-compat.
 */
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  config: string,
  defaultValue: T,
): Promise<T> {
  return resolveViaFacade(config, defaultValue)
}

/**
 * @deprecated Local facade wrapper retained for call-shape compatibility.
 */
export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return resolveViaFacade(feature, defaultValue)
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  return Boolean(resolveViaFacade<unknown>(gate, false))
}

/**
 * G6-2 后行为: 同 checkStatsigFeatureGate_CACHED_MAY_BE_STALE 但保留 async 签名.
 */
export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  return Boolean(resolveViaFacade<unknown>(gate, false))
}

/**
 * Security restriction gate. 个人版永远返回 false (无 hosted security 上报路径).
 */
export async function checkSecurityRestrictionGate(
  _gate: string,
): Promise<boolean> {
  return false
}

// ============================================================================
// Lifecycle / override APIs
// ============================================================================

/** No-op: local facade is synchronous and has no remote client to initialize. */
export const initializeDynamicConfigRuntime = async (): Promise<void> => {
  // Local facade is process-local and ready on import.
}

/** No-op. */
export function resetDynamicConfigRuntime(): void {
  // No remote client state to reset.
}

/** No-op. */
export async function refreshDynamicConfigFeatures(): Promise<void> {
  // No remote refresh.
}

/** No-op. */
export function refreshDynamicConfigAfterAuthChange(): void {
  // No auth-driven remote refresh.
}

/** No-op. */
export function setupPeriodicDynamicConfigRefresh(): void {
  // No periodic refresh timer.
}

/** No-op. */
export function stopPeriodicDynamicConfigRefresh(): void {
  // No timer to stop.
}

/** Refresh listener — 转发到 Mossen facade refresh listener. */
export function onDynamicConfigRefresh(
  listener: () => void | Promise<void>,
): () => void {
  return onMossenConfigRefresh(listener)
}

/**
 * 检查指定 feature 是否被 env override.
 * 个人版只看 MOSSEN_CONFIG_OVERRIDES (新) + MOSSEN_INTERNAL_FC_OVERRIDES (旧 deprecated).
 */
export function hasDynamicConfigEnvOverride(feature: string): boolean {
  const newRaw = process.env.MOSSEN_CONFIG_OVERRIDES
  const oldRaw = process.env.MOSSEN_INTERNAL_FC_OVERRIDES
  for (const raw of [newRaw, oldRaw]) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, feature)) {
        return true
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return false
}

/**
 * 返回当前所有已注入 facade 的 key/value (~Mossen builtin defaults + 任意 override).
 */
export function getAllDynamicConfigValues(): Record<string, unknown> {
  return getAllMossenConfigValues()
}

/**
 * Legacy config override field is frozen; runtime overrides use the Mossen
 * config facade.
 */
export function getDynamicConfigOverrides(): Record<string, unknown> {
  return {}
}

/** 转发到 setMossenConfigOverride('override' scope). */
export function setDynamicConfigOverride(key: string, value: unknown): void {
  setMossenConfigOverride(key, value, 'override')
}

/** 转发到 clearMossenConfigOverrides('override' scope). */
export function clearDynamicConfigOverrides(): void {
  clearMossenConfigOverrides('override')
}

/**
 * 当前 API base URL host (来自 customBackend, 本地解析).
 * 个人版用 custom backend (e.g. dashscope), 不走 hosted feature-flag 端点.
 */
export function getApiBaseUrlHost(): string | undefined {
  try {
    const { remoteBaseUrl } = getHostedPlatformUrls()
    if (!remoteBaseUrl) return undefined
    return new URL(remoteBaseUrl).host
  } catch {
    return undefined
  }
}
