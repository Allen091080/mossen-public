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

function formatMcpDoctor(mcp: McpSnapshot): string {
  const lines: string[] = [
    getLocalizedText({
      en: `${figures.info} MCP doctor (read-only)`,
      zh: `${figures.info} MCP 诊断（只读）`,
    }),
    '',
    getLocalizedText({
      en: `servers: ${mcp.clients.length}; tools: ${mcp.tools.length}; prompts/skills: ${mcp.commands.length}; resources: ${Object.values(mcp.resources).flat().length}`,
      zh: `server: ${mcp.clients.length} 个；工具: ${mcp.tools.length} 个；prompts/skills: ${mcp.commands.length} 个；资源: ${Object.values(mcp.resources).flat().length} 个`,
    }),
  ]

  if (mcp.clients.length === 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} No MCP servers are loaded. Add one with /mcp add, then reconnect or restart Mossen.`,
        zh: `${figures.warning} 当前没有加载 MCP server。可用 /mcp add 添加，然后 reconnect 或重启 Mossen。`,
      }),
    )
    lines.push('/mcp add playwright --scope local -- npx -y @playwright/mcp@latest')
  }

  for (const client of [...mcp.clients].sort((a, b) => a.name.localeCompare(b.name))) {
    const tools = filterToolsByServer(mcp.tools, client.name)
    const prompts = filterMcpPromptsByServer(mcp.commands, client.name)
    const resources = filterResourcesByServer(mcp.resources[client.name] ?? [], client.name)
    const exposed = tools.length + prompts.length + resources.length
    lines.push('')
    lines.push(`${figures.pointer} ${client.name}`)
    lines.push(
      getLocalizedText({
        en: `  status: ${client.type}; exposes: ${tools.length} tools, ${prompts.length} prompts, ${resources.length} resources`,
        zh: `  状态: ${client.type}; 暴露: ${tools.length} 个工具，${prompts.length} 个 prompt，${resources.length} 个资源`,
      }),
    )
    if (client.type === 'failed') {
      lines.push(
        getLocalizedText({
          en: `  ${figures.cross} failed. Run /mcp status, fix the command/config, then /mcp reconnect ${client.name}.`,
          zh: `  ${figures.cross} 失败。先运行 /mcp status，修复命令/配置后执行 /mcp reconnect ${client.name}。`,
        }),
      )
      if (client.error) lines.push(`  error: ${client.error}`)
    } else if (client.type === 'pending') {
      lines.push(
        getLocalizedText({
          en: `  ${figures.info} still connecting. Wait briefly, then run /mcp status again.`,
          zh: `  ${figures.info} 仍在连接中。稍等后再运行 /mcp status。`,
        }),
      )
    } else if (client.type === 'needs-auth') {
      lines.push(
        getLocalizedText({
          en: `  ${figures.warning} needs auth before tools can be exposed.`,
          zh: `  ${figures.warning} 需要认证后才会暴露工具。`,
        }),
      )
    } else if (client.type === 'disabled') {
      lines.push(
        getLocalizedText({
          en: `  ${figures.warning} disabled. Enable with /mcp enable ${client.name} if needed.`,
          zh: `  ${figures.warning} 已禁用。如需使用，执行 /mcp enable ${client.name}。`,
        }),
      )
    } else if (client.type === 'connected' && exposed === 0) {
      lines.push(
        getLocalizedText({
          en: `  ${figures.warning} connected but exposing 0 capabilities. Try /mcp reconnect ${client.name} or restart Mossen.`,
          zh: `  ${figures.warning} 已连接但暴露 0 个能力。可尝试 /mcp reconnect ${client.name} 或重启 Mossen。`,
        }),
      )
    } else if (client.type === 'connected') {
      lines.push(
        getLocalizedText({
          en: `  ${figures.tick} ready. Usage: /mcp usage ${client.name}`,
          zh: `  ${figures.tick} 可用。使用说明：/mcp usage ${client.name}`,
        }),
      )
    }
  }

  lines.push('')
  lines.push('/mcp status')
  lines.push('/mcp usage <server>')
  lines.push('/extensions report')
  lines.push(
    getLocalizedText({
      en: 'This doctor is read-only. It does not reconnect, enable, disable, authenticate, invoke tools, or modify MCP config.',
      zh: '本 doctor 只读。它不会 reconnect、启用、禁用、认证、调用工具或修改 MCP 配置。',
    }),
  )
  return lines.join('\n')
}

export function McpDoctor({
  onComplete,
}: {
  onComplete: (result?: string) => void
}): React.ReactNode {
  const mcp = useMcpSnapshot()
  useEffect(() => {
    onComplete(formatMcpDoctor(mcp))
  }, [mcp, onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading MCP doctor…',
          zh: '正在读取 MCP 诊断…',
        })}
      </Text>
    </Box>
  )
}
