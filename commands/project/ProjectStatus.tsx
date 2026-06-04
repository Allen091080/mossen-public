import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import {
  describeActiveProjectStatus,
  type ActiveProjectStatus,
  type CacheSizeSummary,
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

function formatCache(c: CacheSizeSummary): string {
  if (!c.exists) {
    return getLocalizedText({
      en: `  ${c.path}  (absent)`,
      zh: `  ${c.path}  （不存在）`,
    });
  }
  return getLocalizedText({
    en: `  ${c.path}  ${formatBytes(c.totalBytes)}, ${c.entryCount < 0 ? '?' : c.entryCount} ${plural(Math.max(0, c.entryCount), 'entry')}`,
    zh: `  ${c.path}  ${formatBytes(c.totalBytes)}，${c.entryCount < 0 ? '?' : c.entryCount} 个 entry`,
  });
}

function formatStatus(status: ActiveProjectStatus): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: `${figures.info} Project status (read-only)`,
      zh: `${figures.info} 项目状态（只读）`,
    }),
  );
  lines.push('');

  // Active markers section.
  lines.push(
    getLocalizedText({
      en: 'Active markers:',
      zh: '活动标记:',
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  originalCwd:        ${status.activeMarkers.originalCwd}`,
      zh: `  originalCwd:        ${status.activeMarkers.originalCwd}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  projectRoot:        ${status.activeMarkers.projectRoot}`,
      zh: `  projectRoot:        ${status.activeMarkers.projectRoot}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `  sessionProjectDir:  ${status.activeMarkers.sessionProjectDir ?? '(none)'}`,
      zh: `  sessionProjectDir:  ${status.activeMarkers.sessionProjectDir ?? '（无）'}`,
    }),
  );
  const ids = [...status.activeMarkers.activeSanitized].join(', ');
  lines.push(
    getLocalizedText({
      en: `  active sanitized ids: ${ids}`,
      zh: `  活动 sanitized id:  ${ids}`,
    }),
  );
  lines.push('');

  // Active project dir info.
  if (status.inventory) {
    lines.push(
      getLocalizedText({
        en: `Project dir: ${status.inventory.projectDir}`,
        zh: `项目目录:    ${status.inventory.projectDir}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  sessions:    ${status.inventory.sessionJsonlCount} jsonl, ${status.inventory.subSessionDirCount} sub-dir`,
        zh: `  会话数:      ${status.inventory.sessionJsonlCount} jsonl，${status.inventory.subSessionDirCount} 子目录`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  total size:  ${formatBytes(status.inventory.totalBytes)}`,
        zh: `  总大小:      ${formatBytes(status.inventory.totalBytes)}`,
      }),
    );
    if (status.inventory.modifiedMs > 0) {
      lines.push(
        getLocalizedText({
          en: `  modified:    ${new Date(status.inventory.modifiedMs).toISOString()}`,
          zh: `  修改时间:    ${new Date(status.inventory.modifiedMs).toISOString()}`,
        }),
      );
    }
  } else {
    lines.push(
      getLocalizedText({
        en: 'Project dir not yet created on disk for the active cwd.',
        zh: '当前 cwd 对应的项目目录尚未在磁盘上创建。',
      }),
    );
  }
  lines.push('');

  // Memory section.
  const mem = status.memory;
  lines.push(
    getLocalizedText({
      en: 'Memory:',
      zh: 'Memory:',
    }),
  );
  if (mem.status === 'in-project') {
    lines.push(
      getLocalizedText({
        en: `  status:      in-project (preserved by /project purge default)`,
        zh: `  状态:        in-project（/project purge 默认保留）`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  path:        ${mem.path}`,
        zh: `  路径:        ${mem.path}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  files:       ${mem.fileCount}`,
        zh: `  文件数:      ${mem.fileCount}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  size:        ${formatBytes(mem.totalBytes)}`,
        zh: `  大小:        ${formatBytes(mem.totalBytes)}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  reason:      ${mem.reason}`,
        zh: `  来源:        ${mem.reason}`,
      }),
    );
  } else if (mem.status === 'external') {
    lines.push(
      getLocalizedText({
        en: `  status:      EXTERNAL (override active)`,
        zh: `  状态:        外部（已配置 override）`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  path:        ${mem.path}`,
        zh: `  路径:        ${mem.path}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  reason:      ${mem.reason}`,
        zh: `  来源:        ${mem.reason}`,
      }),
    );
    lines.push(
      getLocalizedText({
        en: `  /project purge does NOT touch external memory.`,
        zh: `  /project purge 不会触及外部 memory。`,
      }),
    );
  } else {
    lines.push(
      getLocalizedText({
        en: `  status:      absent (no memory/ dir under the active project)`,
        zh: `  状态:        不存在（活动项目下没有 memory/ 目录）`,
      }),
    );
  }
  lines.push('');

  // Purge eligibility.
  lines.push(
    getLocalizedText({
      en:
        'Purge eligibility for the active project: REJECTED (active-project guard).\n' +
        '  To purge a non-active project, run /project list to see candidates,\n' +
        '  then /project purge --target <cwd>.',
      zh:
        '当前活动项目的 purge 资格: 拒绝（active-project 守卫）。\n' +
        '  如需清理非活动项目，可先 /project list 查看候选，\n' +
        '  再执行 /project purge --target <cwd>。',
    }),
  );
  lines.push('');

  // Cache summaries.
  lines.push(
    getLocalizedText({
      en: 'Sibling cache sizes (read-only summary):',
      zh: '兄弟 cache 大小（只读概览）:',
    }),
  );
  for (const c of status.caches) {
    lines.push(formatCache(c));
  }

  return lines.join('\n');
}

export function ProjectStatus({ onComplete }: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const status = await describeActiveProjectStatus();
        if (cancelled) return;
        onComplete(formatStatus(status));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} /project status failed: ${errorMessage(error)}`,
            zh: `${figures.cross} /project status 失败: ${errorMessage(error)}`,
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
          en: 'Computing project status…',
          zh: '正在计算项目状态…',
        })}
      </Text>
    </Box>
  );
}
