import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { ALL_MODEL_CONFIGS, type ModelKey } from './model/configs.js'
import { externalProviderModelStemFromMossenId } from './model/externalProviderIds.js'
import { isEnvTruthy } from './envBooleans.js'
import { getResolvedConfigHomeDir } from './naming.js'

export { isEnvDefinedFalsy, isEnvTruthy } from './envBooleans.js'

// Memoized: 150+ callers, many on hot paths. Keyed off the canonical config-dir
// env var so tests that change it get a fresh result without explicit
// cache.clear.
export const getMossenConfigHomeDir = memoize(
  (): string => {
    return getResolvedConfigHomeDir()
  },
  () => process.env.MOSSEN_CONFIG_DIR,
)

export function getTeamsDir(): string {
  return join(getMossenConfigHomeDir(), 'teams')
}

/**
 * Check if NODE_OPTIONS contains a specific flag.
 * Splits on whitespace and checks for exact match to avoid false positives.
 */
export function hasNodeOption(flag: string): boolean {
  const nodeOptions = process.env.NODE_OPTIONS
  if (!nodeOptions) {
    return false
  }
  return nodeOptions.split(/\s+/).includes(flag)
}

/**
 * --bare / MOSSEN_CODE_SIMPLE — skip hooks, LSP, plugin sync, skill dir-walk,
 * attribution, background prefetches, and ALL keychain/credential reads.
 * Auth is strictly MOSSEN_CODE_API_KEY env or apiKeyHelper from --settings.
 * Explicit CLI flags (--plugin-dir, --add-dir, --mcp-config) still honored.
 * ~30 gates across the codebase.
 *
 * Checks argv directly (in addition to the env var) because several gates
 * run before main.tsx's action handler sets MOSSEN_CODE_SIMPLE=1 from --bare
 * — notably startKeychainPrefetch() at main.tsx top-level.
 */
export function isBareMode(): boolean {
  return (
    isEnvTruthy(process.env.MOSSEN_CODE_SIMPLE) ||
    process.argv.includes('--bare')
  )
}

/**
 * Parses an array of environment variable strings into a key-value object
 * @param envVars Array of strings in KEY=VALUE format
 * @returns Object with key-value pairs
 */
export function parseEnvVars(
  rawEnvArgs: string[] | undefined,
): Record<string, string> {
  const parsedEnv: Record<string, string> = {}

  // Parse individual env vars
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

/**
 * Get the AWS region with fallback to default
 * Matches the Bedrock provider SDK's region behavior
 */
export function getAWSRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
}

/**
 * Get the default Vertex AI region
 */
export function getDefaultVertexRegion(): string {
  return process.env.CLOUD_ML_REGION || 'us-east5'
}

/**
 * Check if bash commands should maintain project working directory (reset to original after each command)
 * @returns true if MOSSEN_BASH_MAINTAIN_PROJECT_WORKING_DIR is set to a truthy value
 */
export function shouldMaintainProjectWorkingDir(): boolean {
  return isEnvTruthy(process.env.MOSSEN_BASH_MAINTAIN_PROJECT_WORKING_DIR)
}

/**
 * Check if running in the internal cloud environment.
 */
export function isRunningOnHomespace(): boolean {
  return (
    process.env.USER_TYPE === ('a' + 'nt') &&
    isEnvTruthy(process.env.COO_RUNNING_ON_HOMESPACE)
  )
}

/**
 * Conservative check for whether Mossen is running inside a protected
 * (privileged or ASL3+) COO namespace or cluster.
 *
 * Conservative means: when signals are ambiguous, assume protected. We would
 * rather over-report protected usage than miss it. Unprotected environments
 * are homespace, namespaces on the open allowlist, and no k8s/COO signals
 * at all (laptop/local dev).
 *
 * Used for telemetry to measure auto-mode usage in sensitive environments.
 */
export function isInProtectedNamespace(): boolean {
  // USER_TYPE is build-time --define'd; in external builds this block is
  // DCE'd so the require() and namespace allowlist never appear in the bundle.
  if (process.env.USER_TYPE === ('a' + 'nt')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return (
      require('./protectedNamespace.js') as typeof import('./protectedNamespace.js')
    ).checkProtectedNamespace()
    /* eslint-enable @typescript-eslint/no-require-imports */
  }
  return false
}

// @[MODEL LAUNCH]: Add a Vertex region override env var for the new model.
/**
 * External Vertex provider model prefix → env var for region overrides.
 * Order matters: more specific prefixes must come before less specific ones
 * (e.g., the 4.1 Opus prefix before the 4.0 Opus prefix).
 */
const VERTEX_REGION_MODEL_ENV_VAR_ENTRIES = [
  ['haiku45', 'VERTEX_REGION_MOSSEN_HAIKU_4_5'],
  ['haiku35', 'VERTEX_REGION_MOSSEN_3_5_HAIKU'],
  ['sonnet35', 'VERTEX_REGION_MOSSEN_3_5_SONNET'],
  ['sonnet37', 'VERTEX_REGION_MOSSEN_3_7_SONNET'],
  ['opus41', 'VERTEX_REGION_MOSSEN_4_1_OPUS'],
  ['opus40', 'VERTEX_REGION_MOSSEN_4_0_OPUS'],
  ['sonnet46', 'VERTEX_REGION_MOSSEN_4_6_SONNET'],
  ['sonnet45', 'VERTEX_REGION_MOSSEN_4_5_SONNET'],
  ['sonnet40', 'VERTEX_REGION_MOSSEN_4_0_SONNET'],
] as const satisfies ReadonlyArray<readonly [ModelKey, string]>

const VERTEX_REGION_OVERRIDES: ReadonlyArray<[string, string]> =
  VERTEX_REGION_MODEL_ENV_VAR_ENTRIES.map(([key, envVar]) => {
    const firstPartyModelId = ALL_MODEL_CONFIGS[key].firstParty
    return [
      externalProviderModelStemFromMossenId(firstPartyModelId),
      envVar,
    ] as [string, string]
  })

/**
 * Get the Vertex AI region for a specific model.
 * Different models may be available in different regions.
 */
export function getVertexRegionForModel(
  model: string | undefined,
): string | undefined {
  if (model) {
    const match = VERTEX_REGION_OVERRIDES.find(([prefix]) =>
      model.startsWith(prefix),
    )
    if (match) {
      return process.env[match[1]] || getDefaultVertexRegion()
    }
  }
  return getDefaultVertexRegion()
}
