/**
 * Mossen 配置门面 — provider 接口与共享类型 (G1-1).
 *
 * 设计目标:
 * - 本地优先: env > project > user > default (G-D1)
 * - remote provider 接口预留但默认 disabled (G-D2)
 * - legacy key alias 过渡
 * - 命名规范: mossen.<domain>.<feature>
 */

/** 配置值的来源层 */
export type ConfigValueSource =
  | 'env'      // MOSSEN_INTERNAL_FC_OVERRIDES 等
  | 'project'  // <cwd>/.mossen/settings.json
  | 'user'     // ~/.mossen/settings.json
  | 'default'  // 内置默认值
  | 'remote'   // 远程 provider, G-D2 默认 disabled
  | 'override' // setMossenConfigOverride 运行时设的

/** Provider 优先级数字, 越小越优先 */
export const PROVIDER_PRIORITY: Record<ConfigValueSource, number> = {
  override: 0,
  env: 1,
  project: 2,
  user: 3,
  remote: 4,
  default: 5,
}

/** 单个 provider 的查询结果. undefined 表示该 provider 未命中 key */
export type ProviderResult<T> =
  | {
      value: T
      source: ConfigValueSource
      /** 命中时的解析后 key (alias 解析后); 与查询 key 不同时填 */
      resolvedKey?: string
    }
  | undefined

/** Mossen config provider 接口. G1-2/G1-3 实现各种具体 provider */
export interface MossenConfigProvider {
  /** Provider 名称, 用于 debug/log */
  readonly name: ConfigValueSource
  /** Provider 优先级数字, 越小越优先 (查 PROVIDER_PRIORITY) */
  readonly priority: number
  /** 是否启用; 默认 true; remote provider 默认 false (G-D2) */
  readonly enabled: boolean
  /** 查询某 key, 命中返回 ProviderResult, 未命中返回 undefined */
  get<T>(key: string): ProviderResult<T>
  /** 仅适用于可变 provider (override/user/project). 不可变 provider 此方法 undefined */
  set?<T>(key: string, value: T): void
  /** 仅适用于可变 provider. 清除 provider 内所有 key (或某 key 若给参) */
  clear?(key?: string): void
  /** 订阅刷新 (仅 remote provider 有意义); 不可订阅返回 noop unsubscribe */
  onRefresh?(listener: MossenConfigRefreshListener): () => void
}

/** Refresh listener — provider 数据有变化时通知 */
export type MossenConfigRefreshListener = () => void | Promise<void>

/** 命名规范校验: mossen.<domain>.<feature> 格式 */
export const MOSSEN_KEY_PATTERN = /^mossen\.[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/

/** 校验 key 是否符合命名规范, 不符合返回错误信息 */
export function validateMossenKey(key: string): { ok: true } | { ok: false; reason: string } {
  if (!MOSSEN_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      reason: `invalid Mossen key "${key}": expected mossen.<domain>.<feature> (e.g. mossen.analytics.eventBatchConfig)`,
    }
  }
  return { ok: true }
}

/**
 * Legacy config key → Mossen key alias map.
 * 旧 key 在 wrapper 里查 alias, 转成 mossen.* key 后再走门面.
 */
export type LegacyConfigAliasMap = Record<string, string>

/** Set override 的 scope */
export type ConfigOverrideScope = 'override' | 'user' | 'project'

/** Mossen 门面 API 类型. G1-4 实现时用 */
export interface MossenConfigFacade {
  /** 等价 getFeatureValue_CACHED_MAY_BE_STALE: 同步取值, 不阻塞 */
  getMossenFeatureValue<T>(key: string, defaultValue: T): T
  /** 等价 getDynamicConfig_CACHED_MAY_BE_STALE: 同步取 object 值 */
  getMossenDynamicConfig<T>(key: string, defaultValue: T): T
  /** 等价 checkStatsigFeatureGate_CACHED_MAY_BE_STALE: 同步取 boolean */
  checkMossenGate(key: string, defaultValue?: boolean): boolean
  /** 订阅 refresh; 返回 unsubscribe */
  onMossenConfigRefresh(listener: MossenConfigRefreshListener): () => void
  /** 写持久化 override; scope 默认 'override' (process-内). 'user'/'project' 写文件 */
  setMossenConfigOverride(key: string, value: unknown, scope?: ConfigOverrideScope): void
  /** 清除 override; scope 默认 'override'. key 不给则清整个 scope */
  clearMossenConfigOverrides(scope?: ConfigOverrideScope, key?: string): void
  /** 取所有当前 resolved values (debug/UI 用). 仅返回有内置 default 的 key */
  getAllMossenConfigValues(): Record<string, unknown>
  /**
   * Debug helper: resolve 给定 key, 返回最终值 + 来源 + 解析后 key.
   * R5/R6 测试 + Allen 手动 debug 用.
   */
  resolveMossenConfig<T>(
    key: string,
    defaultValue: T,
  ): { value: T; source: ConfigValueSource; resolvedKey?: string }
}
