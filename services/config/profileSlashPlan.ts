import { randomBytes } from 'crypto'

import {
  deleteProfile,
  desensitizeProfile,
  getCurrentProfile,
  getProfileByName,
  setActiveProfile,
  setProfile,
  validateProfile,
  validateProfileName,
  type DesensitizedProfile,
  type ProfileProvider,
  type ProfileSchema,
} from './profiles.js'

export const MODEL_PROFILE_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type ModelProfilePlanScope = 'user' | 'project'

export type ModelProfilePlan =
  | {
      kind: 'add'
      token: string
      createdAt: number
      name: string
      profile: ProfileSchema
      scope: ModelProfilePlanScope
      activate: boolean
    }
  | {
      kind: 'remove'
      token: string
      createdAt: number
      name: string
      profile: ProfileSchema
      scope: ModelProfilePlanScope
      wasCurrentProfile: boolean
    }
  | {
      kind: 'update'
      token: string
      createdAt: number
      name: string
      before: ProfileSchema
      profile: ProfileSchema
      scope: ModelProfilePlanScope
      wasCurrentProfile: boolean
    }
  | {
      kind: 'default'
      token: string
      createdAt: number
      name: string
      profile: ProfileSchema
      scope: ModelProfilePlanScope
    }

export type ModelProfilePlanPreview =
  | (Omit<Extract<ModelProfilePlan, { kind: 'add' }>, 'profile'> & {
      profile: DesensitizedProfile
    })
  | (Omit<Extract<ModelProfilePlan, { kind: 'remove' }>, 'profile'> & {
      profile: DesensitizedProfile
    })
  | (Omit<Extract<ModelProfilePlan, { kind: 'update' }>, 'profile' | 'before'> & {
      before: DesensitizedProfile
      profile: DesensitizedProfile
    })
  | (Omit<Extract<ModelProfilePlan, { kind: 'default' }>, 'profile'> & {
      profile: DesensitizedProfile
    })

export type ModelProfilePlanError =
  | 'unknown_token'
  | 'expired_token'
  | 'invalid_profile'
  | 'profile_exists'
  | 'profile_not_found'
  | 'fallback_profile_not_writable'

export type ModelProfileExecuteResult =
  | {
      ok: true
      kind: 'add'
      name: string
      profile: DesensitizedProfile
      rawProfile: ProfileSchema
      scope: ModelProfilePlanScope
      activeProfileSet: boolean
    }
  | {
      ok: true
      kind: 'remove'
      name: string
      removedProfile: DesensitizedProfile
      scope: ModelProfilePlanScope
      deleted: boolean
      activeProfileCleared: boolean
      removedWasCurrentProfile: boolean
      nextCurrentProfile:
        | { name: string; profile: DesensitizedProfile; rawProfile: ProfileSchema }
        | null
    }
  | {
      ok: true
      kind: 'update'
      name: string
      before: DesensitizedProfile
      profile: DesensitizedProfile
      rawProfile: ProfileSchema
      scope: ModelProfilePlanScope
      updatedWasCurrentProfile: boolean
    }
  | {
      ok: true
      kind: 'default'
      name: string
      profile: DesensitizedProfile
      rawProfile: ProfileSchema
      scope: ModelProfilePlanScope
      activeProfileSet: boolean
    }
  | {
      ok: false
      error: ModelProfilePlanError
      reason: string
    }

const planStore = new Map<string, ModelProfilePlan>()

function mintToken(): string {
  let token = randomBytes(4).toString('hex')
  while (planStore.has(token)) {
    token = randomBytes(4).toString('hex')
  }
  return token
}

function pruneExpired(now = Date.now()): void {
  for (const [token, plan] of planStore) {
    if (now - plan.createdAt > MODEL_PROFILE_PLAN_TOKEN_TTL_MS) {
      planStore.delete(token)
    }
  }
}

function preview(plan: ModelProfilePlan): ModelProfilePlanPreview {
  if (plan.kind === 'update') {
    return {
      ...plan,
      before: desensitizeProfile(plan.before),
      profile: desensitizeProfile(plan.profile),
    }
  }
  return {
    ...plan,
    profile: desensitizeProfile(plan.profile),
  }
}

type ModelProfilePlanInput =
  | Omit<Extract<ModelProfilePlan, { kind: 'add' }>, 'token' | 'createdAt'>
  | Omit<Extract<ModelProfilePlan, { kind: 'remove' }>, 'token' | 'createdAt'>
  | Omit<Extract<ModelProfilePlan, { kind: 'update' }>, 'token' | 'createdAt'>
  | Omit<Extract<ModelProfilePlan, { kind: 'default' }>, 'token' | 'createdAt'>

function storePlan(plan: ModelProfilePlanInput): ModelProfilePlanPreview {
  pruneExpired()
  const fullPlan = {
    ...plan,
    token: mintToken(),
    createdAt: Date.now(),
  } as ModelProfilePlan
  planStore.set(fullPlan.token, fullPlan)
  return preview(fullPlan)
}

export function createModelProfileAddPlan(input: {
  name: string
  provider: ProfileProvider
  baseURL: string
  model: string
  apiKey: string
  displayName?: string
  maxInputTokens?: number
  scope: ModelProfilePlanScope
  activate: boolean
}): { ok: true; plan: ModelProfilePlanPreview } | { ok: false; error: ModelProfilePlanError; reason: string } {
  const nameResult = validateProfileName(input.name)
  if (nameResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: nameResult.reason }
  }
  if (getProfileByName(nameResult.name)) {
    return {
      ok: false,
      error: 'profile_exists',
      reason: `profile "${nameResult.name}" already exists`,
    }
  }
  const profileResult = validateProfile({
    provider: input.provider,
    baseURL: input.baseURL,
    model: input.model,
    apiKey: input.apiKey,
    ...(input.maxInputTokens ? { maxInputTokens: input.maxInputTokens } : {}),
    ...(input.displayName ? { name: input.displayName } : {}),
  })
  if (profileResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: profileResult.reason }
  }

  return {
    ok: true,
    plan: storePlan({
      kind: 'add',
      name: nameResult.name,
      profile: profileResult.profile,
      scope: input.scope,
      activate: input.activate,
    }),
  }
}

export function createModelProfileRemovePlan(input: {
  name: string
  scope: ModelProfilePlanScope
}): { ok: true; plan: ModelProfilePlanPreview } | { ok: false; error: ModelProfilePlanError; reason: string } {
  const nameResult = validateProfileName(input.name)
  if (nameResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: nameResult.reason }
  }
  const profile = getProfileByName(nameResult.name)
  if (!profile) {
    return {
      ok: false,
      error: 'profile_not_found',
      reason: `profile "${nameResult.name}" not found in settings profiles`,
    }
  }
  const current = getCurrentProfile()
  return {
    ok: true,
    plan: storePlan({
      kind: 'remove',
      name: nameResult.name,
      profile,
      scope: input.scope,
      wasCurrentProfile: current?.name === nameResult.name,
    }),
  }
}

export function createModelProfileUpdatePlan(input: {
  name: string
  provider?: ProfileProvider
  baseURL?: string
  model?: string
  apiKey?: string
  displayName?: string
  maxInputTokens?: number | null
  scope: ModelProfilePlanScope
}): { ok: true; plan: ModelProfilePlanPreview } | { ok: false; error: ModelProfilePlanError; reason: string } {
  const nameResult = validateProfileName(input.name)
  if (nameResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: nameResult.reason }
  }
  const existing = getProfileByName(nameResult.name)
  if (!existing) {
    return {
      ok: false,
      error: 'profile_not_found',
      reason: `profile "${nameResult.name}" not found in settings profiles`,
    }
  }

  const nextCandidate: ProfileSchema = {
    provider: input.provider ?? existing.provider,
    baseURL: input.baseURL ?? existing.baseURL,
    model: input.model ?? existing.model,
    apiKey: input.apiKey ?? existing.apiKey,
    ...(existing.apiKeyRef ? { apiKeyRef: existing.apiKeyRef } : {}),
    ...(input.maxInputTokens === undefined
      ? existing.maxInputTokens
        ? { maxInputTokens: existing.maxInputTokens }
        : {}
      : input.maxInputTokens
        ? { maxInputTokens: input.maxInputTokens }
        : {}),
    ...(input.displayName !== undefined
      ? input.displayName
        ? { name: input.displayName }
        : {}
      : existing.name
        ? { name: existing.name }
        : {}),
  }
  const profileResult = validateProfile(nextCandidate)
  if (profileResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: profileResult.reason }
  }
  const current = getCurrentProfile()
  return {
    ok: true,
    plan: storePlan({
      kind: 'update',
      name: nameResult.name,
      before: existing,
      profile: profileResult.profile,
      scope: input.scope,
      wasCurrentProfile: current?.name === nameResult.name,
    }),
  }
}

export function createModelProfileDefaultPlan(input: {
  name: string
  scope: ModelProfilePlanScope
}): { ok: true; plan: ModelProfilePlanPreview } | { ok: false; error: ModelProfilePlanError; reason: string } {
  const nameResult = validateProfileName(input.name)
  if (nameResult.ok !== true) {
    return { ok: false, error: 'invalid_profile', reason: nameResult.reason }
  }
  const profile = getProfileByName(nameResult.name)
  if (!profile) {
    return {
      ok: false,
      error: 'profile_not_found',
      reason: `profile "${nameResult.name}" not found in settings profiles`,
    }
  }
  return {
    ok: true,
    plan: storePlan({
      kind: 'default',
      name: nameResult.name,
      profile,
      scope: input.scope,
    }),
  }
}

export function executeModelProfilePlan(token: string): ModelProfileExecuteResult {
  pruneExpired()
  const plan = planStore.get(token)
  if (!plan) {
    return {
      ok: false,
      error: 'unknown_token',
      reason: `unknown or expired model profile confirmation token "${token}"`,
    }
  }
  planStore.delete(token)
  if (Date.now() - plan.createdAt > MODEL_PROFILE_PLAN_TOKEN_TTL_MS) {
    return {
      ok: false,
      error: 'expired_token',
      reason: `model profile confirmation token "${token}" has expired`,
    }
  }

  if (plan.kind === 'add') {
    if (getProfileByName(plan.name)) {
      return {
        ok: false,
        error: 'profile_exists',
        reason: `profile "${plan.name}" already exists; re-run /model add to review a fresh plan`,
      }
    }
    setProfile(plan.name, plan.profile, plan.scope)
    let activeProfileSet = false
    if (plan.activate) {
      setActiveProfile(plan.name, plan.scope)
      activeProfileSet = true
    }
    return {
      ok: true,
      kind: 'add',
      name: plan.name,
      profile: desensitizeProfile(plan.profile),
      rawProfile: plan.profile,
      scope: plan.scope,
      activeProfileSet,
    }
  }

  if (plan.kind === 'remove') {
    const current = getProfileByName(plan.name)
    if (!current) {
      return {
        ok: false,
        error: 'profile_not_found',
        reason: `profile "${plan.name}" no longer exists; nothing was removed`,
      }
    }
    const result = deleteProfile(plan.name, plan.scope)
    const nextCurrent = getCurrentProfile()
    return {
      ok: true,
      kind: 'remove',
      name: plan.name,
      removedProfile: desensitizeProfile(current),
      scope: plan.scope,
      deleted: result.deleted,
      activeProfileCleared: result.activeProfileCleared,
      removedWasCurrentProfile: plan.wasCurrentProfile,
      nextCurrentProfile: nextCurrent
        ? {
            name: nextCurrent.name,
            profile: desensitizeProfile(nextCurrent.profile),
            rawProfile: nextCurrent.profile,
          }
        : null,
    }
  }

  if (plan.kind === 'update') {
    const current = getProfileByName(plan.name)
    if (!current) {
      return {
        ok: false,
        error: 'profile_not_found',
        reason: `profile "${plan.name}" no longer exists; re-run /model update to review a fresh plan`,
      }
    }
    setProfile(plan.name, plan.profile, plan.scope)
    return {
      ok: true,
      kind: 'update',
      name: plan.name,
      before: desensitizeProfile(current),
      profile: desensitizeProfile(plan.profile),
      rawProfile: plan.profile,
      scope: plan.scope,
      updatedWasCurrentProfile: plan.wasCurrentProfile,
    }
  }

  setActiveProfile(plan.name, plan.scope)
  return {
    ok: true,
    kind: 'default',
    name: plan.name,
    profile: desensitizeProfile(plan.profile),
    rawProfile: plan.profile,
    scope: plan.scope,
    activeProfileSet: true,
  }
}

export function _resetModelProfilePlanStoreForTesting(): void {
  planStore.clear()
}
