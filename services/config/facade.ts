/**
 * Mossen 配置门面 (G1-4) — provider 链 + 公共 API.
 *
 * Provider 优先级 (按 Allen G-D1 决策):
 *   override (0) > env (1) > project (2) > user (3) > remote (4) > default (5)
 *
 * 远程 provider G1 阶段不实现 (G-D2 接口预留 default disabled);
 * G6 完成后 Mossen hosted 实现时再注册.
 */

import {
  PROVIDER_PRIORITY,
  type ConfigOverrideScope,
  type ConfigValueSource,
  type MossenConfigFacade,
  type MossenConfigProvider,
  type MossenConfigRefreshListener,
  type ProviderResult,
} from './types.js'
import { MOSSEN_BUILTIN_DEFAULTS } from './defaults.js'
import { resolveAliasedKey } from './aliasMap.js'
import {
  LocalDefaultProvider,
  ProjectSettingsProvider,
  UserSettingsProvider,
} from './providers/local.js'
import { EnvOverrideProvider } from './providers/envOverride.js'

/** Process-内 override (优先级最高) */
class RuntimeOverrideProvider implements MossenConfigProvider {
  readonly name: ConfigValueSource = 'override'

  readonly priority = PROVIDER_PRIORITY.override

  readonly enabled = true

  private readonly store = new Map<string, unknown>()

  get<T>(key: string): ProviderResult<T> {
    if (this.store.has(key)) {
      return { value: this.store.get(key) as T, source: 'override' }
    }
    return undefined
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value)
  }

  clear(key?: string): void {
    if (key === undefined) {
      this.store.clear()
    } else {
      this.store.delete(key)
    }
  }
}

const runtimeOverride = new RuntimeOverrideProvider()
const envOverride = new EnvOverrideProvider()
const projectSettings = new ProjectSettingsProvider()
const userSettings = new UserSettingsProvider()
const localDefault = new LocalDefaultProvider()

/**
 * Provider 链, 按 priority 升序排列.
 * G1 阶段 5 个 (无 remote); G6 后接入 remote 时插入到 user 之后.
 */
const PROVIDERS: readonly MossenConfigProvider[] = [
  runtimeOverride,
  envOverride,
  projectSettings,
  userSettings,
  localDefault,
]

/** 用于 set/clear 时按 scope 路由到具体 provider */
function pickWritableProvider(scope: ConfigOverrideScope): MossenConfigProvider {
  switch (scope) {
    case 'override':
      return runtimeOverride
    case 'project':
      return projectSettings
    case 'user':
      return userSettings
  }
}

const refreshListeners = new Set<MossenConfigRefreshListener>()

/** 通知所有 refresh listener (内部用; G6 后远程 provider 触发) */
export function notifyRefreshListeners(): void {
  for (const listener of refreshListeners) {
    try {
      const result = listener()
      if (result instanceof Promise) {
        result.catch(() => {
          // listener 自己 swallow; 不阻塞其他 listener
        })
      }
    } catch {
      // listener 抛错不阻塞其他 listener
    }
  }
}

/**
 * Resolve 给定 key, 顺序遍历 provider 链, 首个命中返回.
 * 全部 miss → 返回 default fallback (caller 传的 defaultValue).
 */
function resolve<T>(
  key: string,
  defaultValue: T,
): { value: T; source: ConfigValueSource; resolvedKey?: string } {
  // alias 解析: legacy aliases → mossen.*
  const resolvedKey = resolveAliasedKey(key)
  const isAliased = resolvedKey !== key

  for (const provider of PROVIDERS) {
    if (!provider.enabled) continue
    const result = provider.get<T>(resolvedKey)
    if (result !== undefined) {
      return {
        value: result.value,
        source: result.source,
        ...(isAliased ? { resolvedKey } : {}),
      }
    }
  }
  return {
    value: defaultValue,
    source: 'default',
    ...(isAliased ? { resolvedKey } : {}),
  }
}

// ===== Facade public API =====

export function getMossenFeatureValue<T>(key: string, defaultValue: T): T {
  return resolve(key, defaultValue).value
}

export function getMossenDynamicConfig<T>(key: string, defaultValue: T): T {
  return resolve(key, defaultValue).value
}

export function checkMossenGate(key: string, defaultValue = false): boolean {
  const v = resolve<unknown>(key, defaultValue).value
  return Boolean(v)
}

export function onMossenConfigRefresh(
  listener: MossenConfigRefreshListener,
): () => void {
  refreshListeners.add(listener)
  return () => {
    refreshListeners.delete(listener)
  }
}

export function setMossenConfigOverride(
  key: string,
  value: unknown,
  scope: ConfigOverrideScope = 'override',
): void {
  const provider = pickWritableProvider(scope)
  provider.set?.(key, value)
  notifyRefreshListeners()
}

export function clearMossenConfigOverrides(
  scope: ConfigOverrideScope = 'override',
  key?: string,
): void {
  const provider = pickWritableProvider(scope)
  provider.clear?.(key)
  notifyRefreshListeners()
}

export function getAllMossenConfigValues(): Record<string, unknown> {
  // 遍历内置 default 表的所有 key, resolve 一遍
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(MOSSEN_BUILTIN_DEFAULTS)) {
    out[key] = resolve(key, MOSSEN_BUILTIN_DEFAULTS[key]).value
  }
  return out
}

export function resolveMossenConfig<T>(
  key: string,
  defaultValue: T,
): { value: T; source: ConfigValueSource; resolvedKey?: string } {
  return resolve(key, defaultValue)
}

/** 仅供测试: reset 全部 in-memory 状态 */
export function _resetFacadeForTesting(): void {
  runtimeOverride.clear()
  refreshListeners.clear()
}

/** 自检: facade 实现了 MossenConfigFacade 接口 */
export const facade: MossenConfigFacade = {
  getMossenFeatureValue,
  getMossenDynamicConfig,
  checkMossenGate,
  onMossenConfigRefresh,
  setMossenConfigOverride,
  clearMossenConfigOverrides,
  getAllMossenConfigValues,
  resolveMossenConfig,
}
