import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  getBuiltinMcpTemplates,
  getLocalizedBuiltinMcpTemplateText,
} from '../../services/mcp/builtinTemplates.js'
import {
  getInteractiveLanguageTag,
  getLocalizedText,
} from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
}

function formatTemplates(): string {
  const templates = getBuiltinMcpTemplates()
  const lines: string[] = []

  lines.push(
    getLocalizedText({
      en: `${figures.info} Built-in MCP templates (read-only inventory)`,
      zh: `${figures.info} 内置 MCP 模板（只读清单）`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en:
        'These templates are not enabled automatically. Copy a template into settings only after reviewing scope, credentials, and side effects.',
      zh:
        '这些模板不会自动启用。只有在确认范围、凭据和副作用之后，才应复制到配置中启用。',
    }),
  )
  lines.push('')

  for (const template of templates) {
    const localized = getLocalizedBuiltinMcpTemplateText(template.name)
    const isChinese = getInteractiveLanguageTag() === 'zh'
    const title = getLocalizedText({
      en: template.title,
      zh: localized.title ?? template.title,
    })
    const description = getLocalizedText({
      en: template.description,
      zh: localized.description ?? template.description,
    })
    const notes = isChinese ? localized.notes ?? template.notes : template.notes

    lines.push(`${figures.pointer} ${template.name}`)
    lines.push(
      getLocalizedText({
        en: `  title:       ${title}`,
        zh: `  标题:        ${title}`,
      }),
    )
    lines.push(
      getLocalizedText({
        en: `  risk:        ${template.risk}`,
        zh: `  风险:        ${template.risk}`,
      }),
    )
    lines.push(
      getLocalizedText({
        en: `  readonly:    ${template.readOnly ? 'yes' : 'no'}`,
        zh: `  只读:        ${template.readOnly ? '是' : '否'}`,
      }),
    )
    lines.push(
      getLocalizedText({
        en: `  credentials: ${template.requiresCredentials ? 'required' : 'not required'}`,
        zh: `  凭据:        ${template.requiresCredentials ? '需要' : '不需要'}`,
      }),
    )
    lines.push(
      getLocalizedText({
        en: `  network:     ${template.requiresNetwork ? 'required' : 'not required'}`,
        zh: `  网络:        ${template.requiresNetwork ? '需要' : '不需要'}`,
      }),
    )
    lines.push(`  command:     ${template.config.type === 'stdio' ? template.config.command : template.config.type}`)
    if (template.config.type === 'stdio') {
      lines.push(`  args:        ${template.config.args.join(' ')}`)
    }
    lines.push(`  ${description}`)
    for (const note of notes) {
      lines.push(`  - ${note}`)
    }
    lines.push('')
  }

  lines.push(
    getLocalizedText({
      en: 'Next step: install one with /mcp add-template <template> and confirm the dry-run token.',
      zh: '下一步：使用 /mcp add-template <template> 安装，并确认 dry-run token。',
    }),
  )

  return lines.join('\n')
}

export function McpTemplates({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    onComplete(formatTemplates())
  }, [onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Listing MCP templates…',
          zh: '正在列出 MCP 模板…',
        })}
      </Text>
    </Box>
  )
}
