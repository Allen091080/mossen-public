import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  describePluginStatus,
  type PluginStatusSummary,
} from '../../utils/plugins/statusOps.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
}

function formatPluginDoctor(s: PluginStatusSummary): string {
  const lines: string[] = [
    getLocalizedText({
      en: `${figures.info} Plugin doctor (read-only)`,
      zh: `${figures.info} 插件诊断（只读）`,
    }),
    '',
    getLocalizedText({
      en: `plugin root: ${s.pluginRootExists ? 'exists' : 'absent'} (${s.pluginRootPath})`,
      zh: `插件根目录: ${s.pluginRootExists ? '存在' : '不存在'} (${s.pluginRootPath})`,
    }),
    getLocalizedText({
      en: `installed registry: ${s.installedRegistryLoadable ? 'loadable' : 'load failed'} (${s.installedRecordCount} records, ${s.installedVersionCount} versions)`,
      zh: `installed 注册表: ${s.installedRegistryLoadable ? '可加载' : '加载失败'}（${s.installedRecordCount} 条，${s.installedVersionCount} 个版本）`,
    }),
    getLocalizedText({
      en: `cache versions: ${s.cache.cacheVersionCount}; expired orphans: ${s.cache.expiredOrphanCount}; unmarked orphans: ${s.cache.unmarkedOrphanCount}; fresh orphans: ${s.cache.freshOrphanCount}`,
      zh: `cache 版本: ${s.cache.cacheVersionCount}; 过期 orphan: ${s.cache.expiredOrphanCount}; 未标记 orphan: ${s.cache.unmarkedOrphanCount}; 新 orphan: ${s.cache.freshOrphanCount}`,
    }),
  ]

  if (!s.pluginRootExists) {
    lines.push(
      getLocalizedText({
        en: `${figures.info} No plugin root yet. Install with /plugin install --dry-run <plugin@marketplace|github-url>.`,
        zh: `${figures.info} 尚无插件根目录。可用 /plugin install --dry-run <plugin@marketplace|github-url> 安装。`,
      }),
    )
  }
  if (!s.installedRegistryLoadable) {
    lines.push(
      getLocalizedText({
        en: `${figures.cross} Installed registry is not loadable. Run /plugin status and inspect the registry path before installing more plugins.`,
        zh: `${figures.cross} installed 注册表无法加载。继续安装前先运行 /plugin status 并检查 registry 路径。`,
      }),
    )
  }
  if (s.pruneEligible) {
    lines.push(
      getLocalizedText({
        en: `${figures.info} Orphaned plugin cache entries exist. Review safely with /plugin prune.`,
        zh: `${figures.info} 存在 orphan plugin cache。可用 /plugin prune 安全预览。`,
      }),
    )
  }
  if (s.cache.zipCacheMode) {
    lines.push(
      getLocalizedText({
        en: `${figures.info} Zip-cache mode is active; /plugin prune does not operate on zip caches.`,
        zh: `${figures.info} 当前启用 zip-cache 模式；/plugin prune 不处理 zip cache。`,
      }),
    )
  }
  if (s.installedRecordCount === 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.info} No installed plugin records. Browse sources with /plugin sources or install with dry-run first.`,
        zh: `${figures.info} 当前没有已安装插件记录。可用 /plugin sources 查看来源，安装前先 dry-run。`,
      }),
    )
  }
  if (lines.length === 4) {
    lines.push(
      getLocalizedText({
        en: `${figures.tick} No obvious plugin issues. Details: /plugin status`,
        zh: `${figures.tick} 未发现明显插件问题。详情：/plugin status`,
      }),
    )
  }
  lines.push('')
  lines.push('/plugin status')
  lines.push('/plugin prune')
  lines.push('/plugin install --dry-run <plugin@marketplace|github-url>')
  lines.push('/extensions report')
  lines.push(
    getLocalizedText({
      en: 'This doctor is read-only. It does not install, prune, enable, disable, reload, or edit plugin config.',
      zh: '本 doctor 只读。它不会安装、prune、启用、禁用、reload 或修改插件配置。',
    }),
  )
  return lines.join('\n')
}

export function PluginDoctor({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    async function run(): Promise<void> {
      try {
        const status = await describePluginStatus()
        if (!cancelled) onComplete(formatPluginDoctor(status))
      } catch (error) {
        logError(error)
        if (!cancelled) {
          onComplete(
            getLocalizedText({
              en: `${figures.cross} Plugin doctor failed: ${errorMessage(error)}`,
              zh: `${figures.cross} 插件诊断失败：${errorMessage(error)}`,
            }),
          )
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading plugin doctor…',
          zh: '正在读取插件诊断…',
        })}
      </Text>
    </Box>
  )
}
