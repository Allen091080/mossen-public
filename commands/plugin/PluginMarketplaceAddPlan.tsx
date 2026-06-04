import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  executePluginMarketplaceAddPlan,
  getPluginMarketplaceAddPlan,
  PLUGIN_MARKETPLACE_ADD_TOKEN_TTL_MS,
  type PluginMarketplaceAddExecuteResult,
  type PluginMarketplaceAddPlanError,
  type PluginMarketplaceAddPlanResult,
} from '../../utils/plugins/marketplaceAddPlan.js'
import { getMarketplaceSourceDisplay } from '../../utils/plugins/marketplaceHelpers.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  target?: string
  confirmToken?: string
  onComplete: (result?: string) => void
}

function formatError(error: PluginMarketplaceAddPlanError): string {
  switch (error.type) {
    case 'missing_source':
      return getLocalizedText({
        en:
          `${figures.cross} Missing marketplace source.\n` +
          'Usage: /plugin marketplace add --dry-run <owner/repo | url | path>',
        zh:
          `${figures.cross} 缺少插件市场来源。\n` +
          '用法：/plugin marketplace add --dry-run <owner/repo | url | path>',
      })
    case 'invalid_source':
      return getLocalizedText({
        en: `${figures.cross} Invalid marketplace source: ${error.message}`,
        zh: `${figures.cross} 无效的插件市场来源：${error.message}`,
      })
    case 'unknown_token':
      return getLocalizedText({
        en: `${figures.cross} Unknown or already-used confirm token: ${error.token}`,
        zh: `${figures.cross} 未知或已使用的确认 token：${error.token}`,
      })
    case 'expired_token':
      return getLocalizedText({
        en: `${figures.cross} Confirm token expired. Re-run the dry-run command.`,
        zh: `${figures.cross} 确认 token 已过期。请重新执行 dry-run 命令。`,
      })
    case 'add_failed':
      return getLocalizedText({
        en: `${figures.cross} Failed to add marketplace: ${error.message}`,
        zh: `${figures.cross} 添加插件市场失败：${error.message}`,
      })
  }
}

function formatDryRun(result: Extract<PluginMarketplaceAddPlanResult, { ok: true }>): string {
  const ttlMin = Math.floor(PLUGIN_MARKETPLACE_ADD_TOKEN_TTL_MS / 60_000)
  const { plan } = result
  return [
    getLocalizedText({
      en: `${figures.info} Plugin marketplace add dry-run`,
      zh: `${figures.info} 插件市场添加 dry-run`,
    }),
    '',
    getLocalizedText({
      en: `Input:  ${plan.input}`,
      zh: `输入:   ${plan.input}`,
    }),
    `Source: ${plan.sourceDisplay}`,
    getLocalizedText({
      en:
        'No settings were changed and no marketplace was fetched. Confirming will reuse the existing addMarketplaceSource() path, then save the resolved marketplace to settings.',
      zh:
        '未修改设置，也未 fetch 插件市场。确认后会复用现有 addMarketplaceSource() 路径，然后把解析后的插件市场写入设置。',
    }),
    '',
    getLocalizedText({
      en: `To add within ${ttlMin} min: /plugin marketplace add --confirm ${plan.token}`,
      zh: `${ttlMin} 分钟内添加：/plugin marketplace add --confirm ${plan.token}`,
    }),
  ].join('\n')
}

function formatInstalled(result: Extract<PluginMarketplaceAddExecuteResult, { ok: true }>): string {
  return [
    getLocalizedText({
      en: `${figures.tick} Added marketplace: ${result.name}`,
      zh: `${figures.tick} 已添加插件市场：${result.name}`,
    }),
    getLocalizedText({
      en: `Resolved source: ${getMarketplaceSourceDisplay(result.resolvedSource)}`,
      zh: `解析来源：${getMarketplaceSourceDisplay(result.resolvedSource)}`,
    }),
    result.alreadyMaterialized
      ? getLocalizedText({
          en: 'The source was already materialized; settings were refreshed.',
          zh: '该来源已经物化；已刷新设置。',
        })
      : getLocalizedText({
          en: 'Marketplace caches were refreshed. Use /plugin install <plugin>@<marketplace> to install plugins from it.',
          zh: '插件市场缓存已刷新。可使用 /plugin install <plugin>@<marketplace> 从中安装插件。',
        }),
  ].join('\n')
}

export function PluginMarketplaceAddPlan({
  target,
  confirmToken,
  onComplete,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (confirmToken) {
        const result = await executePluginMarketplaceAddPlan(confirmToken)
        if (cancelled) return
        if (result.ok === true) {
          onComplete(formatInstalled(result))
        } else {
          onComplete(formatError(result.error))
        }
        return
      }

      const result = await getPluginMarketplaceAddPlan(target)
      if (cancelled) return
      if (result.ok === true) {
        onComplete(formatDryRun(result))
      } else {
        onComplete(formatError(result.error))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [confirmToken, onComplete, target])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Adding plugin marketplace…',
              zh: '正在添加插件市场…',
            })
          : getLocalizedText({
              en: 'Preparing marketplace dry-run…',
              zh: '正在准备插件市场 dry-run…',
            })}
      </Text>
    </Box>
  )
}
