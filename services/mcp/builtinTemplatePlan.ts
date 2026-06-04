import { randomBytes } from 'crypto'
import { isAbsolute } from 'path'
import { addMcpConfig } from './config.js'
import {
  getBuiltinMcpTemplate,
  getBuiltinMcpTemplates,
  instantiateBuiltinMcpTemplate,
  type BuiltinMcpTemplateParameter,
} from './builtinTemplates.js'
import type { ConfigScope, McpServerConfig } from './types.js'

export const MCP_TEMPLATE_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type McpTemplateWritableScope = Extract<
  ConfigScope,
  'local' | 'user' | 'project'
>

export type McpTemplatePlanError =
  | {
      type: 'unknown_template'
      templateName?: string
      availableTemplates: string[]
    }
  | {
      type: 'missing_parameter'
      templateName: string
      missing: BuiltinMcpTemplateParameter[]
    }
  | {
      type: 'path_not_absolute'
      parameter: BuiltinMcpTemplateParameter
      value: string
    }
  | {
      type: 'invalid_scope'
      scope?: string
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

export type McpTemplateInstallPlan = {
  token: string
  createdAt: number
  templateName: string
  title: string
  serverName: string
  scope: McpTemplateWritableScope
  config: McpServerConfig
  readOnly: boolean
  risk: string
  notes: string[]
}

export type McpTemplateInstallResult =
  | {
      ok: true
      plan: McpTemplateInstallPlan
    }
  | {
      ok: false
      error: McpTemplatePlanError
    }

const planStore = new Map<string, McpTemplateInstallPlan>()

function pruneExpiredPlans(now = Date.now()): void {
  for (const [token, plan] of planStore.entries()) {
    if (now - plan.createdAt > MCP_TEMPLATE_PLAN_TOKEN_TTL_MS) {
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

function normalizeScope(scope?: string): McpTemplateWritableScope | null {
  if (!scope || scope === 'local') return 'local'
  if (scope === 'user' || scope === 'project') return scope
  return null
}

function assertAbsolute(
  parameter: BuiltinMcpTemplateParameter,
  value: string | undefined,
): McpTemplatePlanError | null {
  if (!value) return null
  if (isAbsolute(value)) return null
  return {
    type: 'path_not_absolute',
    parameter,
    value,
  }
}

export function getMcpTemplateInstallPlan(opts: {
  templateName?: string
  serverName?: string
  scope?: string
  root?: string
  db?: string
}): McpTemplateInstallResult {
  pruneExpiredPlans()

  const template = opts.templateName
    ? getBuiltinMcpTemplate(opts.templateName)
    : undefined
  if (!template) {
    return {
      ok: false,
      error: {
        type: 'unknown_template',
        templateName: opts.templateName,
        availableTemplates: getBuiltinMcpTemplates().map(item => item.name),
      },
    }
  }

  const scope = normalizeScope(opts.scope)
  if (!scope) {
    return {
      ok: false,
      error: {
        type: 'invalid_scope',
        scope: opts.scope,
      },
    }
  }

  const rootError = assertAbsolute('root', opts.root)
  if (rootError) return { ok: false, error: rootError }
  const dbError = assertAbsolute('db', opts.db)
  if (dbError) return { ok: false, error: dbError }

  const instantiated = instantiateBuiltinMcpTemplate(template, {
    root: opts.root,
    db: opts.db,
  })
  if (!instantiated.config) {
    return {
      ok: false,
      error: {
        type: 'missing_parameter',
        templateName: template.name,
        missing: instantiated.missing,
      },
    }
  }

  const token = createToken()
  const plan: McpTemplateInstallPlan = {
    token,
    createdAt: Date.now(),
    templateName: template.name,
    title: template.title,
    serverName: opts.serverName || template.name,
    scope,
    config: instantiated.config,
    readOnly: template.readOnly,
    risk: template.risk,
    notes: template.notes,
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

export async function executeMcpTemplateInstallPlan(
  token: string,
): Promise<McpTemplateInstallResult> {
  pruneExpiredPlans()
  const plan = planStore.get(token)
  if (!plan) {
    return {
      ok: false,
      error: {
        type: 'unknown_token',
        token,
      },
    }
  }

  planStore.delete(token)
  if (Date.now() - plan.createdAt > MCP_TEMPLATE_PLAN_TOKEN_TTL_MS) {
    return {
      ok: false,
      error: {
        type: 'expired_token',
        token,
      },
    }
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

export function _resetMcpTemplatePlanStoreForTesting(): void {
  planStore.clear()
}
