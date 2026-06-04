import { mkdir, writeFile } from 'fs/promises';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { isAutoMemoryEnabled } from '../../memdir/paths.js';
import { isTeamMemoryEnabled } from '../../memdir/teamMemPaths.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { join } from 'path';
import type { CommandResultDisplay } from '../../commands.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { MemoryFileSelector } from '../../components/memory/MemoryFileSelector.js';
import { getRelativeMemoryPath } from '../../components/memory/MemoryUpdateNotification.js';
import { getProductAssistantName } from '../../constants/product.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { clearMemoryFileCaches, getMemoryFiles } from '../../utils/mossenmd.js';
import { getMossenConfigHomeDir } from '../../utils/envUtils.js';
import { getErrnoCode } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
import {
  describeMemoryState,
  type MemoryStateSummary,
} from '../../utils/projectInventory.js';
import {
  getProjectsDir,
  sanitizePath,
} from '../../utils/sessionStoragePortable.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
// W56: read-only metadata pane shown above the file selector. Surfaces gate
// state + memory location + on-disk file count + total size. NEVER reads
// memory file contents — only stat / readdir.
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
function formatMemBytes(n: number): string {
  if (n < 0) return getLocalizedText({ en: '(unknown)', zh: '（未知）' });
  let v = n;
  let u = 0;
  while (v >= 1024 && u < SIZE_UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)}${SIZE_UNITS[u]}`;
}
function MemoryMetadataPane(): React.ReactNode {
  const [auto, setAuto] = useState<boolean | null>(null);
  const [team, setTeam] = useState<boolean | null>(null);
  const [memState, setMemState] = useState<MemoryStateSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const a = isAutoMemoryEnabled();
        const t = isTeamMemoryEnabled();
        const projectDir = join(
          getProjectsDir(),
          sanitizePath(getOriginalCwd()),
        );
        const m = await describeMemoryState(projectDir);
        if (cancelled) return;
        setAuto(a);
        setTeam(t);
        setMemState(m);
      } catch (error) {
        if (cancelled) return;
        logError(error);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  if (auto === null || team === null || memState === null) {
    return (
      <Box>
        <Text dimColor>
          {getLocalizedText({
            en: 'memory: loading status…',
            zh: 'memory: 正在加载状态…',
          })}
        </Text>
      </Box>
    );
  }
  const locationLabel =
    memState.status === 'in-project'
      ? getLocalizedText({ en: 'in-project', zh: 'in-project' })
      : memState.status === 'external'
        ? getLocalizedText({
            en: `external (${memState.reason})`,
            zh: `外部（${memState.reason}）`,
          })
        : getLocalizedText({ en: 'absent', zh: '不存在' });
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {getLocalizedText({
          en: `auto: ${auto ? 'on' : 'off'} · team: ${team ? 'on' : 'off'} · location: ${locationLabel} · files: ${memState.fileCount} · size: ${formatMemBytes(memState.totalBytes)}`,
          zh: `auto: ${auto ? '开启' : '关闭'} · team: ${team ? '开启' : '关闭'} · 位置: ${locationLabel} · 文件: ${memState.fileCount} · 大小: ${formatMemBytes(memState.totalBytes)}`,
        })}
      </Text>
      <Text dimColor italic>
        {getLocalizedText({
          en: '(metadata only — file contents are never displayed here)',
          zh: '（仅显示元数据 —— 此处不会展示 memory 文件内容）',
        })}
      </Text>
    </Box>
  );
}
function MemoryCommand({
  onDone
}: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}): React.ReactNode {
  const handleSelectMemoryFile = async (memoryPath: string) => {
    try {
      // Create the Mossen config directory if it doesn't exist (idempotent with recursive)
      if (memoryPath.includes(getMossenConfigHomeDir())) {
        await mkdir(getMossenConfigHomeDir(), {
          recursive: true
        });
      }

      // Create file if it doesn't exist (wx flag fails if file exists,
      // which we catch to preserve existing content)
      try {
        await writeFile(memoryPath, '', {
          encoding: 'utf8',
          flag: 'wx'
        });
      } catch (e: unknown) {
        if (getErrnoCode(e) !== 'EEXIST') {
          throw e;
        }
      }
      await editFileInEditor(memoryPath);

      // Determine which environment variable controls the editor
      let editorSource = 'default';
      let editorValue = '';
      if (process.env.VISUAL) {
        editorSource = '$VISUAL';
        editorValue = process.env.VISUAL;
      } else if (process.env.EDITOR) {
        editorSource = '$EDITOR';
        editorValue = process.env.EDITOR;
      }
      const editorInfo = editorSource !== 'default' ? getLocalizedText({
        zh: `正在使用 ${editorSource}="${editorValue}"。`,
        en: `Using ${editorSource}="${editorValue}".`
      }) : '';
      const editorHint = editorInfo ? getLocalizedText({
        zh: `> ${editorInfo} 如需切换编辑器，请设置 $EDITOR 或 $VISUAL 环境变量。`,
        en: `> ${editorInfo} To change editor, set $EDITOR or $VISUAL environment variable.`
      }) : getLocalizedText({
        zh: '> 如需使用其他编辑器，请设置 $EDITOR 或 $VISUAL 环境变量。',
        en: '> To use a different editor, set the $EDITOR or $VISUAL environment variable.'
      });
      onDone(`${getLocalizedText({
        zh: '已打开记忆文件：',
        en: 'Opened memory file at'
      })} ${getRelativeMemoryPath(memoryPath)}\n\n${editorHint}`, {
        display: 'system'
      });
    } catch (error) {
      logError(error);
      onDone(`${getLocalizedText({
        zh: '打开记忆文件时出错：',
        en: 'Error opening memory file:'
      })} ${error}`);
    }
  };
  const handleCancel = () => {
    onDone(getLocalizedText({
      zh: '已取消编辑记忆文件',
      en: 'Cancelled memory editing'
    }), {
      display: 'system'
    });
  };
  return <Dialog title={getLocalizedText({
    zh: '记忆',
    en: 'Memory'
  })} onCancel={handleCancel} color="remember">
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <MemoryMetadataPane />
        </Box>
        <React.Suspense fallback={null}>
          <MemoryFileSelector onSelect={handleSelectMemoryFile} onCancel={handleCancel} />
        </React.Suspense>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{getLocalizedText({
          zh: `使用记忆文件为 ${getProductAssistantName()} 保存可长期复用的项目指引。`,
          en: `Use memory files to store durable project guidance for ${getProductAssistantName()}.`
        })}</Text>
          {/* W434 — crossref hint so users distinguish /memory (this UI: hand-
              written instruction files) from /memory-sidecar (auto-captured
              memory database). Plain dim text, no extra dependency. */}
          <Text dimColor>{getLocalizedText({
          zh: '如要管理自动捕获的旁路记忆库，请用 /memory-sidecar。',
          en: 'For the auto-captured memory database, use /memory-sidecar.'
        })}</Text>
        </Box>
      </Box>
    </Dialog>;
}

// W110: sidecar subcommands migrated to /memory-sidecar namespace.
// /memory now only serves the legacy MOSSEN.md memory file UI.

export const call: LocalJSXCommandCall = async (onDone, _context, _args) => {
  // W110: detect sidecar-style invocations (`/memory recall …`, `search`,
  // `context`, `query`) and emit a bilingual migration hint pointing users at
  // `/memory-sidecar`. The legacy `/memory` UI only manages MOSSEN.md files.
  if (typeof _args === 'string' && _args.length > 0 && /^(recall|search|context|query)\b/i.test(_args)) {
    onDone(
      getLocalizedText({
        zh: '旁路记忆请用 `/memory-sidecar recall <query>`；旧 `/memory` 用于 MOSSEN.md 记忆文件。',
        en: 'Use `/memory-sidecar recall <query>` for sidecar memory; `/memory` manages MOSSEN.md memory files.',
      }),
      { display: 'system' },
    );
    return null;
  }
  // Clear + prime before rendering — Suspense handles the unprimed case,
  // but awaiting here avoids a fallback flash on initial open.
  clearMemoryFileCaches();
  await getMemoryFiles();
  return <MemoryCommand onDone={onDone} />;
};
