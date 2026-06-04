import type { McpServerConfig } from './types.js'

export type BuiltinMcpTemplateRisk = 'low' | 'medium'
export type BuiltinMcpTemplateParameter = 'root' | 'db'

export type BuiltinMcpTemplate = {
  name: string
  title: string
  description: string
  config: McpServerConfig
  parameters: BuiltinMcpTemplateParameter[]
  defaultEnabled: false
  readOnly: boolean
  requiresCredentials: boolean
  requiresNetwork: boolean
  risk: BuiltinMcpTemplateRisk
  notes: string[]
}

const BUILTIN_MCP_TEMPLATES: BuiltinMcpTemplate[] = [
  {
    name: 'filesystem-readonly',
    title: 'Filesystem readonly',
    description:
      'Template for a local filesystem MCP server scoped to explicit read-only roots.',
    config: {
      type: 'stdio',
      command: 'mcp-server-filesystem',
      args: ['--readonly', '<absolute-project-root>'],
    },
    parameters: ['root'],
    defaultEnabled: false,
    readOnly: true,
    requiresCredentials: false,
    requiresNetwork: false,
    risk: 'low',
    notes: [
      'User must replace <absolute-project-root> before enabling.',
      'Keep writable filesystem tools in a separate explicit server.',
    ],
  },
  {
    name: 'git-readonly',
    title: 'Git readonly',
    description:
      'Template for read-only repository inspection: status, branches, history, and metadata.',
    config: {
      type: 'stdio',
      command: 'mcp-server-git',
      args: ['--readonly', '<absolute-repo-root>'],
    },
    parameters: ['root'],
    defaultEnabled: false,
    readOnly: true,
    requiresCredentials: false,
    requiresNetwork: false,
    risk: 'low',
    notes: [
      'Do not expose commit, push, merge, or reset tools in this template.',
      'Use Mossen permission gates for any future mutation-capable git server.',
    ],
  },
  {
    name: 'local-docs',
    title: 'Local docs',
    description:
      'Template for searching local documentation folders without network or credential access.',
    config: {
      type: 'stdio',
      command: 'mcp-server-local-docs',
      args: ['--root', '<absolute-docs-root>'],
    },
    parameters: ['root'],
    defaultEnabled: false,
    readOnly: true,
    requiresCredentials: false,
    requiresNetwork: false,
    risk: 'low',
    notes: [
      'Good fit for project docs, API references, and internal runbooks.',
      'Do not point this at secret directories.',
    ],
  },
  {
    name: 'playwright-local',
    title: 'Playwright local browser',
    description:
      'Template for local browser automation against localhost or explicit test targets.',
    config: {
      type: 'stdio',
      command: 'mcp-server-playwright',
      args: ['--allow-localhost-only'],
    },
    parameters: [],
    defaultEnabled: false,
    readOnly: false,
    requiresCredentials: false,
    requiresNetwork: false,
    risk: 'medium',
    notes: [
      'Not read-only: browser actions can click, type, and mutate local apps.',
      'Keep remote browsing and authenticated sites out of the default template.',
    ],
  },
  {
    name: 'sqlite-readonly',
    title: 'SQLite readonly',
    description:
      'Template for inspecting a local SQLite database in read-only mode.',
    config: {
      type: 'stdio',
      command: 'mcp-server-sqlite',
      args: ['--readonly', '<absolute-db-path>'],
    },
    parameters: ['db'],
    defaultEnabled: false,
    readOnly: true,
    requiresCredentials: false,
    requiresNetwork: false,
    risk: 'low',
    notes: [
      'Use read-only database flags at both MCP server and SQLite connection level.',
      'Do not include production credential paths in templates.',
    ],
  },
]

export function getBuiltinMcpTemplates(): BuiltinMcpTemplate[] {
  return [...BUILTIN_MCP_TEMPLATES]
}

export function getBuiltinMcpTemplate(
  name: string,
): BuiltinMcpTemplate | undefined {
  return BUILTIN_MCP_TEMPLATES.find(template => template.name === name)
}

export function getLocalizedBuiltinMcpTemplateText(name: string): {
  title?: string
  description?: string
  notes?: string[]
} {
  switch (name) {
    case 'filesystem-readonly':
      return {
        title: '文件系统只读',
        description:
          '用于本地 filesystem MCP server 的模板，仅暴露明确指定的只读根目录。',
        notes: [
          '启用前必须把 <absolute-project-root> 替换成真实绝对路径。',
          '可写文件系统工具应放在另一个明确声明的 server 中。',
        ],
      }
    case 'git-readonly':
      return {
        title: 'Git 只读',
        description:
          '用于只读仓库检查：状态、分支、历史和元数据。',
        notes: [
          '该模板不暴露 commit、push、merge 或 reset 工具。',
          '未来如需可变更的 git server，必须走 Mossen 权限闸。',
        ],
      }
    case 'local-docs':
      return {
        title: '本地文档',
        description:
          '用于搜索本地文档目录，不需要网络或凭据访问。',
        notes: [
          '适合项目文档、API reference 和内部 runbook。',
          '不要把它指向 secret 目录。',
        ],
      }
    case 'playwright-local':
      return {
        title: '本地 Playwright 浏览器',
        description:
          '用于针对 localhost 或明确测试目标的本地浏览器自动化。',
        notes: [
          '这不是只读能力：浏览器动作可以点击、输入并改变本地应用。',
          '默认模板不应包含远程浏览或已登录站点。',
        ],
      }
    case 'sqlite-readonly':
      return {
        title: 'SQLite 只读',
        description:
          '用于以只读模式检查本地 SQLite 数据库。',
        notes: [
          'MCP server 与 SQLite connection 两层都应使用只读参数。',
          '不要在模板中包含生产凭据路径。',
        ],
      }
    default:
      return {}
  }
}

export function instantiateBuiltinMcpTemplate(
  template: BuiltinMcpTemplate,
  params: {
    root?: string
    db?: string
  },
): {
  config?: McpServerConfig
  missing: BuiltinMcpTemplateParameter[]
} {
  const missing = template.parameters.filter(param => !params[param])
  if (missing.length > 0) {
    return { missing }
  }

  switch (template.name) {
    case 'filesystem-readonly':
      return {
        missing: [],
        config: {
          type: 'stdio',
          command: 'mcp-server-filesystem',
          args: ['--readonly', params.root!],
        },
      }
    case 'git-readonly':
      return {
        missing: [],
        config: {
          type: 'stdio',
          command: 'mcp-server-git',
          args: ['--readonly', params.root!],
        },
      }
    case 'local-docs':
      return {
        missing: [],
        config: {
          type: 'stdio',
          command: 'mcp-server-local-docs',
          args: ['--root', params.root!],
        },
      }
    case 'playwright-local':
      return {
        missing: [],
        config: {
          type: 'stdio',
          command: 'mcp-server-playwright',
          args: ['--allow-localhost-only'],
        },
      }
    case 'sqlite-readonly':
      return {
        missing: [],
        config: {
          type: 'stdio',
          command: 'mcp-server-sqlite',
          args: ['--readonly', params.db!],
        },
      }
    default:
      return { missing: [] }
  }
}
