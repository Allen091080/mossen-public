import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { atomicWriteJsonSync } from '../../../utils/atomicWriteJson.js'

import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemorySchemaVersion,
  isRecord,
} from '../schema/scope'
import type {
  LlmProviderConfig,
  LlmProviderConfigByJob,
  LlmProviderJobType,
} from '../llm/provider'
import {
  isEmbeddingProviderConfig,
  type EmbeddingProviderConfig,
} from '../embedding/provider'

export type MemorySidecarCaptureConfig = {
  enabled: boolean
  source: 'session-log'
  includeToolOutput: boolean
  includeToolInput: boolean
}

export type MemorySidecarAdapterConfig = {
  enabled: boolean
  maxPayloadBytes: number
  maxTextChars: number
  rejectToolPayloads: boolean
  deadLetter: boolean
}

export type MemorySidecarIndexConfig = {
  sqlite: boolean
  fts: boolean
  vector: boolean
  vectorProvider: EmbeddingProviderConfig
}

// W122-B: 11-class persisted result of `/memory-sidecar llm test`. ONLY
// the categorical label, an optional sub-class tag, and the timestamp are
// persisted. Bodies / headers / api keys / prompts / completions / full
// URLs are NEVER stored.
export type MemorySidecarLlmLastTestStatus =
  | 'success'
  | 'disabled'
  | 'no-config'
  | 'apiKeyEnv-missing'
  | 'invalid-base-url'
  | 'timeout'
  | 'network-error'
  | 'http-4xx'
  | 'http-5xx'
  | 'invalid-json'
  | 'schema-invalid'

export type MemorySidecarLlmLastTest = {
  status: MemorySidecarLlmLastTestStatus
  errorClass: MemorySidecarLlmLastTestStatus | null
  at: string
}

export type MemorySidecarClassificationConfig = {
  ruleBased: boolean
  llm: boolean
  llmProvider: 'disabled' | 'openai-compatible' | 'mossen-profile' | 'external-command'
  llmProviderConfig?: LlmProviderConfig
  perJobProvider?: LlmProviderConfigByJob
  lastTest?: MemorySidecarLlmLastTest
}

export type MemorySidecarRetrievalConfig = {
  mcp: boolean
  maxResults: number
  maxTokens: number
}

export type MemorySidecarAgentScheduleConfig = {
  dirtyCountThreshold: number
  maxDirtyAgeMsThreshold: number
}

export type MemorySidecarAgentConfig = {
  schedule: MemorySidecarAgentScheduleConfig
}

export type MemorySidecarTeamConfig = {
  enabled: boolean
}

export type MemorySidecarConfig = {
  schemaVersion: MemorySchemaVersion
  enabled: boolean
  homeDir: string
  configPath: string
  capture: MemorySidecarCaptureConfig
  adapter: MemorySidecarAdapterConfig
  index: MemorySidecarIndexConfig
  classification: MemorySidecarClassificationConfig
  retrieval: MemorySidecarRetrievalConfig
  agent: MemorySidecarAgentConfig
  team: MemorySidecarTeamConfig
}

export type MemorySidecarConfigInput = Partial<
  Omit<MemorySidecarConfig, 'schemaVersion' | 'homeDir' | 'configPath'>
> & {
  schemaVersion?: unknown
  homeDir?: string
  configPath?: string
}

const SIDECAR_HOME_ENV = 'MOSSEN_MEMORY_SIDECAR_HOME'
const LLM_PROVIDER_JOB_TYPES: LlmProviderJobType[] = [
  'classify_llm',
  'synthesize_profile',
  'detect_proposals',
]

export function getDefaultMemorySidecarHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredHome = env[SIDECAR_HOME_ENV]
  return configuredHome ? resolve(configuredHome) : join(homedir(), '.mossen', 'memory-sidecar')
}

export function getDefaultMemorySidecarConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getDefaultMemorySidecarHome(env), 'config.json')
}

export function createDefaultMemorySidecarConfig(
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  const homeDir = getDefaultMemorySidecarHome(env)

  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    enabled: false,
    homeDir,
    configPath: join(homeDir, 'config.json'),
    capture: {
      enabled: false,
      source: 'session-log',
      includeToolOutput: false,
      includeToolInput: false,
    },
    adapter: {
      enabled: false,
      maxPayloadBytes: 1024 * 1024,
      maxTextChars: 20000,
      rejectToolPayloads: true,
      deadLetter: true,
    },
    index: {
      sqlite: true,
      fts: true,
      vector: false,
      vectorProvider: {
        kind: 'deterministic_fake',
        dimensions: 32,
      },
    },
    classification: {
      ruleBased: true,
      llm: false,
      llmProvider: 'disabled',
      llmProviderConfig: {
        kind: 'disabled',
      },
      perJobProvider: {},
    },
    retrieval: {
      mcp: false,
      maxResults: 10,
      maxTokens: 1200,
    },
    agent: {
      schedule: {
        dirtyCountThreshold: 10,
        maxDirtyAgeMsThreshold: 10 * 60 * 1000,
      },
    },
    team: {
      enabled: false,
    },
  }
}

export function mergeMemorySidecarConfig(
  input: MemorySidecarConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  const defaults = createDefaultMemorySidecarConfig(env)

  return {
    ...defaults,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
    homeDir: input.homeDir ? resolve(input.homeDir) : defaults.homeDir,
    configPath: input.configPath ? resolve(input.configPath) : defaults.configPath,
    capture: {
      ...defaults.capture,
      ...(isRecord(input.capture) ? input.capture : {}),
    },
    adapter: {
      ...defaults.adapter,
      ...(isRecord(input.adapter) ? input.adapter : {}),
    },
    index: mergeIndexConfig(defaults.index, input.index),
    classification: mergeClassificationConfig(defaults.classification, input.classification),
    retrieval: {
      ...defaults.retrieval,
      ...(isRecord(input.retrieval) ? input.retrieval : {}),
    },
    agent: {
      ...defaults.agent,
      ...(isRecord(input.agent) ? input.agent : {}),
      schedule: {
        ...defaults.agent.schedule,
        ...(isRecord(input.agent) && isRecord(input.agent.schedule)
          ? input.agent.schedule
          : {}),
      },
    },
    team: {
      ...defaults.team,
      ...(isRecord(input.team) ? input.team : {}),
    },
  }
}

function mergeClassificationConfig(
  defaults: MemorySidecarClassificationConfig,
  input: unknown,
): MemorySidecarClassificationConfig {
  if (!isRecord(input)) return defaults

  // W122-B: preserve lastTest if it is well-formed. Reject any unrecognized
  // shape silently — we never let arbitrary data into this slot.
  let lastTest: MemorySidecarLlmLastTest | undefined
  if (isMemorySidecarLlmLastTest(input.lastTest)) {
    lastTest = {
      status: input.lastTest.status,
      errorClass: input.lastTest.errorClass,
      at: input.lastTest.at,
    }
  }

  return {
    ruleBased:
      typeof input.ruleBased === 'boolean' ? input.ruleBased : defaults.ruleBased,
    llm: typeof input.llm === 'boolean' ? input.llm : defaults.llm,
    llmProvider:
      input.llmProvider === 'disabled' ||
      input.llmProvider === 'openai-compatible' ||
      input.llmProvider === 'mossen-profile' ||
      input.llmProvider === 'external-command'
        ? input.llmProvider
        : defaults.llmProvider,
    llmProviderConfig: isLlmProviderConfig(input.llmProviderConfig)
      ? input.llmProviderConfig
      : defaults.llmProviderConfig,
    perJobProvider: mergePerJobProviderConfig(
      defaults.perJobProvider,
      input.perJobProvider,
    ),
    lastTest: lastTest ?? defaults.lastTest,
  }
}

function mergePerJobProviderConfig(
  defaults: LlmProviderConfigByJob | undefined,
  input: unknown,
): LlmProviderConfigByJob | undefined {
  const merged: LlmProviderConfigByJob = { ...(defaults ?? {}) }
  if (!isRecord(input)) return merged

  for (const jobType of LLM_PROVIDER_JOB_TYPES) {
    if (isLlmProviderConfig(input[jobType])) {
      merged[jobType] = input[jobType]
    }
  }

  return merged
}

function mergeIndexConfig(
  defaults: MemorySidecarIndexConfig,
  input: unknown,
): MemorySidecarIndexConfig {
  if (!isRecord(input)) return defaults

  return {
    sqlite: typeof input.sqlite === 'boolean' ? input.sqlite : defaults.sqlite,
    fts: typeof input.fts === 'boolean' ? input.fts : defaults.fts,
    vector: typeof input.vector === 'boolean' ? input.vector : defaults.vector,
    vectorProvider: isEmbeddingProviderConfig(input.vectorProvider)
      ? input.vectorProvider
      : defaults.vectorProvider,
  }
}

export function isMemorySidecarConfig(value: unknown): value is MemorySidecarConfig {
  if (!isRecord(value)) {
    return false
  }

  const capture = value.capture
  const adapter = value.adapter
  const index = value.index
  const classification = value.classification
  const retrieval = value.retrieval
  const agent = value.agent
  const team = value.team

  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    typeof value.enabled === 'boolean' &&
    typeof value.homeDir === 'string' &&
    typeof value.configPath === 'string' &&
    isRecord(capture) &&
    typeof capture.enabled === 'boolean' &&
    capture.source === 'session-log' &&
    typeof capture.includeToolOutput === 'boolean' &&
    typeof capture.includeToolInput === 'boolean' &&
    isRecord(adapter) &&
    typeof adapter.enabled === 'boolean' &&
    typeof adapter.maxPayloadBytes === 'number' &&
    Number.isInteger(adapter.maxPayloadBytes) &&
    adapter.maxPayloadBytes > 0 &&
    typeof adapter.maxTextChars === 'number' &&
    Number.isInteger(adapter.maxTextChars) &&
    adapter.maxTextChars > 0 &&
    typeof adapter.rejectToolPayloads === 'boolean' &&
    typeof adapter.deadLetter === 'boolean' &&
    isRecord(index) &&
    typeof index.sqlite === 'boolean' &&
    typeof index.fts === 'boolean' &&
    typeof index.vector === 'boolean' &&
    isEmbeddingProviderConfig(index.vectorProvider) &&
    isRecord(classification) &&
    typeof classification.ruleBased === 'boolean' &&
    typeof classification.llm === 'boolean' &&
    (classification.llmProvider === undefined ||
      classification.llmProvider === 'disabled' ||
      classification.llmProvider === 'openai-compatible' ||
      classification.llmProvider === 'mossen-profile' ||
      classification.llmProvider === 'external-command') &&
    (classification.llmProviderConfig === undefined ||
      isLlmProviderConfig(classification.llmProviderConfig)) &&
    (classification.perJobProvider === undefined ||
      isLlmProviderConfigByJob(classification.perJobProvider)) &&
    (classification.lastTest === undefined ||
      isMemorySidecarLlmLastTest(classification.lastTest)) &&
    isRecord(retrieval) &&
    typeof retrieval.mcp === 'boolean' &&
    typeof retrieval.maxResults === 'number' &&
    Number.isInteger(retrieval.maxResults) &&
    retrieval.maxResults > 0 &&
    typeof retrieval.maxTokens === 'number' &&
    Number.isInteger(retrieval.maxTokens) &&
    retrieval.maxTokens > 0 &&
    isRecord(agent) &&
    isRecord(agent.schedule) &&
    typeof agent.schedule.dirtyCountThreshold === 'number' &&
    Number.isInteger(agent.schedule.dirtyCountThreshold) &&
    agent.schedule.dirtyCountThreshold > 0 &&
    typeof agent.schedule.maxDirtyAgeMsThreshold === 'number' &&
    Number.isInteger(agent.schedule.maxDirtyAgeMsThreshold) &&
    agent.schedule.maxDirtyAgeMsThreshold > 0 &&
    isRecord(team) &&
    typeof team.enabled === 'boolean'
  )
}

function isLlmProviderConfig(value: unknown): value is LlmProviderConfig {
  if (!isRecord(value) || typeof value.kind !== 'string') return false

  if (value.kind === 'disabled') {
    return value.reason === undefined || typeof value.reason === 'string'
  }

  if (value.kind === 'openai-compatible') {
    return (
      typeof value.baseUrl === 'string' &&
      value.baseUrl.length > 0 &&
      typeof value.model === 'string' &&
      value.model.length > 0 &&
      (value.apiKeyEnv === undefined || typeof value.apiKeyEnv === 'string') &&
      (value.timeoutMs === undefined || typeof value.timeoutMs === 'number') &&
      (value.headers === undefined || isStringRecord(value.headers))
    )
  }

  if (value.kind === 'mossen-profile') {
    // W119 H8: mossen-profile is still a recognized shape (existing config
    // files that contain it are loaded so users can migrate), but the
    // factory in createLlmProvider() now returns a disabled provider for
    // this kind. status / config readers can still introspect it.
    return (
      (value.profileId === undefined || typeof value.profileId === 'string') &&
      (value.model === undefined || typeof value.model === 'string') &&
      (value.timeoutMs === undefined || typeof value.timeoutMs === 'number')
    )
  }

  if (value.kind === 'external-command') {
    return (
      typeof value.command === 'string' &&
      value.command.length > 0 &&
      (value.args === undefined ||
        (Array.isArray(value.args) &&
          value.args.every(arg => typeof arg === 'string'))) &&
      (value.timeoutMs === undefined || typeof value.timeoutMs === 'number')
    )
  }

  return false
}

function isLlmProviderConfigByJob(value: unknown): value is LlmProviderConfigByJob {
  if (!isRecord(value)) return false
  return LLM_PROVIDER_JOB_TYPES.every(jobType =>
    value[jobType] === undefined || isLlmProviderConfig(value[jobType]),
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(item => typeof item === 'string')
  )
}

const MEMORY_SIDECAR_LLM_LAST_TEST_STATUSES: MemorySidecarLlmLastTestStatus[] = [
  'success',
  'disabled',
  'no-config',
  'apiKeyEnv-missing',
  'invalid-base-url',
  'timeout',
  'network-error',
  'http-4xx',
  'http-5xx',
  'invalid-json',
  'schema-invalid',
]

function isMemorySidecarLlmLastTestStatus(
  value: unknown,
): value is MemorySidecarLlmLastTestStatus {
  return (
    typeof value === 'string' &&
    (MEMORY_SIDECAR_LLM_LAST_TEST_STATUSES as readonly string[]).includes(value)
  )
}

function isMemorySidecarLlmLastTest(
  value: unknown,
): value is MemorySidecarLlmLastTest {
  if (!isRecord(value)) return false
  return (
    isMemorySidecarLlmLastTestStatus(value.status) &&
    (value.errorClass === null || isMemorySidecarLlmLastTestStatus(value.errorClass)) &&
    typeof value.at === 'string' &&
    value.at.length > 0
  )
}

export function loadMemorySidecarConfig(
  configPath = getDefaultMemorySidecarConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  if (!existsSync(configPath)) {
    return createDefaultMemorySidecarConfig(env)
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as MemorySidecarConfigInput
  const merged = mergeMemorySidecarConfig(
    {
      ...parsed,
      configPath,
    },
    env,
  )

  if (!isMemorySidecarConfig(merged)) {
    throw new Error(`Invalid memory sidecar config: ${configPath}`)
  }

  return merged
}

/**
 * Set the `enabled` field in the sidecar config file.
 * Creates the config file and parent directories if they don't exist.
 * Does not delete any data. Does not start/stop any processes.
 * Returns the updated config.
 */
export type MemorySidecarLlmStatus = {
  llmEnabled: boolean
  ruleBasedEnabled: boolean
  providerKind: 'disabled' | 'openai-compatible' | 'mossen-profile' | 'external-command'
  hasConfig: boolean
  baseUrl?: string
  model?: string
  apiKeyEnv?: string
  apiKeyConfigured?: boolean
  profileId?: string
  profileAvailable?: boolean
  // W122-B: persisted result of the most recent /memory-sidecar llm test.
  // Categorical only — body / api key / prompt / completion never persisted.
  lastTest?: MemorySidecarLlmLastTest
}

export function getMemorySidecarLlmStatus(
  config: MemorySidecarConfig,
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarLlmStatus {
  const classification = config.classification
  const providerConfig = classification.llmProviderConfig

  const status: MemorySidecarLlmStatus = {
    llmEnabled: classification.llm,
    ruleBasedEnabled: classification.ruleBased,
    providerKind: classification.llmProvider,
    hasConfig: hasIndependentLlmConfig(config),
  }

  if (providerConfig?.kind === 'openai-compatible') {
    const oc = providerConfig as OpenAiCompatibleLlmProviderConfigFromConfig
    status.baseUrl = oc.baseUrl
    status.model = oc.model
    status.apiKeyEnv = oc.apiKeyEnv
    status.apiKeyConfigured = !!(oc.apiKeyEnv && env[oc.apiKeyEnv])
  } else if (providerConfig?.kind === 'mossen-profile') {
    // W121-A.1: mossen-profile is fully deprecated. Status surfaces the
    // legacy profileId for visibility but reports hasConfig=false and
    // profileAvailable=false unconditionally — sidecar never reads
    // mossen.activeProfile / mossen.profiles / profile.apiKey.
    const profileId = (providerConfig as { profileId?: string }).profileId
    status.profileId = profileId
    status.profileAvailable = false
  }

  if (classification.lastTest) {
    status.lastTest = classification.lastTest
  }

  return status
}

export type OpenAiCompatibleLlmProviderConfigFromConfig = {
  kind: 'openai-compatible'
  baseUrl: string
  model: string
  apiKeyEnv?: string
  timeoutMs?: number
}

// W119 M7: apiKeyEnv must be an env-var NAME, not a key value. This regex
// rejects strings that look like real keys (sk-..., bearer tokens, JWTs
// containing dots/dashes) and accepts only valid POSIX env-var names.
const API_KEY_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

export function isValidApiKeyEnvName(value: string): boolean {
  return API_KEY_ENV_NAME_PATTERN.test(value)
}

export function setMemorySidecarLlmConfig(
  options: {
    baseUrl: string
    model: string
    apiKeyEnv: string
    timeoutMs?: number
  },
  configPath = getDefaultMemorySidecarConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  // W119 M7: reject anything that does not look like an env-var name. This
  // catches the "user pasted their real sk-... key into --api-key-env"
  // mistake at the persistence boundary so the actual key never reaches
  // config.json.
  if (!isValidApiKeyEnvName(options.apiKeyEnv)) {
    throw new Error(
      `INVALID_API_KEY_ENV: --api-key-env must be an env-var NAME (e.g. OPENAI_API_KEY), ` +
      `not a real key. Got something matching ${API_KEY_ENV_NAME_PATTERN}=false. ` +
      `If you accidentally pasted your real key, do NOT save it to config; ` +
      `instead export it: \`export YOUR_ENV_NAME=<key>\` and pass --api-key-env YOUR_ENV_NAME.`,
    )
  }

  const dir = resolve(configPath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const current = loadMemorySidecarConfig(configPath, env)
  const updated: MemorySidecarConfig = {
    ...current,
    classification: {
      ...current.classification,
      llmProvider: 'openai-compatible',
      llmProviderConfig: {
        kind: 'openai-compatible',
        baseUrl: options.baseUrl,
        model: options.model,
        apiKeyEnv: options.apiKeyEnv,
        timeoutMs: options.timeoutMs,
      },
    },
  }

  // W158: atomic temp+rename + fsync so a crash mid-write cannot leave
  // the config truncated. The auth-loss guard refuses to overwrite a
  // file that already has a populated `apiKeyEnv` with a payload that
  // dropped it — this setter always writes a populated apiKeyEnv (it
  // came from an `isValidApiKeyEnvName` check above), so the guard
  // only fires if a future regression accidentally clears the field.
  atomicWriteJsonSync(configPath, updated, {
    defaultMode: 0o600,
    authLossGuard: (currentRaw, nextRaw) => {
      const currentApiKeyEnv = extractApiKeyEnv(currentRaw)
      const nextApiKeyEnv = extractApiKeyEnv(nextRaw)
      if (currentApiKeyEnv && !nextApiKeyEnv) {
        return (
          'AUTH_LOSS_GUARD: refusing to overwrite memory-sidecar config — ' +
          `existing apiKeyEnv "${currentApiKeyEnv}" would be dropped`
        )
      }
      return null
    },
  })
  return updated
}

// W158 helper: pull apiKeyEnv out of a parsed config so the auth-loss
// guard can compare current vs. next without depending on the full
// merge pipeline. Tolerant of malformed inputs — returns undefined
// rather than throwing, so the guard fails open on the "current file
// is corrupt" path (the helper itself still writes; a corrupt-recovery
// is a separate concern from auth loss).
function extractApiKeyEnv(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as { classification?: unknown }
  if (!v.classification || typeof v.classification !== 'object') return undefined
  const c = v.classification as { llmProviderConfig?: unknown }
  if (!c.llmProviderConfig || typeof c.llmProviderConfig !== 'object') {
    return undefined
  }
  const p = c.llmProviderConfig as { apiKeyEnv?: unknown }
  return typeof p.apiKeyEnv === 'string' && p.apiKeyEnv ? p.apiKeyEnv : undefined
}

export function hasIndependentLlmConfig(config: MemorySidecarConfig): boolean {
  const providerConfig = config.classification.llmProviderConfig
  if (isIndependentLlmProviderConfig(providerConfig)) return true
  return Object.values(config.classification.perJobProvider ?? {})
    .some(isIndependentLlmProviderConfig)
}

function isIndependentLlmProviderConfig(
  providerConfig: LlmProviderConfig | undefined,
): boolean {
  if (!providerConfig || providerConfig.kind === 'disabled') return false
  if (providerConfig.kind === 'openai-compatible') {
    const oc = providerConfig as OpenAiCompatibleLlmProviderConfigFromConfig
    return !!(oc.baseUrl && oc.model)
  }
  // W121-A.1: mossen-profile is deprecated and never counts as "independent
  // LLM config". /memory-sidecar llm enable on a stale mossen-profile config
  // throws NO_LLM_CONFIG and the slash command surfaces the migration hint.
  if (providerConfig.kind === 'mossen-profile') {
    return false
  }
  return true
}

export function setMemorySidecarLlmEnabled(
  enable: boolean,
  configPath = getDefaultMemorySidecarConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  const dir = resolve(configPath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const current = loadMemorySidecarConfig(configPath, env)

  // W109: Enable refuses if no independent provider config exists
  if (enable && !hasIndependentLlmConfig(current)) {
    throw new Error('NO_LLM_CONFIG')
  }

  const updated: MemorySidecarConfig = {
    ...current,
    classification: {
      ...current.classification,
      ruleBased: true,
      llm: enable,
      // Keep existing provider config on disable, only flip llm flag
    },
  }

  // W158: atomic temp+rename + fsync.
  atomicWriteJsonSync(configPath, updated, { defaultMode: 0o600 })
  return updated
}

// W122-B: persist the categorical result of `/memory-sidecar llm test`.
// HARD CONSTRAINT — three fields only: status, errorClass, at. Bodies /
// headers / api keys / prompts / completions / full URLs are NEVER
// persisted. Inputs are validated; malformed payloads throw.
export function setMemorySidecarLlmLastTest(
  lastTest: MemorySidecarLlmLastTest,
  configPath = getDefaultMemorySidecarConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  if (!isMemorySidecarLlmLastTest(lastTest)) {
    throw new Error(
      'INVALID_LLM_LAST_TEST: only {status, errorClass, at} (status/errorClass from the 11-class enum) may be persisted',
    )
  }

  const dir = resolve(configPath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const current = loadMemorySidecarConfig(configPath, env)
  const updated: MemorySidecarConfig = {
    ...current,
    classification: {
      ...current.classification,
      lastTest: {
        status: lastTest.status,
        errorClass: lastTest.errorClass,
        at: lastTest.at,
      },
    },
  }

  // W158: atomic temp+rename + fsync.
  atomicWriteJsonSync(configPath, updated, { defaultMode: 0o600 })
  return updated
}

export function setMemorySidecarEnabled(
  enabled: boolean,
  configPath = getDefaultMemorySidecarConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): MemorySidecarConfig {
  const dir = resolve(configPath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const current = loadMemorySidecarConfig(configPath, env)
  const updated: MemorySidecarConfig = {
    ...current,
    enabled,
    adapter: { ...current.adapter, enabled },
    capture: { ...current.capture, enabled },
  }
  // W158: atomic temp+rename + fsync.
  atomicWriteJsonSync(configPath, updated, { defaultMode: 0o600 })
  return updated
}
