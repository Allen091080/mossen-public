import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { plural } from '../../utils/stringUtils.js';
import {
  executePluginPrunePlan,
  getPluginPrunePlan,
  type PluginPrunePlan,
  type PluginPruneResult,
  PRUNE_PLAN_TOKEN_TTL_MS,
  type PrunePlanEntry,
} from '../../utils/plugins/cacheUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

type Props = {
  onComplete: (result?: string) => void;
  /** Optional token from --confirm; absent for dry-run. */
  confirmToken?: string;
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

function totalSize(entries: PrunePlanEntry[]): number {
  let sum = 0;
  let anyKnown = false;
  for (const e of entries) {
    if (e.sizeBytes >= 0) {
      sum += e.sizeBytes;
      anyKnown = true;
    }
  }
  return anyKnown ? sum : -1;
}

function formatEntry(entry: PrunePlanEntry, ageNote: string): string {
  // Compact one-line shape: "marketplace/plugin/version  size  age-note"
  return `  ${entry.marketplace}/${entry.plugin}/${entry.version}  ${formatBytes(
    entry.sizeBytes,
  )}  ${ageNote}`;
}

function formatDryRun(plan: PluginPrunePlan): string {
  const ttlMin = Math.floor(PRUNE_PLAN_TOKEN_TTL_MS / 60_000);
  const lines: string[] = [];

  lines.push(
    getLocalizedText({
      en: `${figures.info} Plugin prune (dry-run)`,
      zh: `${figures.info} 插件 prune（dry-run 预览）`,
    }),
  );
  lines.push('');

  if (plan.zipCacheMode) {
    lines.push(
      getLocalizedText({
        en:
          'Plugin zip-cache mode is active — /plugin prune does not operate on zip caches.\n' +
          'No action taken; nothing was scanned, marked, or deleted.',
        zh:
          '当前启用了插件 zip 缓存模式 —— /plugin prune 不处理 zip 缓存。\n' +
          '本次未执行任何动作；未扫描、未标记、未删除。',
      }),
    );
    return lines.join('\n');
  }

  const expired = plan.expiredOrphans;
  const unmarked = plan.unmarkedOrphans;
  const fresh = plan.freshOrphans;
  const installed = plan.installedSkipped;

  // Header summary line.
  lines.push(
    getLocalizedText({
      en:
        `Will delete ${expired.length} expired ${plural(expired.length, 'orphan')}, ` +
        `mark ${unmarked.length} new ${plural(unmarked.length, 'orphan')}, ` +
        `keep ${fresh.length} ${plural(fresh.length, 'fresh orphan')} ` +
        `(< 7d), skip ${installed.length} installed.`,
      zh:
        `将删除 ${expired.length} 个过期 orphan，标记 ${unmarked.length} 个新发现的 orphan，` +
        `保留 ${fresh.length} 个未到 7 天的 orphan，跳过 ${installed.length} 个已安装版本。`,
    }),
  );
  lines.push('');

  // Section: will delete (expired orphans).
  if (expired.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} Will DELETE on confirm (${plural(expired.length, 'version')}, total ${formatBytes(totalSize(expired))}):`,
        zh: `${figures.warning} 确认后将删除（${expired.length} 个版本，总 ${formatBytes(totalSize(expired))}）：`,
      }),
    );
    for (const entry of expired) {
      lines.push(
        formatEntry(
          entry,
          getLocalizedText({
            en: `marker ${entry.ageDays}d old`,
            zh: `标记于 ${entry.ageDays} 天前`,
          }),
        ),
      );
    }
    lines.push('');
  }

  // Section: will mark (unmarked orphans).
  if (unmarked.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.bullet} Will MARK on confirm (no delete; deletion happens after 7d grace) (${plural(unmarked.length, 'version')}, total ${formatBytes(totalSize(unmarked))}):`,
        zh: `${figures.bullet} 确认后仅标记（不删除；7 天后再清理）（${unmarked.length} 个版本，总 ${formatBytes(totalSize(unmarked))}）：`,
      }),
    );
    for (const entry of unmarked) {
      lines.push(
        formatEntry(
          entry,
          getLocalizedText({ en: 'no marker', zh: '尚未标记' }),
        ),
      );
    }
    lines.push('');
  }

  // Section: fresh orphans (kept).
  if (fresh.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.bullet} Within 7d grace — KEPT (${plural(fresh.length, 'version')}):`,
        zh: `${figures.bullet} 在 7 天宽限期内，保留（${fresh.length} 个版本）：`,
      }),
    );
    for (const entry of fresh) {
      lines.push(
        formatEntry(
          entry,
          getLocalizedText({
            en: `marker ${entry.ageDays}d old`,
            zh: `标记于 ${entry.ageDays} 天前`,
          }),
        ),
      );
    }
    lines.push('');
  }

  // Footer: token + grace explanation + how to confirm.
  if (expired.length === 0 && unmarked.length === 0) {
    lines.push(
      getLocalizedText({
        en: 'Nothing to prune. No mutation needed.',
        zh: '没有需要清理的内容，无需执行。',
      }),
    );
    return lines.join('\n');
  }

  lines.push(
    getLocalizedText({
      en:
        'NOTE: 7-day grace period is enforced — newly discovered orphans are only marked,\n' +
        'never deleted in the same run. Re-run /plugin prune after 7 days to delete them.',
      zh:
        '提示：保留 7 天宽限期 —— 新发现的 orphan 只会被标记，不会在同一次运行中被删除。\n' +
        '7 天后再次执行 /plugin prune 才会删除。',
    }),
  );
  lines.push('');
  lines.push(
    getLocalizedText({
      en: `To execute this plan, run within ${ttlMin} min:`,
      zh: `如要执行此方案，请在 ${ttlMin} 分钟内运行：`,
    }),
  );
  lines.push(`  /plugin prune --confirm ${plan.token}`);

  return lines.join('\n');
}

function formatExecuteResult(result: PluginPruneResult): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: `${figures.tick} Plugin prune complete`,
      zh: `${figures.tick} 插件 prune 完成`,
    }),
  );
  lines.push(
    getLocalizedText({
      en:
        `  marked: ${result.marked.length}\n` +
        `  deleted: ${result.deleted.length}\n` +
        `  cleaned empty dirs: ${result.cleanedDirs.length}\n` +
        `  errors: ${result.errors.length}`,
      zh:
        `  已标记：${result.marked.length}\n` +
        `  已删除：${result.deleted.length}\n` +
        `  清理空目录：${result.cleanedDirs.length}\n` +
        `  错误：${result.errors.length}`,
    }),
  );
  if (result.errors.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Errors (per-path, non-blocking):',
        zh: '错误明细（按路径，不阻塞）：',
      }),
    );
    for (const e of result.errors) {
      lines.push(`  [${e.phase}] ${e.path}: ${e.message}`);
    }
  }
  return lines.join('\n');
}

export function PluginPrune({ onComplete, confirmToken }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        if (confirmToken) {
          const outcome = await executePluginPrunePlan(confirmToken);
          if (cancelled) return;
          if ('kind' in outcome) {
            switch (outcome.kind) {
              case 'unknown_token':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} Unknown confirm token. ` +
                      'Run /plugin prune (no args) first to generate a fresh token.',
                    zh:
                      `${figures.cross} 未知的确认 token。` +
                      '请先运行 /plugin prune（不带参数）以生成新的 token。',
                  }),
                );
                return;
              case 'expired_token':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} Confirm token has expired (>${Math.floor(PRUNE_PLAN_TOKEN_TTL_MS / 60_000)} min). ` +
                      'Run /plugin prune again to refresh.',
                    zh:
                      `${figures.cross} 确认 token 已过期（>${Math.floor(PRUNE_PLAN_TOKEN_TTL_MS / 60_000)} 分钟）。` +
                      '请重新运行 /plugin prune 获取新 token。',
                  }),
                );
                return;
              case 'zip_cache_mode':
                onComplete(
                  getLocalizedText({
                    en:
                      'Plugin zip-cache mode is active — /plugin prune does not operate on zip caches.',
                    zh:
                      '当前启用了插件 zip 缓存模式 —— /plugin prune 不处理 zip 缓存。',
                  }),
                );
                return;
            }
          }
          onComplete(formatExecuteResult(outcome));
          return;
        }
        // Dry-run path.
        const plan = await getPluginPrunePlan();
        if (cancelled) return;
        onComplete(formatDryRun(plan));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Plugin prune failed: ${errorMessage(error)}`,
            zh: `${figures.cross} 插件 prune 失败：${errorMessage(error)}`,
          }),
        );
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [onComplete, confirmToken]);

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Executing plugin prune…',
              zh: '正在执行插件 prune…',
            })
          : getLocalizedText({
              en: 'Computing prune plan…',
              zh: '正在计算 prune 方案…',
            })}
      </Text>
    </Box>
  );
}
