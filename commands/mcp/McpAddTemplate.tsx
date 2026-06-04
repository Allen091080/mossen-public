import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  executeMcpTemplateInstallPlan,
  getMcpTemplateInstallPlan,
  MCP_TEMPLATE_PLAN_TOKEN_TTL_MS,
  type McpTemplateInstallPlan,
  type McpTemplatePlanError,
} from '../../services/mcp/builtinTemplatePlan.js'
import { getLocalizedBuiltinMcpTemplateText } from '../../services/mcp/builtinTemplates.js'
import {
  getInteractiveLanguageTag,
  getLocalizedText,
} from '../../utils/uiLanguage.js'
import type { ParsedMcpAddTemplateArgs } from './parseTemplateArgs.js'

type Props = ParsedMcpAddTemplateArgs & {
  onComplete: (result?: string) => void
}

function formatConfig(plan: McpTemplateInstallPlan): string {
  if (plan.config.type === 'stdio') {
    return `${plan.config.command} ${(plan.config.args ?? []).join(' ')}`.trim()
  }
  return plan.config.type ?? 'stdio'
}

function formatPlan(plan: McpTemplateInstallPlan): string {
  const ttlMin = Math.floor(MCP_TEMPLATE_PLAN_TOKEN_TTL_MS / 60_000)
  const localized = getLocalizedBuiltinMcpTemplateText(plan.templateName)
  const isChinese = getInteractiveLanguageTag() === 'zh'
  const title = getLocalizedText({
    en: plan.title,
    zh: localized.title ?? plan.title,
  })
  const notes = isChinese ? localized.notes ?? plan.notes : plan.notes
  const lines: string[] = []
  lines.push(
    getLocalizedText({
      en: `${figures.info} MCP add-template dry-run`,
      zh: `${figures.info} MCP add-template dry-run`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `Template: ${plan.templateName} (${title})`,
      zh: `模板: ${plan.templateName} (${title})`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Server name: ${plan.serverName}`,
      zh: `服务器名: ${plan.serverName}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Scope: ${plan.scope}`,
      zh: `作用域: ${plan.scope}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Readonly: ${plan.readOnly ? 'yes' : 'no'}  Risk: ${plan.risk}`,
      zh: `只读: ${plan.readOnly ? '是' : '否'}  风险: ${plan.risk}`,
    }),
  )
  lines.push(`Command: ${formatConfig(plan)}`)
  lines.push('')
  lines.push(
    getLocalizedText({
      en:
        'No files were modified. Confirming will write this MCP server through the existing addMcpConfig() path; it will not auto-connect the server.',
      zh:
        '未修改任何文件。确认后会通过现有 addMcpConfig() 路径写入该 MCP server；不会自动连接服务器。',
    }),
  )
  lines.push('')
  for (const note of notes) {
    lines.push(`- ${note}`)
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `To install within ${ttlMin} min: /mcp add-template --confirm ${plan.token}`,
      zh: `${ttlMin} 分钟内安装: /mcp add-template --confirm ${plan.token}`,
    }),
  )
  return lines.join('\n')
}

function formatInstalled(plan: McpTemplateInstallPlan): string {
  return getLocalizedText({
    en:
      `${figures.tick} Added MCP template ${plan.templateName} as ${plan.serverName} in ${plan.scope} config.\n` +
      'Server was written to config only; reconnect or restart MCP if needed.',
    zh:
      `${figures.tick} 已将 MCP 模板 ${plan.templateName} 作为 ${plan.serverName} 写入 ${plan.scope} 配置。\n` +
      '本操作只写配置；如需生效，请按需 reconnect 或重启 MCP。',
  })
}

function formatError(error: McpTemplatePlanError): string {
  switch (error.type) {
    case 'unknown_template':
      return getLocalizedText({
        en:
          `${figures.cross} Unknown MCP template: ${error.templateName ?? '(missing)'}\n` +
          `Available templates: ${error.availableTemplates.join(', ')}`,
        zh:
          `${figures.cross} 未知 MCP 模板: ${error.templateName ?? '（缺失）'}\n` +
          `可用模板: ${error.availableTemplates.join(', ')}`,
      })
    case 'missing_parameter':
      return getLocalizedText({
        en:
          `${figures.cross} Template ${error.templateName} requires: ${error.missing.map(item => `--${item}`).join(', ')}`,
        zh:
          `${figures.cross} 模板 ${error.templateName} 需要参数: ${error.missing.map(item => `--${item}`).join(', ')}`,
      })
    case 'path_not_absolute':
      return getLocalizedText({
        en: `${figures.cross} --${error.parameter} must be an absolute path: ${error.value}`,
        zh: `${figures.cross} --${error.parameter} 必须是绝对路径: ${error.value}`,
      })
    case 'invalid_scope':
      return getLocalizedText({
        en: `${figures.cross} Invalid scope: ${error.scope ?? '(missing)'}. Use local, user, or project.`,
        zh: `${figures.cross} 无效作用域: ${error.scope ?? '（缺失）'}。请使用 local、user 或 project。`,
      })
    case 'unknown_token':
      return getLocalizedText({
        en: `${figures.cross} Unknown or already-used confirm token: ${error.token}`,
        zh: `${figures.cross} 未知或已使用的确认 token: ${error.token}`,
      })
    case 'expired_token':
      return getLocalizedText({
        en: `${figures.cross} Confirm token expired. Re-run /mcp add-template.`,
        zh: `${figures.cross} 确认 token 已过期。请重新运行 /mcp add-template。`,
      })
    case 'install_failed':
      return getLocalizedText({
        en: `${figures.cross} Failed to add MCP template: ${error.message}`,
        zh: `${figures.cross} 添加 MCP 模板失败: ${error.message}`,
      })
  }
}

export function McpAddTemplate({
  onComplete,
  templateName,
  serverName,
  scope,
  root,
  db,
  confirmToken,
  unsupportedFlag,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (unsupportedFlag) {
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Unsupported flag for /mcp add-template: ${unsupportedFlag}`,
            zh: `${figures.cross} /mcp add-template 不支持参数: ${unsupportedFlag}`,
          }),
        )
        return
      }

      const result = confirmToken
        ? await executeMcpTemplateInstallPlan(confirmToken)
        : getMcpTemplateInstallPlan({
            templateName,
            serverName,
            scope,
            root,
            db,
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
    run()
    return () => {
      cancelled = true
    }
  }, [
    onComplete,
    templateName,
    serverName,
    scope,
    root,
    db,
    confirmToken,
    unsupportedFlag,
  ])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Installing MCP template…',
              zh: '正在安装 MCP 模板…',
            })
          : getLocalizedText({
              en: 'Preparing MCP template dry-run…',
              zh: '正在准备 MCP 模板 dry-run…',
            })}
      </Text>
    </Box>
  )
}
