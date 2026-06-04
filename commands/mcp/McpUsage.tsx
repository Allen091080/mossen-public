import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  filterMcpPromptsByServer,
  filterResourcesByServer,
  filterToolsByServer,
} from '../../services/mcp/utils.js'
import { useAppState } from '../../state/AppState.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type McpSnapshot = ReturnType<typeof useMcpSnapshot>

function useMcpSnapshot() {
  return useAppState(state => state.mcp)
}

function normalizeQuery(input?: string): string | null {
  const trimmed = input?.trim()
  return trimmed ? trimmed : null
}

function formatLimitedNames(items: readonly { name?: string }[], limit = 8): string {
  const names = items
    .map(item => item.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .sort()
  if (names.length === 0) return '(none)'
  const visible = names.slice(0, limit).join(', ')
  return names.length > limit ? `${visible}, … +${names.length - limit}` : visible
}

function genericExample(serverName: string, hasTools: boolean): string {
  if (serverName.toLowerCase().includes('playwright')) {
    return getLocalizedText({
      en: 'Ask: use Playwright to open https://example.com and tell me the page title.',
      zh: '可以问：用 Playwright 打开 https://example.com，告诉我页面标题。',
    })
  }
  if (hasTools) {
    return getLocalizedText({
      en: `Ask naturally: use the ${serverName} MCP tools to inspect or operate on the thing I describe.`,
      zh: `自然提问即可：使用 ${serverName} MCP 工具检查或操作我描述的内容。`,
    })
  }
  return getLocalizedText({
    en: `Ask for a prompt/resource from ${serverName}, or run /mcp status to see whether tools are exposed.`,
    zh: `可以请求 ${serverName} 的 prompt/resource，或运行 /mcp status 查看是否暴露工具。`,
  })
}

function formatServerUsage(mcp: McpSnapshot, serverName: string): string {
  const client = mcp.clients.find(c => c.name === serverName)
  if (!client) {
    const known = mcp.clients.map(c => c.name).sort().join(', ')
    return [
      getLocalizedText({
        en: `${figures.warning} MCP usage (read-only)`,
        zh: `${figures.warning} MCP 使用说明（只读）`,
      }),
      '',
      getLocalizedText({
        en: `Server "${serverName}" is not loaded in the current session.`,
        zh: `当前会话没有加载 server "${serverName}"。`,
      }),
      known
        ? getLocalizedText({ en: `Loaded servers: ${known}`, zh: `已加载 server: ${known}` })
        : getLocalizedText({ en: 'No MCP servers are loaded.', zh: '当前没有加载 MCP server。' }),
      '/mcp status',
      '/mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
    ].join('\n')
  }

  const tools = filterToolsByServer(mcp.tools, serverName)
  const prompts = filterMcpPromptsByServer(mcp.commands, serverName)
  const resources = filterResourcesByServer(
    mcp.resources[serverName] ?? [],
    serverName,
  )
  const exposedCount = tools.length + prompts.length + resources.length
  const lines = [
    getLocalizedText({
      en: `${figures.info} MCP usage for ${serverName} (read-only)`,
      zh: `${figures.info} ${serverName} MCP 使用说明（只读）`,
    }),
    '',
    getLocalizedText({
      en: `status: ${client.type}  scope: ${client.config.scope}  transport: ${client.config.type ?? 'stdio'}`,
      zh: `状态: ${client.type}  作用域: ${client.config.scope}  传输: ${client.config.type ?? 'stdio'}`,
    }),
    getLocalizedText({
      en: `exposes: ${tools.length} tools, ${prompts.length} prompts, ${resources.length} resources`,
      zh: `暴露能力: ${tools.length} 个工具，${prompts.length} 个 prompt，${resources.length} 个资源`,
    }),
    getLocalizedText({ en: `tools: ${formatLimitedNames(tools)}`, zh: `工具: ${formatLimitedNames(tools)}` }),
    getLocalizedText({ en: `prompts: ${formatLimitedNames(prompts)}`, zh: `Prompts: ${formatLimitedNames(prompts)}` }),
    getLocalizedText({ en: `resources: ${formatLimitedNames(resources)}`, zh: `资源: ${formatLimitedNames(resources)}` }),
    '',
    genericExample(serverName, tools.length > 0),
  ]

  if (client.type === 'pending') {
    lines.push(
      getLocalizedText({
        en: `hint: ${serverName} is still connecting. Wait briefly, then run /mcp status again.`,
        zh: `提示: ${serverName} 仍在连接中。稍等后再运行 /mcp status。`,
      }),
    )
  } else if (client.type === 'failed') {
    lines.push(
      getLocalizedText({
        en: `hint: inspect the error in /mcp status, fix the config, then run /mcp reconnect ${serverName}.`,
        zh: `提示: 先在 /mcp status 查看错误；修复配置后运行 /mcp reconnect ${serverName}。`,
      }),
    )
  } else if (client.type === 'connected' && exposedCount === 0) {
    lines.push(
      getLocalizedText({
        en: `hint: connected but exposing nothing. Try /mcp reconnect ${serverName} or restart Mossen.`,
        zh: `提示: 已连接但没有暴露能力。可尝试 /mcp reconnect ${serverName} 或重启 Mossen。`,
      }),
    )
  }

  lines.push('')
  lines.push(
    getLocalizedText({
      en: 'This command does not invoke tools, reconnect, enable, disable, authenticate, or modify MCP config.',
      zh: '本命令不会调用工具、reconnect、启用、禁用、认证或修改 MCP 配置。',
    }),
  )
  return lines.join('\n')
}

function formatUsage(mcp: McpSnapshot, query?: string): string {
  const target = normalizeQuery(query)
  if (target) return formatServerUsage(mcp, target)

  if (mcp.clients.length === 0) {
    return [
      getLocalizedText({
        en: `${figures.info} MCP usage (read-only)`,
        zh: `${figures.info} MCP 使用说明（只读）`,
      }),
      '',
      getLocalizedText({
        en: 'No MCP servers are loaded. Add one first, then run /mcp usage <server>.',
        zh: '当前没有加载 MCP server。先添加一个，再运行 /mcp usage <server>。',
      }),
      '/mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
      '/mcp status',
    ].join('\n')
  }

  return [
    getLocalizedText({
      en: `${figures.info} MCP usage (read-only)`,
      zh: `${figures.info} MCP 使用说明（只读）`,
    }),
    '',
    getLocalizedText({
      en: `Loaded servers: ${mcp.clients.map(c => c.name).sort().join(', ')}`,
      zh: `已加载 server: ${mcp.clients.map(c => c.name).sort().join(', ')}`,
    }),
    getLocalizedText({
      en: 'Run /mcp usage <server> for examples and exposed capability names.',
      zh: '运行 /mcp usage <server> 查看示例和已暴露能力名称。',
    }),
    '',
    ...mcp.clients
      .map(client => `  /mcp usage ${client.name}`)
      .sort(),
    '',
    getLocalizedText({
      en: 'Detailed health: /mcp status',
      zh: '详细健康状态：/mcp status',
    }),
  ].join('\n')
}

export function McpUsage({
  onComplete,
  serverName,
}: {
  onComplete: (result?: string) => void
  serverName?: string
}): React.ReactNode {
  const mcp = useMcpSnapshot()
  useEffect(() => {
    onComplete(formatUsage(mcp, serverName))
  }, [mcp, onComplete, serverName])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading MCP usage…',
          zh: '正在读取 MCP 使用说明…',
        })}
      </Text>
    </Box>
  )
}
