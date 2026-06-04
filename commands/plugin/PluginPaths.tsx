import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  describeExtensionPaths,
  type ExtensionPathsSummary,
} from '../../utils/plugins/extensionPaths.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
}

function kindLabel(kind: string): string {
  return getLocalizedText({
    en: kind,
    zh:
      kind === 'skills'
        ? 'skills'
        : kind === 'commands'
          ? 'commands'
          : kind === 'agents'
            ? 'agents'
            : kind === 'plugins-root'
              ? '插件根目录'
              : kind === 'plugin-cache'
                ? '插件缓存'
                : kind === 'marketplaces'
                  ? '插件市场'
                  : 'seed',
  })
}

function formatPaths(summary: ExtensionPathsSummary): string {
  const lines: string[] = []
  lines.push(
    getLocalizedText({
      en: `${figures.info} Extension paths (read-only)`,
      zh: `${figures.info} 扩展路径（只读）`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `Config home: ${summary.configHome}`,
      zh: `配置根目录: ${summary.configHome}`,
    }),
  )
  lines.push('')

  for (const group of summary.groups) {
    lines.push(`${figures.pointer} ${group.label}`)
    for (const item of group.paths) {
      lines.push(`  ${kindLabel(item.kind)}: ${item.path}`)
    }
    lines.push('')
  }

  lines.push(
    getLocalizedText({
      en: 'Notes:',
      zh: '说明:',
    }),
  )
  for (const note of summary.notes) {
    lines.push(`  - ${note}`)
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      en:
        'Use these paths for standard local skills, commands, agents, and plugin packages. This command does not install or create anything.',
      zh:
        '这些路径用于标准本地 skills、commands、agents 和 plugin packages。本命令不会安装或创建任何内容。',
    }),
  )
  return lines.join('\n')
}

export function PluginPaths({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    onComplete(formatPaths(describeExtensionPaths()))
  }, [onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading extension paths…',
          zh: '正在读取扩展路径…',
        })}
      </Text>
    </Box>
  )
}
