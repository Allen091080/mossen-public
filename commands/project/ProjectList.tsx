import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import {
  buildProjectInventory,
  type ProjectInventoryEntry,
  type ProjectInventoryResult,
} from '../../utils/projectInventory.js';
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

function formatRelativeTime(modifiedMs: number, nowMs: number): string {
  if (modifiedMs <= 0) {
    return getLocalizedText({ en: '(unknown)', zh: '（未知）' });
  }
  const ageDays = Math.floor((nowMs - modifiedMs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 0) {
    return getLocalizedText({ en: 'today', zh: '今天' });
  }
  if (ageDays === 1) {
    return getLocalizedText({ en: '1d ago', zh: '1 天前' });
  }
  return getLocalizedText({
    en: `${ageDays}d ago`,
    zh: `${ageDays} 天前`,
  });
}

function formatEntry(entry: ProjectInventoryEntry, nowMs: number): string[] {
  const lines: string[] = [];
  const flags: string[] = [];
  if (entry.active) {
    flags.push(
      getLocalizedText({ en: 'ACTIVE', zh: '活动' }),
    );
  }
  if (entry.stale) {
    flags.push(getLocalizedText({ en: 'STALE', zh: '过期' }));
  }
  const flagSuffix =
    flags.length > 0 ? `  [${flags.join(', ')}]` : '';
  const cwdLabel =
    entry.inferredCwdConfidence === 'low'
      ? `${entry.sanitizedId}  ${getLocalizedText({ en: '(opaque id)', zh: '（不可还原 cwd）' })}`
      : entry.inferredCwd;
  lines.push(`  ${cwdLabel}${flagSuffix}`);
  lines.push(
    getLocalizedText({
      en: `    sanitizedId:   ${entry.sanitizedId}`,
      zh: `    sanitized id:  ${entry.sanitizedId}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `    projectDir:    ${entry.projectDir}`,
      zh: `    项目目录:      ${entry.projectDir}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `    sessions:      ${entry.sessionJsonlCount} jsonl, ${entry.subSessionDirCount} sub-dir`,
      zh: `    会话数:        ${entry.sessionJsonlCount} jsonl，${entry.subSessionDirCount} 子目录`,
    }),
  );
  if (entry.hasMemoryDir) {
    lines.push(
      getLocalizedText({
        en: `    memory:        present (${entry.memoryFileCount} ${plural(entry.memoryFileCount, 'file')}, ${formatBytes(entry.memoryBytes)})`,
        zh: `    memory:        存在（${entry.memoryFileCount} 个文件，${formatBytes(entry.memoryBytes)}）`,
      }),
    );
  } else {
    lines.push(
      getLocalizedText({
        en: '    memory:        absent',
        zh: '    memory:        不存在',
      }),
    );
  }
  lines.push(
    getLocalizedText({
      en: `    total size:    ${formatBytes(entry.totalBytes)}`,
      zh: `    总大小:        ${formatBytes(entry.totalBytes)}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `    last modified: ${formatRelativeTime(entry.modifiedMs, nowMs)}`,
      zh: `    最近修改:      ${formatRelativeTime(entry.modifiedMs, nowMs)}`,
    }),
  );
  return lines;
}

function formatInventory(result: ProjectInventoryResult, nowMs: number): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: `${figures.info} Project storage inventory (read-only)`,
      zh: `${figures.info} 项目存储清单（只读）`,
    }),
  );
  lines.push('');

  if (result.missingProjectsDir) {
    lines.push(
      getLocalizedText({
        en: `Projects dir not found: ${result.projectsDir}\nNo projects to list.`,
        zh: `项目目录不存在: ${result.projectsDir}\n没有可列出的项目。`,
      }),
    );
    return lines.join('\n');
  }

  lines.push(
    getLocalizedText({
      en: `Projects dir: ${result.projectsDir}`,
      zh: `项目目录:     ${result.projectsDir}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Total: ${result.entries.length} ${plural(result.entries.length, 'project')} (${formatBytes(result.aggregateBytes)} aggregate)`,
      zh: `共 ${result.entries.length} 个项目（合计 ${formatBytes(result.aggregateBytes)}）`,
    }),
  );
  const activeCount = result.entries.filter(e => e.active).length;
  const staleCount = result.entries.filter(e => e.stale).length;
  lines.push(
    getLocalizedText({
      en: `Active markers detected: ${activeCount} (originalCwd / projectRoot / sessionProjectDir).`,
      zh: `检测到活动标记: ${activeCount} 处（originalCwd / projectRoot / sessionProjectDir）。`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Stale (mtime > 7d): ${staleCount}.`,
      zh: `过期（mtime > 7 天）: ${staleCount} 个。`,
    }),
  );
  lines.push('');

  if (result.entries.length === 0) {
    lines.push(
      getLocalizedText({
        en: 'No projects found.',
        zh: '未发现任何项目。',
      }),
    );
    return lines.join('\n');
  }

  for (const entry of result.entries) {
    lines.push(...formatEntry(entry, nowMs));
    lines.push('');
  }

  lines.push(
    getLocalizedText({
      en:
        'NOTE: this is a read-only view. To remove a non-active project use:\n' +
        '  /project purge --target <cwd>\n' +
        'Active projects are protected and will be rejected.',
      zh:
        '提示：此为只读视图。如需清理某个非活动项目：\n' +
        '  /project purge --target <cwd>\n' +
        '活动项目受保护，将被拒绝。',
    }),
  );
  return lines.join('\n');
}

export function ProjectList({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const result = await buildProjectInventory();
        if (cancelled) return;
        onComplete(formatInventory(result, Date.now()));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} /project list failed: ${errorMessage(error)}`,
            zh: `${figures.cross} /project list 失败: ${errorMessage(error)}`,
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
          en: 'Inventorying ~/.mossen/projects/…',
          zh: '正在清点 ~/.mossen/projects/…',
        })}
      </Text>
    </Box>
  );
}
