import { createHash, randomBytes } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs'
import { dirname } from 'path'
import type { EditableSettingSource } from './settings/constants.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  updateSettingsForSource,
} from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'

type ApplyConfigChangeStatus = 'blocked' | 'preview' | 'applied' | 'failed'

export type StreamJsonApplyConfigChangeRequest = {
  source?: EditableSettingSource
  changes?: Record<string, unknown>
  dryRun?: boolean
  confirm?: boolean
  confirmToken?: string
}

export type StreamJsonApplyConfigChangeResponse = {
  status: ApplyConfigChangeStatus
  reason?: string
  summary?: string
  changedKeys?: string[]
  rejectedKeys?: string[]
  token?: string
  expiresAt?: string
  source?: EditableSettingSource
  backupCreated?: boolean
}

type PendingConfigChange = {
  source: EditableSettingSource
  changes: SettingsJson
  changedKeys: string[]
  baseHash: string
  expiresAt: number
}

type AllowedSettingSpec = {
  description: string
  normalize: (value: unknown) => { ok: true; value: unknown } | { ok: false }
}

const CONFIG_CHANGE_TOKEN_TTL_MS = 10 * 60 * 1000
const pendingConfigChanges = new Map<string, PendingConfigChange>()

const booleanSetting = (): AllowedSettingSpec => ({
  description: 'boolean',
  normalize: value =>
    typeof value === 'boolean' ? { ok: true, value } : { ok: false },
})

const nullableStringSetting = (): AllowedSettingSpec => ({
  description: 'string or null',
  normalize: value => {
    if (value === null) return { ok: true, value: undefined }
    return typeof value === 'string' ? { ok: true, value } : { ok: false }
  },
})

const enumSetting = (values: readonly string[]): AllowedSettingSpec => ({
  description: `${values.join('|')} or null`,
  normalize: value => {
    if (value === null) return { ok: true, value: undefined }
    return typeof value === 'string' && values.includes(value)
      ? { ok: true, value }
      : { ok: false }
  },
})

const numberRangeSetting = (min: number, max: number): AllowedSettingSpec => ({
  description: `number ${min}..${max} or null`,
  normalize: value => {
    if (value === null) return { ok: true, value: undefined }
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
      ? { ok: true, value }
      : { ok: false }
  },
})

const ALLOWED_CONFIG_CHANGE_KEYS = {
  alwaysThinkingEnabled: booleanSetting(),
  disableWorkflows: booleanSetting(),
  effortLevel: enumSetting(['low', 'medium', 'high', 'xhigh']),
  enableWorkflows: booleanSetting(),
  feedbackSurveyRate: numberRangeSetting(0, 1),
  includeCoAuthoredBy: booleanSetting(),
  includeGitInstructions: booleanSetting(),
  language: nullableStringSetting(),
  reasoningProfile: enumSetting(['fast', 'standard', 'deep']),
  skipWorkflowUsageWarning: booleanSetting(),
  spinnerTipsEnabled: booleanSetting(),
  syntaxHighlightingDisabled: booleanSetting(),
  terminalTitleFromRename: booleanSetting(),
  workflowKeywordTriggerEnabled: booleanSetting(),
} as const satisfies Record<string, AllowedSettingSpec>

const SECRET_KEY_PATTERN =
  /(?:api|auth|bearer|credential|header|password|private|secret|token)/i

function pruneExpiredTokens(now = Date.now()): void {
  for (const [token, pending] of pendingConfigChanges) {
    if (pending.expiresAt <= now) {
      pendingConfigChanges.delete(token)
    }
  }
}

function hashSettingsFile(source: EditableSettingSource): string {
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath || !existsSync(filePath)) return 'absent'
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

function createBackupIfPresent(
  source: EditableSettingSource,
  token: string,
): boolean {
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath || !existsSync(filePath)) return false
  mkdirSync(dirname(filePath), { recursive: true })
  copyFileSync(filePath, `${filePath}.w177b-${token}.bak`)
  return true
}

function normalizeSource(
  source: unknown,
): EditableSettingSource | { error: string } {
  if (source === undefined || source === null) return 'userSettings'
  if (
    source === 'userSettings' ||
    source === 'projectSettings' ||
    source === 'localSettings'
  ) {
    return source
  }
  return {
    error:
      'apply_config_change only supports userSettings, projectSettings, or localSettings',
  }
}

function normalizeChanges(
  changes: unknown,
):
  | {
      ok: true
      changes: SettingsJson
      changedKeys: string[]
    }
  | {
      ok: false
      reason: string
      rejectedKeys: string[]
    } {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return {
      ok: false,
      reason: 'changes must be a non-empty object',
      rejectedKeys: [],
    }
  }

  const input = changes as Record<string, unknown>
  const output: Record<string, unknown> = {}
  const rejectedKeys: string[] = []

  for (const [key, value] of Object.entries(input)) {
    const spec = ALLOWED_CONFIG_CHANGE_KEYS[key]
    if (!spec || SECRET_KEY_PATTERN.test(key)) {
      rejectedKeys.push(key)
      continue
    }
    const normalized = spec.normalize(value)
    if (!normalized.ok) {
      rejectedKeys.push(`${key} (${spec.description})`)
      continue
    }
    output[key] = normalized.value
  }

  const changedKeys = Object.keys(output).sort()
  if (rejectedKeys.length > 0) {
    return {
      ok: false,
      reason:
        'changes include unsupported or sensitive settings; use dedicated credential/profile flows for secrets',
      rejectedKeys: rejectedKeys.sort(),
    }
  }
  if (changedKeys.length === 0) {
    return {
      ok: false,
      reason: 'changes must include at least one allowed setting key',
      rejectedKeys: [],
    }
  }

  return {
    ok: true,
    changes: output as SettingsJson,
    changedKeys,
  }
}

function mintConfigChangeToken(pending: PendingConfigChange): string {
  pruneExpiredTokens()
  const token = randomBytes(4).toString('hex')
  pendingConfigChanges.set(token, pending)
  return token
}

export function handleStreamJsonConfigChangeRequest(
  request: StreamJsonApplyConfigChangeRequest,
): StreamJsonApplyConfigChangeResponse {
  pruneExpiredTokens()

  if (request.confirm === true) {
    const token = request.confirmToken?.trim()
    if (!token || !/^[0-9a-f]{8}$/i.test(token)) {
      return {
        status: 'failed',
        reason: 'apply_config_change confirm requires an 8-hex confirmToken',
      }
    }
    const pending = pendingConfigChanges.get(token)
    pendingConfigChanges.delete(token)
    if (!pending) {
      return {
        status: 'failed',
        reason:
          'apply_config_change confirm token is unknown or expired; run dryRun again',
      }
    }
    const currentHash = hashSettingsFile(pending.source)
    if (currentHash !== pending.baseHash) {
      return {
        status: 'failed',
        source: pending.source,
        changedKeys: pending.changedKeys,
        reason:
          'settings file changed after preview; run dryRun again before confirming',
      }
    }

    const backupCreated = createBackupIfPresent(pending.source, token)
    const result = updateSettingsForSource(pending.source, pending.changes)
    if (result.error) {
      return {
        status: 'failed',
        source: pending.source,
        changedKeys: pending.changedKeys,
        backupCreated,
        reason: result.error.message,
      }
    }

    return {
      status: 'applied',
      source: pending.source,
      changedKeys: pending.changedKeys,
      backupCreated,
      summary: `Applied ${pending.changedKeys.length} setting change(s) to ${pending.source}`,
    }
  }

  const source = normalizeSource(request.source)
  if (typeof source !== 'string') {
    return { status: 'failed', reason: source.error }
  }

  const normalized = normalizeChanges(request.changes)
  if (normalized.ok === false) {
    return {
      status: 'failed',
      source,
      reason: normalized.reason,
      rejectedKeys: normalized.rejectedKeys,
    }
  }

  // Read the source so preview reflects the exact file snapshot that confirm
  // must match. The returned value is intentionally not echoed to the client.
  getSettingsForSource(source)
  const expiresAt = Date.now() + CONFIG_CHANGE_TOKEN_TTL_MS
  const token = mintConfigChangeToken({
    source,
    changes: normalized.changes,
    changedKeys: normalized.changedKeys,
    baseHash: hashSettingsFile(source),
    expiresAt,
  })

  return {
    status: 'preview',
    source,
    changedKeys: normalized.changedKeys,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    summary: `Preview accepted for ${normalized.changedKeys.length} setting change(s); confirm with apply_config_change confirmToken before it expires`,
  }
}
