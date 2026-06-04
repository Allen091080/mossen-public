import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  executeMcpRemoteInstallPlan,
  getMcpRemoteInstallPlan,
  MCP_REMOTE_PLAN_TOKEN_TTL_MS,
  type McpRemoteInstallPlan,
  type McpRemotePlanError,
} from '../../services/mcp/remoteInstallPlan.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import type { ParsedMcpInstallArgs } from './parseInstallArgs.js'

type Props = ParsedMcpInstallArgs & {
  onComplete: (result?: string) => void
}

function formatConfig(plan: McpRemoteInstallPlan): string {
  if (plan.config.type === 'stdio' || !('type' in plan.config)) {
    return `${'command' in plan.config ? plan.config.command : ''} ${'args' in plan.config ? (plan.config.args ?? []).join(' ') : ''}`.trim()
  }
  if ('url' in plan.config) return `${plan.config.type}: ${plan.config.url}`
  return plan.config.type ?? 'stdio'
}

function formatError(error: McpRemotePlanError): string {
  switch (error.type) {
    case 'missing_source':
      return getLocalizedText({
        en:
          `${figures.cross} Missing remote MCP config URL.\n` +
          'Usage: /mcp install --dry-run <url> [--name server] [--scope local|user|project]',
        zh:
          `${figures.cross} 缺少远程 MCP config URL。\n` +
          '用法：/mcp install --dry-run <url> [--name server] [--scope local|user|project]',
      })
    case 'invalid_scope':
      return getLocalizedText({
        en: `${figures.cross} Invalid scope: ${error.scope ?? '(missing)'}. Use local, user, or project.`,
        zh: `${figures.cross} 无效作用域：${error.scope ?? '（缺失）'}。请使用 local、user 或 project。`,
      })
    case 'invalid_source':
      return getLocalizedText({
        en: `${figures.cross} Invalid remote MCP config: ${error.reason}`,
        zh: `${figures.cross} 远程 MCP config 无效：${error.reason}`,
      })
    case 'multiple_servers':
      return getLocalizedText({
        en:
          `${figures.cross} Remote config contains multiple servers. Re-run with --name.\n` +
          `Available: ${error.availableServers.join(', ')}`,
        zh:
          `${figures.cross} 远程 config 包含多个 server。请加 --name 重新运行。\n` +
          `可用：${error.availableServers.join(', ')}`,
      })
    case 'missing_server_name':
      return getLocalizedText({
        en: `${figures.cross} Remote config is a single server object; pass --name <server>.`,
        zh: `${figures.cross} 远程 config 是单个 server 对象；请传入 --name <server>。`,
      })
    case 'server_not_found':
      return getLocalizedText({
        en:
          `${figures.cross} Server "${error.serverName}" was not found in remote config.\n` +
          `Available: ${error.availableServers.join(', ')}`,
        zh:
          `${figures.cross} 远程 config 中未找到 server "${error.serverName}"。\n` +
          `可用：${error.availableServers.join(', ')}`,
      })
    case 'unknown_token':
      return getLocalizedText({
        en: `${figures.cross} Unknown or already-used confirm token: ${error.token}`,
        zh: `${figures.cross} 未知或已使用的确认 token：${error.token}`,
      })
    case 'expired_token':
      return getLocalizedText({
        en: `${figures.cross} Confirm token expired. Re-run /mcp install --dry-run.`,
        zh: `${figures.cross} 确认 token 已过期。请重新运行 /mcp install --dry-run。`,
      })
    case 'install_failed':
      return getLocalizedText({
        en: `${figures.cross} Failed to add MCP server: ${error.message}`,
        zh: `${figures.cross} 添加 MCP server 失败：${error.message}`,
      })
  }
}

function formatPlan(plan: McpRemoteInstallPlan): string {
  const ttlMin = Math.floor(MCP_REMOTE_PLAN_TOKEN_TTL_MS / 60_000)
  return [
    getLocalizedText({
      en: `${figures.info} MCP remote install dry-run`,
      zh: `${figures.info} MCP 远程安装 dry-run`,
    }),
    '',
    getLocalizedText({ en: `Source: ${plan.source}`, zh: `来源：${plan.source}` }),
    getLocalizedText({
      en: `Server name: ${plan.serverName}`,
      zh: `服务器名：${plan.serverName}`,
    }),
    getLocalizedText({ en: `Scope: ${plan.scope}`, zh: `作用域：${plan.scope}` }),
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
      en: `To install within ${ttlMin} min: /mcp install --confirm ${plan.token}`,
      zh: `${ttlMin} 分钟内安装：/mcp install --confirm ${plan.token}`,
    }),
  ].join('\n')
}

function formatInstalled(plan: McpRemoteInstallPlan): string {
  return getLocalizedText({
    en:
      `${figures.tick} Added remote MCP server ${plan.serverName} in ${plan.scope} config.\n` +
      'Server was written to config only; reconnect or restart MCP if needed.',
    zh:
      `${figures.tick} 已将远程 MCP server ${plan.serverName} 写入 ${plan.scope} 配置。\n` +
      '本操作只写配置；如需生效，请按需 reconnect 或重启 MCP。',
  })
}

export function McpInstall({
  onComplete,
  source,
  serverName,
  scope,
  confirmToken,
  unsupportedFlag,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (unsupportedFlag) {
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Unsupported flag for /mcp install: ${unsupportedFlag}`,
            zh: `${figures.cross} /mcp install 不支持参数：${unsupportedFlag}`,
          }),
        )
        return
      }

      const result = confirmToken
        ? await executeMcpRemoteInstallPlan(confirmToken)
        : await getMcpRemoteInstallPlan({ source, serverName, scope })
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
  }, [confirmToken, onComplete, scope, serverName, source, unsupportedFlag])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Installing remote MCP server…',
              zh: '正在安装远程 MCP server…',
            })
          : getLocalizedText({
              en: 'Preparing remote MCP install dry-run…',
              zh: '正在准备远程 MCP 安装 dry-run…',
            })}
      </Text>
    </Box>
  )
}
