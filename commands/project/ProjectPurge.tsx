import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { plural } from '../../utils/stringUtils.js';
import {
  executeProjectPurgePlan,
  getProjectPurgePlan,
  type ProjectPurgeEntry,
  type ProjectPurgePlan,
  type ProjectPurgeResult,
  PROJECT_PURGE_TOKEN_TTL_MS,
} from '../../utils/projectPurge.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

type Props = {
  onComplete: (result?: string) => void;
  /** Optional --target <cwd>. */
  target?: string;
  /** --include-memory toggle (rejected when memory is external). */
  includeMemory: boolean;
  /** Optional --confirm <token>; absent → dry-run. */
  confirmToken?: string;
  /** Optional unsupported flag from parser; rendered as a localized error. */
  unsupportedFlag?: string;
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

function formatEntry(entry: ProjectPurgeEntry): string {
  const kindLabel =
    entry.kind === 'directory'
      ? getLocalizedText({ en: 'dir ', zh: '目录' })
      : entry.kind === 'file'
        ? getLocalizedText({ en: 'file', zh: '文件' })
        : getLocalizedText({ en: 'misc', zh: '其他' });
  return `  [${kindLabel}] ${entry.name}  ${formatBytes(entry.sizeBytes)}`;
}

function formatDryRun(plan: ProjectPurgePlan): string {
  const ttlMin = Math.floor(PROJECT_PURGE_TOKEN_TTL_MS / 60_000);
  const lines: string[] = [];

  lines.push(
    getLocalizedText({
      en: `${figures.info} Project purge (dry-run preview)`,
      zh: `${figures.info} 项目 purge（dry-run 预览）`,
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: `Target cwd:    ${plan.targetCwd}`,
      zh: `目标 cwd:      ${plan.targetCwd}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Sanitized id:  ${plan.sanitizedTarget}`,
      zh: `Sanitized id:  ${plan.sanitizedTarget}`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Project dir:   ${plan.originalProjectDir}`,
      zh: `项目目录:      ${plan.originalProjectDir}`,
    }),
  );
  lines.push('');

  // Memory section.
  if (plan.memoryStatus === 'external') {
    lines.push(
      getLocalizedText({
        en:
          `${figures.warning} Memory location: EXTERNAL (override active).\n` +
          `  External hint: ${plan.memoryExternalHint ?? '(unknown)'}\n` +
          `  Reason: ${plan.memoryExternalReason ?? '(unknown)'}\n` +
          `  /project purge does not touch external memory; --include-memory is rejected\n` +
          `  in this configuration. Back up / clean external memory manually.`,
        zh:
          `${figures.warning} memory 位置: 外部（已配置 override）\n` +
          `  外部路径提示: ${plan.memoryExternalHint ?? '（未知）'}\n` +
          `  原因: ${plan.memoryExternalReason ?? '（未知）'}\n` +
          `  /project purge 不会越界处理外部 memory；本配置下 --include-memory 会被拒绝。\n` +
          `  外部 memory 请用户自行备份/清理。`,
      }),
    );
  } else if (plan.memoryStatus === 'in-project' && !plan.includeMemory) {
    lines.push(
      getLocalizedText({
        en:
          `${figures.bullet} Memory: PRESERVED (in-project memory/ kept; not archived, not deleted).\n` +
          `  To include memory in the purge, add --include-memory (irreversible).`,
        zh:
          `${figures.bullet} memory: 已保留（项目内 memory/ 不归档、不删除）。\n` +
          `  如需一并清理 memory，请加 --include-memory（不可逆）。`,
      }),
    );
  } else if (plan.memoryStatus === 'in-project' && plan.includeMemory) {
    lines.push(
      getLocalizedText({
        en:
          `${figures.warning} Memory: WILL BE ARCHIVED (--include-memory active).\n` +
          `  This is irreversible without restoring from the backup directory.`,
        zh:
          `${figures.warning} memory: 将被归档（已启用 --include-memory）\n` +
          `  此操作不可逆，仅可从备份目录恢复。`,
      }),
    );
  } else {
    lines.push(
      getLocalizedText({
        en: `${figures.bullet} Memory: ABSENT (no memory/ in this project dir).`,
        zh: `${figures.bullet} memory: 不存在（项目目录内无 memory/）。`,
      }),
    );
  }
  lines.push('');

  // Summary.
  const archiveCount = plan.toArchive.length;
  lines.push(
    getLocalizedText({
      en: `Will archive ${archiveCount} top-level ${plural(archiveCount, 'entry')} (total ${formatBytes(plan.totalArchiveBytes)}). Skipped: ${plan.toSkip.length}.`,
      zh: `将归档 ${archiveCount} 个顶层 entry（共 ${formatBytes(plan.totalArchiveBytes)}）。跳过 ${plan.toSkip.length} 个。`,
    }),
  );
  lines.push('');

  if (archiveCount > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} Will archive on confirm:`,
        zh: `${figures.warning} 确认后将归档：`,
      }),
    );
    for (const e of plan.toArchive) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  if (plan.toSkip.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.bullet} Skipped (preserved):`,
        zh: `${figures.bullet} 跳过（保留）：`,
      }),
    );
    for (const e of plan.toSkip) {
      lines.push(formatEntry(e));
    }
    lines.push('');
  }

  lines.push(
    getLocalizedText({
      en: `Archive destination:\n  ${plan.archiveDir}/`,
      zh: `归档目标:\n  ${plan.archiveDir}/`,
    }),
  );
  lines.push('');

  if (archiveCount === 0) {
    lines.push(
      getLocalizedText({
        en: 'Nothing to archive. No mutation needed.',
        zh: '没有需要归档的内容，无需执行。',
      }),
    );
    return lines.join('\n');
  }

  lines.push(
    getLocalizedText({
      en:
        'NOTE: archive is the only mode — every entry is copied to ~/.mossen/backups/\n' +
        'before deletion. Active project, current cwd, and session-bound projects\n' +
        'are protected by a three-way guard. Memory is preserved by default; use\n' +
        '--include-memory only if you understand the consequences. Backup files\n' +
        'persist under ~/.mossen/backups/ until you remove them manually.',
      zh:
        '提示：仅支持 archive 模式 —— 每个 entry 在删除前都会先 copy 到 ~/.mossen/backups/。\n' +
        '当前活动项目、original cwd、与会话绑定项目均会被三方 active guard 保护。\n' +
        '默认保留 memory；如需一并清理请确认后再使用 --include-memory。\n' +
        '备份文件保存在 ~/.mossen/backups/，需手动清理。',
    }),
  );
  lines.push('');

  lines.push(
    getLocalizedText({
      en: `To execute this plan, run within ${ttlMin} min:`,
      zh: `如要执行此方案，请在 ${ttlMin} 分钟内运行：`,
    }),
  );
  const confirmCmdParts = ['/project purge'];
  if (plan.targetCwd) confirmCmdParts.push(`--target ${plan.targetCwd}`);
  if (plan.includeMemory) confirmCmdParts.push('--include-memory');
  confirmCmdParts.push(`--confirm ${plan.token}`);
  lines.push(`  ${confirmCmdParts.join(' ')}`);

  return lines.join('\n');
}

function formatExecuteResult(result: ProjectPurgeResult): string {
  const lines: string[] = [];
  if (result.phaseAHalted) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} Project purge halted during archive phase`,
        zh: `${figures.warning} 项目 purge 在归档阶段中止`,
      }),
    );
  } else {
    lines.push(
      getLocalizedText({
        en: `${figures.tick} Project purge complete`,
        zh: `${figures.tick} 项目 purge 完成`,
      }),
    );
  }
  lines.push(
    getLocalizedText({
      en:
        `  archived: ${result.archivedEntries.length}\n` +
        `  skipped (preserved): ${result.skippedEntries.length}\n` +
        `  errors: ${result.errors.length}\n` +
        `  total archived bytes: ${result.totalArchivedBytes}\n` +
        `  archive dir: ${result.archiveDir}\n` +
        `  manifest: ${result.manifestPath}\n` +
        `  project dir removed: ${result.projectDirRemoved ? 'yes' : 'no'}`,
      zh:
        `  已归档:           ${result.archivedEntries.length}\n` +
        `  已跳过（保留）:   ${result.skippedEntries.length}\n` +
        `  错误:             ${result.errors.length}\n` +
        `  归档总字节:       ${result.totalArchivedBytes}\n` +
        `  归档目录:         ${result.archiveDir}\n` +
        `  manifest:         ${result.manifestPath}\n` +
        `  项目目录已删除:   ${result.projectDirRemoved ? '是' : '否'}`,
    }),
  );
  if (result.skippedEntries.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Skipped (preserved):',
        zh: '已跳过（保留）：',
      }),
    );
    for (const s of result.skippedEntries) {
      lines.push(`  ${s.name}  (${s.reason})`);
    }
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Errors (per-entry, non-blocking unless phase A):',
        zh: '错误明细（按 entry，非 phase A 失败不阻塞）：',
      }),
    );
    for (const e of result.errors) {
      lines.push(`  [${e.phase}] ${e.name}: ${e.message}`);
    }
  }
  if (result.phaseAHalted) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en:
          'Phase A (archive/copy) halted on first failure — no original entries\n' +
          'were deleted in Phase B. Review the manifest, fix the underlying issue,\n' +
          'and re-run /project purge to retry.',
        zh:
          'Phase A（归档/拷贝）首次失败即中止 —— Phase B 未删除任何原始 entry。\n' +
          '请查看 manifest，修复问题后重新运行 /project purge 再试。',
      }),
    );
  }
  return lines.join('\n');
}

export function ProjectPurge({
  onComplete,
  target,
  includeMemory,
  confirmToken,
  unsupportedFlag,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        if (unsupportedFlag) {
          if (cancelled) return;
          onComplete(
            getLocalizedText({
              en:
                `${figures.cross} Unsupported flag: ${unsupportedFlag}\n` +
                'This flag is intentionally not implemented. /project purge accepts only:\n' +
                '  --target <cwd>\n' +
                '  --include-memory\n' +
                '  --confirm <token>\n' +
                'Re-run with allowed flags only.',
              zh:
                `${figures.cross} 不支持的参数: ${unsupportedFlag}\n` +
                '该参数已被有意拒绝。/project purge 仅接受：\n' +
                '  --target <cwd>\n' +
                '  --include-memory\n' +
                '  --confirm <token>\n' +
                '请使用允许的参数再次运行。',
            }),
          );
          return;
        }

        if (confirmToken) {
          const outcome = await executeProjectPurgePlan({
            token: confirmToken,
            targetCwd: target,
          });
          if (cancelled) return;
          if ('kind' in outcome) {
            switch (outcome.kind) {
              case 'unknown_token':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} Unknown confirm token. Run /project purge first to get a fresh token.`,
                    zh:
                      `${figures.cross} 未知的确认 token。请先运行 /project purge 以生成新的 token。`,
                  }),
                );
                return;
              case 'expired_token':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} Confirm token expired (>${Math.floor(PROJECT_PURGE_TOKEN_TTL_MS / 60_000)} min). Re-run /project purge.`,
                    zh:
                      `${figures.cross} 确认 token 已过期（>${Math.floor(PROJECT_PURGE_TOKEN_TTL_MS / 60_000)} 分钟）。请重新运行 /project purge。`,
                  }),
                );
                return;
              case 'active_project':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} Active-project guard rejected target on confirm.\n` +
                      `  Target: ${outcome.targetCwd}\n` +
                      'You cannot purge the project that is currently active. Switch sessions away from this project first.',
                    zh:
                      `${figures.cross} 在 confirm 阶段被 active project 守卫拒绝。\n` +
                      `  目标: ${outcome.targetCwd}\n` +
                      '不能 purge 当前活动项目。请先切换会话再试。',
                  }),
                );
                return;
              case 'invalid_target':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} --target failed to resolve: ${outcome.targetCwd}\n  Reason: ${outcome.reason}`,
                    zh:
                      `${figures.cross} --target 解析失败: ${outcome.targetCwd}\n  原因: ${outcome.reason}`,
                  }),
                );
                return;
              case 'token_target_mismatch':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} --target does not match the token-bound target.\n  expected: ${outcome.expected}\n  got:      ${outcome.got}\n` +
                      'Re-run /project purge --target <cwd> to obtain a fresh token.',
                    zh:
                      `${figures.cross} --target 与 token 绑定的目标不一致。\n  期望: ${outcome.expected}\n  收到: ${outcome.got}\n` +
                      '请重新运行 /project purge --target <cwd> 以获取新 token。',
                  }),
                );
                return;
              case 'project_dir_missing':
                onComplete(
                  getLocalizedText({
                    en: `${figures.cross} Project dir not found: ${outcome.path}`,
                    zh: `${figures.cross} 项目目录不存在: ${outcome.path}`,
                  }),
                );
                return;
              case 'external_memory_include_rejected':
                onComplete(
                  getLocalizedText({
                    en:
                      `${figures.cross} --include-memory rejected: memory is configured externally\n` +
                      `  hint:   ${outcome.externalHint ?? '(unknown)'}\n` +
                      `  reason: ${outcome.reason ?? '(unknown)'}\n` +
                      'External memory is out of scope for /project purge. Back up / clean it manually.',
                    zh:
                      `${figures.cross} --include-memory 被拒绝：memory 已被配置到外部路径\n` +
                      `  路径提示: ${outcome.externalHint ?? '（未知）'}\n` +
                      `  原因:     ${outcome.reason ?? '（未知）'}\n` +
                      '外部 memory 不在 /project purge 范围内，请用户自行备份/清理。',
                  }),
                );
                return;
              case 'unsupported_flag':
                onComplete(
                  getLocalizedText({
                    en: `${figures.cross} Unsupported flag: ${outcome.flag}`,
                    zh: `${figures.cross} 不支持的参数: ${outcome.flag}`,
                  }),
                );
                return;
            }
          }
          onComplete(formatExecuteResult(outcome));
          return;
        }

        // Dry-run path.
        const plan = await getProjectPurgePlan({
          targetCwd: target,
          includeMemory,
        });
        if (cancelled) return;
        if ('kind' in plan) {
          switch (plan.kind) {
            case 'active_project':
              onComplete(
                getLocalizedText({
                  en:
                    `${figures.cross} Active-project guard: REJECT.\n` +
                    `  Target: ${plan.targetCwd}\n` +
                    `  Sanitized id: ${plan.sanitizedTarget}\n` +
                    'The default target is the active project — you cannot purge it.\n' +
                    'Use /project purge --target <cwd> to specify a non-active project.',
                  zh:
                    `${figures.cross} active project 守卫: 拒绝\n` +
                    `  目标: ${plan.targetCwd}\n` +
                    `  Sanitized id: ${plan.sanitizedTarget}\n` +
                    '默认目标即当前活动项目，无法 purge。\n' +
                    '请使用 /project purge --target <cwd> 指定一个非活动项目。',
                }),
              );
              return;
            case 'invalid_target':
              onComplete(
                getLocalizedText({
                  en: `${figures.cross} --target failed to resolve: ${plan.targetCwd}\n  Reason: ${plan.reason}`,
                  zh: `${figures.cross} --target 解析失败: ${plan.targetCwd}\n  原因: ${plan.reason}`,
                }),
              );
              return;
            case 'project_dir_missing':
              onComplete(
                getLocalizedText({
                  en: `${figures.cross} Project dir not found: ${plan.path}`,
                  zh: `${figures.cross} 项目目录不存在: ${plan.path}`,
                }),
              );
              return;
            case 'external_memory_include_rejected':
              onComplete(
                getLocalizedText({
                  en:
                    `${figures.cross} --include-memory rejected: memory is configured externally\n` +
                    `  hint:   ${plan.externalHint ?? '(unknown)'}\n` +
                    `  reason: ${plan.reason ?? '(unknown)'}\n` +
                    'External memory is out of scope for /project purge. Back up / clean it manually.',
                  zh:
                    `${figures.cross} --include-memory 被拒绝：memory 已被配置到外部路径\n` +
                    `  路径提示: ${plan.externalHint ?? '（未知）'}\n` +
                    `  原因:     ${plan.reason ?? '（未知）'}\n` +
                    '外部 memory 不在 /project purge 范围内，请用户自行备份/清理。',
                }),
              );
              return;
            case 'unknown_token':
            case 'expired_token':
            case 'token_target_mismatch':
            case 'unsupported_flag':
              // These tags are only produced from the confirm path; surface
              // a generic error if the engine somehow returns them on dry-run.
              onComplete(
                getLocalizedText({
                  en: `${figures.cross} Project purge dry-run failed (${plan.kind})`,
                  zh: `${figures.cross} 项目 purge dry-run 失败（${plan.kind}）`,
                }),
              );
              return;
          }
        }
        onComplete(formatDryRun(plan));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Project purge failed: ${errorMessage(error)}`,
            zh: `${figures.cross} 项目 purge 失败: ${errorMessage(error)}`,
          }),
        );
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [onComplete, confirmToken, target, includeMemory, unsupportedFlag]);

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Executing project purge…',
              zh: '正在执行项目 purge…',
            })
          : getLocalizedText({
              en: 'Computing project purge plan…',
              zh: '正在计算项目 purge 方案…',
            })}
      </Text>
    </Box>
  );
}
