// Critical system constants extracted to break circular dependencies

import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/config/dynamicConfig.js'
import { isCustomBackendEnabled } from '../utils/customBackend.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getWorkload } from '../utils/workloadContext.js'
import { getProductAssistantName, getProductDisplayName } from './product.js'

const DEFAULT_PREFIX = `You are Mossen, a software engineering assistant running in the Mossen CLI.`
const MOSSEN_AGENT_SDK_PRESET_PREFIX = `You are Mossen, a software engineering assistant running within the Mossen Agent SDK.`
const MOSSEN_AGENT_SDK_PREFIX = `You are a Mossen agent, built on the Mossen Agent SDK.`
const CUSTOM_DEFAULT_PREFIX = `You are ${getProductAssistantName()}, a software engineering assistant running in a local ${getProductDisplayName()} environment.`
const CUSTOM_AGENT_SDK_PRESET_PREFIX = `You are ${getProductAssistantName()} running inside a local ${getProductDisplayName()} agent runtime.`
const CUSTOM_AGENT_SDK_PREFIX = `You are a software engineering agent operating through ${getProductDisplayName()}'s custom model backend.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  MOSSEN_AGENT_SDK_PRESET_PREFIX,
  MOSSEN_AGENT_SDK_PREFIX,
  CUSTOM_DEFAULT_PREFIX,
  CUSTOM_AGENT_SDK_PRESET_PREFIX,
  CUSTOM_AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  if (isCustomBackendEnabled()) {
    if (options?.isNonInteractive) {
      if (options.hasAppendSystemPrompt) {
        return CUSTOM_AGENT_SDK_PRESET_PREFIX
      }
      return CUSTOM_AGENT_SDK_PREFIX
    }
    return CUSTOM_DEFAULT_PREFIX
  }
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
        return MOSSEN_AGENT_SDK_PRESET_PREFIX
      }
      return MOSSEN_AGENT_SDK_PREFIX
    }
    return DEFAULT_PREFIX
  }

/**
 * Check if attribution header is enabled.
 * Enabled by default, can be disabled via env var or local config killswitch.
 */
function isAttributionHeaderEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.MOSSEN_CODE_ATTRIBUTION_HEADER)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'mossen.api.attributionHeaderEnabled',
    true,
  )
}

/**
 * Get attribution header for API requests.
 * Returns a header string with cc_version (including fingerprint) and cc_entrypoint.
 * Enabled by default, can be disabled via env var or local config killswitch.
 *
 * When NATIVE_CLIENT_ATTESTATION is enabled, includes a `cch=00000` placeholder.
 * Before the request is sent, Bun's native HTTP stack finds this placeholder
 * in the request body and overwrites the zeros with a computed hash. The
 * server verifies this token to confirm the request came from a real Mossen
 * Code client. See the native HTTP attestation implementation for details.
 *
 * We use a placeholder (instead of injecting from Zig) because same-length
 * replacement avoids Content-Length changes and buffer reallocation.
 */
export function getAttributionHeader(fingerprint: string): string {
  if (isCustomBackendEnabled()) {
    return ''
  }
  if (!isAttributionHeaderEnabled()) {
    return ''
  }

  const version = `${MACRO.VERSION}.${fingerprint}`
  const entrypoint = process.env.MOSSEN_CODE_ENTRYPOINT ?? 'unknown'

  // cch=00000 placeholder is overwritten by Bun's HTTP stack with attestation token
  const cch = feature('NATIVE_CLIENT_ATTESTATION') ? ' cch=00000;' : ''
  // cc_workload: turn-scoped hint so the API can route e.g. cron-initiated
  // requests to a lower QoS pool. Absent = interactive default. Safe re:
  // fingerprint (computed from msg chars + version only, line 78 above) and
  // cch attestation (placeholder overwritten in serialized body bytes after
  // this string is built). Server _parse_cc_header tolerates unknown extra
  // fields so old API deploys silently ignore this.
  const workload = getWorkload()
  const workloadPair = workload ? ` cc_workload=${workload};` : ''
  const header = `x-mossen-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};${cch}${workloadPair}`

  logForDebugging(`attribution header ${header}`)
  return header
}
