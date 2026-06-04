import { spawnSync } from 'child_process'

export type ProfileApiKeyRef = {
  provider: 'macos-keychain'
  service: string
  account: string
}

/**
 * W459-schema — env-var apiKey reference (separate from keychain ref so all
 * existing keychain consumers stay unchanged). Stores the env-var NAME,
 * not the key value; resolveApiKeyEnvRef() reads $envVar at runtime.
 *
 * Discriminated from ProfileApiKeyRef by the dedicated `apiKeyEnvRef`
 * field on ProfileSchema (not a union member of ProfileApiKeyRef). This
 * keeps keyFor / readProfileApiKeyFromKeychain / writeProfileApiKeyToKeychain
 * / validateApiKeyRef / etc. operating on the keychain-only shape they
 * were designed for, and resolveProfileApiKey adds an env-var case in
 * the priority chain before falling through to keychain / plaintext.
 */
export type ProfileApiKeyEnvRef = {
  provider: 'env-var'
  envVar: string
}

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

export function describeApiKeyEnvRef(ref: ProfileApiKeyEnvRef): string {
  return `env:${ref.envVar}`
}

export function validateApiKeyEnvRef(
  value: unknown,
): { ok: true; ref: ProfileApiKeyEnvRef } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'apiKeyEnvRef must be an object' }
  }
  const v = value as Record<string, unknown>
  if (v.provider !== 'env-var') {
    return { ok: false, reason: 'apiKeyEnvRef.provider must be "env-var"' }
  }
  const envVar = typeof v.envVar === 'string' ? v.envVar.trim() : ''
  if (!envVar) {
    return { ok: false, reason: 'apiKeyEnvRef.envVar required' }
  }
  if (!ENV_VAR_NAME_PATTERN.test(envVar)) {
    return {
      ok: false,
      reason: `apiKeyEnvRef.envVar must match /^[A-Z_][A-Z0-9_]*$/, got ${JSON.stringify(envVar)}`,
    }
  }
  return { ok: true, ref: { provider: 'env-var', envVar } }
}

export type ApiKeyEnvResolution =
  | { ok: true; value: string }
  | { ok: false; reason: string }

export function resolveApiKeyEnvRef(
  ref: ProfileApiKeyEnvRef,
  env: NodeJS.ProcessEnv = process.env,
): ApiKeyEnvResolution {
  const raw = env[ref.envVar]
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value) return { ok: true, value }
  return { ok: false, reason: `env var ${ref.envVar} is not set or empty` }
}

export type KeychainReadResult =
  | { ok: true; value: string; source: 'macos-keychain' | 'mock-keychain' }
  | { ok: false; reason: string; unavailable?: boolean }

export type KeychainWriteResult =
  | { ok: true; source: 'macos-keychain' | 'mock-keychain' }
  | { ok: false; reason: string; unavailable?: boolean }

const DEFAULT_SERVICE = 'mossen'
const MOCK_KEYCHAIN_ENV = 'MOSSEN_CODE_KEYCHAIN_MOCK_JSON'

function keyFor(ref: ProfileApiKeyRef): string {
  return `${ref.service}\u0000${ref.account}`
}

function readMockStore(): Record<string, string> | null {
  const raw = process.env[MOCK_KEYCHAIN_ENV]
  if (raw === undefined) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeMockStore(store: Record<string, string>): void {
  process.env[MOCK_KEYCHAIN_ENV] = JSON.stringify(store)
}

export function defaultProfileApiKeyRef(profileName: string): ProfileApiKeyRef {
  return {
    provider: 'macos-keychain',
    service: DEFAULT_SERVICE,
    account: `profile:${profileName}`,
  }
}

export function describeApiKeyRef(ref: ProfileApiKeyRef): string {
  return `${ref.provider}:${ref.service}:${ref.account}`
}

export function validateApiKeyRef(value: unknown): { ok: true; ref: ProfileApiKeyRef } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'apiKeyRef must be an object' }
  }
  const v = value as Record<string, unknown>
  if (v.provider !== 'macos-keychain') {
    return { ok: false, reason: 'apiKeyRef.provider must be "macos-keychain"' }
  }
  const service = typeof v.service === 'string' ? v.service.trim() : ''
  const account = typeof v.account === 'string' ? v.account.trim() : ''
  if (!service) return { ok: false, reason: 'apiKeyRef.service required' }
  if (!account) return { ok: false, reason: 'apiKeyRef.account required' }
  if (/[\r\n\u0000]/.test(service) || /[\r\n\u0000]/.test(account)) {
    return { ok: false, reason: 'apiKeyRef service/account must not contain control characters' }
  }
  return {
    ok: true,
    ref: {
      provider: 'macos-keychain',
      service,
      account,
    },
  }
}

export function isModelProfileKeychainAvailable(): boolean {
  if (readMockStore() !== null) return true
  return process.platform === 'darwin'
}

export function readProfileApiKeyFromKeychain(ref: ProfileApiKeyRef): KeychainReadResult {
  const mock = readMockStore()
  if (mock !== null) {
    const value = mock[keyFor(ref)]
    if (typeof value === 'string' && value.trim()) {
      return { ok: true, value, source: 'mock-keychain' }
    }
    return { ok: false, reason: 'mock keychain entry not found' }
  }

  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'macOS keychain is unavailable on this platform', unavailable: true }
  }

  const result = spawnSync(
    'security',
    ['find-generic-password', '-a', ref.account, '-s', ref.service, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim()) {
    return { ok: true, value: result.stdout.trim(), source: 'macos-keychain' }
  }
  const detail = typeof result.stderr === 'string' && result.stderr.trim()
    ? result.stderr.trim().split(/\r?\n/)[0]
    : 'keychain entry not found'
  return { ok: false, reason: detail || 'keychain entry not found' }
}

export function writeProfileApiKeyToKeychain(ref: ProfileApiKeyRef, apiKey: string): KeychainWriteResult {
  const secret = apiKey.trim()
  if (!secret) return { ok: false, reason: 'apiKey must be non-empty' }

  const mock = readMockStore()
  if (mock !== null) {
    mock[keyFor(ref)] = secret
    writeMockStore(mock)
    return { ok: true, source: 'mock-keychain' }
  }

  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'macOS keychain is unavailable on this platform', unavailable: true }
  }

  const hexSecret = Buffer.from(secret, 'utf8').toString('hex')
  const result = spawnSync(
    'security',
    ['add-generic-password', '-U', '-a', ref.account, '-s', ref.service, '-X', hexSecret],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status === 0) {
    return { ok: true, source: 'macos-keychain' }
  }
  const detail = typeof result.stderr === 'string' && result.stderr.trim()
    ? result.stderr.trim().split(/\r?\n/)[0]
    : 'security add-generic-password failed'
  return { ok: false, reason: detail || 'security add-generic-password failed' }
}
