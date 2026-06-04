import { randomBytes } from 'crypto'
import { addMcpConfig } from './config.js'
import { parseHeaders } from './utils.js'
import { parseEnvVars } from '../../utils/envUtils.js'
import {
  McpServerConfigSchema,
  type ConfigScope,
  type McpServerConfig,
} from './types.js'

export const MCP_SLASH_ADD_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type McpSlashAddWritableScope = Extract<
  ConfigScope,
  'local' | 'user' | 'project'
>

export type McpSlashAddTransport = 'stdio' | 'sse' | 'http'

export type McpSlashAddPlan = {
  token: string
  createdAt: number
  serverName: string
  scope: McpSlashAddWritableScope
  transport: McpSlashAddTransport
  config: McpServerConfig
}

export type McpSlashAddPlanError =
  | {
      type: 'missing_server_name'
    }
  | {
      type: 'missing_command'
    }
  | {
      type: 'invalid_scope'
      scope?: string
    }
  | {
      type: 'invalid_transport'
      transport?: string
    }
  | {
      type: 'invalid_env'
      message: string
    }
  | {
      type: 'invalid_header'
      message: string
    }
  | {
      type: 'invalid_config'
      reason: string
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

export type McpSlashAddPlanResult =
  | {
      ok: true
      plan: McpSlashAddPlan
    }
  | {
      ok: false
      error: McpSlashAddPlanError
    }

const planStore = new Map<string, McpSlashAddPlan>()

function pruneExpiredPlans(now = Date.now()): void {
  for (const [token, plan] of planStore.entries()) {
    if (now - plan.createdAt > MCP_SLASH_ADD_PLAN_TOKEN_TTL_MS) {
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

function normalizeScope(scope?: string): McpSlashAddWritableScope | null {
  if (!scope || scope === 'local') return 'local'
  if (scope === 'user' || scope === 'project') return scope
  return null
}

function normalizeTransport(transport?: string): McpSlashAddTransport | null {
  if (!transport || transport === 'stdio') return 'stdio'
  if (transport === 'sse' || transport === 'http') return transport
  return null
}

function formatSchemaError(error: unknown): string {
  const issues =
    (error as {
      issues?: Array<{
        path: Array<string | number>
        message: string
      }>
    }).issues ?? []
  return issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join(', ')
}

export function getMcpSlashAddPlan(opts: {
  serverName?: string
  scope?: string
  transport?: string
  commandOrUrl?: string
  args?: string[]
  env?: string[]
  headers?: string[]
}): McpSlashAddPlanResult {
  pruneExpiredPlans()

  const serverName = opts.serverName?.trim()
  if (!serverName) {
    return { ok: false, error: { type: 'missing_server_name' } }
  }

  const scope = normalizeScope(opts.scope)
  if (!scope) {
    return { ok: false, error: { type: 'invalid_scope', scope: opts.scope } }
  }

  const transport = normalizeTransport(opts.transport)
  if (!transport) {
    return {
      ok: false,
      error: { type: 'invalid_transport', transport: opts.transport },
    }
  }

  const commandOrUrl = opts.commandOrUrl?.trim()
  if (!commandOrUrl) {
    return { ok: false, error: { type: 'missing_command' } }
  }

  let config: McpServerConfig
  if (transport === 'stdio') {
    let env: Record<string, string> | undefined
    try {
      env = parseEnvVars(opts.env)
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'invalid_env',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
    config = {
      type: 'stdio',
      command: commandOrUrl,
      args: opts.args ?? [],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
  } else {
    let headers: Record<string, string> | undefined
    if (opts.headers?.length) {
      try {
        headers = parseHeaders(opts.headers)
      } catch (error) {
        return {
          ok: false,
          error: {
            type: 'invalid_header',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }
    config = {
      type: transport,
      url: commandOrUrl,
      ...(headers ? { headers } : {}),
    }
  }

  const parsed = McpServerConfigSchema().safeParse(config)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        type: 'invalid_config',
        reason: formatSchemaError(parsed.error),
      },
    }
  }

  const token = createToken()
  const plan: McpSlashAddPlan = {
    token,
    createdAt: Date.now(),
    serverName,
    scope,
    transport,
    config: parsed.data,
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

export async function executeMcpSlashAddPlan(
  token: string,
): Promise<McpSlashAddPlanResult> {
  pruneExpiredPlans()
  const plan = planStore.get(token)
  if (!plan) {
    return { ok: false, error: { type: 'unknown_token', token } }
  }

  planStore.delete(token)
  if (Date.now() - plan.createdAt > MCP_SLASH_ADD_PLAN_TOKEN_TTL_MS) {
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

export function _resetMcpSlashAddPlanStoreForTesting(): void {
  planStore.clear()
}
