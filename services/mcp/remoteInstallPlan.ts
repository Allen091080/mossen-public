import { randomBytes } from 'crypto'
import { addMcpConfig } from './config.js'
import {
  McpJsonConfigSchema,
  McpServerConfigSchema,
  type ConfigScope,
  type McpServerConfig,
} from './types.js'

export const MCP_REMOTE_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type McpRemoteWritableScope = Extract<
  ConfigScope,
  'local' | 'user' | 'project'
>

export type McpRemoteInstallPlan = {
  token: string
  createdAt: number
  source: string
  serverName: string
  scope: McpRemoteWritableScope
  config: McpServerConfig
  availableServers: string[]
}

export type McpRemotePlanError =
  | {
      type: 'missing_source'
    }
  | {
      type: 'invalid_scope'
      scope?: string
    }
  | {
      type: 'invalid_source'
      reason: string
    }
  | {
      type: 'multiple_servers'
      availableServers: string[]
    }
  | {
      type: 'missing_server_name'
    }
  | {
      type: 'server_not_found'
      serverName: string
      availableServers: string[]
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
      type: 'install_failed'
      message: string
    }

export type McpRemoteInstallResult =
  | {
      ok: true
      plan: McpRemoteInstallPlan
    }
  | {
      ok: false
      error: McpRemotePlanError
    }

const planStore = new Map<string, McpRemoteInstallPlan>()

type SelectedServerConfig =
  | {
      ok: true
      serverName: string
      config: McpServerConfig
      availableServers: string[]
    }
  | {
      ok: false
      error: McpRemotePlanError
    }

function pruneExpiredPlans(now = Date.now()): void {
  for (const [token, plan] of planStore.entries()) {
    if (now - plan.createdAt > MCP_REMOTE_PLAN_TOKEN_TTL_MS) {
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

function normalizeScope(scope?: string): McpRemoteWritableScope | null {
  if (!scope || scope === 'local') return 'local'
  if (scope === 'user' || scope === 'project') return scope
  return null
}

export async function getMcpRemoteInstallPlan(opts: {
  source?: string
  serverName?: string
  scope?: string
}): Promise<McpRemoteInstallResult> {
  pruneExpiredPlans()
  const source = opts.source?.trim()
  if (!source) {
    return { ok: false, error: { type: 'missing_source' } }
  }

  const scope = normalizeScope(opts.scope)
  if (!scope) {
    return { ok: false, error: { type: 'invalid_scope', scope: opts.scope } }
  }

  const loaded = await loadRemoteJson(source)
  if (loaded.ok === false) {
    return { ok: false, error: { type: 'invalid_source', reason: loaded.reason } }
  }

  const selected = selectServerConfig(loaded.json, opts.serverName)
  if (selected.ok === false) return { ok: false, error: selected.error }

  const token = createToken()
  const plan: McpRemoteInstallPlan = {
    token,
    createdAt: Date.now(),
    source,
    serverName: selected.serverName,
    scope,
    config: selected.config,
    availableServers: selected.availableServers,
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

export async function executeMcpRemoteInstallPlan(
  token: string,
): Promise<McpRemoteInstallResult> {
  pruneExpiredPlans()
  const plan = planStore.get(token)
  if (!plan) {
    return { ok: false, error: { type: 'unknown_token', token } }
  }

  planStore.delete(token)
  if (Date.now() - plan.createdAt > MCP_REMOTE_PLAN_TOKEN_TTL_MS) {
    return { ok: false, error: { type: 'expired_token', token } }
  }

  try {
    await addMcpConfig(plan.serverName, plan.config, plan.scope)
    return { ok: true, plan }
  } catch (error) {
    return {
      ok: false,
      error: {
        type: 'install_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function selectServerConfig(
  json: unknown,
  requestedName?: string,
): SelectedServerConfig {
  const mcpJson = McpJsonConfigSchema().safeParse(json)
  if (mcpJson.success) {
    const availableServers = Object.keys(mcpJson.data.mcpServers)
    const serverName =
      requestedName ?? (availableServers.length === 1 ? availableServers[0] : undefined)
    if (!serverName) {
      return {
        ok: false,
        error: { type: 'multiple_servers', availableServers },
      }
    }
    const config = mcpJson.data.mcpServers[serverName]
    if (!config) {
      return {
        ok: false,
        error: {
          type: 'server_not_found',
          serverName,
          availableServers,
        },
      }
    }
    return {
      ok: true,
      serverName,
      config,
      availableServers,
    }
  }

  if (!requestedName) {
    return { ok: false, error: { type: 'missing_server_name' } }
  }
  const serverConfig = McpServerConfigSchema().safeParse(json)
  if (!serverConfig.success) {
    return {
      ok: false,
      error: {
        type: 'invalid_source',
        reason: serverConfig.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
      },
    }
  }
  return {
    ok: true,
    serverName: requestedName,
    config: serverConfig.data,
    availableServers: [requestedName],
  }
}

async function loadRemoteJson(
  source: string,
): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  let url: URL
  try {
    url = new URL(toFetchableUrl(source))
  } catch {
    return {
      ok: false,
      reason: 'Expected an http(s) URL or a GitHub blob URL to a JSON MCP config.',
    }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'Only http(s) remote MCP config URLs are supported.',
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'mossen-mcp-installer',
    },
  })
  if (!response.ok) {
    return {
      ok: false,
      reason: `Remote config request failed (${response.status})`,
    }
  }
  try {
    return { ok: true, json: JSON.parse(await response.text()) }
  } catch (error) {
    return {
      ok: false,
      reason: `Remote config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function toFetchableUrl(source: string): string {
  const url = new URL(source)
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return source
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length >= 5 && parts[2] === 'blob') {
    const [owner, repo, , ref, ...pathParts] = parts
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${pathParts.join('/')}`
  }
  return source
}

export function _resetMcpRemotePlanStoreForTesting(): void {
  planStore.clear()
}
