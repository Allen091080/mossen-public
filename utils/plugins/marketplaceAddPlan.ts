import { randomBytes } from 'crypto'
import { clearAllCaches } from './cacheUtils.js'
import { getMarketplaceSourceDisplay } from './marketplaceHelpers.js'
import {
  addMarketplaceSource,
  saveMarketplaceToSettings,
} from './marketplaceManager.js'
import { parseMarketplaceInput } from './parseMarketplaceInput.js'
import type { MarketplaceSource } from './schemas.js'

export const PLUGIN_MARKETPLACE_ADD_TOKEN_TTL_MS = 10 * 60 * 1000

export type PluginMarketplaceAddPlan = {
  token: string
  createdAt: number
  input: string
  source: MarketplaceSource
  sourceDisplay: string
}

export type PluginMarketplaceAddPlanError =
  | {
      type: 'missing_source'
    }
  | {
      type: 'invalid_source'
      message: string
    }
  | {
      type: 'unknown_token'
      token: string
    }
  | {
      type: 'expired_token'
      token: string
    }
  | {
      type: 'add_failed'
      message: string
    }

export type PluginMarketplaceAddPlanResult =
  | {
      ok: true
      plan: PluginMarketplaceAddPlan
    }
  | {
      ok: false
      error: PluginMarketplaceAddPlanError
    }

export type PluginMarketplaceAddExecuteResult =
  | {
      ok: true
      plan: PluginMarketplaceAddPlan
      name: string
      alreadyMaterialized: boolean
      resolvedSource: MarketplaceSource
    }
  | {
      ok: false
      error: PluginMarketplaceAddPlanError
    }

const planStore = new Map<string, PluginMarketplaceAddPlan>()

function pruneExpiredPlans(now = Date.now()): void {
  for (const [token, plan] of planStore.entries()) {
    if (now - plan.createdAt > PLUGIN_MARKETPLACE_ADD_TOKEN_TTL_MS) {
      planStore.delete(token)
    }
  }
}

function createToken(): string {
  let token = randomBytes(4).toString('hex')
  while (planStore.has(token)) {
    token = randomBytes(4).toString('hex')
  }
  return token
}

export async function getPluginMarketplaceAddPlan(
  input?: string,
): Promise<PluginMarketplaceAddPlanResult> {
  pruneExpiredPlans()
  const trimmed = input?.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: { type: 'missing_source' },
    }
  }

  const parsed = await parseMarketplaceInput(trimmed)
  if (!parsed) {
    return {
      ok: false,
      error: {
        type: 'invalid_source',
        message:
          'Invalid marketplace source format. Try: owner/repo, https://..., or ./path',
      },
    }
  }
  if ('error' in parsed) {
    return {
      ok: false,
      error: {
        type: 'invalid_source',
        message: parsed.error,
      },
    }
  }

  const token = createToken()
  const plan: PluginMarketplaceAddPlan = {
    token,
    createdAt: Date.now(),
    input: trimmed,
    source: parsed,
    sourceDisplay: getMarketplaceSourceDisplay(parsed),
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

export async function executePluginMarketplaceAddPlan(
  token: string,
): Promise<PluginMarketplaceAddExecuteResult> {
  pruneExpiredPlans()
  const plan = planStore.get(token)
  if (!plan) {
    return {
      ok: false,
      error: { type: 'unknown_token', token },
    }
  }

  planStore.delete(token)
  if (Date.now() - plan.createdAt > PLUGIN_MARKETPLACE_ADD_TOKEN_TTL_MS) {
    return {
      ok: false,
      error: { type: 'expired_token', token },
    }
  }

  try {
    const { name, alreadyMaterialized, resolvedSource } =
      await addMarketplaceSource(plan.source)
    saveMarketplaceToSettings(name, { source: resolvedSource })
    clearAllCaches()
    return { ok: true, plan, name, alreadyMaterialized, resolvedSource }
  } catch (error) {
    return {
      ok: false,
      error: {
        type: 'add_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export function _resetPluginMarketplaceAddPlanStoreForTesting(): void {
  planStore.clear()
}
