/**
 * EnvOverrideProvider (G1-3) — env-based 配置覆盖, priority 高于 settings.json.
 *
 * 新 env: MOSSEN_CONFIG_OVERRIDES (推荐, Mossen 命名规范)
 * 旧 env: MOSSEN_INTERNAL_FC_OVERRIDES (deprecated pre-facade name, 仍兼容读取)
 *
 * 当两个 env 同时存在: 新 env 优先, 警告 stderr 一次.
 *
 * env 内容 = JSON object, key 是 mossen.<domain>.<feature> 或 legacy aliases.
 *   例: MOSSEN_CONFIG_OVERRIDES='{"mossen.analytics.eventBatchConfig": {"maxQueueSize": 100}}'
 */

import {
  PROVIDER_PRIORITY,
  type ConfigValueSource,
  type MossenConfigProvider,
  type ProviderResult,
} from '../types.js'
import { resolveAliasedKey } from '../aliasMap.js'

const NEW_ENV_NAME = 'MOSSEN_CONFIG_OVERRIDES'
const DEPRECATED_ENV_NAME = 'MOSSEN_INTERNAL_FC_OVERRIDES'

let parsedCache: { source: 'new' | 'deprecated'; data: Record<string, unknown> } | null = null
let parseAttempted = false
let deprecationWarned = false

function parseEnvOverrides(): Record<string, unknown> | null {
  if (parseAttempted) return parsedCache?.data ?? null
  parseAttempted = true

  const newRaw = process.env[NEW_ENV_NAME]
  const deprecatedRaw = process.env[DEPRECATED_ENV_NAME]

  if (newRaw && deprecatedRaw && !deprecationWarned) {
    process.stderr.write(
      `[mossen] Warning: both ${NEW_ENV_NAME} and ${DEPRECATED_ENV_NAME} set; using ${NEW_ENV_NAME} (${DEPRECATED_ENV_NAME} is deprecated).\n`,
    )
    deprecationWarned = true
  } else if (!newRaw && deprecatedRaw && !deprecationWarned) {
    process.stderr.write(
      `[mossen] Warning: ${DEPRECATED_ENV_NAME} is deprecated; rename to ${NEW_ENV_NAME}.\n`,
    )
    deprecationWarned = true
  }

  const raw = newRaw ?? deprecatedRaw
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rawData = parsed as Record<string, unknown>
      // Alias-resolve env keys at parse time so callers can use either legacy
      // aliases or mossen.* names; facade lookup is always alias-resolved.
      const data: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rawData)) {
        data[resolveAliasedKey(k)] = v
      }
      parsedCache = { source: newRaw ? 'new' : 'deprecated', data }
      return data
    }
    process.stderr.write(
      `[mossen] Warning: ${NEW_ENV_NAME}/${DEPRECATED_ENV_NAME} must be a JSON object, got ${typeof parsed}; ignoring.\n`,
    )
    return null
  } catch (e) {
    process.stderr.write(
      `[mossen] Warning: failed to parse ${NEW_ENV_NAME}/${DEPRECATED_ENV_NAME}: ${(e as Error).message}; ignoring.\n`,
    )
    return null
  }
}

/** 仅供测试: 重置内部 cache */
export function _resetEnvOverrideCacheForTesting(): void {
  parsedCache = null
  parseAttempted = false
  deprecationWarned = false
}

export class EnvOverrideProvider implements MossenConfigProvider {
  readonly name: ConfigValueSource = 'env'

  readonly priority = PROVIDER_PRIORITY.env

  readonly enabled = true

  get<T>(key: string): ProviderResult<T> {
    const data = parseEnvOverrides()
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      return { value: data[key] as T, source: 'env' }
    }
    return undefined
  }
}
