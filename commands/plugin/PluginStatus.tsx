import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import {
  describePluginStatus,
  type PluginStatusSummary,
} from '../../utils/plugins/statusOps.js';
import { plural } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

type Props = {
  onComplete: (result?: string) => void;
};

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

function formatBytes(n: number): string {
  if (n < 0) return getLocalizedText({ en: '(unknown)', zh: '（未知）' });
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)}${SIZE_UNITS[unit]}`;
}

function formatStatus(s: PluginStatusSummary): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: `${figures.info} Plugin status (read-only)`,
      zh: `${figures.info} 插件状态（只读）`,
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: `Plugin root:    ${s.pluginRootPath}  ${s.pluginRootExists ? '(exists)' : '(absent)'}`,
      zh: `插件根目录:     ${s.pluginRootPath}  ${s.pluginRootExists ? '（存在）' : '（不存在）'}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Cache path:     ${s.cache.cachePath}`,
      zh: `Cache 路径:     ${s.cache.cachePath}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Marketplaces:   ${s.marketplacesDir}  ${s.marketplacesDirExists ? '(exists)' : '(absent)'}`,
      zh: `Marketplaces:   ${s.marketplacesDir}  ${s.marketplacesDirExists ? '（存在）' : '（不存在）'}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Installed reg:  ${s.installedRegistryPath}  ${s.installedRegistryLoadable ? '(loadable)' : '(load failed)'}`,
      zh: `installed 注册表: ${s.installedRegistryPath}  ${s.installedRegistryLoadable ? '（可加载）' : '（加载失败）'}`,
    }),
  );
  lines.push('');

  if (s.cache.zipCacheMode) {
    lines.push(
      getLocalizedText({
        en:
          'Zip-cache mode is active — /plugin prune does not operate on zip caches.\n' +
          'No orphan walk performed.',
        zh:
          '当前启用 zip 缓存模式 —— /plugin prune 不处理 zip 缓存。\n' +
          '未执行 orphan 扫描。',
      }),
    );
    lines.push('');
    lines.push(
      getLocalizedText({
        en: `Suggested: ${s.suggestedCommand}`,
        zh: `建议: ${s.suggestedCommand}`,
      }),
    );
    return lines.join('\n');
  }

  lines.push(
    getLocalizedText({
      en: 'Registry counts:',
      zh: 'Registry 统计:',
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  installed plugins:  ${s.installedRecordCount} ${plural(s.installedRecordCount, 'record')}`,
      zh: `  已安装插件:         ${s.installedRecordCount} 条`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  installed versions: ${s.installedVersionCount}`,
      zh: `  已安装版本:         ${s.installedVersionCount} 个`,
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: 'Cache counts:',
      zh: 'Cache 统计:',
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  marketplaces:       ${s.cache.marketplaceCount}`,
      zh: `  marketplace 数:     ${s.cache.marketplaceCount}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  unique plugins:     ${s.cache.uniquePluginCount}`,
      zh: `  唯一插件数:         ${s.cache.uniquePluginCount}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  cache versions:     ${s.cache.cacheVersionCount}`,
      zh: `  cache 版本数:       ${s.cache.cacheVersionCount}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  cache total bytes:  ${formatBytes(s.cache.cacheBytes)}`,
      zh: `  cache 总大小:       ${formatBytes(s.cache.cacheBytes)}`,
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: 'Orphan classification (W55 R1 idiom):',
      zh: 'Orphan 分类（W55 R1 idiom）:',
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  expired (>7d):      ${s.cache.expiredOrphanCount}  — would be deleted on /plugin prune --confirm`,
      zh: `  过期（>7 天）:      ${s.cache.expiredOrphanCount}  — /plugin prune --confirm 后将删除`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  unmarked:           ${s.cache.unmarkedOrphanCount}  — would be marked on /plugin prune --confirm`,
      zh: `  未标记:             ${s.cache.unmarkedOrphanCount}  — /plugin prune --confirm 后仅标记`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  fresh (<=7d):       ${s.cache.freshOrphanCount}  — held by 7-day grace`,
      zh: `  新鲜（<=7 天）:     ${s.cache.freshOrphanCount}  — 7 天宽限期内保留`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  installed-skipped:  ${s.cache.installedSkippedCount}  — protected (in installed registry)`,
      zh: `  已安装跳过:         ${s.cache.installedSkippedCount}  — 受保护（在 installed 注册表中）`,
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: `Prune eligibility: ${s.pruneEligible ? 'YES — orphans present' : 'no orphans'}`,
      zh: `Prune 资格: ${s.pruneEligible ? '是 —— 存在 orphan' : '无 orphan'}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Suggested:         ${s.suggestedCommand}`,
      zh: `建议:               ${s.suggestedCommand}`,
    }),
  );

  // W146.4 P1-2: surface plugin load errors so a corrupt plugin.json or a
  // missing marketplace can't silently break /<plugin-cmd>. Renders only
  // when count > 0 — clean projects see no extra noise.
  if (s.loadErrors.count > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: `Plugin load errors: ${s.loadErrors.count}`,
        zh: `插件加载错误: ${s.loadErrors.count}`,
      }),
    );
    for (const summary of s.loadErrors.summaries) {
      lines.push(`  - ${summary}`);
    }
    if (s.loadErrors.count > s.loadErrors.summaries.length) {
      const remaining =
        s.loadErrors.count - s.loadErrors.summaries.length;
      lines.push(
        getLocalizedText({
          en: `  - … and ${remaining} more (run with --debug for full details)`,
          zh: `  - …还有 ${remaining} 条（用 --debug 查看完整信息）`,
        }),
      );
    }
  }

  // W154-B: surface explicitly disabled plugins. Operators chasing a missing
  // /<plugin-cmd> need to distinguish "plugin is off" from "plugin failed to
  // load" — both leave the command absent. Renders only when count > 0.
  if (s.disabledPluginCount > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: `Disabled plugins: ${s.disabledPluginCount}`,
        zh: `已禁用插件: ${s.disabledPluginCount}`,
      }),
    );
    for (const id of s.disabledPluginIds) {
      lines.push(`  - ${id}`);
    }
    if (s.disabledPluginCount > s.disabledPluginIds.length) {
      const remaining =
        s.disabledPluginCount - s.disabledPluginIds.length;
      lines.push(
        getLocalizedText({
          en: `  - … and ${remaining} more`,
          zh: `  - …还有 ${remaining} 个`,
        }),
      );
    }
    lines.push(
      getLocalizedText({
        en: `  fix: re-enable via /plugin enable <plugin@marketplace>`,
        zh: `  修复: 用 /plugin enable <plugin@marketplace> 重新启用`,
      }),
    );
  }

  if (s.shadowedEnabledPluginSettings.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Shadowed plugin settings:',
        zh: '被覆盖的插件设置:',
      }),
    );
    for (const warning of s.shadowedEnabledPluginSettings) {
      lines.push(`  - ${warning}`);
    }
    lines.push(
      getLocalizedText({
        en: '  note: later/higher-priority settings sources decide the effective plugin state',
        zh: '  说明: 后加载/高优先级 settings source 决定插件最终状态',
      }),
    );
  }

  if (s.ignoredFolderWarnings.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Ignored plugin folders:',
        zh: '被忽略的插件目录:',
      }),
    );
    for (const warning of s.ignoredFolderWarnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (s.componentInventory.pluginCount > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Plugin component inventory:',
        zh: '插件组件清单:',
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  plugins: ${s.componentInventory.pluginCount}, commands: ${s.componentInventory.commandCount}, skills: ${s.componentInventory.skillCount}`,
        zh: `  插件: ${s.componentInventory.pluginCount}, 命令: ${s.componentInventory.commandCount}, 技能: ${s.componentInventory.skillCount}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  projected session tokens: ~${s.componentInventory.projectedSessionTokens}`,
        zh: `  预计会话 tokens: ~${s.componentInventory.projectedSessionTokens}`,
      }),
    );
    if (s.componentInventory.hookEventNames.length > 0) {
      lines.push(
        getLocalizedText({
          en: `  hook events: ${s.componentInventory.hookEventNames.join(', ')}`,
          zh: `  hook 事件: ${s.componentInventory.hookEventNames.join(', ')}`,
        }),
      );
    }
    if (s.componentInventory.mcpServerNames.length > 0) {
      lines.push(
        getLocalizedText({
          en: `  MCP servers: ${s.componentInventory.mcpServerNames.join(', ')}`,
          zh: `  MCP server: ${s.componentInventory.mcpServerNames.join(', ')}`,
        }),
      );
    }
    if (s.componentInventory.mcpServerSummaries.length > 0) {
      lines.push(
        getLocalizedText({
          en: '  MCP config summaries:',
          zh: '  MCP 配置摘要:',
        }),
      );
      for (const summary of s.componentInventory.mcpServerSummaries) {
        lines.push(`    - ${summary}`);
      }
    }
    if (s.componentInventory.lspServerNames.length > 0) {
      lines.push(
        getLocalizedText({
          en: `  LSP servers: ${s.componentInventory.lspServerNames.join(', ')}`,
          zh: `  LSP server: ${s.componentInventory.lspServerNames.join(', ')}`,
        }),
      );
    }
    if (s.componentInventory.lspServerSummaries.length > 0) {
      lines.push(
        getLocalizedText({
          en: '  LSP config summaries:',
          zh: '  LSP 配置摘要:',
        }),
      );
      for (const summary of s.componentInventory.lspServerSummaries) {
        lines.push(`    - ${summary}`);
      }
    }
    if (s.componentInventory.settingsKeys.length > 0) {
      lines.push(
        getLocalizedText({
          en: `  settings/user config: ${s.componentInventory.settingsKeys.join(', ')}`,
          zh: `  settings/user config: ${s.componentInventory.settingsKeys.join(', ')}`,
        }),
      );
    }
    for (const summary of s.componentInventory.pluginSummaries) {
      lines.push(`  - ${summary}`);
    }
  }
  return lines.join('\n');
}

export function PluginStatus({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const status = await describePluginStatus();
        if (cancelled) return;
        onComplete(formatStatus(status));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} /plugin status failed: ${errorMessage(error)}`,
            zh: `${figures.cross} /plugin status 失败: ${errorMessage(error)}`,
          }),
        );
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Computing plugin status…',
          zh: '正在计算插件状态…',
        })}
      </Text>
    </Box>
  );
}
