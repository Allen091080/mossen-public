import { randomBytes } from 'crypto'

import {
  defaultProfileApiKeyRef,
  describeApiKeyRef,
  isModelProfileKeychainAvailable,
  writeProfileApiKeyToKeychain,
  type ProfileApiKeyRef,
} from './keychain.js'
import {
  desensitizeProfile,
  getProfiles,
  getProfileByName,
  setProfile,
  validateProfileName,
  type DesensitizedProfile,
  type ProfileSchema,
} from './profiles.js'
import type { ModelProfilePlanScope } from './profileSlashPlan.js'

const PROFILE_KEYCHAIN_PLAN_TTL_MS = 10 * 60 * 1000

type ProfileKeychainPlan = {
  token: string
  createdAt: number
  kind: 'import' | 'migrate'
  entries: Array<{
    name: string
    profile: ProfileSchema
    apiKey: string
    ref: ProfileApiKeyRef
  }>
  scope: ModelProfilePlanScope
}

export type ProfileKeychainPlanPreview = Omit<ProfileKeychainPlan, 'entries'> & {
  entries: Array<{
    name: string
    profile: DesensitizedProfile
    ref: ProfileApiKeyRef
  }>
}

export type ProfileKeychainExecuteResult =
  | {
      ok: true
      kind: 'import' | 'migrate'
      scope: ModelProfilePlanScope
      entries: Array<{
        name: string
        profile: DesensitizedProfile
        ref: ProfileApiKeyRef
      }>
    }
  | {
      ok: false
      reason: string
    }

const keychainPlanStore = new Map<string, ProfileKeychainPlan>()

function mintToken(): string {
  let token = randomBytes(4).toString('hex')
  while (keychainPlanStore.has(token)) token = randomBytes(4).toString('hex')
  return token
}

function pruneExpired(now = Date.now()): void {
  for (const [token, plan] of keychainPlanStore) {
    if (now - plan.createdAt > PROFILE_KEYCHAIN_PLAN_TTL_MS) {
      keychainPlanStore.delete(token)
    }
  }
}

function preview(plan: ProfileKeychainPlan): ProfileKeychainPlanPreview {
  return {
    ...plan,
    entries: plan.entries.map(entry => ({
      name: entry.name,
      profile: desensitizeProfile({
        ...entry.profile,
        apiKeyRef: entry.ref,
      }),
      ref: entry.ref,
    })),
  }
}

function storePlan(input: Omit<ProfileKeychainPlan, 'token' | 'createdAt'>): ProfileKeychainPlanPreview {
  pruneExpired()
  const full: ProfileKeychainPlan = {
    ...input,
    token: mintToken(),
    createdAt: Date.now(),
  }
  keychainPlanStore.set(full.token, full)
  return preview(full)
}

export function getModelProfileKeychainStatus(): {
  available: boolean
  profiles: Array<{
    name: string
    hasPlaintextApiKey: boolean
    hasApiKeyRef: boolean
    keychainRef?: string
    credentialSource: string
  }>
} {
  const profiles = getProfiles()
  return {
    available: isModelProfileKeychainAvailable(),
    profiles: Object.keys(profiles).sort().map(name => {
      const profile = profiles[name]!
      const credential = desensitizeProfile(profile)
      return {
        name,
        hasPlaintextApiKey: !!profile.apiKey?.trim(),
        hasApiKeyRef: !!profile.apiKeyRef,
        ...(profile.apiKeyRef ? { keychainRef: describeApiKeyRef(profile.apiKeyRef) } : {}),
        credentialSource: credential.credentialSource ?? 'missing',
      }
    }),
  }
}

export function createModelProfileKeychainImportPlan(input: {
  name: string
  scope: ModelProfilePlanScope
}): { ok: true; plan: ProfileKeychainPlanPreview } | { ok: false; reason: string } {
  const nameResult = validateProfileName(input.name)
  if (nameResult.ok !== true) return { ok: false, reason: nameResult.reason }
  const profile = getProfileByName(nameResult.name)
  if (!profile) return { ok: false, reason: `profile "${nameResult.name}" not found` }
  const apiKey = profile.apiKey?.trim()
  if (!apiKey) {
    return { ok: false, reason: `profile "${nameResult.name}" has no plaintext apiKey to import` }
  }
  const ref = profile.apiKeyRef ?? defaultProfileApiKeyRef(nameResult.name)
  return {
    ok: true,
    plan: storePlan({
      kind: 'import',
      entries: [{ name: nameResult.name, profile, apiKey, ref }],
      scope: input.scope,
    }),
  }
}

export function createModelProfileKeychainMigrationPlan(input: {
  scope: ModelProfilePlanScope
}): { ok: true; plan: ProfileKeychainPlanPreview } | { ok: false; reason: string } {
  const entries = Object.entries(getProfiles())
    .filter((entry): entry is [string, ProfileSchema] => !!entry[1]?.apiKey?.trim())
    .map(([name, profile]) => ({
      name,
      profile,
      apiKey: profile.apiKey!.trim(),
      ref: profile.apiKeyRef ?? defaultProfileApiKeyRef(name),
    }))
  if (entries.length === 0) {
    return { ok: false, reason: 'no settings profiles with plaintext apiKey were found' }
  }
  return {
    ok: true,
    plan: storePlan({
      kind: 'migrate',
      entries,
      scope: input.scope,
    }),
  }
}

export function executeModelProfileKeychainPlan(token: string): ProfileKeychainExecuteResult {
  pruneExpired()
  const plan = keychainPlanStore.get(token)
  if (!plan) return { ok: false, reason: `unknown or expired keychain confirmation token "${token}"` }
  keychainPlanStore.delete(token)
  if (Date.now() - plan.createdAt > PROFILE_KEYCHAIN_PLAN_TTL_MS) {
    return { ok: false, reason: `keychain confirmation token "${token}" has expired` }
  }

  for (const entry of plan.entries) {
    const result = writeProfileApiKeyToKeychain(entry.ref, entry.apiKey)
    if (result.ok === false) {
      return { ok: false, reason: `${entry.name}: ${result.reason}` }
    }
  }

  const written: ProfileKeychainExecuteResult & { ok: true } = {
    ok: true,
    kind: plan.kind,
    scope: plan.scope,
    entries: [],
  }
  for (const entry of plan.entries) {
    const current = getProfileByName(entry.name) ?? entry.profile
    const updated: ProfileSchema = {
      ...current,
      apiKeyRef: entry.ref,
      // Keep plaintext for compatibility; W168 is opt-in reference, not destructive migration.
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    }
    setProfile(entry.name, updated, plan.scope)
    written.entries.push({
      name: entry.name,
      profile: desensitizeProfile(updated),
      ref: entry.ref,
    })
  }
  return written
}

export function _resetModelProfileKeychainPlanStoreForTesting(): void {
  keychainPlanStore.clear()
}
