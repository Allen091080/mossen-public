import { createHash } from 'node:crypto';
import { useEffect, useRef, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import type { CommandResultDisplay } from '../../commands.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getMossenConfigHomeDir } from '../../utils/envUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import {
  recallForMossen,
  parseRecallForMossenArgs,
  type RecallResult,
} from '../../memory-sidecar/src/retrieval/recallForMossen.js';
import { projectIdFromCwd } from '../../memory-sidecar/src/adapter/payload.js';
import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  setMemorySidecarEnabled,
  getMemorySidecarLlmStatus,
  setMemorySidecarLlmEnabled,
  setMemorySidecarLlmConfig,
  setMemorySidecarLlmLastTest,
} from '../../memory-sidecar/src/config/config.js';
import {
  generateHealthReport,
  type HealthReport,
} from '../../memory-sidecar/src/management/healthReport.js';
import {
  generateExplainCaptureReport,
  type ExplainCaptureReport,
} from '../../memory-sidecar/src/management/explainCapture.js';
import {
  generateRecallTestReport,
  type RecallTestReport,
} from '../../memory-sidecar/src/management/recallTest.js';
import {
  generateDataIntegrityReport,
  type DataIntegrityReport,
} from '../../memory-sidecar/src/management/dataIntegrityReport.js';
import {
  generateWorkerReport,
  type WorkerReport,
} from '../../memory-sidecar/src/management/workerReport.js';
import {
  generateRunOnceReport,
  type RunOnceReport,
} from '../../memory-sidecar/src/management/runOnceReport.js';
import {
  generateMemoryStorageGovernanceReport,
  generateMemoryStorageGovernancePlan,
  type MemoryStorageGovernanceReport,
  type MemoryStorageGovernancePlan,
} from '../../memory-sidecar/src/management/storageGovernanceReport.js';
import {
  createMemoryStorageGovernanceApplyDryRun,
  executeMemoryStorageGovernanceApply,
  type GovernanceApplyDryRun,
  type GovernanceApplyExecution,
  type GovernanceApplyScope,
} from '../../memory-sidecar/src/management/storageGovernanceApply.js';
import {
  generateArchiveCompressionShadowReport,
  type ArchiveCompressionShadowReport,
} from '../../memory-sidecar/src/management/archiveCompressionShadowReport.js';
import {
  createArchiveCompressionApplyDryRun,
  executeArchiveCompressionApplyConfirm,
  type ArchiveCompressionApplyDryRun,
  type ArchiveCompressionApplyConfirm,
} from '../../memory-sidecar/src/management/archiveCompressionApplyGate.js';
import {
  createArchiveCompressionWriteDryRun,
  executeArchiveCompressionWriteConfirm,
  type ArchiveCompressionWriteDryRun,
  type ArchiveCompressionWriteConfirm,
} from '../../memory-sidecar/src/management/archiveCompressionWriter.js';
import {
  createAgentResultMemoryHandoff,
} from '../../memory-sidecar/src/management/agentResultHandoff.js';
import {
  createMemoryRetentionDryRun,
  confirmMemoryRetention,
  type MemoryRetentionConfirm,
  type MemoryRetentionDryRun,
} from '../../memory-sidecar/src/management/retentionPolicy.js';
import {
  getMemorySidecarRepairPlan,
  executeMemorySidecarRepairPlan,
  type RepairPlan,
  type RepairExecution,
} from '../../memory-sidecar/src/management/repairPlan.js';
import {
  confirmCleanup,
  createMaintenanceStatusReport,
  createCleanupDryRun,
  exportMemorySidecarData,
  type CleanupConfirmResult,
  type CleanupDryRunResult,
  type CleanupScope,
  type ExportMemorySidecarResult,
  type MaintenancePaths,
  type MaintenanceStatusReport,
} from '../../memory-sidecar/src/storage/maintenance.js';
import {
  getProjectMemoryDir,
} from '../../memory-sidecar/src/index.js';
import {
  listObservations,
  readObservation,
  recentObservations,
  suppressObservation,
} from '../../memory-sidecar/src/storage/observationStore.js';
import {
  listProfileSnapshots,
  recentProfileSnapshots,
} from '../../memory-sidecar/src/storage/profileStore.js';
import {
  listProposals,
  recentProposals,
  reviewProposal,
} from '../../memory-sidecar/src/storage/proposalStore.js';
import type {
  Observation,
  ObservationType,
} from '../../memory-sidecar/src/schema/observation.js';
import type {
  ProposalStatus,
} from '../../memory-sidecar/src/schema/proposal.js';
import type {
  MemoryScope,
} from '../../memory-sidecar/src/schema/scope.js';
import {
  runMemorySidecarLlmTest,
  type LlmTestResult,
} from '../../memory-sidecar/src/llm/llmTest.js';
import {
  readAgentSupervisorResultPayload,
} from '../../services/agentSupervisor/resultPayload.js';

// ---------------------------------------------------------------------------
// Panels (moved from commands/memory/memory.tsx W104/W101/W109)
// ---------------------------------------------------------------------------

// W146.1: safe wrapper around loadMemorySidecarConfig. Without an enclosing
// React error boundary, a render-time throw from a corrupt config tears down
// the entire panel surface; every panel that needs sidecar config must go
// through this helper inside useEffect rather than calling load at the
// component body. Path-shaped substrings are redacted before they reach the
// panel UI so error output never echoes absolute HOME paths.
type LoadConfigResult =
  | { ok: true; config: ReturnType<typeof loadMemorySidecarConfig> }
  | { ok: false; safeMessage: string };

function loadConfigSafe(): LoadConfigResult {
  try {
    return {
      ok: true,
      config: loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath()),
    };
  } catch (e) {
    return { ok: false, safeMessage: redactConfigLoadError(e) };
  }
}

function redactConfigLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const home = process.env.HOME ?? '';
  let safe = home && home.length > 1 ? raw.split(home).join('~') : raw;
  safe = safe.replace(/\/Users\/[^/\s]+/g, '~');
  safe = safe.replace(/\/home\/[^/\s]+/g, '~');
  return safe;
}

function configReadFailureText(safeMessage: string): string {
  return getLocalizedText({
    zh: `配置读取失败: ${safeMessage}`,
    en: `config read failed: ${safeMessage}`,
  });
}

// W110: /memory-sidecar status
// W122-A: production-readiness status — drives generateHealthReport and
// renders 30+ fields plus warnings + recommendedActions. Read-only.
function SidecarStatusPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const configPath = getDefaultMemorySidecarConfigPath();
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = loadMemorySidecarConfig(configPath);
        // W122-B: status surfaces integrity findings alongside healthReport.
        // Both helpers are read-only; we never trigger repair or worker
        // from /memory-sidecar status.
        const [report, integrity] = await Promise.all([
          generateHealthReport({ rootDir: config.homeDir, projectId }),
          generateDataIntegrityReport({ rootDir: config.homeDir, projectId }).catch(
            () => null,
          ),
        ]);
        if (cancelled) return;
        const base = formatHealthStatus(report, configPath);
        setOutput(integrity ? `${base}\n\n${formatDataIntegritySummary(integrity)}` : base);
      } catch {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `无法加载旁路记忆配置: ${configPath}`,
            en: `Cannot load sidecar config: ${configPath}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configPath, projectId]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W122-B: compact integrity findings block — totals + non-ok lines only.
// Output is read-only; no action triggers.
function formatDataIntegritySummary(r: DataIntegrityReport): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `数据完整性: ${r.totals.findingsOk}/${r.totals.findingsTotal} ok, ${r.totals.findingsWarn} warn, ${r.totals.findingsFail} fail`,
    en: `data integrity: ${r.totals.findingsOk}/${r.totals.findingsTotal} ok, ${r.totals.findingsWarn} warn, ${r.totals.findingsFail} fail`,
  }));
  const nonOk = r.findings.filter(f => f.status !== 'ok');
  if (nonOk.length === 0) {
    lines.push(getLocalizedText({
      zh: '  (全部正常)',
      en: '  (all probes ok)',
    }));
    return lines.join('\n');
  }
  for (const f of nonOk) {
    lines.push(`  [${f.status}] ${f.id} (count=${f.count}): ${f.summary}`);
    if (f.detail) lines.push(`      ${f.detail}`);
  }
  return lines.join('\n');
}

function createMaintenancePaths(): MaintenancePaths {
  const home = getMossenConfigHomeDir();
  const root = `${home}/memory-sidecar`;
  const projectId = projectIdFromCwd(getOriginalCwd());
  const memoryDir = getProjectMemoryDir({ rootDir: root, projectId });
  return {
    home,
    root,
    configPath: getDefaultMemorySidecarConfigPath(),
    projectId,
    memoryDir,
    sqlitePath: `${memoryDir}/memory.db`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function formatStorageStatus(report: MaintenanceStatusReport): string {
  const totalBytes = report.files.reduce((sum, item) => sum + item.bytes, 0);
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: '旁路记忆 storage 状态',
    en: 'Memory sidecar storage status',
  }));
  lines.push(`projectId: ${report.projectId}`);
  lines.push(`memoryDir: ${report.memoryDir}`);
  lines.push(`sqlitePath: ${report.sqlitePath}`);
  lines.push(`totalTrackedBytes: ${formatBytes(totalBytes)}`);
  lines.push('');
  lines.push(`archive.events: ${report.archive.stats.archiveEventCount}`);
  lines.push(`archive.sessions: ${report.archive.stats.sessionFileCount}`);
  lines.push(`archive.badLines: ${report.archive.stats.badLineCount}`);
  if (report.archive.stats.lastEventAt) {
    lines.push(`archive.lastEventAt: ${report.archive.stats.lastEventAt}`);
  }
  lines.push('');
  lines.push(getLocalizedText({ zh: '文件:', en: 'files:' }));
  for (const file of report.files) {
    lines.push(`  ${file.label}: ${file.exists ? formatBytes(file.bytes) : 'missing'} (${file.path})`);
  }
  lines.push('');
  lines.push(getLocalizedText({ zh: '可清理候选 (dead-letter/jobs):', en: 'cleanup candidates (dead-letter/jobs):' }));
  for (const candidate of report.cleanupCandidates) {
    lines.push(`  ${candidate.scope}: ${candidate.exists ? formatBytes(candidate.bytes) : 'missing'}, records=${candidate.records}`);
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: '归档说明: archive JSONL 是长期源数据；memory.db 是可重建索引；export 只复制数据，不删除原始记忆。',
    en: 'Archive note: archive JSONL is the long-lived source of truth; memory.db is a rebuildable index; export copies data and does not delete memories.',
  }));
  lines.push(getLocalizedText({
    zh: '推荐: 数据增长后先运行 /memory-sidecar storage export --out-dir <外部目录> 做备份，再考虑 CLI cleanup dead-letter/jobs。',
    en: 'Recommended: when data grows, run /memory-sidecar storage export --out-dir <external-dir> first, then consider CLI cleanup for dead-letter/jobs.',
  }));
  return lines.join('\n');
}

function formatStorageExport(result: ExportMemorySidecarResult): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: '旁路记忆 export 完成',
    en: 'Memory sidecar export complete',
  }));
  lines.push(`outDir: ${result.outDir}`);
  lines.push(`manifest: ${result.manifestPath}`);
  lines.push('');
  lines.push(getLocalizedText({ zh: '已复制:', en: 'copied:' }));
  for (const item of result.copied) {
    lines.push(`  ${item.label}: ${formatBytes(item.bytes)} -> ${item.destination}`);
  }
  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '跳过:', en: 'skipped:' }));
    for (const item of result.skipped) {
      lines.push(`  ${item.label}: ${item.reason} (${item.source})`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: '注意: export 不删除原始 archive/observations/profiles/proposals；这是转移/备份，不是压缩清理。',
    en: 'Note: export does not delete original archive/observations/profiles/proposals; this is transfer/backup, not compaction cleanup.',
  }));
  return lines.join('\n');
}

function formatStorageCleanupDryRun(result: CleanupDryRunResult): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `storage cleanup dry-run (token=${result.token})`,
    en: `storage cleanup dry-run (token=${result.token})`,
  }));
  lines.push(`projectId: ${result.projectId}`);
  lines.push(`scope: ${result.scope}`);
  lines.push(`expiresAt: ${result.expiresAt}`);
  lines.push(`planPath: ${result.planPath}`);
  lines.push('');
  if (result.targets.length === 0) {
    lines.push(getLocalizedText({
      zh: '没有可清理的 dead-letter/jobs 运行噪声。',
      en: 'No dead-letter/jobs runtime noise to clean up.',
    }));
  } else {
    lines.push(getLocalizedText({ zh: '将删除的候选:', en: 'targets to delete:' }));
    for (const target of result.targets) {
      lines.push(`  ${target.scope}: ${formatBytes(target.bytes)}, records=${target.records}`);
      lines.push(`    ${target.path}`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: `确认执行: /memory-sidecar storage cleanup --confirm ${result.token}`,
    en: `To execute: /memory-sidecar storage cleanup --confirm ${result.token}`,
  }));
  lines.push(getLocalizedText({
    zh: '安全边界: cleanup 只清理 dead-letter/jobs，不删除 archive/observations/profiles/proposals 原始记忆。',
    en: 'Safety boundary: cleanup only removes dead-letter/jobs, never archive/observations/profiles/proposals memories.',
  }));
  return lines.join('\n');
}

function formatStorageCleanupConfirm(result: CleanupConfirmResult): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: 'storage cleanup 已执行',
    en: 'storage cleanup complete',
  }));
  lines.push(`projectId: ${result.projectId}`);
  lines.push(`scope: ${result.scope}`);
  lines.push('');
  if (result.deleted.length === 0) {
    lines.push(getLocalizedText({
      zh: '没有删除任何文件。',
      en: 'No files were deleted.',
    }));
  } else {
    lines.push(getLocalizedText({ zh: '已删除:', en: 'deleted:' }));
    for (const item of result.deleted) {
      lines.push(`  ${item.scope}: ${formatBytes(item.bytes)}, records=${item.records}`);
      lines.push(`    ${item.path}`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: 'archive/observations/profiles/proposals 原始记忆未被 cleanup 触碰。',
    en: 'archive/observations/profiles/proposals memories were not touched by cleanup.',
  }));
  return lines.join('\n');
}

function formatMemoryRetentionDryRun(result: MemoryRetentionDryRun): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `retention dry-run (token=${result.token})`,
    en: `retention dry-run (token=${result.token})`,
  }));
  lines.push(`projectId: ${result.projectId}`);
  lines.push(`root: ${result.root}`);
  lines.push('');
  lines.push(getLocalizedText({ zh: '可安全清理:', en: 'safe cleanup targets:' }));
  for (const target of result.targets) {
    lines.push(`  ${target.id}: ${target.exists ? formatBytes(target.bytes) : 'missing'}, records=${target.records}`);
    lines.push(`    ${target.path}`);
  }
  lines.push('');
  lines.push(getLocalizedText({ zh: '明确阻止:', en: 'blocked targets:' }));
  for (const blocked of result.blocked) {
    lines.push(`  ${blocked.id}: ${blocked.reason}`);
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: `确认执行: /memory-sidecar retention --confirm ${result.token}`,
    en: `To execute: /memory-sidecar retention --confirm ${result.token}`,
  }));
  lines.push(getLocalizedText({
    zh: '安全边界: retention 只删除 dead-letter/jobs 运行噪声；archive/observations/profiles/proposals 不会被触碰。',
    en: 'Safety boundary: retention only deletes dead-letter/jobs runtime noise; archive/observations/profiles/proposals are untouched.',
  }));
  return lines.join('\n');
}

function formatMemoryRetentionConfirm(result: MemoryRetentionConfirm): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: 'retention cleanup 已执行',
    en: 'retention cleanup complete',
  }));
  lines.push(`projectId: ${result.projectId}`);
  lines.push(`token: ${result.token}`);
  lines.push('');
  if (result.deleted.length === 0) {
    lines.push(getLocalizedText({ zh: '没有删除任何文件。', en: 'No files were deleted.' }));
  } else {
    lines.push(getLocalizedText({ zh: '已删除:', en: 'deleted:' }));
    for (const item of result.deleted) {
      lines.push(`  ${item.id}: ${formatBytes(item.bytes)}, records=${item.records}`);
      lines.push(`    ${item.path}`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: 'archive/observations/profiles/proposals 未被 retention cleanup 触碰。',
    en: 'archive/observations/profiles/proposals were not touched by retention cleanup.',
  }));
  return lines.join('\n');
}

function SidecarRetentionPanel({ onDone, confirmToken }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  confirmToken?: string;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const paths = createMaintenancePaths();
    const op = confirmToken
      ? confirmMemoryRetention(paths, confirmToken).then(formatMemoryRetentionConfirm)
      : createMemoryRetentionDryRun(paths).then(formatMemoryRetentionDryRun);
    op.then(setResult).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [confirmToken]);

  if (didCallOnDoneRef.current) return null;
  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error, { display: 'system' });
    return null;
  }
  if (!result) return null;

  didCallOnDoneRef.current = true;
  onDone(result, { display: 'system' });
  return null;
}

function parseCleanupScope(rest: string): CleanupScope {
  const first = rest.split(/\s+/).filter(Boolean).find(part => !part.startsWith('--'));
  if (first === 'dead-letter' || first === 'jobs' || first === 'all') return first;
  return 'all';
}

function parseGovernanceApplyScope(rest: string): GovernanceApplyScope | undefined {
  const first = rest.split(/\s+/).filter(Boolean).find(part => !part.startsWith('--'));
  if (
    first === 'profile-prune-redundant' ||
    first === 'proposal-prune-stale-candidates' ||
    first === 'sqlite-rebuild-index' ||
    first === 'archive-export-project-bundle' ||
    first === 'all'
  ) {
    return first;
  }
  return undefined;
}

// W149-A: identify a deferred governance action id so the dispatcher
// can return a wave-aware error message instead of the generic "scope
// must be …". Mirrors GovernanceApplyCapability in
// memory-sidecar/src/management/storageGovernanceReport.ts.
function deferredGovernanceActionInfo(rest: string): {
  id: string;
  wave: string;
} | undefined {
  const first = rest
    .split(/\s+/)
    .filter(Boolean)
    .find(part => !part.startsWith('--'));
  if (!first) return undefined;
  const matrix: Record<string, string> = {
    // W149-B promoted sqlite-rebuild-index to executable; W149-C
    // promoted archive-export-project-bundle. Only the compression
    // action remains gated.
    'archive-compress-old-sessions': 'W149-D (gated on the archive-compression recoverability design)',
  };
  const wave = matrix[first];
  return wave ? { id: first, wave } : undefined;
}

function parseFlagValue(rest: string, flag: string): string | undefined {
  const parts = rest.split(/\s+/).filter(Boolean);
  const idx = parts.indexOf(flag);
  if (idx < 0) return undefined;
  const value = parts[idx + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function SidecarStorageStatusPanel({ onDone }: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}) {
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = createMaintenancePaths();
        const config = loadMemorySidecarConfig(paths.configPath);
        const report = await createMaintenanceStatusReport(paths, config);
        if (!cancelled) setOutput(formatStorageStatus(report));
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `storage status 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `storage status failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function SidecarStorageExportPanel({ onDone, outDir }: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  outDir: string;
}) {
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = createMaintenancePaths();
        const config = loadMemorySidecarConfig(paths.configPath);
        const result = await exportMemorySidecarData({ paths, config, outDir });
        if (!cancelled) setOutput(formatStorageExport(result));
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `storage export 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `storage export failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outDir]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function SidecarStorageCleanupPanel({ onDone, scope, token }: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  scope?: CleanupScope;
  token?: string;
}) {
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = createMaintenancePaths();
        const result = token
          ? await confirmCleanup(paths, token)
          : await createCleanupDryRun(paths, scope ?? 'all');
        const formatted = token
          ? formatStorageCleanupConfirm(result as CleanupConfirmResult)
          : formatStorageCleanupDryRun(result as CleanupDryRunResult);
        if (!cancelled) setOutput(formatted);
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `storage cleanup 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `storage cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, token]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatHealthStatus(report: HealthReport, configPath: string): string {
  const lines: string[] = [];
  const cfg = report.config;
  const sidecarLabel = getLocalizedText({
    zh: `旁路记忆状态: ${cfg.sidecarEnabled ? '已启用' : '未启用'}`,
    en: `Sidecar memory: ${cfg.sidecarEnabled ? 'enabled' : 'disabled'}`,
  });
  lines.push(sidecarLabel);
  lines.push(getLocalizedText({
    zh: `健康分: ${report.healthScore}/100 (${report.grade})`,
    en: `healthScore: ${report.healthScore}/100 (${report.grade})`,
  }));
  lines.push(`config: ${configPath}`);
  lines.push(`memoryDir: ${report.paths.memoryDir}`);
  lines.push(`sqlitePath: ${report.paths.sqlitePath}`);

  // alias chain
  lines.push(`requestedProjectId: ${report.alias.requestedProjectId}`);
  if (report.alias.resolvedProjectId !== report.alias.requestedProjectId) {
    lines.push(`resolvedProjectId: ${report.alias.resolvedProjectId}`);
  }
  lines.push(`searchedProjectIds: ${report.alias.searchedProjectIds.join(', ')}`);
  if (report.alias.aliasReason) {
    lines.push(`aliasReason: ${report.alias.aliasReason}`);
  }

  // capture / adapter / rule / llm
  lines.push(getLocalizedText({
    zh: `capture: ${cfg.captureEnabled ? '已启用' : '未启用'}`,
    en: `capture: ${cfg.captureEnabled ? 'enabled' : 'disabled'}`,
  }));
  lines.push(`adapter: ${cfg.adapterEnabled ? 'enabled' : 'disabled'}`);
  lines.push(`ruleClassifier: ${cfg.ruleClassifierEnabled ? 'enabled' : 'disabled'}`);
  lines.push(getLocalizedText({
    zh: `LLM 智能整理: ${cfg.llmEnabled ? '已启用' : '未启用'}`,
    en: `LLM classification: ${cfg.llmEnabled ? 'enabled' : 'disabled'}`,
  }));
  lines.push(`llmProvider: ${cfg.llmProviderKind}`);
  lines.push(`llmHasIndependentConfig: ${cfg.llmHasIndependentConfig ? 'yes' : 'no'}`);
  if (cfg.llmApiKeyEnv) {
    lines.push(`apiKeyEnv: ${cfg.llmApiKeyEnv}`);
    lines.push(`apiKey configured: ${cfg.llmApiKeyConfigured ? 'yes' : 'no'}`);
  }

  // archive
  lines.push(`archive events: ${report.archive.events}`);
  lines.push(`archive sessions: ${report.archive.sessions}`);
  if (report.archive.lastEventAt) {
    lines.push(`latestEventAt: ${report.archive.lastEventAt}`);
  }

  // dirty / reconcile
  lines.push(`dirty: ${report.dirty.unconsumed} unconsumed / ${report.dirty.consumed} consumed / ${report.dirty.total} total`);
  lines.push(`reconcile: scanWindow=${report.reconcile.scanWindow} scanned=${report.reconcile.scannedEvents} missing=${report.reconcile.missing}`);

  // worker
  const w = report.worker;
  lines.push(`worker.lock: held=${w.lockHeld} stale=${w.lockStale}` + (w.staleReason ? ` staleReason=${w.staleReason}` : ''));
  if (w.lockHeld) {
    if (w.pid !== null) lines.push(`worker.lock.pid: ${w.pid}`);
    if (w.hostname) lines.push(`worker.lock.hostname: ${w.hostname}`);
    if (w.heartbeatAt) lines.push(`worker.lock.heartbeatAt: ${w.heartbeatAt}`);
    if (w.sameHost !== null) lines.push(`worker.lock.sameHost: ${w.sameHost}`);
    if (w.pidAlive !== null) lines.push(`worker.lock.pidAlive: ${w.pidAlive}`);
  }
  lines.push(`worker.jobs: total=${w.jobs.total} pending=${w.jobs.pending} completed=${w.jobs.completed} failed=${w.jobs.failed} skipped=${w.jobs.skipped}`);
  // W144: surface the derived runnable-work signal so the operator
  // does not have to mentally OR pending/running/failed/retry/
  // exhausted/reconcile.missing to answer "do I need to run worker
  // again?". When the answer is no but dirty.unconsumed > 0, an
  // explicit note explains that markers are retained for audit — that
  // is the case that misled operators on the W144 reproduction host.
  if (typeof w.effectivePendingWork === 'boolean') {
    lines.push(`worker.runnableWork: ${w.effectivePendingWork ? 'yes' : 'no'}`);
    if (!w.effectivePendingWork && report.dirty.unconsumed > 0) {
      lines.push(`worker.note: dirty markers retained (${report.dirty.unconsumed} unconsumed), but no pending/failed/retry jobs require action`);
    }
  }
  // W143-D2: per-type / per-status matrix when populated.
  // Skips emitting empty rows so the panel stays compact for sessions
  // where only a couple of job types fired.
  if (w.jobs.countsByTypeStatus) {
    const typeStatusLines: string[] = [];
    const sortedTypes = Object.keys(w.jobs.countsByTypeStatus).sort();
    for (const t of sortedTypes) {
      const row = w.jobs.countsByTypeStatus[t] ?? {};
      const total = Object.values(row).reduce((sum: number, n) => sum + (typeof n === 'number' ? n : 0), 0);
      if (total === 0) continue;
      const parts = ['completed', 'skipped', 'failed', 'pending', 'running']
        .map(s => `${s}=${row[s] ?? 0}`).join(' ');
      typeStatusLines.push(`  ${t}: ${parts}`);
    }
    if (typeStatusLines.length > 0) {
      lines.push('worker.jobs.byType:');
      lines.push(...typeStatusLines);
    }
  }
  lines.push(`worker.retries: failed=${w.retries.activeFailedJobs} retrying=${w.retries.retryJobs} exhausted=${w.retries.exhaustedJobs}`);

  // observations / profile / proposals
  lines.push(`observations: ${report.observations.total}`);
  lines.push(`profile snapshots: ${report.profile.snapshots}` + (report.profile.latestAt ? ` (latest=${report.profile.latestAt})` : ''));
  const p = report.proposals;
  lines.push(`proposals: total=${p.total} candidate=${p.candidate} accepted=${p.accepted} rejected=${p.rejected} deferred=${p.deferred}`);

  // index
  lines.push(`sqlite index present: ${report.index.sqlitePresent ? 'yes' : 'no'}`);

  // retrieval probe summary
  lines.push(`retrievalProbe: query="${report.retrievalProbe.query}" results=${report.retrievalProbe.results} filtered=${report.retrievalProbe.filteredControlPlaneCount} ~${report.retrievalProbe.estimatedTokens} tokens`);

  // warnings / recommendedActions
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const warn of report.warnings) lines.push(`  - ${warn}`);
  }
  if (report.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const action of report.recommendedActions) lines.push(`  ${action}`);
  }
  return lines.join('\n');
}

// W104: /memory-sidecar enable
function SidecarEnablePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const configPath = getDefaultMemorySidecarConfigPath();

  let config;
  try {
    config = loadMemorySidecarConfig(configPath);
  } catch {
    onDone(getLocalizedText({
      zh: `无法加载旁路记忆配置: ${configPath}`,
      en: `Cannot load sidecar config: ${configPath}`,
    }));
    return null;
  }

  // W107.1: Self-heal — detect repair vs fresh enable
  const allNestedEnabled = config.adapter.enabled && config.capture.enabled;
  const fullyAligned = config.enabled && allNestedEnabled;
  const needsRepair = config.enabled && !allNestedEnabled;

  if (fullyAligned) {
    onDone(getLocalizedText({
      zh: '旁路记忆已经启用。',
      en: 'Sidecar memory is already enabled.',
    }), { display: 'system' });
    return null;
  }

  try {
    setMemorySidecarEnabled(true, configPath);
    const msg = needsRepair
      ? getLocalizedText({
          zh: `旁路记忆已启用，并已修复自动采集配置。\n\n下一步: 运行 /memory-sidecar status 确认状态。`,
          en: `Sidecar memory enabled and auto-capture config repaired.\n\nNext: run /memory-sidecar status to confirm.`,
        })
      : getLocalizedText({
          zh: `旁路记忆已启用。Config written to: ${configPath}\n\nNext: ask natural history questions and the model will call MemoryContext when relevant, or run /memory-sidecar status to check.`,
          en: `Sidecar memory enabled. Config written to: ${configPath}\n\nNext: ask natural history questions and the model will call MemoryContext when relevant, or run /memory-sidecar status to check.`,
        });
    onDone(msg, { display: 'system' });
  } catch (e) {
    onDone(getLocalizedText({
      zh: `启用旁路记忆失败: ${e instanceof Error ? e.message : String(e)}`,
      en: `Failed to enable sidecar memory: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
  return null;
}

// W104: /memory-sidecar disable
function SidecarDisablePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const configPath = getDefaultMemorySidecarConfigPath();

  try {
    const config = setMemorySidecarEnabled(false, configPath);
    const msg = !config.enabled
      ? getLocalizedText({
          zh: `旁路记忆已关闭。已有数据保留在 ${configPath.replace('/config.json', '')}。`,
          en: `Sidecar memory disabled. Existing data preserved at ${configPath.replace('/config.json', '')}.`,
        })
      : getLocalizedText({
          zh: `旁路记忆未能关闭。请检查配置: ${configPath}`,
          en: `Sidecar memory could not be disabled. Check config: ${configPath}`,
        });
    onDone(msg, { display: 'system' });
  } catch (e) {
    onDone(getLocalizedText({
      zh: `关闭旁路记忆失败: ${e instanceof Error ? e.message : String(e)}`,
      en: `Failed to disable sidecar memory: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
  return null;
}

// W101: /memory-sidecar recall
function SidecarRecallPanel({ onDone, args }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  args: string;
}) {
  const [result, setResult] = useState<RecallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const parsedArgs = parseRecallForMossenArgs(args);
    if (!parsedArgs.query) {
      setError(getLocalizedText({
        zh: '用法: /memory-sidecar recall <query>',
        en: 'Usage: /memory-sidecar recall <query>',
      }));
      return;
    }

    const cwd = getOriginalCwd();
    const projectId = projectIdFromCwd(cwd);
    const home = getMossenConfigHomeDir();

    recallForMossen({
      rootDir: `${home}/memory-sidecar`,
      projectId,
      query: parsedArgs.query,
      limit: parsedArgs.limit,
      maxTokens: parsedArgs.maxTokens,
      // W143-C/W310: --debug and --explain both need per-layer counts.
      // --debug renders raw counters; --explain renders a friendly summary.
      debug: parsedArgs.debug || parsedArgs.explain,
    }).then(r => {
      const merged = {
        ...r,
        warnings: [...parsedArgs.warnings, ...r.warnings],
      };
      setResult(merged);
      return merged;
    }).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [args]);

  // Guard: only call onDone once, and only from result/error/empty paths
  if (didCallOnDoneRef.current) {
    return null;
  }

  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error);
    return null;
  }

  // Empty query error — not a loading state
  if (args.trim() === '') {
    didCallOnDoneRef.current = true;
    onDone(getLocalizedText({
      zh: '用法: /memory-sidecar recall <query>',
      en: 'Usage: /memory-sidecar recall <query>',
    }));
    return null;
  }

  if (!result) {
    // Still loading — do NOT call onDone here; let async resolve it
    return null;
  }

  const lines: string[] = [];
  const parsedForRender = parseRecallForMossenArgs(args);
  // W120 M10: every user-visible string in recall output goes through
  // getLocalizedText so /memory-sidecar recall stops being zh-only.
  const queryLabel = getLocalizedText({ zh: '查询', en: 'Query' });
  lines.push(`${queryLabel}: ${result.query}`);

  if (result.resolvedProjectId) {
    lines.push(`resolvedProjectId: ${result.resolvedProjectId}`);
  }
  if (result.requestedProjectId) {
    lines.push(`requestedProjectId: ${result.requestedProjectId}`);
  }
  if (result.searchedProjectIds) {
    lines.push(`searchedProjectIds: ${result.searchedProjectIds.join(', ')}`);
  }

  lines.push(`limit=${result.limit} maxTokens=${result.maxTokens}`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) lines.push(`⚠ ${w}`);
  }
  lines.push(getLocalizedText({
    zh: `${result.totalResults} 条结果 (~${result.estimatedTokens} tokens)`,
    en: `${result.totalResults} result(s) (~${result.estimatedTokens} tokens)`,
  }));

  if (parsedForRender.explain) {
    const explanationTitle = getLocalizedText({ zh: '召回解释', en: 'Recall explanation' });
    const sourceLayerLabel = getLocalizedText({ zh: '来源层', en: 'source layers' });
    const scopeLabelForExplain = getLocalizedText({ zh: '检索范围', en: 'search scope' });
    const filteredLabel = getLocalizedText({ zh: '过滤', en: 'filtered' });
    const budgetLabel = getLocalizedText({ zh: '预算', en: 'budget' });
    const layers = result.debug
      ? [
          `observations=${result.debug.observationHits}`,
          `profile=${result.debug.profileHits}`,
          `archive=${result.debug.archiveHits}`,
          `sqlite=${result.debug.archiveSqliteHits}`,
          `jsonl=${result.debug.archiveJsonlFallbackHits}`,
        ].join(' ')
      : getLocalizedText({ zh: '未请求 debug 计数', en: 'debug counts unavailable' });
    lines.push('');
    lines.push(`── ${explanationTitle} ─────────────────`);
    lines.push(`${sourceLayerLabel}: ${layers}`);
    lines.push(`${scopeLabelForExplain}: ${(result.searchedProjectIds ?? []).join(', ') || result.resolvedProjectId || result.requestedProjectId || 'n/a'}`);
    lines.push(`${filteredLabel}: control-plane=${result.filteredControlPlaneCount}`);
    lines.push(`${budgetLabel}: ${result.estimatedTokens}/${result.maxTokens} tokens`);
  }

  const scoreLabel = getLocalizedText({ zh: '相关度', en: 'score' });
  const scopeLabel = getLocalizedText({ zh: '范围', en: 'scope' });
  const tokenWord = getLocalizedText({ zh: 'tokens', en: 'tokens' });
  const evidenceLabel = getLocalizedText({ zh: '证据', en: 'evidence' });
  const whyLabel = getLocalizedText({ zh: '原因', en: 'why' });
  for (const item of result.items) {
    lines.push(`  [${item.source}] ${item.title}`);
    lines.push(`    ${scoreLabel}=${item.score} ${scopeLabel}=${item.scope} ~${item.tokenEstimate}${tokenWord}`);
    if (parsedForRender.explain) {
      lines.push(`    ${whyLabel}: source=${item.source}; score=${item.score}; scope=${item.scope}; budget=${item.tokenEstimate}/${result.maxTokens} tokens`);
    }
    if (item.summary) lines.push(`    ${item.summary}`);
    if (item.evidenceIds.length > 0) lines.push(`    ${evidenceLabel}: ${item.evidenceIds.join(', ')}`);
  }

  // W143-C: when --debug is requested, append a structured diagnostic
  // block so the operator can see which retrieval layer the query hit
  // and which layer was empty. Off by default — does not pollute normal
  // recall output.
  if (result.debug) {
    const d = result.debug;
    lines.push('');
    lines.push(getLocalizedText({
      zh: '── debug ─────────────────',
      en: '── debug ─────────────────',
    }));
    lines.push(`query: ${d.query}`);
    lines.push(`normalized.fullQuery: ${d.normalizedFullQuery}`);
    lines.push(`normalized.terms: [${d.normalizedTerms.join(', ')}]`);
    lines.push(`normalized.strongTerms: [${d.normalizedStrongTerms.join(', ')}]`);
    if (d.requestedProjectId) lines.push(`requestedProjectId: ${d.requestedProjectId}`);
    if (d.resolvedProjectId) lines.push(`resolvedProjectId: ${d.resolvedProjectId}`);
    lines.push(`searchedProjectIds: [${d.searchedProjectIds.join(', ')}]`);
    lines.push(`observationHits: ${d.observationHits}`);
    lines.push(`profileHits: ${d.profileHits}`);
    lines.push(`archiveHits: ${d.archiveHits}`);
    // W143.1: per-layer split for the archive count so reviewers can
    // tell whether SQLite/FTS or the JSONL fallback was responsible.
    lines.push(`archiveSqliteHits: ${d.archiveSqliteHits}`);
    lines.push(`archiveJsonlFallbackHits: ${d.archiveJsonlFallbackHits}`);
    lines.push(`filteredControlPlaneCount: ${d.filteredControlPlaneCount}`);
    lines.push(`finalResultCount: ${d.finalResultCount}`);
  }

  if (result.totalResults === 0 && !result.warnings.some(w => w.includes('error'))) {
    lines.push(getLocalizedText({
      zh: '未找到相关旁路记忆',
      en: 'No relevant sidecar memories found',
    }));
  }

  didCallOnDoneRef.current = true;
  onDone(lines.join('\n'), { display: 'system' });
  return null;
}

type MemoryListArgs = {
  limit: number;
  scope?: MemoryScope;
  type?: ObservationType;
};

function parseMemoryListArgs(args: string): MemoryListArgs {
  const parts = args.split(/\s+/).filter(Boolean);
  const getValue = (flag: string): string | undefined => {
    const index = parts.indexOf(flag);
    if (index < 0) return undefined;
    const value = parts[index + 1];
    if (!value || value.startsWith('--')) return undefined;
    return value;
  };
  const parsedLimit = Number.parseInt(getValue('--limit') ?? '8', 10);
  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 30) : 8,
    scope: getValue('--scope') as MemoryScope | undefined,
    type: getValue('--type') as ObservationType | undefined,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}=${value}`).join(' ');
}

function trimForMemoryLine(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function formatTrustBoundaryLines(): string[] {
  return [
    getLocalizedText({
      zh: '安全边界: memories/recall/proposals show 都是只读；proposal review 和 forget 只追加审核/抑制记录。',
      en: 'Safety boundary: memories/recall/proposals show are read-only; proposal review and forget only append review/suppression records.',
    }),
    getLocalizedText({
      zh: 'archive 原始来源不会被删除；普通聊天不会因为旁路记忆失败而崩溃。',
      en: 'Archive source data is not deleted; normal chat should not crash if sidecar memory fails.',
    }),
  ];
}

function buildForgetPlan(projectId: string, observation: Observation) {
  return {
    action: 'suppress-observation',
    projectId,
    observationId: observation.observationId,
    title: observation.title,
    current: {
      lifecycle: observation.lifecycle,
      retrievalPolicy: observation.retrievalPolicy,
      promotionStatus: observation.promotionStatus,
    },
    next: {
      lifecycle: 'disputed',
      retrievalPolicy: 'never_inject',
      promotionStatus: 'rejected',
    },
  };
}

function tokenForForgetPlan(plan: ReturnType<typeof buildForgetPlan>): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex')
    .slice(0, 8);
}

function SidecarMemoriesPanel({ onDone, args }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  args: string;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const cwd = getOriginalCwd();
    const projectId = projectIdFromCwd(cwd);
    const home = getMossenConfigHomeDir();
    const rootDir = `${home}/memory-sidecar`;
    const memoryDir = getProjectMemoryDir({ rootDir, projectId });
    const parsed = parseMemoryListArgs(args);

    (async () => {
      const [allObservations, recentObservationEntries, allProfiles, recentProfileEntries, allProposals, recentProposalEntries] = await Promise.all([
        listObservations({ rootDir, projectId, limit: Number.POSITIVE_INFINITY }),
        recentObservations({
          rootDir,
          projectId,
          limit: parsed.limit,
          scope: parsed.scope,
          type: parsed.type,
        }),
        listProfileSnapshots({ rootDir, projectId, limit: Number.POSITIVE_INFINITY }),
        recentProfileSnapshots({ rootDir, projectId, limit: 3 }),
        listProposals({ rootDir, projectId, limit: Number.POSITIVE_INFINITY }),
        recentProposals({ rootDir, projectId, limit: parsed.limit }),
      ]);

      const observations = allObservations.map(entry => entry.observation);
      const profiles = allProfiles.map(entry => entry.profile);
      const proposals = allProposals.map(entry => entry.proposal);
      const lines: string[] = [];

      lines.push(getLocalizedText({
        zh: 'Memory trust surface',
        en: 'Memory trust surface',
      }));
      lines.push(`projectId: ${projectId}`);
      lines.push(`memoryDir: ${memoryDir}`);
      lines.push(`filters: limit=${parsed.limit} scope=${parsed.scope ?? 'any'} type=${parsed.type ?? 'any'}`);
      lines.push('');

      lines.push(getLocalizedText({ zh: '记忆概览', en: 'Memory overview' }));
      lines.push(`observations: total=${observations.length} bySource=${formatCounts(countBy(observations, item => item.source))}`);
      lines.push(`  byScope: ${formatCounts(countBy(observations, item => item.scope))}`);
      lines.push(`  byType: ${formatCounts(countBy(observations, item => item.type))}`);
      lines.push(`  lifecycle: ${formatCounts(countBy(observations, item => item.lifecycle))}`);
      lines.push(`profiles: total=${profiles.length} latest=${recentProfileEntries[0]?.profile.generatedAt ?? 'none'}`);
      lines.push(`proposals: total=${proposals.length} status=${formatCounts(countBy(proposals, item => item.status))}`);
      lines.push('');

      lines.push(getLocalizedText({ zh: '最近 observations', en: 'Recent observations' }));
      if (recentObservationEntries.length === 0) {
        lines.push(getLocalizedText({ zh: '  无匹配 observation', en: '  No matching observations' }));
      } else {
        for (const entry of recentObservationEntries) {
          const observation = entry.observation;
          lines.push(`  ${observation.observationId} · ${observation.source}/${observation.type}/${observation.scope} · ${observation.lifecycle}/${observation.retrievalPolicy}`);
          lines.push(`    ${trimForMemoryLine(observation.title)} — ${trimForMemoryLine(observation.summary)}`);
          if (observation.evidenceEventIds.length > 0) {
            lines.push(`    evidence: ${observation.evidenceEventIds.slice(0, 5).join(', ')}`);
          }
          lines.push(`    forget: /memory-sidecar forget ${observation.observationId} --dry-run`);
        }
      }
      lines.push('');

      lines.push(getLocalizedText({ zh: '最近 profile snapshots', en: 'Recent profile snapshots' }));
      if (recentProfileEntries.length === 0) {
        lines.push(getLocalizedText({ zh: '  无 profile snapshot', en: '  No profile snapshots' }));
      } else {
        for (const entry of recentProfileEntries) {
          const profile = entry.profile;
          lines.push(`  ${profile.generatedAt} · scope=${profile.scope} confidence=${profile.confidence} sourceJobId=${profile.sourceJobId}`);
          lines.push(`    preferences=${profile.preferences.length} habits=${profile.habits.length} constraints=${profile.constraints.length} projectFacts=${profile.projectFacts.length}`);
        }
      }
      lines.push('');

      lines.push(getLocalizedText({ zh: '最近 proposals', en: 'Recent proposals' }));
      if (recentProposalEntries.length === 0) {
        lines.push(getLocalizedText({ zh: '  无 proposal', en: '  No proposals' }));
      } else {
        for (const entry of recentProposalEntries) {
          const proposal = entry.proposal;
          lines.push(`  ${proposal.proposalId} · ${proposal.type}/${proposal.status} · confidence=${proposal.confidence}`);
          lines.push(`    ${trimForMemoryLine(proposal.title)} — ${trimForMemoryLine(proposal.rationale)}`);
          lines.push(`    show: /memory-sidecar proposals show ${proposal.proposalId}`);
        }
      }
      lines.push('');
      lines.push(getLocalizedText({
        zh: '解释召回: /memory-sidecar recall <query> --explain',
        en: 'Explain recall: /memory-sidecar recall <query> --explain',
      }));
      lines.push(getLocalizedText({
        zh: '审阅候选: /memory-sidecar proposals show <proposalId> / review <proposalId> --accept|--reject --reason <text>',
        en: 'Review candidates: /memory-sidecar proposals show <proposalId> / review <proposalId> --accept|--reject --reason <text>',
      }));
      lines.push(...formatTrustBoundaryLines());

      setResult(lines.join('\n'));
    })().catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [args]);

  if (didCallOnDoneRef.current) return null;
  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error, { display: 'system' });
    return null;
  }
  if (!result) return null;
  didCallOnDoneRef.current = true;
  onDone(result, { display: 'system' });
  return null;
}

function SidecarForgetPanel({ onDone, args }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  args: string;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const cwd = getOriginalCwd();
    const projectId = projectIdFromCwd(cwd);
    const home = getMossenConfigHomeDir();
    const rootDir = `${home}/memory-sidecar`;
    const parts = args.split(/\s+/).filter(Boolean);
    const observationId = parts.find(part => !part.startsWith('--')) ?? '';
    const dryRun = parts.includes('--dry-run');
    const confirmIndex = parts.indexOf('--confirm');
    const confirmToken = confirmIndex >= 0 ? parts[confirmIndex + 1] : undefined;

    (async () => {
      if (!observationId || (!dryRun && !confirmToken)) {
        throw new Error(getLocalizedText({
          zh: '用法: /memory-sidecar forget <observationId> --dry-run，然后 /memory-sidecar forget <observationId> --confirm <8hex>',
          en: 'Usage: /memory-sidecar forget <observationId> --dry-run, then /memory-sidecar forget <observationId> --confirm <8hex>',
        }));
      }

      const latest = await readObservation({ rootDir, projectId, observationId });
      if (!latest) {
        throw new Error(getLocalizedText({
          zh: `找不到 observation: ${observationId}`,
          en: `Observation not found: ${observationId}`,
        }));
      }

      const plan = buildForgetPlan(projectId, latest.observation);
      const token = tokenForForgetPlan(plan);
      const lines: string[] = [];

      if (dryRun) {
        lines.push(getLocalizedText({
          zh: `forget dry-run (token=${token})`,
          en: `forget dry-run (token=${token})`,
        }));
        lines.push(`observationId: ${latest.observation.observationId}`);
        lines.push(`title: ${latest.observation.title}`);
        lines.push(`current: lifecycle=${latest.observation.lifecycle} retrievalPolicy=${latest.observation.retrievalPolicy} promotionStatus=${latest.observation.promotionStatus}`);
        lines.push(`next: lifecycle=disputed retrievalPolicy=never_inject promotionStatus=rejected`);
        lines.push(getLocalizedText({
          zh: `确认执行: /memory-sidecar forget ${latest.observation.observationId} --confirm ${token}`,
          en: `To execute: /memory-sidecar forget ${latest.observation.observationId} --confirm ${token}`,
        }));
        lines.push(...formatTrustBoundaryLines());
        setResult(lines.join('\n'));
        return;
      }

      if (!confirmToken || !/^[0-9a-f]{8}$/.test(confirmToken)) {
        throw new Error(getLocalizedText({
          zh: 'forget --confirm 需要 8 位 hex token',
          en: 'forget --confirm requires an 8-hex token',
        }));
      }
      if (confirmToken !== token) {
        throw new Error(getLocalizedText({
          zh: `forget token 不匹配；请重新运行 dry-run。expected=${token}`,
          en: `forget token mismatch; rerun dry-run. expected=${token}`,
        }));
      }

      const suppressed = await suppressObservation({ rootDir, projectId, observationId });
      lines.push(getLocalizedText({
        zh: 'observation 已抑制',
        en: 'Observation suppressed',
      }));
      lines.push(`observationId: ${suppressed.observation.observationId}`);
      lines.push(`lifecycle: ${suppressed.observation.lifecycle}`);
      lines.push(`retrievalPolicy: ${suppressed.observation.retrievalPolicy}`);
      lines.push(`promotionStatus: ${suppressed.observation.promotionStatus}`);
      lines.push(getLocalizedText({
        zh: '安全边界: 这是追加式抑制记录；archive 原始来源未删除。',
        en: 'Safety boundary: this appended a suppression record; archive source data was not deleted.',
      }));
      setResult(lines.join('\n'));
    })().catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [args]);

  if (didCallOnDoneRef.current) return null;
  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error, { display: 'system' });
    return null;
  }
  if (!result) return null;
  didCallOnDoneRef.current = true;
  onDone(result, { display: 'system' });
  return null;
}

// W109: /memory-sidecar llm status
function formatLlmApiKeyEnvMissingGuidance(apiKeyEnv: string | null | undefined): string[] {
  const envName = apiKeyEnv || '<ENV_VAR>';
  return [
    getLocalizedText({
      zh: `提示: 当前 Mossen 进程没有读取到 ${envName}。`,
      en: `Hint: the current Mossen process cannot read ${envName}.`,
    }),
    getLocalizedText({
      zh: `在启动 Mossen 前执行: export ${envName}=<你的 API Key>`,
      en: `Before starting Mossen, run: export ${envName}=<your API key>`,
    }),
    getLocalizedText({
      zh: '如果刚刚才 export，请重启 Mossen 后再运行 /memory-sidecar llm test。',
      en: 'If you exported it after Mossen was already running, restart Mossen and run /memory-sidecar llm test again.',
    }),
  ];
}

function SidecarLlmStatusPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const configPath = getDefaultMemorySidecarConfigPath();

  let config;
  try {
    config = loadMemorySidecarConfig(configPath);
  } catch {
    onDone(getLocalizedText({
      zh: `无法加载旁路记忆配置: ${configPath}`,
      en: `Cannot load sidecar config: ${configPath}`,
    }));
    return null;
  }

  const llmStatus = getMemorySidecarLlmStatus(config);
  const lines: string[] = [];

  lines.push(getLocalizedText({
    zh: `LLM 智能整理: ${llmStatus.llmEnabled ? '已启用' : '未启用'}`,
    en: `LLM classification: ${llmStatus.llmEnabled ? 'enabled' : 'disabled'}`,
  }));
  lines.push(getLocalizedText({
    zh: `规则分类: ${llmStatus.ruleBasedEnabled ? '已启用' : '未启用'}`,
    en: `Rule classification: ${llmStatus.ruleBasedEnabled ? 'enabled' : 'disabled'}`,
  }));
  lines.push(`provider: ${llmStatus.providerKind}`);

  if (llmStatus.baseUrl) {
    lines.push(`baseUrl: ${llmStatus.baseUrl}`);
  }
  if (llmStatus.model) {
    lines.push(`model: ${llmStatus.model}`);
  }
  if (llmStatus.apiKeyEnv) {
    lines.push(`apiKeyEnv: ${llmStatus.apiKeyEnv}`);
    lines.push(`apiKey configured: ${llmStatus.apiKeyConfigured ? 'yes' : 'no'}`);
    if (llmStatus.apiKeyConfigured === false) {
      lines.push('');
      lines.push(...formatLlmApiKeyEnvMissingGuidance(llmStatus.apiKeyEnv));
    }
  }
  if (llmStatus.profileId) {
    lines.push(`profileId: ${llmStatus.profileId}`);
    if (llmStatus.profileAvailable === false) {
      lines.push(getLocalizedText({
        zh: `⚠ profile "${llmStatus.profileId}" 不存在或不可用`,
        en: `⚠ profile "${llmStatus.profileId}" not found or unavailable`,
      }));
    }
  }

  // W122-B: surface persisted lastTest summary when present (categorical
  // only — no body, no api key, no headers, no prompt, no completion).
  if (llmStatus.lastTest) {
    lines.push('');
    const t = llmStatus.lastTest;
    lines.push(`lastTest.status: ${t.status}`);
    if (t.errorClass) {
      lines.push(`lastTest.errorClass: ${t.errorClass}`);
    }
    lines.push(`lastTest.at: ${t.at}`);
  }

  if (!llmStatus.llmEnabled) {
    lines.push('');
    if (!llmStatus.hasConfig) {
      lines.push(getLocalizedText({
        zh: 'LLM 智能整理未启用且未配置。先运行 /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV> 配置独立 provider。',
        en: 'LLM classification not configured. Run /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV> first.',
      }));
    } else {
      lines.push(getLocalizedText({
        zh: 'LLM 智能整理未启用。运行 /memory-sidecar llm enable 开启。',
        en: 'LLM classification disabled. Run /memory-sidecar llm enable to enable.',
      }));
    }
  }

  onDone(lines.join('\n'), { display: 'system' });
  return null;
}

// W109: /memory-sidecar llm config
function SidecarLlmConfigPanel({ onDone, baseUrl, model, apiKeyEnv, show }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  show: boolean;
}) {
  if (show) {
    // /memory-sidecar llm config --show
    const configPath = getDefaultMemorySidecarConfigPath();
    let config;
    try {
      config = loadMemorySidecarConfig(configPath);
    } catch {
      onDone(getLocalizedText({
        zh: `无法加载旁路记忆配置: ${configPath}`,
        en: `Cannot load sidecar config: ${configPath}`,
      }));
      return null;
    }
    const status = getMemorySidecarLlmStatus(config);
    const lines: string[] = [];
    lines.push(`provider: ${status.providerKind}`);
    if (status.baseUrl) lines.push(`baseUrl: ${status.baseUrl}`);
    if (status.model) lines.push(`model: ${status.model}`);
    if (status.apiKeyEnv) {
      lines.push(`apiKeyEnv: ${status.apiKeyEnv}`);
      lines.push(`apiKey configured: ${status.apiKeyConfigured ? 'yes' : 'no'}`);
      if (status.apiKeyConfigured === false) {
        lines.push('');
        lines.push(...formatLlmApiKeyEnvMissingGuidance(status.apiKeyEnv));
      }
    }
    lines.push(`hasConfig: ${status.hasConfig}`);
    onDone(lines.join('\n'), { display: 'system' });
    return null;
  }

  if (!baseUrl || !model || !apiKeyEnv) {
    onDone(getLocalizedText({
      zh: '用法: /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV_VAR>',
      en: 'Usage: /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV_VAR>',
    }));
    return null;
  }

  try {
    const config = setMemorySidecarLlmConfig({ baseUrl, model, apiKeyEnv }, getDefaultMemorySidecarConfigPath());
    const status = getMemorySidecarLlmStatus(config);

    const lines: string[] = [];
    lines.push(getLocalizedText({
      zh: 'LLM 独立配置已写入。',
      en: 'LLM independent config written.',
    }));
    lines.push(`provider: ${status.providerKind}`);
    lines.push(`baseUrl: ${status.baseUrl}`);
    lines.push(`model: ${status.model}`);
    lines.push(`apiKeyEnv: ${status.apiKeyEnv}`);
    lines.push(`apiKey configured: ${status.apiKeyConfigured ? 'yes' : 'no'}`);
    if (status.apiKeyConfigured === false) {
      lines.push('');
      lines.push(...formatLlmApiKeyEnvMissingGuidance(status.apiKeyEnv));
    }
    lines.push('');
    lines.push(getLocalizedText({
      zh: '下一步: 运行 /memory-sidecar llm enable 启用 LLM 智能整理。',
      en: 'Next: run /memory-sidecar llm enable to activate LLM classification.',
    }));

    onDone(lines.join('\n'), { display: 'system' });
  } catch (e) {
    onDone(getLocalizedText({
      zh: `写入配置失败: ${e instanceof Error ? e.message : String(e)}`,
      en: `Failed to write config: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
  return null;
}

// W109: /memory-sidecar llm enable
function SidecarLlmEnablePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  try {
    const config = setMemorySidecarLlmEnabled(true, getDefaultMemorySidecarConfigPath());
    const status = getMemorySidecarLlmStatus(config);

    const lines: string[] = [];
    lines.push(getLocalizedText({
      zh: 'LLM 智能整理已启用。',
      en: 'LLM classification enabled.',
    }));
    lines.push(`provider: ${status.providerKind}`);
    if (status.model) lines.push(`model: ${status.model}`);
    if (status.baseUrl) lines.push(`baseUrl: ${status.baseUrl}`);
    lines.push('');
    lines.push(getLocalizedText({
      zh: '下一步: 运行 /memory-sidecar worker run-once 触发一次 LLM 分类。',
      en: 'Next: run /memory-sidecar worker run-once to trigger LLM classification.',
    }));

    onDone(lines.join('\n'), { display: 'system' });
  } catch (e) {
    if (e instanceof Error && e.message === 'NO_LLM_CONFIG') {
      onDone(getLocalizedText({
        zh: 'LLM 智能整理未配置独立 provider。请先运行:\n  /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV_VAR>',
        en: 'No independent LLM provider configured. Run:\n  /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV_VAR>',
      }));
    } else {
      onDone(getLocalizedText({
        zh: `写入配置失败: ${e instanceof Error ? e.message : String(e)}`,
        en: `Failed to write config: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }
  return null;
}

// W109: /memory-sidecar llm disable
function SidecarLlmDisablePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  try {
    setMemorySidecarLlmEnabled(false, getDefaultMemorySidecarConfigPath());
    onDone(getLocalizedText({
      zh: 'LLM 智能整理已关闭，规则分类仍可继续运行，已有记忆数据保留。Provider 配置保留。',
      en: 'LLM classification disabled. Rule classification continues. Existing memory data and provider config preserved.',
    }), { display: 'system' });
  } catch (e) {
    onDone(getLocalizedText({
      zh: `写入配置失败: ${e instanceof Error ? e.message : String(e)}`,
      en: `Failed to write config: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
  return null;
}

// W109: /memory-sidecar llm test
// W122-B: production-grade LLM test — runs the 11-class categorization
// helper, persists status/errorClass/at to config (no body / api key /
// prompt / completion ever stored), and prints categorical fields only.
function SidecarLlmTestPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const configPath = getDefaultMemorySidecarConfigPath();
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = loadMemorySidecarConfig(configPath);
        const result = await runMemorySidecarLlmTest({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;

        // Persist categorical-only result. setMemorySidecarLlmLastTest
        // validates the shape and rejects any non-{status,errorClass,at}
        // payload — guarding against accidental body persistence.
        try {
          setMemorySidecarLlmLastTest({
            status: result.status,
            errorClass: result.status === 'success' ? null : result.status,
            at: result.finishedAt,
          }, configPath);
        } catch {
          // Persistence failure is non-fatal — the user still gets the
          // live result. We surface a single warning line.
        }

        setOutput(formatLlmTestResult(result));
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `LLM 测试失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `LLM test failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configPath, projectId]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatLlmTestResult(result: LlmTestResult): string {
  const lines: string[] = [];
  lines.push(`status: ${result.status}`);
  lines.push(`durationMs: ${result.durationMs}`);
  if (result.httpStatus !== null) {
    lines.push(`httpStatus: ${result.httpStatus}`);
  }
  lines.push(`provider: ${result.providerKind}`);
  if (result.baseUrlHost) {
    lines.push(`host: ${result.baseUrlHost}`);
  }
  if (result.model) {
    lines.push(`model: ${result.model}`);
  }
  if (result.errorMessage) {
    lines.push(`error: ${result.errorMessage}`);
  }
  if (result.recommendedAction) {
    lines.push(`next: ${result.recommendedAction}`);
  }
  if (result.status === 'apiKeyEnv-missing') {
    lines.push('');
    lines.push(...formatLlmApiKeyEnvMissingGuidance(result.apiKeyEnv));
  }
  return lines.join('\n');
}

// W122-A: production-readiness doctor — 14 read-only checks + healthScore
// + grade + retrieval probe + recommendedActions. No mutation, no LLM,
// no worker run. Accepts an optional `--query <text>` to bias the
// retrieval probe.
function SidecarDoctorPanel({ onDone, query }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  query?: string;
}) {
  const configPath = getDefaultMemorySidecarConfigPath();
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = loadMemorySidecarConfig(configPath);
        // W122-B: doctor surfaces integrity findings in addition to the
        // 14-check matrix. Both helpers are read-only.
        const [report, integrity] = await Promise.all([
          generateHealthReport({ rootDir: config.homeDir, projectId, query }),
          generateDataIntegrityReport({ rootDir: config.homeDir, projectId }).catch(
            () => null,
          ),
        ]);
        if (!cancelled) {
          const base = formatHealthDoctor(report);
          setOutput(integrity ? `${base}\n\n${formatDataIntegritySummary(integrity)}` : base);
        }
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `旁路记忆 doctor 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `Memory sidecar doctor failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configPath, projectId, query]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatHealthDoctor(report: HealthReport): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `健康分: ${report.healthScore}/100 (${report.grade})`,
    en: `healthScore: ${report.healthScore}/100 (${report.grade})`,
  }));
  lines.push(`projectId: ${report.projectId}`);
  lines.push(`retrievalProbe: query="${report.retrievalProbe.query}" results=${report.retrievalProbe.results} filtered=${report.retrievalProbe.filteredControlPlaneCount}`);
  lines.push('');
  lines.push(getLocalizedText({
    zh: `检查项 (${report.checks.length}):`,
    en: `checks (${report.checks.length}):`,
  }));
  for (const check of report.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.summary}` + (check.detail ? ` (${check.detail})` : ''));
    if (check.action) {
      lines.push(`    -> ${check.action}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const warn of report.warnings) lines.push(`  - ${warn}`);
  }
  if (report.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const action of report.recommendedActions) lines.push(`  ${action}`);
  }
  return lines.join('\n');
}

// W122-A: read-only capture-boundary explainer.
function SidecarExplainCapturePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const configPath = getDefaultMemorySidecarConfigPath();
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = loadMemorySidecarConfig(configPath);
        const report = await generateExplainCaptureReport({
          rootDir: config.homeDir,
          projectId,
        });
        if (!cancelled) setOutput(formatExplainCapture(report));
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `explain-capture 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `explain-capture failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configPath, projectId]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatExplainCapture(report: ExplainCaptureReport): string {
  const lines: string[] = [];
  const cfg = report.config;
  lines.push(getLocalizedText({
    zh: '旁路记忆采集说明 / Sidecar memory capture explainer',
    en: 'Sidecar memory capture explainer',
  }));
  lines.push('');
  lines.push(getLocalizedText({
    zh: `当前: sidecar=${cfg.sidecarEnabled ? '开' : '关'}, capture=${cfg.captureEnabled ? '开' : '关'}, adapter=${cfg.adapterEnabled ? '开' : '关'}, redaction=${cfg.redactionEnabled ? '开' : '关'}`,
    en: `current: sidecar=${cfg.sidecarEnabled} capture=${cfg.captureEnabled} adapter=${cfg.adapterEnabled} redaction=${cfg.redactionEnabled}`,
  }));
  lines.push(getLocalizedText({
    zh: `archive 事件数: ${report.archive.events}` + (report.archive.lastEventAt ? `, 最近事件 ${report.archive.lastEventAt}` : ''),
    en: `archive events: ${report.archive.events}` + (report.archive.lastEventAt ? `, latestEventAt ${report.archive.lastEventAt}` : ''),
  }));

  lines.push('');
  lines.push(getLocalizedText({ zh: '会采集 / captured:', en: 'captured:' }));
  for (const item of report.captured) lines.push(`  + ${item}`);
  lines.push('');
  lines.push(getLocalizedText({ zh: '不会采集 / not captured:', en: 'not captured:' }));
  for (const item of report.notCaptured) lines.push(`  - ${item}`);
  lines.push('');
  lines.push(getLocalizedText({ zh: '会脱敏 / redacted:', en: 'redacted:' }));
  for (const item of report.redacted) lines.push(`  ~ ${item}`);

  lines.push('');
  lines.push(getLocalizedText({
    zh: `如何关闭采集 / how to disable: ${report.howToDisable}`,
    en: `how to disable: ${report.howToDisable}`,
  }));
  lines.push(getLocalizedText({
    zh: '如何确认 0 写盘 / how to verify zero writes:',
    en: 'how to verify zero writes:',
  }));
  for (const cmd of report.howToVerifyZeroWrites) lines.push(`  ${cmd}`);

  return lines.join('\n');
}

// W122-A: read-only recall sanity tester. Runs four fixed probes and
// surfaces verdict per probe + overall.
function SidecarRecallTestPanel({ onDone, query }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  query?: string;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const configPath = getDefaultMemorySidecarConfigPath();
  const didCallOnDoneRef = useRef(false);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = loadMemorySidecarConfig(configPath);
        const report = await generateRecallTestReport({
          rootDir: config.homeDir,
          projectId,
          query,
        });
        if (!cancelled) setOutput(formatRecallTest(report));
      } catch (error) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `recall-test 失败: ${error instanceof Error ? error.message : String(error)}`,
            en: `recall-test failed: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configPath, projectId, query]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatRecallTest(report: RecallTestReport): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `recall-test: ${report.overallStatus}`,
    en: `recall-test: ${report.overallStatus}`,
  }));
  lines.push(`projectId: ${report.projectId} (resolved=${report.resolvedProjectId})`);
  lines.push(`searchedProjectIds: ${report.searchedProjectIds.join(', ')}`);
  lines.push('');
  lines.push(getLocalizedText({ zh: '探针:', en: 'probes:' }));
  for (const probe of report.probes) {
    lines.push(`  [${probe.status.toUpperCase()}] ${probe.id}: query="${probe.query}" results=${probe.results} filtered=${probe.filteredControlPlaneCount} ~${probe.estimatedTokens} tokens`);
    if (probe.detail) lines.push(`    ${probe.detail}`);
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const warn of report.warnings) lines.push(`  - ${warn}`);
  }
  if (report.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const action of report.recommendedActions) lines.push(`  ${action}`);
  }
  return lines.join('\n');
}

// W109: /memory-sidecar worker status
// W122-B: production-grade worker status — drives generateWorkerReport
// and surfaces dirty / reconcile / lock detail (sameHost / pidAlive /
// staleReason) / job aggregation / lastCompleted / lastFailed (redacted)
// / recommendedActions. Read-only.
function SidecarWorkerStatusPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const report = await generateWorkerReport({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatWorkerReport(report));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `worker 状态读取失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `worker status read failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatWorkerReport(r: WorkerReport): string {
  const lines: string[] = [];
  const yesNo = (value: boolean) => getLocalizedText({
    zh: value ? '是' : '否',
    en: value ? 'yes' : 'no',
  });

  lines.push(getLocalizedText({
    zh: `项目: ${r.projectId}`,
    en: `projectId: ${r.projectId}`,
  }));
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(getLocalizedText({
      zh: `解析后项目: ${r.resolvedProjectId}`,
      en: `resolvedProjectId: ${r.resolvedProjectId}`,
    }));
  }
  lines.push(getLocalizedText({
    zh: `记忆目录: ${r.memoryDir}`,
    en: `memoryDir: ${r.memoryDir}`,
  }));
  lines.push('');

  lines.push(getLocalizedText({
    zh: `脏标记: ${r.dirty.unconsumed} 未消费 / ${r.dirty.consumed} 已消费 / ${r.dirty.total} 总计`,
    en: `dirty: ${r.dirty.unconsumed} unconsumed / ${r.dirty.consumed} consumed / ${r.dirty.total} total`,
  }));
  lines.push(getLocalizedText({
    zh: `对账: scanWindow=${r.reconcile.scanWindow} scanned=${r.reconcile.scannedEvents} missing=${r.reconcile.missing}`,
    en: `reconcile: scanWindow=${r.reconcile.scanWindow} scanned=${r.reconcile.scannedEvents} missing=${r.reconcile.missing}`,
  }));
  lines.push('');

  lines.push(getLocalizedText({
    zh: `锁: 持有=${yesNo(r.lock.held)} 陈旧=${yesNo(r.lock.stale)}`,
    en: `lock: held=${yesNo(r.lock.held)} stale=${yesNo(r.lock.stale)}`,
  }));
  if (r.lock.held) {
    if (r.lock.pid !== null) lines.push(`  pid: ${r.lock.pid}`);
    if (r.lock.hostname) lines.push(`  hostname: ${r.lock.hostname}`);
    if (r.lock.heartbeatAt) lines.push(`  heartbeatAt: ${r.lock.heartbeatAt}`);
    if (r.lock.sameHost !== null) lines.push(`  sameHost: ${r.lock.sameHost}`);
    if (r.lock.pidAlive !== null) lines.push(`  pidAlive: ${r.lock.pidAlive}`);
    if (r.lock.staleReason) lines.push(`  staleReason: ${r.lock.staleReason}`);
  }
  lines.push('');

  const s = r.jobs.byStatus;
  lines.push(getLocalizedText({
    zh: `任务状态: completed=${s.completed} skipped=${s.skipped} failed=${s.failed} pending=${s.pending} running=${s.running}`,
    en: `jobs by status: completed=${s.completed} skipped=${s.skipped} failed=${s.failed} pending=${s.pending} running=${s.running}`,
  }));
  const typeKeys = Object.keys(r.jobs.byType).sort();
  if (typeKeys.length > 0) {
    lines.push(getLocalizedText({ zh: '任务类型:', en: 'jobs by type:' }));
    for (const k of typeKeys) {
      lines.push(`  ${k}: ${r.jobs.byType[k]}`);
    }
  }
  lines.push(getLocalizedText({
    zh: `活跃失败: ${r.jobs.activeFailed}`,
    en: `activeFailed: ${r.jobs.activeFailed}`,
  }));
  lines.push(getLocalizedText({
    zh: `重试任务: ${r.jobs.retryJobs}`,
    en: `retryJobs: ${r.jobs.retryJobs}`,
  }));
  lines.push(getLocalizedText({
    zh: `耗尽任务: ${r.jobs.exhaustedJobs}`,
    en: `exhaustedJobs: ${r.jobs.exhaustedJobs}`,
  }));

  // W144: surface effectivePendingWork so the operator does not have
  // to mentally OR the four-or-five fields above to answer "do I need
  // to run worker again?". When the answer is no but dirty.unconsumed
  // is positive, also print a single-line note explaining the retained
  // markers — that's the case that misled users pre-W144.
  if (typeof r.effectivePendingWork === 'boolean') {
    lines.push(getLocalizedText({
      zh: `可运行工作: ${r.effectivePendingWork ? '是' : '否'}`,
      en: `runnableWork: ${r.effectivePendingWork ? 'yes' : 'no'}`,
    }));
    if (!r.effectivePendingWork && r.dirty.unconsumed > 0) {
      lines.push(getLocalizedText({
        zh: `说明: 已保留 ${r.dirty.unconsumed} 个未消费脏标记用于审计，但没有 pending/failed/retry 任务需要处理`,
        en: `note: dirty markers retained (${r.dirty.unconsumed} unconsumed), but no pending/failed/retry jobs require action`,
      }));
    }
  }

  if (r.lastCompleted) {
    lines.push('');
    lines.push(getLocalizedText({
      zh: `最近完成: ${r.lastCompleted.type} (${r.lastCompleted.id}) at ${r.lastCompleted.finishedAt}`,
      en: `lastCompleted: ${r.lastCompleted.type} (${r.lastCompleted.id}) at ${r.lastCompleted.finishedAt}`,
    }));
  }
  if (r.lastFailed) {
    lines.push('');
    lines.push(getLocalizedText({
      zh: `最近失败: ${r.lastFailed.type} (${r.lastFailed.id}) at ${r.lastFailed.finishedAt}`,
      en: `lastFailed: ${r.lastFailed.type} (${r.lastFailed.id}) at ${r.lastFailed.finishedAt}`,
    }));
    lines.push(`  errorClass: ${r.lastFailed.errorClass}`);
    if (r.lastFailed.redactedMessage) {
      lines.push(`  message: ${r.lastFailed.redactedMessage}`);
    }
  }

  if (r.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  if (r.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const a of r.recommendedActions) lines.push(`  - ${a}`);
  }

  return lines.join('\n');
}

// W122-B: production-grade worker run-once — drives generateRunOnceReport
// and surfaces durationMs / repairedMarkers / scheduled / completed /
// skipped / failed / llmSkippedReason / recommendedActions. Errors per
// job are redacted via redactMemoryText.
function SidecarWorkerRunOncePanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [result, setResult] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setResult(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const report = await generateRunOnceReport({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setResult(formatRunOnceReport(report));
      } catch (e) {
        if (!cancelled) {
          setResult(getLocalizedText({
            zh: `worker run-once 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `worker run-once failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (result && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(result, { display: 'system' });
  }
  return null;
}

function formatRunOnceReport(r: RunOnceReport): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `worker run-once 完成 (${r.durationMs}ms)`,
    en: `worker run-once completed (${r.durationMs}ms)`,
  }));
  lines.push(`projectId: ${r.projectId}`);
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(`resolvedProjectId: ${r.resolvedProjectId}`);
  }
  lines.push('');
  lines.push(`repairedMarkers: ${r.repairedMarkers}`);
  lines.push(`scheduled: ${r.scheduledJobs}`);
  lines.push(`completed: ${r.completedJobs}`);
  lines.push(`skipped: ${r.skippedJobs}`);
  lines.push(`failed: ${r.failedJobs}`);
  if (r.llmSkippedReason) {
    lines.push(`llm: ${r.llmSkippedReason}`);
  }

  // W143-D3: per-type breakdown so the operator sees `classify_rule:
  // completed=N skipped=N failed=N` style tally without scrolling
  // through jobsDetail.
  if (r.typeBreakdown && r.typeBreakdown.length > 0) {
    lines.push('');
    lines.push('byType:');
    for (const row of r.typeBreakdown) {
      const total = row.completed + row.skipped + row.failed + row.pending + row.running;
      if (total === 0) continue;
      lines.push(`  ${row.type}: completed=${row.completed} skipped=${row.skipped} failed=${row.failed} pending=${row.pending} running=${row.running}`);
    }
  }

  // W143-D3: skipped-reason aggregation. Top reasons first, ≤5 examples
  // each. Skipped jobs whose reason was empty appear under
  // `(no reason recorded)` so they still surface.
  if (r.skippedReasonSummary && r.skippedReasonSummary.length > 0) {
    lines.push('');
    lines.push('skippedReasons:');
    for (const sr of r.skippedReasonSummary) {
      lines.push(`  [${sr.count}] ${sr.reason}`);
      if (sr.examples.length > 0) {
        lines.push(`     examples: ${sr.examples.join(', ')}`);
      }
    }
  }

  if (r.jobsDetail.length > 0) {
    lines.push('');
    lines.push(`jobs (up to ${r.jobsDetail.length}):`);
    for (const j of r.jobsDetail) {
      const tail = j.redactedError ? ` — ${j.redactedError}` : '';
      lines.push(`  ${j.type}: ${j.status}${tail}`);
    }
  }

  if (r.warnings.length > 0) {
    lines.push('');
    lines.push(`warnings:`);
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  if (r.recommendedActions.length > 0) {
    lines.push('');
    lines.push(`recommendedActions:`);
    for (const a of r.recommendedActions) lines.push(`  - ${a}`);
  }

  return lines.join('\n');
}

function SidecarAgentHandoffPanel({ onDone, jobId, confirm }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  jobId: string;
  confirm: boolean;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const cwd = getOriginalCwd();
    const projectId = projectIdFromCwd(cwd);
    const home = getMossenConfigHomeDir();

    readAgentSupervisorResultPayload(jobId)
      .then(payload => {
        if (!payload) {
          throw new Error(`no structured result payload found for job ${jobId}`);
        }
        return createAgentResultMemoryHandoff({
          rootDir: `${home}/memory-sidecar`,
          projectId,
          jobId,
          payload,
          confirm,
        });
      })
      .then(r => {
        const lines = [
          getLocalizedText({
            zh: confirm ? 'Agent 结果 handoff 已写入候选记忆' : 'Agent 结果 handoff dry-run',
            en: confirm ? 'Agent result handoff wrote a memory candidate' : 'Agent result handoff dry-run',
          }),
          `status: ${r.status}`,
          `proposalId: ${r.proposal.proposalId}`,
          `type: ${r.proposal.type}`,
          `proposalStatus: ${r.proposal.status}`,
          `title: ${r.proposal.title}`,
          getLocalizedText({
            zh: '安全边界: 只创建 candidate proposal；不会自动 accepted，也不会自动注入主会话。',
            en: 'Safety boundary: only creates a candidate proposal; never auto-accepts or auto-injects into the main session.',
          }),
        ];
        if (!confirm) {
          lines.push(getLocalizedText({
            zh: `确认写入: /memory-sidecar agent-handoff ${jobId} --confirm`,
            en: `To write: /memory-sidecar agent-handoff ${jobId} --confirm`,
          }));
        }
        setResult(lines.join('\n'));
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [confirm, jobId]);

  if (didCallOnDoneRef.current) return null;
  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error, { display: 'system' });
    return null;
  }
  if (!result) return null;

  didCallOnDoneRef.current = true;
  onDone(result, { display: 'system' });
  return null;
}

function parseProposalReviewArgs(rest: string): {
  proposalId: string
  status?: Extract<ProposalStatus, 'accepted' | 'rejected'>
  reason?: string
} {
  const parts = rest.split(/\s+/).filter(Boolean);
  const proposalId = parts.find(part => !part.startsWith('--') && part !== 'review') ?? '';
  const status = parts.includes('--accept')
    ? 'accepted'
    : parts.includes('--reject')
      ? 'rejected'
      : undefined;
  const reasonIndex = parts.indexOf('--reason');
  const reason = reasonIndex >= 0
    ? parts.slice(reasonIndex + 1).filter(part => !part.startsWith('--')).join(' ')
    : undefined;
  return { proposalId, status, reason };
}

function formatProposalList(
  proposals: Awaited<ReturnType<typeof recentProposals>>,
  status: ProposalStatus,
): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `Memory proposals (${status})`,
    en: `Memory proposals (${status})`,
  }));
  if (proposals.length === 0) {
    lines.push(getLocalizedText({
      zh: '没有待审核候选。Agent handoff 可用 /memory-sidecar agent-handoff <jobId> --dry-run 生成候选。',
      en: 'No proposals need review. Agent handoff can create candidates with /memory-sidecar agent-handoff <jobId> --dry-run.',
    }));
    return lines.join('\n');
  }

  for (const entry of proposals) {
    const p = entry.proposal;
    lines.push('');
    lines.push(`${p.proposalId} · ${p.type} · confidence=${p.confidence}`);
    lines.push(`  title: ${p.title}`);
    lines.push(`  rationale: ${p.rationale.slice(0, 260)}${p.rationale.length > 260 ? '...' : ''}`);
    lines.push(`  createdAt: ${p.createdAt}`);
    lines.push(`  show: /memory-sidecar proposals show ${p.proposalId}`);
    lines.push(`  review: /memory-sidecar proposals review ${p.proposalId} --accept --reason <text>`);
    lines.push(`          /memory-sidecar proposals review ${p.proposalId} --reject --reason <text>`);
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: '安全边界: review 只追加审核记录；不会重写 proposals.jsonl，也不会自动注入普通对话。',
    en: 'Safety boundary: review only appends a review record; it does not rewrite proposals.jsonl or auto-inject into normal chat.',
  }));
  return lines.join('\n');
}

function formatProposalShow(
  entry: Awaited<ReturnType<typeof listProposals>>[number] | undefined,
  proposalId: string,
): string {
  if (!entry) {
    return getLocalizedText({
      zh: `未找到 proposal: ${proposalId}`,
      en: `Proposal not found: ${proposalId}`,
    });
  }

  const p = entry.proposal;
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: 'Memory proposal detail',
    en: 'Memory proposal detail',
  }));
  lines.push(`proposalId: ${p.proposalId}`);
  lines.push(`type: ${p.type}`);
  lines.push(`status: ${p.status}`);
  lines.push(`confidence: ${p.confidence}`);
  lines.push(`createdAt: ${p.createdAt}`);
  if (p.updatedAt) lines.push(`updatedAt: ${p.updatedAt}`);
  if (p.reviewedAt) lines.push(`reviewedAt: ${p.reviewedAt}`);
  if (p.decisionReason) lines.push(`decisionReason: ${p.decisionReason}`);
  lines.push(`title: ${p.title}`);
  lines.push(`rationale: ${p.rationale}`);
  lines.push(`evidenceEventIds: ${p.evidenceEventIds.length > 0 ? p.evidenceEventIds.join(', ') : 'none'}`);
  lines.push('');
  lines.push(`accept: /memory-sidecar proposals review ${p.proposalId} --accept --reason <text>`);
  lines.push(`reject: /memory-sidecar proposals review ${p.proposalId} --reject --reason <text>`);
  lines.push(...formatTrustBoundaryLines());
  return lines.join('\n');
}

function SidecarProposalReviewPanel({ onDone, args }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  args: string;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    const cwd = getOriginalCwd();
    const projectId = projectIdFromCwd(cwd);
    const home = getMossenConfigHomeDir();
    const rootDir = `${home}/memory-sidecar`;
    const trimmed = args.trim();

    (async () => {
      if (!trimmed || trimmed === 'list' || trimmed === '--candidates') {
        const proposals = await recentProposals({
          rootDir,
          projectId,
          status: 'candidate',
          limit: 10,
        });
        setResult(formatProposalList(proposals, 'candidate'));
        return;
      }

      if (trimmed.startsWith('show ')) {
        const proposalId = trimmed.slice('show'.length).trim().split(/\s+/)[0] ?? '';
        if (!proposalId) {
          throw new Error(getLocalizedText({
            zh: '用法: /memory-sidecar proposals show <proposalId>',
            en: 'Usage: /memory-sidecar proposals show <proposalId>',
          }));
        }
        const [proposal] = await listProposals({
          rootDir,
          projectId,
          limit: Number.POSITIVE_INFINITY,
        }).then(proposals =>
          proposals
            .filter(({ proposal }) => proposal.proposalId === proposalId)
            .sort((a, b) => (b.proposal.updatedAt ?? b.proposal.reviewedAt ?? b.proposal.createdAt)
              .localeCompare(a.proposal.updatedAt ?? a.proposal.reviewedAt ?? a.proposal.createdAt)),
        );
        setResult(formatProposalShow(proposal, proposalId));
        return;
      }

      if (trimmed.startsWith('review ')) {
        const parsed = parseProposalReviewArgs(trimmed.slice('review'.length).trim());
        if (!parsed.proposalId || !parsed.status) {
          throw new Error(getLocalizedText({
            zh: '用法: /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>',
            en: 'Usage: /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>',
          }));
        }
        const reviewed = await reviewProposal({
          rootDir,
          projectId,
          proposalId: parsed.proposalId,
          status: parsed.status,
          decisionReason: parsed.reason,
        });
        setResult([
          getLocalizedText({
            zh: 'Memory proposal 已审核',
            en: 'Memory proposal reviewed',
          }),
          `proposalId: ${reviewed.proposal.proposalId}`,
          `status: ${reviewed.proposal.status}`,
          `decisionReason: ${reviewed.proposal.decisionReason ?? '—'}`,
          getLocalizedText({
            zh: '安全边界: 这是追加式 review 记录；不会自动注入普通对话。',
            en: 'Safety boundary: this appended a review record; it does not auto-inject into normal chat.',
          }),
        ].join('\n'));
        return;
      }

      throw new Error(getLocalizedText({
        zh: '用法: /memory-sidecar proposals、/memory-sidecar proposals show <proposalId>，或 /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>',
        en: 'Usage: /memory-sidecar proposals, /memory-sidecar proposals show <proposalId>, or /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>',
      }));
    })().catch(err => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [args]);

  if (didCallOnDoneRef.current) return null;
  if (error) {
    didCallOnDoneRef.current = true;
    onDone(error, { display: 'system' });
    return null;
  }
  if (!result) return null;
  didCallOnDoneRef.current = true;
  onDone(result, { display: 'system' });
  return null;
}

// W145: /memory-sidecar governance status — drives
// generateMemoryStorageGovernanceReport. Read-only observability of the
// on-disk memory store: archive size, sqlite row count, observation /
// profile / proposal counts, dirty + jobs aggregation, monthly archive
// buckets, risk level + reasons.
//
// W145 hard invariant: this surface NEVER mutates anything on disk.
// All five plan actions are dry-run only (safeToExecuteNow=false).
//
// Naming note: the original W145 instructions said
// `/memory-sidecar storage status`, but `storage status` is already the
// W132/W138 maintenance/operator surface (file-level cleanup +
// dead-letter etc.) and must not be overwritten. W145 governs long-term
// retention, so it lives under a fresh `governance` namespace. Old
// `storage status / storage export / storage cleanup` are unchanged.
function SidecarGovernanceStatusPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const report = await generateMemoryStorageGovernanceReport({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatGovernanceReport(report));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance status 读取失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance status read failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W145: /memory-sidecar governance plan — drives
// generateMemoryStorageGovernancePlan. Dry-run only; every action emits
// safeToExecuteNow=false. W146 implements a separate governance apply
// dry-run/confirm route for the low-risk profile/proposal actions.
function SidecarGovernancePlanPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const plan = await generateMemoryStorageGovernancePlan({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatGovernancePlan(plan));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance plan 读取失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance plan read failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W149-E: /memory-sidecar governance compression shadow
// Read-only shadow report for archive compression — generates a
// deterministic shadow plan + recoverability report without writing
// any compressed files or modifying any source data.
function formatCompressionShadow(
  report: ArchiveCompressionShadowReport,
): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: '✓ Archive compression shadow (read-only — no source files changed)',
      zh: '✓ 归档压缩 shadow（只读 — 未修改任何源文件）',
    }),
  );
  lines.push('');
  lines.push(`projectId: ${report.resolvedProjectId}`);
  lines.push(`archiveSessionsDir: ${report.archiveSessionsDir}`);
  lines.push(
    `totalSessions: ${report.totalSessions} (scanned: ${report.scannedSessions}, skipped: ${report.skippedSessions.length})`,
  );
  lines.push('');
  lines.push(
    getLocalizedText({
      en: 'Compression estimate (memory-only, gzip):',
      zh: '压缩估算（只内存运算，gzip）：',
    }),
  );
  lines.push(`  totalOriginalBytes:           ${report.totalOriginalBytes}`);
  lines.push(`  totalEstimatedCompressedBytes: ${report.totalEstimatedCompressedBytes}`);
  lines.push(`  totalEstimatedSavingsBytes:    ${report.totalEstimatedSavingsBytes}`);
  if (report.skippedSessions.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: `Skipped (${report.skippedSessions.length}):`,
        zh: `已跳过（${report.skippedSessions.length}）：`,
      }),
    );
    const sample = report.skippedSessions.slice(0, 5);
    for (const s of sample) {
      lines.push(`  - ${s.sessionId}: ${s.reason}${s.detail ? ` (${s.detail})` : ''}`);
    }
    if (report.skippedSessions.length > sample.length) {
      lines.push(`  - …and ${report.skippedSessions.length - sample.length} more`);
    }
  }
  if (report.parseWarnings.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Parse warnings:',
        zh: 'Parse 警告：',
      }),
    );
    for (const w of report.parseWarnings.slice(0, 5)) {
      lines.push(`  - ${w}`);
    }
  }
  lines.push('');
  lines.push(
    getLocalizedText({
      en: `Recoverability: ${report.recoverability.pass ? 'PASS' : 'FAIL'}`,
      zh: `Recoverability: ${report.recoverability.pass ? 'PASS' : 'FAIL'}`,
    }),
  );
  lines.push(
    `  sourceJsonlRetained:                       ${report.recoverability.sourceJsonlRetained}`,
  );
  lines.push(
    `  sourceSha256Recorded:                      ${report.recoverability.sourceSha256Recorded}`,
  );
  lines.push(
    `  compressedCopyAuthoritative:               ${report.recoverability.compressedCopyAuthoritative}`,
  );
  lines.push(
    `  sqliteRebuildableFromSource:               ${report.recoverability.sqliteRebuildableFromSource}`,
  );
  lines.push(
    `  exportCanUseSource:                        ${report.recoverability.exportCanUseSource}`,
  );
  lines.push(
    `  partialFailureLeavesSourceUntouched:       ${report.recoverability.partialFailureLeavesSourceUntouched}`,
  );
  lines.push(
    `  repeatedShadowRunDeterministic:            ${report.recoverability.repeatedShadowRunDeterministic}`,
  );
  lines.push(
    `  sidecarDisabledNotRequiredForReadOnlyShadow: ${report.recoverability.sidecarDisabledNotRequiredForReadOnlyShadow}`,
  );
  lines.push(
    `  activeOrRecentSessionSkipped:              ${report.recoverability.activeOrRecentSessionSkipped}`,
  );
  if (!report.recoverability.pass) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Failure reasons:',
        zh: '失败原因：',
      }),
    );
    for (const r of report.recoverability.reasons) {
      lines.push(`  - ${r}`);
    }
  }
  lines.push('');
  lines.push(
    getLocalizedText({
      en: 'Notes:',
      zh: '说明：',
    }),
  );
  for (const note of report.notes) {
    lines.push(`  - ${note}`);
  }
  lines.push('');
  lines.push(
    getLocalizedText({
      en: 'shadow only / no source files changed / W149-G required for copy-compress',
      zh: 'shadow only / 未修改任何源文件 / 真实压缩需要 W149-G 单独 GO',
    }),
  );
  return lines.join('\n');
}

function SidecarGovernanceCompressionShadowPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const report = await generateArchiveCompressionShadowReport({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatCompressionShadow(report));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance compression shadow 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance compression shadow failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W149-F: /memory-sidecar governance compression apply --dry-run
//         /memory-sidecar governance compression apply --confirm <8hex>
// Apply gate ONLY. Both paths emit dryRun=true; confirm verifies the
// token + sidecar-disabled + recoverability + plan-drift gates and
// reports a "noop-confirmed" status. NO compressed files are written;
// archive is byte-stable. W149-G is the only wave that may actually
// copy-compress, and it is gated on a separate Allen GO.
function formatCompressionApplyDryRun(
  result: ArchiveCompressionApplyDryRun,
): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: '✓ Archive compression apply gate (dry-run, no archive files changed)',
      zh: '✓ 归档压缩 apply gate（dry-run，未修改任何归档文件）',
    }),
  );
  lines.push('');
  lines.push(`projectId: ${result.resolvedProjectId}`);
  lines.push(`memoryDir: ${result.memoryDir}`);
  lines.push(`sidecarDisabled: ${result.sidecarDisabled}`);
  lines.push(`status: ${result.status}${result.blocked ? ` (blocked: ${result.blocked})` : ''}`);
  if (result.detail) lines.push(`detail: ${result.detail}`);
  lines.push(`scannedSessions: ${result.shadow.scannedSessions}`);
  lines.push(`estimatedSavingsBytes: ${result.estimatedSavingsBytes}`);
  lines.push(`token: ${result.token}`);
  lines.push(`expiresAt: ${result.expiresAt}`);
  lines.push('');
  lines.push(`confirmCommand: ${result.confirmCommand}`);
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Warnings:',
        zh: '警告：',
      }),
    );
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  if (result.recommendedActions.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Recommended next actions:',
        zh: '建议的下一步：',
      }),
    );
    for (const a of result.recommendedActions) lines.push(`  - ${a}`);
  }
  lines.push('');
  lines.push(
    getLocalizedText({
      en: 'Notes:',
      zh: '说明：',
    }),
  );
  for (const note of result.notes) lines.push(`  - ${note}`);
  return lines.join('\n');
}

function formatCompressionApplyConfirm(
  result: ArchiveCompressionApplyConfirm,
): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: '✓ Archive compression apply gate confirmed (still dry-run, no archive files changed)',
      zh: '✓ 归档压缩 apply gate 已确认（仍是 dry-run，未修改任何归档文件）',
    }),
  );
  lines.push('');
  lines.push(`projectId: ${result.resolvedProjectId}`);
  lines.push(`memoryDir: ${result.memoryDir}`);
  lines.push(`sidecarDisabled: ${result.sidecarDisabled}`);
  lines.push(`status: ${result.status}${result.blocked ? ` (blocked: ${result.blocked})` : ''}`);
  if (result.detail) lines.push(`detail: ${result.detail}`);
  lines.push(`planDriftDetected: ${result.planDriftDetected}`);
  if (result.driftReason) lines.push(`driftReason: ${result.driftReason}`);
  lines.push(`scannedSessions: ${result.shadow.scannedSessions}`);
  lines.push(`durationMs: ${result.durationMs}`);
  lines.push(`archiveChanged: ${result.archiveChanged}`);
  lines.push(`compressedFilesWritten: ${result.compressedFilesWritten}`);
  lines.push('');
  lines.push(
    getLocalizedText({
      en: 'Notes:',
      zh: '说明：',
    }),
  );
  for (const note of result.notes) lines.push(`  - ${note}`);
  return lines.join('\n');
}

function SidecarGovernanceCompressionApplyDryRunPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const result = await createArchiveCompressionApplyDryRun({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatCompressionApplyDryRun(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance compression apply --dry-run 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance compression apply --dry-run failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function SidecarGovernanceCompressionApplyConfirmPanel({ onDone, token }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  token: string;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const result = await executeArchiveCompressionApplyConfirm({
          rootDir: config.homeDir,
          projectId,
          token,
        });
        if (cancelled) return;
        setOutput(formatCompressionApplyConfirm(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance compression apply --confirm 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance compression apply --confirm failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W167-A: /memory-sidecar governance compression write --dry-run
//         /memory-sidecar governance compression write --confirm <8hex>
// Real copy-compress v1. This writes `.jsonl.gz` shadow copies and
// manifests, while preserving source `.jsonl` files as authoritative.
function formatCompressionWriteDryRun(
  result: ArchiveCompressionWriteDryRun,
): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    en: '✓ Archive compression write plan (copy-compress shadow)',
    zh: '✓ 归档压缩写入计划（copy-compress shadow）',
  }));
  lines.push('');
  lines.push(`projectId: ${result.resolvedProjectId}`);
  lines.push(`memoryDir: ${result.memoryDir}`);
  lines.push(`sidecarDisabled: ${result.sidecarDisabled}`);
  lines.push(`status: ${result.status}${result.blocked ? ` (blocked: ${result.blocked})` : ''}`);
  if (result.detail) lines.push(`detail: ${result.detail}`);
  lines.push(`targets: ${result.targets.length}`);
  lines.push(`estimatedCompressedFiles: ${result.estimatedCompressedFiles}`);
  lines.push(`estimatedManifestFiles: ${result.estimatedManifestFiles}`);
  lines.push(`estimatedSavingsBytes: ${result.estimatedSavingsBytes}`);
  lines.push(`safeToExecuteNow: ${result.safeToExecuteNow}`);
  lines.push(`token: ${result.token}`);
  lines.push(`expiresAt: ${result.expiresAt}`);
  lines.push('');
  lines.push(`confirmCommand: ${result.confirmCommand}`);
  if (result.targets.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ en: 'Target preview:', zh: '目标预览：' }));
    for (const target of result.targets.slice(0, 5)) {
      lines.push(`  - ${target.sessionId}: ${target.sourceBytes} → ~${target.estimatedCompressedBytes}`);
    }
    if (result.targets.length > 5) {
      lines.push(`  - …and ${result.targets.length - 5} more`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ en: 'Warnings:', zh: '警告：' }));
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  if (result.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ en: 'Recommended next actions:', zh: '建议的下一步：' }));
    for (const action of result.recommendedActions) lines.push(`  - ${action}`);
  }
  lines.push('');
  lines.push(getLocalizedText({ en: 'Notes:', zh: '说明：' }));
  for (const note of result.notes) lines.push(`  - ${note}`);
  return lines.join('\n');
}

function formatCompressionWriteConfirm(
  result: ArchiveCompressionWriteConfirm,
): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    en: '✓ Archive compression write completed (source .jsonl retained)',
    zh: '✓ 归档压缩写入完成（源 .jsonl 已保留）',
  }));
  lines.push('');
  lines.push(`projectId: ${result.resolvedProjectId}`);
  lines.push(`memoryDir: ${result.memoryDir}`);
  lines.push(`sidecarDisabled: ${result.sidecarDisabled}`);
  lines.push(`status: ${result.status}${result.blocked ? ` (blocked: ${result.blocked})` : ''}`);
  if (result.detail) lines.push(`detail: ${result.detail}`);
  lines.push(`planDriftDetected: ${result.planDriftDetected}`);
  if (result.driftReason) lines.push(`driftReason: ${result.driftReason}`);
  lines.push(`durationMs: ${result.durationMs}`);
  lines.push(`sourceArchiveChanged: ${result.sourceArchiveChanged}`);
  lines.push(`compressedFilesWritten: ${result.compressedFilesWritten}`);
  lines.push(`manifestsWritten: ${result.manifestsWritten}`);
  if (result.results.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ en: 'Results:', zh: '结果：' }));
    for (const item of result.results.slice(0, 5)) {
      lines.push(`  - ${item.sessionId}: ${item.status}, sourceUnchanged=${item.sourceUnchanged}, compressedBytes=${item.compressedBytes}`);
      if (item.errorMessage) lines.push(`    error: ${item.errorMessage}`);
    }
    if (result.results.length > 5) {
      lines.push(`  - …and ${result.results.length - 5} more`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({ en: 'Notes:', zh: '说明：' }));
  for (const note of result.notes) lines.push(`  - ${note}`);
  return lines.join('\n');
}

function SidecarGovernanceCompressionWriteDryRunPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const result = await createArchiveCompressionWriteDryRun({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatCompressionWriteDryRun(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance compression write --dry-run 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance compression write --dry-run failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function SidecarGovernanceCompressionWriteConfirmPanel({ onDone, token }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  token: string;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const result = await executeArchiveCompressionWriteConfirm({
          rootDir: config.homeDir,
          projectId,
          token,
        });
        if (cancelled) return;
        setOutput(formatCompressionWriteConfirm(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance compression write --confirm 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance compression write --confirm failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

// W146: /memory-sidecar governance apply <scope> --dry-run
//       /memory-sidecar governance apply --confirm <token>
//
// Minimal executable governance gate. Only profile/proposal derived
// data can execute; archive compression/export/sqlite rebuild stay
// outside this apply surface. Confirm requires sidecar disabled and
// uses an in-memory one-shot token.
function SidecarGovernanceApplyPanel({ onDone, scope, token }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  scope?: GovernanceApplyScope;
  token?: string;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);

  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // W146.1: governance apply is a write face. If config cannot be
      // read we MUST stop — never run apply against a default-config
      // fallback because that could touch the wrong project's memoryDir.
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        if (token) {
          const result = await executeMemoryStorageGovernanceApply({
            rootDir: config.homeDir,
            projectId,
            token,
          });
          if (!cancelled) setOutput(formatGovernanceApplyExecution(result));
          return;
        }
        const result = await createMemoryStorageGovernanceApplyDryRun({
          rootDir: config.homeDir,
          projectId,
          scope: scope ?? 'all',
        });
        if (!cancelled) setOutput(formatGovernanceApplyDryRun(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `governance apply 失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `governance apply failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatGovernanceReport(r: MemoryStorageGovernanceReport): string {
  const lines: string[] = [];
  const riskLabel = r.risk.level === 'ok'
    ? getLocalizedText({ zh: 'ok', en: 'ok' })
    : r.risk.level === 'warn'
      ? getLocalizedText({ zh: '需关注', en: 'warn' })
      : getLocalizedText({ zh: '高风险', en: 'high' });
  lines.push(getLocalizedText({
    zh: `记忆存储治理: ${riskLabel}`,
    en: `Memory storage governance: ${riskLabel}`,
  }));
  lines.push(`projectId: ${r.projectId}`);
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(`resolvedProjectId: ${r.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${r.memoryDir}`);
  lines.push('');

  // archive
  lines.push('archive:');
  lines.push(`  events: ${r.archive.events}`);
  lines.push(`  sessions: ${r.archive.sessions}`);
  lines.push(`  jsonlBytes: ${formatBytes(r.archive.jsonlBytes)}`);
  if (r.archive.largestSessionBytes > 0) {
    lines.push(`  largestSessionBytes: ${formatBytes(r.archive.largestSessionBytes)}`);
  }
  if (r.archive.oldestEventAt) lines.push(`  oldest: ${r.archive.oldestEventAt}`);
  if (r.archive.latestEventAt) lines.push(`  latest: ${r.archive.latestEventAt}`);
  if (r.archive.monthlyBuckets.length > 0) {
    const summary = r.archive.monthlyBuckets
      .map(b => `${b.month}=${b.events}`)
      .join(' ');
    lines.push(`  monthlyBuckets: ${summary}`);
  }
  lines.push('');

  // sqlite
  lines.push('sqlite:');
  lines.push(`  present: ${r.sqlite.present ? 'yes' : 'no'}`);
  lines.push(`  bytes: ${formatBytes(r.sqlite.bytes)}`);
  if (r.sqlite.rowCount !== null) lines.push(`  rows: ${r.sqlite.rowCount}`);
  if (r.sqlite.error) lines.push(`  error: ${r.sqlite.error}`);
  lines.push('');

  // observations
  lines.push('observations:');
  lines.push(`  total: ${r.observations.total}`);
  if (r.observations.latestAt) lines.push(`  latest: ${r.observations.latestAt}`);

  // profiles
  lines.push('profiles:');
  lines.push(`  snapshots: ${r.profiles.snapshots}`);
  lines.push(`  recommendedKeep: ${r.profiles.recommendedKeep}`);
  lines.push(`  redundant: ${r.profiles.redundantCount}`);
  if (r.profiles.latestAt) lines.push(`  latest: ${r.profiles.latestAt}`);

  // proposals
  lines.push('proposals:');
  lines.push(`  total: ${r.proposals.total}`);
  lines.push(`  candidate: ${r.proposals.candidate}`);
  lines.push(`  accepted: ${r.proposals.accepted}`);
  lines.push(`  rejected: ${r.proposals.rejected}`);
  lines.push(`  deferred: ${r.proposals.deferred}`);
  lines.push(`  staleCandidates: ${r.proposals.staleCandidateCount}`);

  // jobs / dirty
  lines.push('jobsAndDirty:');
  lines.push(`  dirtyTotal: ${r.jobsAndDirty.dirtyTotal}`);
  lines.push(`  dirtyUnconsumed: ${r.jobsAndDirty.dirtyUnconsumed}`);
  lines.push(`  jobsTotal: ${r.jobsAndDirty.jobsTotal}`);
  lines.push(`  pending: ${r.jobsAndDirty.pending}`);
  lines.push(`  failed: ${r.jobsAndDirty.failed}`);
  lines.push(`  retrying: ${r.jobsAndDirty.retrying}`);
  lines.push(`  exhausted: ${r.jobsAndDirty.exhausted}`);
  lines.push('');

  // policy (display-only — W145 does not persist custom policy)
  lines.push('policy:');
  lines.push(`  archiveWarnBytes: ${formatBytes(r.policy.archiveWarnBytes)}`);
  lines.push(`  archiveHighBytes: ${formatBytes(r.policy.archiveHighBytes)}`);
  lines.push(`  profileKeepLatest: ${r.policy.profileKeepLatest}`);
  lines.push(`  proposalCandidateKeepLatest: ${r.policy.proposalCandidateKeepLatest}`);
  lines.push(`  staleProposalDays: ${r.policy.staleProposalDays}`);
  lines.push(`  monthlyBucketLimit: ${r.policy.monthlyBucketLimit}`);
  lines.push('');

  // risk + warnings
  lines.push(`risk: ${r.risk.level}`);
  if (r.risk.reasons.length > 0) {
    lines.push(getLocalizedText({ zh: 'reasons:', en: 'reasons:' }));
    for (const reason of r.risk.reasons) lines.push(`  - ${reason}`);
  }

  if (r.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  if (r.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const a of r.recommendedActions) lines.push(`  - ${a}`);
  }
  return lines.join('\n');
}

function formatGovernancePlan(p: MemoryStorageGovernancePlan): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: '记忆治理计划: dry-run only',
    en: 'Memory governance plan: dry-run only',
  }));
  lines.push(`projectId: ${p.projectId}`);
  if (p.resolvedProjectId !== p.projectId) {
    lines.push(`resolvedProjectId: ${p.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${p.memoryDir}`);
  lines.push(`estimatedReclaimBytes: ${formatBytes(p.estimatedReclaimBytes)}`);
  lines.push('');
  lines.push('actions:');
  for (const a of p.actions) {
    const reasonTail = a.reason ? ` — ${a.reason}` : '';
    lines.push(
      `  · ${a.id}: ${a.status} count=${a.count} safeToExecuteNow=${a.safeToExecuteNow}${reasonTail}`,
    );
    if (a.estimatedBytes !== undefined) {
      lines.push(`    estimatedBytes: ${formatBytes(a.estimatedBytes)}`);
    }
    if (a.targets && a.targets.length > 0) {
      lines.push(`    targets: ${a.targets.join(', ')}`);
    }
    if (a.blocked) {
      lines.push(`    blocked: ${a.blocked}`);
    }
    if (a.futureCommand) {
      lines.push(`    future: ${a.futureCommand}`);
    } else if (a.executableInW146 === false) {
      lines.push(`    future: deferred (not executable in W146)`);
    }
  }
  lines.push('');
  // W145/W146 boundary note: plan itself never deletes anything. W146
  // adds a separate apply dry-run/confirm route for two low-risk
  // derived-data actions only.
  lines.push(getLocalizedText({
    zh: 'plan 本身不会删除或压缩任何数据；W146 仅 profile/proposal 两类派生数据可用 futureCommand 生成一次性 token。',
    en: 'The plan itself never deletes or compresses data; in W146 only profile/proposal derived-data actions expose futureCommand token minting.',
  }));
  if (p.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const w of p.warnings) lines.push(`  - ${w}`);
  }
  if (p.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const a of p.recommendedActions) lines.push(`  - ${a}`);
  }
  return lines.join('\n');
}

function formatGovernanceApplyDryRun(r: GovernanceApplyDryRun): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `governance apply dry-run (token=${r.token})`,
    en: `governance apply dry-run (token=${r.token})`,
  }));
  lines.push(`projectId: ${r.projectId}`);
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(`resolvedProjectId: ${r.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${r.memoryDir}`);
  lines.push(`scope: ${r.scope}`);
  lines.push(`expiresAt: ${r.expiresAt}`);
  lines.push(`sidecarDisabled: ${r.sidecarDisabled ? 'yes' : 'no'}`);
  lines.push(`estimatedWrites: ${r.estimatedWrites}`);
  lines.push(`estimatedReclaimBytes: ${formatBytes(r.estimatedReclaimBytes)}`);
  lines.push('');
  lines.push('actions:');
  for (const a of r.actions) {
    const blocked = a.blocked ? ` blocked=${a.blocked}` : '';
    lines.push(
      `  · ${a.id}: ${a.status} count=${a.count} safeToExecute=${a.safeToExecute}${blocked}`,
    );
    if (a.estimatedBytes > 0) {
      lines.push(`    estimatedBytes: ${formatBytes(a.estimatedBytes)}`);
    }
    if (a.detail) {
      lines.push(`    detail: ${a.detail}`);
    }
    if (a.targets && a.targets.length > 0) {
      lines.push(`    targets: ${a.targets.join(', ')}`);
    }
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: `确认执行: ${r.confirmCommand}`,
    en: `To execute: ${r.confirmCommand}`,
  }));
  lines.push(getLocalizedText({
    zh: '安全边界: confirm 前会重新计算目标；token 一次性；必须先 disable 旁路记忆，避免 worker append 与 rewrite 竞态。',
    en: 'Safety boundary: confirm recomputes targets; token is one-shot; sidecar must be disabled first to avoid worker append/rewrite races.',
  }));
  if (r.warnings.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '警告:', en: 'warnings:' }));
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  if (r.recommendedActions.length > 0) {
    lines.push('');
    lines.push(getLocalizedText({ zh: '建议命令:', en: 'recommendedActions:' }));
    for (const a of r.recommendedActions) lines.push(`  - ${a}`);
  }
  return lines.join('\n');
}

function formatGovernanceApplyExecution(r: GovernanceApplyExecution): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `governance apply 执行完成 (${r.durationMs}ms)`,
    en: `governance apply complete (${r.durationMs}ms)`,
  }));
  lines.push(`projectId: ${r.projectId}`);
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(`resolvedProjectId: ${r.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${r.memoryDir}`);
  lines.push(`scope: ${r.scope}`);
  lines.push(
    `totals: executed=${r.totals.executed} skipped=${r.totals.skipped} blocked=${r.totals.blocked} failed=${r.totals.failed} reclaimed=${formatBytes(r.totals.reclaimedBytes)}`,
  );
  lines.push('');
  lines.push('results:');
  for (const item of r.results) {
    const blocked = item.blocked ? ` blocked=${item.blocked}` : '';
    const error = item.errorMessage ? ` error=${item.errorMessage}` : '';
    lines.push(
      `  · ${item.id}: ${item.status} count=${item.count} reclaimed=${formatBytes(item.reclaimedBytes)}${blocked}${error}`,
    );
    if (item.detail) lines.push(`    detail: ${item.detail}`);
  }
  lines.push('');
  lines.push(`summary: ${r.summary}`);
  lines.push(getLocalizedText({
    zh: 'archive / observations / dirty / jobs 未被 governance apply 触碰。',
    en: 'archive / observations / dirty / jobs were not touched by governance apply.',
  }));
  return lines.join('\n');
}

// W122-B: /memory-sidecar repair — DRY-RUN. Generates a plan with a 8-hex
// token (10-min TTL, single-use) describing what would be written. No fs
// writes. failed-jobs is always blocked (job-queue immutable).
function SidecarRepairPlanPanel({ onDone }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const plan = await getMemorySidecarRepairPlan({
          rootDir: config.homeDir,
          projectId,
        });
        if (cancelled) return;
        setOutput(formatRepairPlan(plan));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `repair 计划生成失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `repair plan generation failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatRepairPlan(p: RepairPlan): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `[dry-run] 修复计划 (token=${p.token}, 有效至 ${p.expiresAt})`,
    en: `[dry-run] repair plan (token=${p.token}, expiresAt ${p.expiresAt})`,
  }));
  lines.push(`projectId: ${p.projectId}`);
  if (p.resolvedProjectId !== p.projectId) {
    lines.push(`resolvedProjectId: ${p.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${p.memoryDir}`);
  lines.push(`estimatedWrites: ${p.estimatedWrites}`);
  lines.push('');
  lines.push(`actions:`);
  for (const a of p.actions) {
    const flag = a.safeToExecute ? '✓' : '·';
    lines.push(`  ${flag} ${a.id}: ${a.status} (count=${a.count}, safeToExecute=${a.safeToExecute})`);
    if (a.detail) lines.push(`      ${a.detail}`);
    if (a.blocked) lines.push(`      blocked: ${a.blocked}`);
    if (a.targets && a.targets.length > 0) {
      const preview = a.targets.slice(0, 3).join(', ');
      const more = a.targets.length > 3 ? ` (+${a.targets.length - 3} more)` : '';
      lines.push(`      targets: ${preview}${more}`);
    }
    if (a.recommendedAction) lines.push(`      → ${a.recommendedAction}`);
  }
  if (p.warnings.length > 0) {
    lines.push('');
    lines.push(`warnings:`);
    for (const w of p.warnings) lines.push(`  - ${w}`);
  }
  if (p.recommendedActions.length > 0) {
    lines.push('');
    lines.push(`recommendedActions:`);
    for (const a of p.recommendedActions) lines.push(`  - ${a}`);
  }
  lines.push('');
  lines.push(getLocalizedText({
    zh: `执行: ${p.confirmCommand}`,
    en: `to execute: ${p.confirmCommand}`,
  }));
  return lines.join('\n');
}

// W122-B: /memory-sidecar repair --confirm <token> — single-use token
// consumption. Re-derives plan at execute time; only safeToExecute=true
// actions run. Token is deleted from store BEFORE any disk write.
function SidecarRepairConfirmPanel({ onDone, token }: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  token: string;
}) {
  const cwd = getOriginalCwd();
  const projectId = projectIdFromCwd(cwd);
  const [output, setOutput] = useState<string | null>(null);
  const didCallOnDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // W146.1: repair confirm is a write face. If config cannot be
      // read we MUST stop — never run mutation against a default-config
      // fallback because that could touch the wrong project's memoryDir.
      const cfg = loadConfigSafe();
      if (cfg.ok === false) {
        if (!cancelled) setOutput(configReadFailureText(cfg.safeMessage));
        return;
      }
      const config = cfg.config;
      try {
        const result = await executeMemorySidecarRepairPlan({
          rootDir: config.homeDir,
          projectId,
          token,
        });
        if (cancelled) return;
        setOutput(formatRepairExecution(result));
      } catch (e) {
        if (!cancelled) {
          setOutput(getLocalizedText({
            zh: `repair 执行失败: ${e instanceof Error ? e.message : String(e)}`,
            en: `repair execute failed: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (output && !didCallOnDoneRef.current) {
    didCallOnDoneRef.current = true;
    onDone(output, { display: 'system' });
  }
  return null;
}

function formatRepairExecution(r: RepairExecution): string {
  const lines: string[] = [];
  lines.push(getLocalizedText({
    zh: `repair 执行完成 (${r.durationMs}ms)`,
    en: `repair execution finished (${r.durationMs}ms)`,
  }));
  lines.push(`projectId: ${r.projectId}`);
  if (r.resolvedProjectId !== r.projectId) {
    lines.push(`resolvedProjectId: ${r.resolvedProjectId}`);
  }
  lines.push(`memoryDir: ${r.memoryDir}`);
  lines.push('');
  lines.push(`totals: executed=${r.totals.executed} skipped=${r.totals.skipped} failed=${r.totals.failed} blocked=${r.totals.blocked}`);
  lines.push('');
  lines.push(`results:`);
  for (const a of r.results) {
    const tail = a.errorMessage ? ` — ${a.errorMessage}` : '';
    lines.push(`  ${a.id}: ${a.status} (count=${a.count})${tail}`);
    if (a.detail) lines.push(`      ${a.detail}`);
  }
  lines.push('');
  lines.push(r.summary);
  return lines.join('\n');
}

// W122-A: parse `--query <text>` (the only flag doctor/recall-test accept).
// Tokens are whitespace-separated; the first non-flag token after the flag
// is the value. Returns undefined when not found or value is missing.
function parseQueryArg(rest: string): string | undefined {
  if (!rest) return undefined;
  const parts = rest.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === '--query') {
      const value = parts[i + 1];
      if (!value || value.startsWith('--')) return undefined;
      return value;
    }
  }
  // bare positional query — accept "doctor foo bar" by joining the tail.
  if (!parts[0].startsWith('--')) return parts.join(' ');
  return undefined;
}

function renderMemorySidecarOverview(): string {
  return getLocalizedText({
    zh: `旁路记忆系统总览:

常用路径:
  1. 看状态:      /memory-sidecar status
  2. 查记忆:      /memory-sidecar recall <query> --explain
  3. 看采集规则:  /memory-sidecar explain-capture
  4. 跑质量探针:  /memory-sidecar recall-test
  5. 看 worker:   /memory-sidecar worker status
  6. Agent 交接:  /memory-sidecar agent-handoff <jobId> --dry-run
  7. 清运行噪声:  /memory-sidecar retention --dry-run
  8. 审核候选:    /memory-sidecar proposals

安全边界:
  - 普通对话不依赖旁路记忆；sidecar 失败应降级，不应崩主循环。
  - Agent handoff 只生成 candidate proposal，不会自动 accepted。
  - retention 只处理 dead-letter/jobs 运行噪声，不删除 archive/observations/profiles/proposals。

提示: 运行 /memory-sidecar 查看完整命令清单；运行 /memory-sidecar guide 只看这份总览。`,
    en: `Memory sidecar overview:

Common paths:
  1. Check status:       /memory-sidecar status
  2. Recall memories:    /memory-sidecar recall <query> --explain
  3. Inspect memories:   /memory-sidecar memories
  4. Explain capture:    /memory-sidecar explain-capture
  5. Run quality probes: /memory-sidecar recall-test
  6. Check worker:       /memory-sidecar worker status
  7. Agent handoff:      /memory-sidecar agent-handoff <jobId> --dry-run
  8. Clean runtime noise:/memory-sidecar retention --dry-run
  9. Review candidates:  /memory-sidecar proposals

Safety boundaries:
  - Normal chat does not depend on sidecar memory; sidecar failures should degrade, not crash the main loop.
  - Agent handoff only creates candidate proposals; it never auto-accepts them.
  - Retention only handles dead-letter/jobs runtime noise; it never deletes archive/observations/profiles/proposals.

Tip: run /memory-sidecar for the full command inventory; run /memory-sidecar guide for only this overview.`,
  });
}

// ---------------------------------------------------------------------------
// Route: /memory-sidecar <subcommand>
// ---------------------------------------------------------------------------

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args?.trim() ?? '';

  // No args: show usage
  if (!trimmed) {
    const fullCommandList = getLocalizedText({
      zh: `旁路记忆系统命令:
  /memory-sidecar status              查看状态 (含健康分 / 警告 / 建议)
  /memory-sidecar enable              启用
  /memory-sidecar disable             关闭
  /memory-sidecar recall <query>      检索记忆
  /memory-sidecar recall <query> --explain
                                      解释命中来源 / 过滤 / token 预算
  /memory-sidecar memories            只读查看 observations/profiles/proposals 概览
  /memory-sidecar memories --scope <scope> --type <type> --limit <n>
                                      按范围/类型过滤记忆概览
  /memory-sidecar forget <observationId> --dry-run
                                      生成 observation 抑制计划 (不删 archive)
  /memory-sidecar forget <observationId> --confirm <8hex>
                                      追加抑制记录 (never_inject, 不删除原始来源)
  /memory-sidecar recall-test         跑 4 个固定召回探针 (只读)
  /memory-sidecar doctor              14 项只读诊断 (含 healthScore)
  /memory-sidecar doctor --query <q>  指定召回探针查询
  /memory-sidecar explain-capture     解释会采集与不会采集的内容
  /memory-sidecar llm status          LLM 整理状态
  /memory-sidecar llm config --show   查看当前 LLM 配置
  /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV>
                                      配置独立 LLM provider
  /memory-sidecar llm enable          启用 LLM
  /memory-sidecar llm disable         关闭 LLM
  /memory-sidecar llm test            测试 LLM 配置
  /memory-sidecar worker status       worker 状态
  /memory-sidecar worker run-once     运行一次 worker
  /memory-sidecar agent-handoff <jobId> --dry-run
                                      将 Agent View 结果预览为候选记忆
  /memory-sidecar agent-handoff <jobId> --confirm
                                      写入 candidate proposal (不自动 accepted)
  /memory-sidecar proposals           列出 candidate proposals
  /memory-sidecar proposals show <proposalId>
                                      查看候选记忆详情与证据
  /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>
                                      审核候选记忆 (追加式记录, 不自动注入)
  /memory-sidecar storage status      查看 storage/归档大小与转移建议
  /memory-sidecar storage export --out-dir <dir>
                                      复制归档数据到外部目录 (不删除原数据)
  /memory-sidecar storage cleanup [dead-letter|jobs|all] --dry-run
                                      清理运行噪声计划 (不碰原始记忆)
  /memory-sidecar storage cleanup --confirm <token>
                                      执行 storage cleanup 计划
  /memory-sidecar retention --dry-run
                                      长期保留清理计划 (只删 dead-letter/jobs)
  /memory-sidecar retention --confirm <8hex>
                                      执行 retention 计划 (内容寻址 token)
  /memory-sidecar governance status   长期记忆治理观测 (只读, 含风险评级 + 月度桶)
  /memory-sidecar governance plan     治理计划 (dry-run only, 不删除任何数据)
  /memory-sidecar governance apply <profile-prune-redundant|proposal-prune-stale-candidates|all> --dry-run
                                      生成治理执行 token (要求 confirm 前先 disable)
  /memory-sidecar governance apply --confirm <token>
                                      执行 profile/proposal 派生数据治理
  /memory-sidecar governance apply sqlite-rebuild-index --dry-run
                                      W149-B 重建 sqlite 索引 (token-gated, archive 不变)
  /memory-sidecar governance apply archive-export-project-bundle --dry-run
                                      W149-C 导出项目 bundle 到 ~/.mossen/.../exports
  /memory-sidecar governance compression shadow
                                      W149-E archive 压缩影子报告 (只读, 不写 .gz)
  /memory-sidecar governance compression apply --dry-run
                                      W149-F 压缩 apply gate dry-run (永不写 .gz)
  /memory-sidecar governance compression apply --confirm <8hex>
                                      W149-F 压缩 apply gate 确认 (依旧 dry-run)
  /memory-sidecar governance compression write --dry-run
                                      W167-A 压缩写入计划 (copy-compress shadow)
  /memory-sidecar governance compression write --confirm <8hex>
                                      W167-A 写 .jsonl.gz 影子副本 (源 .jsonl 保留)
  /memory-sidecar repair              生成只读修复计划 (附 8-hex token, 10 分钟有效)
  /memory-sidecar repair --confirm <token>
                                      执行修复计划 (一次性消费, 仅 safeToExecute=true)`,
      en: `Memory sidecar commands:
  /memory-sidecar status              Show status (with healthScore / warnings / actions)
  /memory-sidecar enable              Enable sidecar
  /memory-sidecar disable             Disable sidecar
  /memory-sidecar recall <query>      Retrieve memories
  /memory-sidecar recall <query> --explain
                                      Explain sources / filters / token budget
  /memory-sidecar memories            Read-only overview of observations/profiles/proposals
  /memory-sidecar memories --scope <scope> --type <type> --limit <n>
                                      Filter the memory overview by scope/type
  /memory-sidecar forget <observationId> --dry-run
                                      Plan observation suppression (archive stays intact)
  /memory-sidecar forget <observationId> --confirm <8hex>
                                      Append suppression record (never_inject, no source delete)
  /memory-sidecar recall-test         Run 4 fixed recall probes (read-only)
  /memory-sidecar doctor              14-check read-only diagnostics (with healthScore)
  /memory-sidecar doctor --query <q>  Bias the retrieval probe query
  /memory-sidecar explain-capture     Explain captured / not-captured / redacted
  /memory-sidecar llm status          LLM classification status
  /memory-sidecar llm config --show   Show current LLM config
  /memory-sidecar llm config --base-url <url> --model <id> --api-key-env <ENV>
                                      Configure independent LLM provider
  /memory-sidecar llm enable          Enable LLM
  /memory-sidecar llm disable         Disable LLM
  /memory-sidecar llm test            Test LLM config
  /memory-sidecar worker status       Worker status
  /memory-sidecar worker run-once     Run one worker cycle
  /memory-sidecar agent-handoff <jobId> --dry-run
                                      Preview Agent View result as a memory candidate
  /memory-sidecar agent-handoff <jobId> --confirm
                                      Write candidate proposal (never auto-accepted)
  /memory-sidecar proposals           List candidate proposals
  /memory-sidecar proposals show <proposalId>
                                      Show candidate detail and evidence
  /memory-sidecar proposals review <proposalId> --accept|--reject --reason <text>
                                      Review memory candidates (append-only, no auto-inject)
  /memory-sidecar storage status      Show storage/archive size and transfer guidance
  /memory-sidecar storage export --out-dir <dir>
                                      Copy archive data to an external dir (no delete)
  /memory-sidecar storage cleanup [dead-letter|jobs|all] --dry-run
                                      Plan runtime-noise cleanup (keeps memories)
  /memory-sidecar storage cleanup --confirm <token>
                                      Execute storage cleanup plan
  /memory-sidecar retention --dry-run
                                      Long-term retention cleanup plan (dead-letter/jobs only)
  /memory-sidecar retention --confirm <8hex>
                                      Execute retention plan (content-addressed token)
  /memory-sidecar governance status   Long-term memory governance (read-only; risk + monthly buckets)
  /memory-sidecar governance plan     Governance plan (dry-run only; no data is deleted)
  /memory-sidecar governance apply <profile-prune-redundant|proposal-prune-stale-candidates|all> --dry-run
                                      Mint a governance apply token (disable before confirm)
  /memory-sidecar governance apply --confirm <token>
                                      Execute profile/proposal derived-data governance
  /memory-sidecar governance apply sqlite-rebuild-index --dry-run
                                      W149-B rebuild sqlite index (token-gated; archive untouched)
  /memory-sidecar governance apply archive-export-project-bundle --dry-run
                                      W149-C export project bundle to ~/.mossen/.../exports
  /memory-sidecar governance compression shadow
                                      W149-E archive compression shadow report (read-only; no .gz)
  /memory-sidecar governance compression apply --dry-run
                                      W149-F compression apply gate dry-run (never writes .gz)
  /memory-sidecar governance compression apply --confirm <8hex>
                                      W149-F compression apply gate confirm (still dry-run)
  /memory-sidecar governance compression write --dry-run
                                      W167-A compression write plan (copy-compress shadow)
  /memory-sidecar governance compression write --confirm <8hex>
                                      W167-A write .jsonl.gz shadow copies (source .jsonl retained)
  /memory-sidecar repair              Generate read-only repair plan (8-hex token, 10-min TTL)
  /memory-sidecar repair --confirm <token>
                                      Execute repair plan (single-use, only safeToExecute=true)`,
    });
    onDone(`${renderMemorySidecarOverview()}\n\n---\n\n${fullCommandList}`, { display: 'system' });
    return null;
  }

  // /memory-sidecar overview|guide — W337 friendly entry point.
  if (trimmed === 'overview' || trimmed === 'guide') {
    onDone(renderMemorySidecarOverview(), { display: 'system' });
    return null;
  }

  // /memory-sidecar status
  if (trimmed === 'status') {
    return <SidecarStatusPanel onDone={onDone} />;
  }

  // /memory-sidecar enable
  if (trimmed === 'enable') {
    return <SidecarEnablePanel onDone={onDone} />;
  }

  // /memory-sidecar disable
  if (trimmed === 'disable') {
    return <SidecarDisablePanel onDone={onDone} />;
  }

  // /memory-sidecar recall-test [--query <text>] (W122-A) — must come BEFORE
  // the `recall` route since both share the `recall` prefix.
  if (trimmed === 'recall-test' || trimmed.startsWith('recall-test ')) {
    const rest = trimmed.slice('recall-test'.length).trim();
    const queryArg = parseQueryArg(rest);
    return <SidecarRecallTestPanel onDone={onDone} query={queryArg} />;
  }

  // /memory-sidecar memories [--scope <scope>] [--type <type>] [--limit <n>]
  // W360.5: read-only trust surface so users can see what the sidecar
  // remembers before deciding to recall, review, or suppress anything.
  if (trimmed === 'memories' || trimmed.startsWith('memories ')) {
    const rest = trimmed.slice('memories'.length).trim();
    return <SidecarMemoriesPanel onDone={onDone} args={rest} />;
  }

  // /memory-sidecar forget <observationId> --dry-run|--confirm <8hex>
  // This is an append-only suppression path, not an archive/source delete.
  if (trimmed === 'forget' || trimmed.startsWith('forget ')) {
    const rest = trimmed.slice('forget'.length).trim();
    return <SidecarForgetPanel onDone={onDone} args={rest} />;
  }

  // /memory-sidecar recall <query>
  if (trimmed.startsWith('recall')) {
    const query = trimmed.slice(6).trim();
    return <SidecarRecallPanel onDone={onDone} args={query} />;
  }

  // /memory-sidecar doctor [--query <text>] (W122-A)
  if (trimmed === 'doctor' || trimmed.startsWith('doctor ')) {
    const rest = trimmed.slice('doctor'.length).trim();
    const queryArg = parseQueryArg(rest);
    return <SidecarDoctorPanel onDone={onDone} query={queryArg} />;
  }

  // /memory-sidecar explain-capture (W122-A)
  if (trimmed === 'explain-capture') {
    return <SidecarExplainCapturePanel onDone={onDone} />;
  }

  // /memory-sidecar llm status
  if (trimmed === 'llm status') {
    return <SidecarLlmStatusPanel onDone={onDone} />;
  }

  // /memory-sidecar llm config --show or --base-url <url> --model <id> --api-key-env <ENV>
  if (trimmed.startsWith('llm config')) {
    const configArgs = trimmed.slice(11).trim();
    const parts = configArgs.split(/\s+/);
    // W119 M8: getValue must NOT swallow the next flag as a value.
    // `--base-url --model gpt-4` previously bound baseUrl="--model".
    // Now any value that starts with `--` is treated as missing.
    const getValue = (flag: string) => {
      const idx = parts.indexOf(flag);
      if (idx < 0) return '';
      const next = parts[idx + 1];
      if (!next || next.startsWith('--')) return '';
      return next;
    };
    return <SidecarLlmConfigPanel
      onDone={onDone}
      baseUrl={getValue('--base-url')}
      model={getValue('--model')}
      apiKeyEnv={getValue('--api-key-env')}
      show={parts.includes('--show')}
    />;
  }

  // /memory-sidecar llm enable
  if (trimmed === 'llm enable') {
    return <SidecarLlmEnablePanel onDone={onDone} />;
  }

  // /memory-sidecar llm disable
  if (trimmed === 'llm disable') {
    return <SidecarLlmDisablePanel onDone={onDone} />;
  }

  // /memory-sidecar llm test
  if (trimmed === 'llm test') {
    return <SidecarLlmTestPanel onDone={onDone} />;
  }

  // /memory-sidecar worker status
  if (trimmed === 'worker status') {
    return <SidecarWorkerStatusPanel onDone={onDone} />;
  }

  // /memory-sidecar worker run-once
  if (trimmed === 'worker run-once') {
    return <SidecarWorkerRunOncePanel onDone={onDone} />;
  }

  // W311: /memory-sidecar agent-handoff <jobId> --dry-run|--confirm
  // Explicit bridge from Agent View structured results to memory
  // candidate proposals. This never auto-accepts or auto-injects.
  if (trimmed === 'agent-handoff' || trimmed.startsWith('agent-handoff ')) {
    const rest = trimmed.slice('agent-handoff'.length).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const jobId = parts.find(part => !part.startsWith('--')) ?? '';
    const confirm = parts.includes('--confirm');
    const dryRun = parts.includes('--dry-run');
    if (!jobId || (!confirm && !dryRun)) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar agent-handoff <jobId> --dry-run，然后 /memory-sidecar agent-handoff <jobId> --confirm',
        en: 'Usage: /memory-sidecar agent-handoff <jobId> --dry-run, then /memory-sidecar agent-handoff <jobId> --confirm',
      }), { display: 'system' });
      return null;
    }
    return <SidecarAgentHandoffPanel onDone={onDone} jobId={jobId} confirm={confirm} />;
  }

  // W339: /memory-sidecar proposals
  // User-facing review surface for candidate proposals. Review appends a
  // status transition record through proposalStore.reviewProposal; it never
  // rewrites proposals.jsonl in place and never injects content into chat.
  if (trimmed === 'proposals' || trimmed.startsWith('proposals ')) {
    const rest = trimmed.slice('proposals'.length).trim();
    return <SidecarProposalReviewPanel onDone={onDone} args={rest} />;
  }

  // W145: /memory-sidecar governance status — long-term storage
  // governance observability (dry-run only). NOT to be confused with
  // /memory-sidecar storage status which is the W132/W138 file-level
  // maintenance / cleanup surface and is unchanged.
  if (trimmed === 'governance status' || trimmed === 'governance') {
    return <SidecarGovernanceStatusPanel onDone={onDone} />;
  }

  // W145: /memory-sidecar governance plan — dry-run only. W146 adds a
  // separate apply dry-run/confirm route for profile/proposal derived
  // data; this plan route itself still never mutates.
  if (trimmed === 'governance plan') {
    return <SidecarGovernancePlanPanel onDone={onDone} />;
  }

  // W149-E: /memory-sidecar governance compression shadow — read-only
  // shadow plan + recoverability report. NEVER writes a compressed
  // file, never modifies any source. W149-F adds a separate apply
  // gate (also dry-run-only); W149-G is the only wave that may
  // actually copy-compress, and is gated on a separate Allen GO.
  if (
    trimmed === 'governance compression shadow' ||
    trimmed === 'governance compression'
  ) {
    return <SidecarGovernanceCompressionShadowPanel onDone={onDone} />;
  }

  // W149-F: /memory-sidecar governance compression apply
  //   --dry-run                     → 8-hex token + 10-min TTL
  //   --confirm <8-hex token>       → still dry-run (apply gate only)
  // No archive byte is written by either path. Confirm verifies the
  // sidecar-disabled gate, recoverability invariants, and
  // shadow-plan-drift between dry-run and confirm.
  if (
    trimmed === 'governance compression apply' ||
    trimmed.startsWith('governance compression apply ')
  ) {
    const rest = trimmed.slice('governance compression apply'.length).trim();
    const restParts = rest.split(/\s+/).filter(Boolean);
    const confirmIdx = restParts.indexOf('--confirm');
    if (confirmIdx >= 0) {
      const token = restParts[confirmIdx + 1];
      if (!token || token.startsWith('--')) {
        onDone(getLocalizedText({
          zh: 'governance compression apply --confirm 缺少 token (8 hex 字符)',
          en: 'governance compression apply --confirm requires a token (8 hex chars)',
        }));
        return null;
      }
      if (!/^[0-9a-f]{8}$/.test(token)) {
        onDone(getLocalizedText({
          zh: 'governance compression apply --confirm token 必须为 8 位 hex',
          en: 'governance compression apply --confirm token must be 8 hex chars',
        }));
        return null;
      }
      return (
        <SidecarGovernanceCompressionApplyConfirmPanel
          onDone={onDone}
          token={token}
        />
      );
    }
    if (!rest.includes('--dry-run')) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar governance compression apply --dry-run，然后 /memory-sidecar governance compression apply --confirm <8 位 hex>',
        en: 'Usage: /memory-sidecar governance compression apply --dry-run, then /memory-sidecar governance compression apply --confirm <8-hex token>',
      }));
      return null;
    }
    return <SidecarGovernanceCompressionApplyDryRunPanel onDone={onDone} />;
  }

  // W167-A: /memory-sidecar governance compression write
  //   --dry-run                     → 8-hex token + 10-min TTL
  //   --confirm <8-hex token>       → writes .jsonl.gz shadow copies
  // This route is separate from W149-F `apply` so the old apply-gate
  // remains dry-run-only and operators explicitly opt into real writes.
  if (
    trimmed === 'governance compression write' ||
    trimmed.startsWith('governance compression write ')
  ) {
    const rest = trimmed.slice('governance compression write'.length).trim();
    const restParts = rest.split(/\s+/).filter(Boolean);
    const confirmIdx = restParts.indexOf('--confirm');
    if (confirmIdx >= 0) {
      const token = restParts[confirmIdx + 1];
      if (!token || token.startsWith('--')) {
        onDone(getLocalizedText({
          zh: 'governance compression write --confirm 缺少 token (8 hex 字符)',
          en: 'governance compression write --confirm requires a token (8 hex chars)',
        }));
        return null;
      }
      if (!/^[0-9a-f]{8}$/.test(token)) {
        onDone(getLocalizedText({
          zh: 'governance compression write --confirm token 必须为 8 位 hex',
          en: 'governance compression write --confirm token must be 8 hex chars',
        }));
        return null;
      }
      return (
        <SidecarGovernanceCompressionWriteConfirmPanel
          onDone={onDone}
          token={token}
        />
      );
    }
    if (!rest.includes('--dry-run')) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar governance compression write --dry-run，然后 /memory-sidecar governance compression write --confirm <8 位 hex>',
        en: 'Usage: /memory-sidecar governance compression write --dry-run, then /memory-sidecar governance compression write --confirm <8-hex token>',
      }));
      return null;
    }
    return <SidecarGovernanceCompressionWriteDryRunPanel onDone={onDone} />;
  }

  // W146: /memory-sidecar governance apply <scope> --dry-run
  //       /memory-sidecar governance apply --confirm <token>
  if (trimmed === 'governance apply' || trimmed.startsWith('governance apply ')) {
    const rest = trimmed.slice('governance apply'.length).trim();
    // W146.2 P2-1: validate --confirm token format upfront (mirrors the
    // repair --confirm router below). Distinguish "missing token" from
    // "format invalid" with separate user-facing messages so a typo
    // doesn't fall through to the apply executor's generic
    // "token-not-found" path.
    const restParts = rest.split(/\s+/).filter(Boolean);
    const confirmIdx = restParts.indexOf('--confirm');
    if (confirmIdx >= 0) {
      const token = restParts[confirmIdx + 1];
      if (!token || token.startsWith('--')) {
        onDone(getLocalizedText({
          zh: 'governance apply --confirm 缺少 token (8 hex 字符)',
          en: 'governance apply --confirm requires a token (8 hex chars)',
        }));
        return null;
      }
      if (!/^[0-9a-f]{8}$/.test(token)) {
        onDone(getLocalizedText({
          zh: 'governance apply --confirm token 必须为 8 位 hex',
          en: 'governance apply --confirm token must be 8 hex chars',
        }));
        return null;
      }
      return <SidecarGovernanceApplyPanel onDone={onDone} token={token} />;
    }
    if (!rest.includes('--dry-run')) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar governance apply <profile-prune-redundant|proposal-prune-stale-candidates|all> --dry-run，然后 /memory-sidecar governance apply --confirm <token>',
        en: 'Usage: /memory-sidecar governance apply <profile-prune-redundant|proposal-prune-stale-candidates|all> --dry-run, then /memory-sidecar governance apply --confirm <token>',
      }));
      return null;
    }
    const scope = parseGovernanceApplyScope(rest);
    if (!scope) {
      // W149-A: distinguish deferred action ids (real governance actions
      // wired up in a later wave) from typos so the operator gets a
      // wave-aware hint instead of a flat "must be …" error.
      const deferred = deferredGovernanceActionInfo(rest);
      if (deferred) {
        onDone(getLocalizedText({
          zh: `governance apply '${deferred.id}' 暂未启用 — 该 action 已计划在 ${deferred.wave} 接入；当前可执行 scope 仅 profile-prune-redundant / proposal-prune-stale-candidates / all`,
          en: `governance apply '${deferred.id}' is not yet enabled — this action is scheduled for ${deferred.wave}; currently executable scopes are profile-prune-redundant / proposal-prune-stale-candidates / all`,
        }));
        return null;
      }
      onDone(getLocalizedText({
        zh: 'governance apply scope 必须是 profile-prune-redundant / proposal-prune-stale-candidates / all',
        en: 'governance apply scope must be profile-prune-redundant / proposal-prune-stale-candidates / all',
      }));
      return null;
    }
    return <SidecarGovernanceApplyPanel onDone={onDone} scope={scope} />;
  }

  // W132/W138: /memory-sidecar storage status/export/cleanup.
  // status is read-only; export copies archive data to an explicit external
  // directory and never deletes source memories. cleanup only deletes
  // dead-letter/jobs runtime noise after a tokenized dry-run.
  if (trimmed === 'storage status' || trimmed === 'storage') {
    return <SidecarStorageStatusPanel onDone={onDone} />;
  }
  if (trimmed.startsWith('storage export')) {
    const rest = trimmed.slice('storage export'.length).trim();
    const outDir = parseFlagValue(rest, '--out-dir') ?? parseFlagValue(rest, '--out');
    if (!outDir) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar storage export --out-dir <外部目录>',
        en: 'Usage: /memory-sidecar storage export --out-dir <external-dir>',
      }));
      return null;
    }
    return <SidecarStorageExportPanel onDone={onDone} outDir={outDir} />;
  }
  if (trimmed.startsWith('storage cleanup')) {
    const rest = trimmed.slice('storage cleanup'.length).trim();
    const token = parseFlagValue(rest, '--confirm');
    if (token) {
      return <SidecarStorageCleanupPanel onDone={onDone} token={token} />;
    }
    if (!rest.includes('--dry-run')) {
      onDone(getLocalizedText({
        zh: '用法: /memory-sidecar storage cleanup [dead-letter|jobs|all] --dry-run，然后 /memory-sidecar storage cleanup --confirm <token>',
        en: 'Usage: /memory-sidecar storage cleanup [dead-letter|jobs|all] --dry-run, then /memory-sidecar storage cleanup --confirm <token>',
      }));
      return null;
    }
    return <SidecarStorageCleanupPanel onDone={onDone} scope={parseCleanupScope(rest)} />;
  }

  // W312: /memory-sidecar retention --dry-run|--confirm <8hex>
  // Content-addressed cleanup plan for long-lived runtime noise. It only
  // deletes dead-letter/jobs and explicitly blocks archive source prune.
  if (trimmed === 'retention' || trimmed.startsWith('retention ')) {
    const rest = trimmed.slice('retention'.length).trim();
    const token = parseFlagValue(rest, '--confirm');
    if (token) {
      if (!/^[0-9a-f]{8}$/.test(token)) {
        onDone(getLocalizedText({
          zh: 'retention --confirm token 必须为 8 位 hex',
          en: 'retention --confirm token must be 8 hex chars',
        }), { display: 'system' });
        return null;
      }
      return <SidecarRetentionPanel onDone={onDone} confirmToken={token} />;
    }
    if (rest === '' || rest.includes('--dry-run')) {
      return <SidecarRetentionPanel onDone={onDone} />;
    }
    onDone(getLocalizedText({
      zh: '用法: /memory-sidecar retention --dry-run，然后 /memory-sidecar retention --confirm <8hex>',
      en: 'Usage: /memory-sidecar retention --dry-run, then /memory-sidecar retention --confirm <8hex>',
    }), { display: 'system' });
    return null;
  }

  // W122-B: /memory-sidecar repair (dry-run by default)
  // /memory-sidecar repair --confirm <token>  (single-use 8-hex token)
  // No --target, no cross-project parameter — locked to current project.
  if (trimmed === 'repair' || trimmed.startsWith('repair ')) {
    const rest = trimmed.slice('repair'.length).trim();
    if (rest === '') {
      return <SidecarRepairPlanPanel onDone={onDone} />;
    }
    const parts = rest.split(/\s+/).filter(Boolean);
    const idx = parts.indexOf('--confirm');
    if (idx >= 0) {
      const token = parts[idx + 1];
      if (!token || token.startsWith('--')) {
        onDone(getLocalizedText({
          zh: 'repair --confirm 缺少 token (8 hex 字符)',
          en: 'repair --confirm requires a token (8 hex chars)',
        }));
        return null;
      }
      if (!/^[0-9a-f]{8}$/.test(token)) {
        onDone(getLocalizedText({
          zh: 'repair --confirm token 必须为 8 位 hex',
          en: 'repair --confirm token must be 8 hex chars',
        }));
        return null;
      }
      return <SidecarRepairConfirmPanel onDone={onDone} token={token} />;
    }
    // Reject unknown flags / args (no --target / no <projectId>).
    onDone(getLocalizedText({
      zh: `repair 无法识别的参数: ${rest}\n用法: /memory-sidecar repair  或  /memory-sidecar repair --confirm <token>`,
      en: `repair: unrecognized args: ${rest}\nusage: /memory-sidecar repair  or  /memory-sidecar repair --confirm <token>`,
    }));
    return null;
  }

  // Unknown subcommand
  onDone(getLocalizedText({
    zh: `未知子命令: ${trimmed}\n运行 /memory-sidecar 查看可用命令。`,
    en: `Unknown subcommand: ${trimmed}\nRun /memory-sidecar to see available commands.`,
  }));
  return null;
};
