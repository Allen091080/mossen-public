import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  describePluginSources,
  type PluginSourceStatus,
} from '../../utils/plugins/sourceStatus.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
}

function yesNo(value: boolean): string {
  return getLocalizedText({
    en: value ? 'yes' : 'no',
    zh: value ? '是' : '否',
  })
}

function formatSources(status: PluginSourceStatus): string {
  const lines: string[] = []
  lines.push(
    getLocalizedText({
      en: `${figures.info} Plugin sources (read-only)`,
      zh: `${figures.info} 插件来源（只读）`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `Plugin root:       ${status.pluginRoot}`,
      zh: `插件根目录:        ${status.pluginRoot}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Marketplace cache: ${status.marketplaceCacheDir}`,
      zh: `Marketplace cache: ${status.marketplaceCacheDir}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Seed dirs:         ${status.seedDirs.length ? status.seedDirs.join(', ') : '(none)'}`,
      zh: `Seed 目录:         ${status.seedDirs.length ? status.seedDirs.join(', ') : '（无）'}`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en: 'Official marketplace:',
      zh: '官方插件市场:',
    }),
  )
  lines.push(`  ${status.officialMarketplace.name}`)
  lines.push(`  source:   ${status.officialMarketplace.sourceDisplay}`)
  lines.push(
    getLocalizedText({
      en: `  declared: ${yesNo(status.officialMarketplace.declared)}  known: ${yesNo(status.officialMarketplace.known)}`,
      zh: `  已声明:   ${yesNo(status.officialMarketplace.declared)}  已缓存: ${yesNo(status.officialMarketplace.known)}`,
    }),
  )
  lines.push('')

  if (status.entries.length === 0) {
    lines.push(
      getLocalizedText({
        en: 'No plugin sources are currently known.',
        zh: '当前没有已知插件来源。',
      }),
    )
  } else {
    lines.push(
      getLocalizedText({
        en: 'Known / declared sources:',
        zh: '已知 / 已声明来源:',
      }),
    )
    for (const entry of status.entries) {
      lines.push(`${figures.pointer} ${entry.name}${entry.isOfficial ? ' (official)' : ''}`)
      lines.push(`  source:        ${entry.sourceDisplay}`)
      lines.push(
        getLocalizedText({
          en: `  declared:      ${yesNo(entry.declared)}  known: ${yesNo(entry.known)}`,
          zh: `  已声明:        ${yesNo(entry.declared)}  已缓存: ${yesNo(entry.known)}`,
        }),
      )
      lines.push(
        getLocalizedText({
          en: `  auto-update:   ${entry.autoUpdate === undefined ? '(default)' : yesNo(entry.autoUpdate)}`,
          zh: `  自动更新:      ${entry.autoUpdate === undefined ? '（默认）' : yesNo(entry.autoUpdate)}`,
        }),
      )
      if (entry.sourceIsFallback) {
        lines.push(
          getLocalizedText({
            en: '  fallback:      yes — declared implicitly by enabled official plugin',
            zh: '  fallback:      是 —— 由已启用官方插件隐式声明',
          }),
        )
      }
      if (entry.installLocation) {
        lines.push(`  cache:         ${entry.installLocation}`)
      }
    }
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      en: 'Suggested commands:',
      zh: '建议命令:',
    }),
  )
  for (const command of status.suggestedCommands) {
    lines.push(`  ${command}`)
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      en: 'This command does not install, update, remove, clone, or fetch plugins.',
      zh: '本命令不会安装、更新、移除、clone 或 fetch 插件。',
    }),
  )

  return lines.join('\n')
}

export function PluginSources({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const status = await describePluginSources()
        if (cancelled) return
        onComplete(formatSources(status))
      } catch (error) {
        if (cancelled) return
        logError(error)
        onComplete(
          getLocalizedText({
            en: `${figures.cross} /plugin sources failed: ${errorMessage(error)}`,
            zh: `${figures.cross} /plugin sources 失败: ${errorMessage(error)}`,
          }),
        )
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading plugin sources…',
          zh: '正在读取插件来源…',
        })}
      </Text>
    </Box>
  )
}
