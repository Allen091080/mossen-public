import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import {
  executePluginInstallPlan,
  getPluginInstallPlan,
  PLUGIN_INSTALL_PLAN_TOKEN_TTL_MS,
  type PluginInstallPlanError,
  type PluginInstallPlanResult,
} from '../../utils/plugins/pluginInstallPlan.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  plugin?: string
  scope?: string
  confirmToken?: string
  onComplete: (result?: string) => void
}

function formatError(error: PluginInstallPlanError): string {
  switch (error.type) {
    case 'missing_plugin':
      return getLocalizedText({
        en:
          `${figures.cross} Missing plugin identifier.\n` +
          'Usage: /plugin install --dry-run <plugin@marketplace> [--scope user|project|local]',
        zh:
          `${figures.cross} 缺少插件标识。\n` +
          '用法：/plugin install --dry-run <plugin@marketplace> [--scope user|project|local]',
      })
    case 'marketplace_required':
      return getLocalizedText({
        en: `${figures.cross} Marketplace is required for dry-run install: ${error.plugin}. Use plugin@marketplace, or pass a GitHub plugin URL.`,
        zh: `${figures.cross} dry-run 安装必须指定 marketplace：${error.plugin}。请使用 plugin@marketplace，或传入 GitHub plugin URL。`,
      })
    case 'invalid_github_target':
      return getLocalizedText({
        en: `${figures.cross} Invalid GitHub plugin target: ${error.reason}`,
        zh: `${figures.cross} GitHub plugin 目标无效：${error.reason}`,
      })
    case 'plugin_not_found':
      return getLocalizedText({
        en: `${figures.cross} Plugin not found: ${error.plugin}`,
        zh: `${figures.cross} 未找到插件：${error.plugin}`,
      })
    case 'invalid_scope':
      return getLocalizedText({
        en: `${figures.cross} Invalid scope: ${error.scope ?? '(missing)'}. Use user, project, or local.`,
        zh: `${figures.cross} 无效作用域：${error.scope ?? '（缺失）'}。请使用 user、project 或 local。`,
      })
    case 'blocked_by_policy':
      return getLocalizedText({
        en: `${figures.cross} Plugin is blocked by policy: ${error.pluginId}`,
        zh: `${figures.cross} 插件被策略阻止：${error.pluginId}`,
      })
    case 'resolution_failed':
      return getLocalizedText({
        en: `${figures.cross} Dependency resolution failed: ${error.message}`,
        zh: `${figures.cross} 依赖解析失败：${error.message}`,
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
    case 'install_failed':
      return getLocalizedText({
        en: `${figures.cross} Plugin install failed: ${error.message}`,
        zh: `${figures.cross} 插件安装失败：${error.message}`,
      })
  }
}

function formatPlan(result: Extract<PluginInstallPlanResult, { ok: true }>): string {
  const { plan } = result
  const ttlMin = Math.floor(PLUGIN_INSTALL_PLAN_TOKEN_TTL_MS / 60_000)
  return [
    getLocalizedText({
      en: `${figures.info} Plugin install dry-run`,
      zh: `${figures.info} 插件安装 dry-run`,
    }),
    '',
    `Plugin:      ${plan.pluginId}`,
    plan.sourceDescription ? `Source:      ${plan.sourceDescription}` : undefined,
    `Scope:       ${plan.scope}`,
    plan.entry.version ? `Version:     ${plan.entry.version}` : undefined,
    plan.entry.description
      ? getLocalizedText({
          en: `Description: ${plan.entry.description}`,
          zh: `描述:        ${plan.entry.description}`,
        })
      : undefined,
    getLocalizedText({
      en: `Dependencies: ${plan.dependencyClosure.length - 1} additional plugin(s)${plan.depNote}`,
      zh: `依赖:        ${plan.dependencyClosure.length - 1} 个额外插件${plan.depNote}`,
    }),
    '',
    getLocalizedText({
      en:
        'No settings were changed and no plugin files were written. Confirming will reuse the existing installResolvedPlugin() path.',
      zh:
        '未修改设置，也未写入插件文件。确认后会复用现有 installResolvedPlugin() 路径。',
    }),
    '',
    getLocalizedText({
      en: `To install within ${ttlMin} min: /plugin install --confirm ${plan.token}`,
      zh: `${ttlMin} 分钟内安装：/plugin install --confirm ${plan.token}`,
    }),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function formatInstalled(result: Extract<PluginInstallPlanResult, { ok: true }>): string {
  return [
    getLocalizedText({
      en: `${figures.tick} Installed ${result.plan.pluginId} (scope: ${result.plan.scope})${result.plan.depNote}.`,
      zh: `${figures.tick} 已安装 ${result.plan.pluginId}（作用域：${result.plan.scope}）${result.plan.depNote}。`,
    }),
    getLocalizedText({
      en: 'Plugin files were installed. Run /reload-plugins to activate them in this session.',
      zh: '插件文件已安装。运行 /reload-plugins 可在当前会话中激活。',
    }),
    '',
    getLocalizedText({
      en: 'Next: /reload-plugins',
      zh: '下一步：/reload-plugins',
    }),
    getLocalizedText({
      en: 'Then check: /plugin status',
      zh: '然后检查：/plugin status',
    }),
    getLocalizedText({
      en: 'For all extension install commands: /extensions',
      zh: '查看所有扩展安装命令：/extensions',
    }),
  ].join('\n')
}

export function PluginInstallPlan({
  plugin,
  scope,
  confirmToken,
  onComplete,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const result = confirmToken
        ? await executePluginInstallPlan(confirmToken)
        : await getPluginInstallPlan({ plugin, scope })
      if (cancelled) return
      if (result.ok === true) {
        onComplete(confirmToken ? formatInstalled(result) : formatPlan(result))
      } else {
        onComplete(formatError(result.error))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [confirmToken, onComplete, plugin, scope])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Installing plugin…',
              zh: '正在安装插件…',
            })
          : getLocalizedText({
              en: 'Preparing plugin install dry-run…',
              zh: '正在准备插件安装 dry-run…',
            })}
      </Text>
    </Box>
  )
}
