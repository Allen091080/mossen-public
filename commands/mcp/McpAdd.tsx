import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  executeMcpSlashAddPlan,
  getMcpSlashAddPlan,
  MCP_SLASH_ADD_PLAN_TOKEN_TTL_MS,
  type McpSlashAddPlan,
  type McpSlashAddPlanError,
} from '../../services/mcp/slashAddPlan.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import type { ParsedMcpAddArgs } from './parseAddArgs.js'

type Props = ParsedMcpAddArgs & {
  onComplete: (result?: string) => void
}

function formatConfig(plan: McpSlashAddPlan): string {
  if (plan.config.type === 'stdio') {
    return `${plan.config.command} ${(plan.config.args ?? []).join(' ')}`.trim()
  }
  if ('url' in plan.config) return `${plan.config.type}: ${plan.config.url}`
  return plan.transport
}

function formatError(error: McpSlashAddPlanError): string {
  switch (error.type) {
    case 'missing_server_name':
      return getLocalizedText({
        en:
          `${figures.cross} Missing MCP server name.\n` +
          'Usage: /mcp add <name> [--scope local|user|project] -- <command> [args...]',
        zh:
          `${figures.cross} 缺少 MCP server 名称。\n` +
          '用法：/mcp add <name> [--scope local|user|project] -- <command> [args...]',
      })
    case 'missing_command':
      return getLocalizedText({
        en:
          `${figures.cross} Missing MCP command or URL.\n` +
          'Example: /mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
        zh:
          `${figures.cross} 缺少 MCP 命令或 URL。\n` +
          '示例：/mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
      })
    case 'invalid_scope':
      return getLocalizedText({
        en: `${figures.cross} Invalid scope: ${error.scope ?? '(missing)'}. Use local, user, or project.`,
        zh: `${figures.cross} 无效作用域：${error.scope ?? '（缺失）'}。请使用 local、user 或 project。`,
      })
    case 'invalid_transport':
      return getLocalizedText({
        en: `${figures.cross} Invalid transport: ${error.transport ?? '(missing)'}. Use stdio, http, or sse.`,
        zh: `${figures.cross} 无效传输：${error.transport ?? '（缺失）'}。请使用 stdio、http 或 sse。`,
      })
    case 'invalid_env':
      return getLocalizedText({
        en: `${figures.cross} Invalid environment variable: ${error.message}`,
        zh: `${figures.cross} 环境变量无效：${error.message}`,
      })
    case 'invalid_header':
      return getLocalizedText({
        en: `${figures.cross} Invalid header: ${error.message}`,
        zh: `${figures.cross} 请求头无效：${error.message}`,
      })
    case 'invalid_config':
      return getLocalizedText({
        en: `${figures.cross} Invalid MCP config: ${error.reason}`,
        zh: `${figures.cross} MCP 配置无效：${error.reason}`,
      })
    case 'unknown_token':
      return getLocalizedText({
        en: `${figures.cross} Unknown or already-used confirm token: ${error.token}`,
        zh: `${figures.cross} 未知或已使用的确认 token：${error.token}`,
      })
    case 'expired_token':
      return getLocalizedText({
        en: `${figures.cross} Confirm token expired. Re-run /mcp add.`,
        zh: `${figures.cross} 确认 token 已过期。请重新运行 /mcp add。`,
      })
    case 'install_failed':
      return getLocalizedText({
        en: `${figures.cross} Failed to add MCP server: ${error.message}`,
        zh: `${figures.cross} 添加 MCP server 失败：${error.message}`,
      })
  }
}

function formatPlan(plan: McpSlashAddPlan): string {
  const ttlMin = Math.floor(MCP_SLASH_ADD_PLAN_TOKEN_TTL_MS / 60_000)
  return [
    getLocalizedText({
      en: `${figures.info} MCP add dry-run`,
      zh: `${figures.info} MCP add dry-run`,
    }),
    '',
    getLocalizedText({
      en: `Server name: ${plan.serverName}`,
      zh: `服务器名：${plan.serverName}`,
    }),
    getLocalizedText({ en: `Scope: ${plan.scope}`, zh: `作用域：${plan.scope}` }),
    getLocalizedText({
      en: `Transport: ${plan.transport}`,
      zh: `传输：${plan.transport}`,
    }),
    `Config: ${formatConfig(plan)}`,
    '',
    getLocalizedText({
      en:
        'No files were modified. Confirming will write this MCP server through the existing addMcpConfig() path; it will not auto-connect the server.',
      zh:
        '未修改任何文件。确认后会通过现有 addMcpConfig() 路径写入该 MCP server；不会自动连接服务器。',
    }),
    '',
    getLocalizedText({
      en: `To install within ${ttlMin} min: /mcp add --confirm ${plan.token}`,
      zh: `${ttlMin} 分钟内安装：/mcp add --confirm ${plan.token}`,
    }),
  ].join('\n')
}

function formatInstalled(plan: McpSlashAddPlan): string {
  const lines = [
    getLocalizedText({
      en: `${figures.tick} Added MCP server ${plan.serverName} in ${plan.scope} config.`,
      zh: `${figures.tick} 已将 MCP server ${plan.serverName} 写入 ${plan.scope} 配置。`,
    }),
    getLocalizedText({
      en: 'Server was written to config only; reconnect or restart MCP to load it.',
      zh: '本操作只写配置；如需加载，请 reconnect 或重启 MCP。',
    }),
    '',
    getLocalizedText({
      en: `Next: /mcp reconnect ${plan.serverName}`,
      zh: `下一步：/mcp reconnect ${plan.serverName}`,
    }),
    getLocalizedText({
      en: 'Then check: /mcp status',
      zh: '然后检查：/mcp status',
    }),
  ]

  if (plan.serverName.toLowerCase().includes('playwright')) {
    lines.push('')
    lines.push(
      getLocalizedText({
        en: 'After it is connected, try: open https://example.com with Playwright and tell me the page title.',
        zh: '连接成功后可测试：用 Playwright 打开 https://example.com，告诉我页面标题。',
      }),
    )
  }

  return lines.join('\n')
}

export function McpAdd({
  onComplete,
  serverName,
  scope,
  transport,
  commandOrUrl,
  args,
  env,
  headers,
  confirmToken,
  unsupportedFlag,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (unsupportedFlag) {
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Unsupported flag for /mcp add: ${unsupportedFlag}`,
            zh: `${figures.cross} /mcp add 不支持参数：${unsupportedFlag}`,
          }),
        )
        return
      }

      const result = confirmToken
        ? await executeMcpSlashAddPlan(confirmToken)
        : getMcpSlashAddPlan({
            serverName,
            scope,
            transport,
            commandOrUrl,
            args,
            env,
            headers,
          })
      if (cancelled) return
      if (result.ok === false) {
        onComplete(formatError(result.error))
      } else {
        onComplete(
          confirmToken ? formatInstalled(result.plan) : formatPlan(result.plan),
        )
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    args,
    commandOrUrl,
    confirmToken,
    env,
    headers,
    onComplete,
    scope,
    serverName,
    transport,
    unsupportedFlag,
  ])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Adding MCP server…',
              zh: '正在添加 MCP server…',
            })
          : getLocalizedText({
              en: 'Preparing MCP add dry-run…',
              zh: '正在准备 MCP add dry-run…',
            })}
      </Text>
    </Box>
  )
}
