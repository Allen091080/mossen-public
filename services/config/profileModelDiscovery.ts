import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  getFallbackProfile,
  getProfileByName,
  resolveProfileApiKey,
  type ListedProfile,
  type ProfileSchema,
} from './profiles.js'

export type DiscoveredProfileModel = {
  id: string
  displayName?: string
  created?: number
  ownedBy?: string
}

export type ProfileModelDiscoverySuccess = {
  ok: true
  profileName: string
  source: 'cache' | 'network'
  url: string
  status?: number
  fetchedAt: string
  cachePath: string
  models: DiscoveredProfileModel[]
}

export type ProfileModelDiscoveryFailure = {
  ok: false
  profileName: string
  reason:
    | 'profile-not-found'
    | 'missing-api-key'
    | 'invalid-base-url'
    | 'network-error'
    | 'http-error'
    | 'invalid-json'
    | 'no-models'
  url?: string
  status?: number
  error: string
  cachePath: string
}

export type ProfileModelDiscoveryResult =
  | ProfileModelDiscoverySuccess
  | ProfileModelDiscoveryFailure

type CacheEntry = {
  profileName: string
  fingerprint: string
  provider: string
  baseURL: string
  fetchedAt: string
  models: DiscoveredProfileModel[]
}

type CacheFile = {
  schemaVersion: 1
  entries: Record<string, CacheEntry>
}

type FetchLike = typeof fetch

function configDir(): string {
  return process.env.MOSSEN_CONFIG_DIR || path.join(os.homedir(), '.mossen')
}

export function getProfileModelsCachePath(): string {
  return path.join(configDir(), 'model-models-cache.json')
}

function emptyCache(): CacheFile {
  return { schemaVersion: 1, entries: {} }
}

function readCache(cachePath = getProfileModelsCachePath()): CacheFile {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<CacheFile>
    if (parsed.schemaVersion !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return emptyCache()
    }
    return { schemaVersion: 1, entries: parsed.entries as Record<string, CacheEntry> }
  } catch {
    return emptyCache()
  }
}

function writeCache(cache: CacheFile, cachePath = getProfileModelsCachePath()): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(cachePath, 0o600)
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function credentialDescriptor(profile: ProfileSchema): string {
  if (profile.apiKeyRef) {
    return `keychain:${profile.apiKeyRef.provider}:${profile.apiKeyRef.service}:${profile.apiKeyRef.account}`
  }
  if (profile.apiKey) return 'settings-apiKey'
  return 'missing'
}

function fingerprintProfile(profileName: string, profile: ProfileSchema): string {
  return createHash('sha256')
    .update([
      profileName,
      profile.provider,
      trimTrailingSlash(profile.baseURL),
      credentialDescriptor(profile),
    ].join('\0'))
    .digest('hex')
    .slice(0, 16)
}

export function getListedProfileForModelDiscovery(name: string): ListedProfile | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const real = getProfileByName(trimmed)
  if (real) return { name: trimmed, profile: real, source: 'settings' }
  const fallback = getFallbackProfile()
  if (fallback && fallback.name === trimmed) return fallback
  return null
}

function modelFromUnknown(value: unknown): DiscoveredProfileModel | null {
  if (typeof value === 'string') {
    const id = value.trim()
    return id ? { id } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const idRaw = record.id ?? record.model ?? record.name
  if (typeof idRaw !== 'string' || !idRaw.trim()) return null
  const out: DiscoveredProfileModel = { id: idRaw.trim() }
  if (typeof record.display_name === 'string' && record.display_name.trim()) {
    out.displayName = record.display_name.trim()
  } else if (typeof record.displayName === 'string' && record.displayName.trim()) {
    out.displayName = record.displayName.trim()
  }
  if (typeof record.created === 'number' && Number.isFinite(record.created)) {
    out.created = record.created
  }
  if (typeof record.owned_by === 'string' && record.owned_by.trim()) {
    out.ownedBy = record.owned_by.trim()
  } else if (typeof record.ownedBy === 'string' && record.ownedBy.trim()) {
    out.ownedBy = record.ownedBy.trim()
  }
  return out
}

export function parseProfileModelsPayload(payload: unknown): DiscoveredProfileModel[] {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null
  const candidates =
    Array.isArray(payload)
      ? payload
      : Array.isArray(record?.data)
        ? record.data
        : Array.isArray(record?.models)
          ? record.models
          : Array.isArray(record?.model)
            ? record.model
            : []

  const byId = new Map<string, DiscoveredProfileModel>()
  for (const candidate of candidates) {
    const model = modelFromUnknown(candidate)
    if (!model) continue
    if (!byId.has(model.id)) byId.set(model.id, model)
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function redactProviderText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/x-api-key\s*[:=]\s*[A-Za-z0-9._-]+/gi, 'x-api-key=<redacted>')
}

function compact(value: string, max = 240): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine
}

function failure(
  profileName: string,
  reason: ProfileModelDiscoveryFailure['reason'],
  error: string,
  extra: Partial<Omit<ProfileModelDiscoveryFailure, 'ok' | 'profileName' | 'reason' | 'error' | 'cachePath'>> = {},
): ProfileModelDiscoveryFailure {
  return {
    ok: false,
    profileName,
    reason,
    error,
    cachePath: getProfileModelsCachePath(),
    ...extra,
  }
}

export async function discoverProfileModels(
  profileName: string,
  options: {
    refresh?: boolean
    timeoutMs?: number
    fetchImpl?: FetchLike
  } = {},
): Promise<ProfileModelDiscoveryResult> {
  const listed = getListedProfileForModelDiscovery(profileName)
  if (!listed) {
    return failure(profileName, 'profile-not-found', `profile "${profileName}" not found`)
  }

  const { profile } = listed
  const cachePath = getProfileModelsCachePath()
  const fingerprint = fingerprintProfile(listed.name, profile)
  const cache = readCache(cachePath)
  const cached = cache.entries[listed.name]
  const baseURL = trimTrailingSlash(profile.baseURL)
  const url = `${baseURL}/models`

  if (!options.refresh && cached?.fingerprint === fingerprint && cached.models.length > 0) {
    return {
      ok: true,
      profileName: listed.name,
      source: 'cache',
      url,
      fetchedAt: cached.fetchedAt,
      cachePath,
      models: cached.models,
    }
  }

  try {
    // Validate before starting a network request so malformed profile metadata
    // returns a user-actionable error instead of a fetch implementation detail.
    void new URL(url)
  } catch {
    return failure(listed.name, 'invalid-base-url', `invalid /models URL: ${url}`, { url })
  }

  const credential = resolveProfileApiKey(profile)
  if (!credential.apiKey) {
    return failure(
      listed.name,
      'missing-api-key',
      `apiKey unavailable (${credential.detail ?? credential.source})`,
      { url },
    )
  }

  const headers: Record<string, string> =
    profile.provider === 'openai-compatible'
      ? {
          Authorization: `Bearer ${credential.apiKey}`,
          'User-Agent': 'mossen-model-discovery/1.0',
        }
      : {
          'x-api-key': credential.apiKey,
          'User-Agent': 'mossen-model-discovery/1.0',
        }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const raw = await response.text()
    if (!response.ok) {
      return failure(
        listed.name,
        'http-error',
        `HTTP ${response.status}: ${compact(redactProviderText(raw))}`,
        { url, status: response.status },
      )
    }

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return failure(listed.name, 'invalid-json', 'provider /models response is not valid JSON', {
        url,
        status: response.status,
      })
    }

    const models = parseProfileModelsPayload(payload)
    if (models.length === 0) {
      return failure(listed.name, 'no-models', 'provider /models response did not contain model ids', {
        url,
        status: response.status,
      })
    }

    const fetchedAt = new Date().toISOString()
    cache.entries[listed.name] = {
      profileName: listed.name,
      fingerprint,
      provider: profile.provider,
      baseURL,
      fetchedAt,
      models,
    }
    writeCache(cache, cachePath)

    return {
      ok: true,
      profileName: listed.name,
      source: 'network',
      url,
      status: response.status,
      fetchedAt,
      cachePath,
      models,
    }
  } catch (error) {
    return failure(
      listed.name,
      'network-error',
      error instanceof Error ? error.message : String(error),
      { url },
    )
  } finally {
    clearTimeout(timeout)
  }
}
