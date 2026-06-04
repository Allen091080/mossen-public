/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import figures from 'figures';
import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { getTerminalFocusState } from 'src/ink/terminal-focus-state.js';
import { useTerminalNotification } from 'src/ink/useTerminalNotification.js';
import { launchAgentSupervisorBackgroundJob } from 'src/services/agentSupervisor/launch.js';
import { removeAgentSupervisorJob, stopAgentSupervisorJob } from 'src/services/agentSupervisor/management.js';
import { moveAgentSupervisorJobOrder, renameAgentSupervisorJob, toggleAgentSupervisorPin } from 'src/services/agentSupervisor/organization.js';
import { resolveAgentSupervisorPrStatuses, type AgentSupervisorPrStatus } from 'src/services/agentSupervisor/prStatus.js';
import { readAgentSupervisorRoster } from 'src/services/agentSupervisor/roster.js';
import { reconcileAgentSupervisorStaleProcesses } from 'src/services/agentSupervisor/daemon.js';
import type { AgentSupervisorStatus } from 'src/services/agentSupervisor/schema.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView, stopOrDismissAgent } from 'src/state/teammateViewHelpers.js';
import type { ToolUseContext } from 'src/Tool.js';
import { sendNotification } from 'src/services/notifier.js';
import { DreamTask, type DreamTaskState } from 'src/tasks/DreamTask/DreamTask.js';
import { InProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { LocalAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import { LocalShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
// Type import is erased at build time — safe even though module is ant-gated.
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { MonitorMcpTaskState } from 'src/tasks/MonitorMcpTask/MonitorMcpTask.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { ReadonlyDeep as DeepImmutable } from 'type-fest';
import { intersperse } from 'src/utils/array.js';
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text, useInput } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getCommandName } from '../../types/command.js';
import { count } from '../../utils/array.js';
import { getLocalizedCommandDescription } from '../../utils/commandDescription.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { t } from '../../utils/i18n/index.js';
import { editPromptInEditor } from '../../utils/promptEditor.js';
import { truncateVisual, visualWidth } from '../../utils/visualWidth.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { AgentSupervisorDetailDialog } from './AgentSupervisorDetailDialog.js';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { deriveAgentViewItems, isAgentViewTaskState, type AgentViewItem, type AgentViewTaskState } from './agentViewModel.js';
import { deriveSupervisorAgentViewItems, filterSupervisorAgentViewItems, getSupervisorAgentPrStatus, type SupervisorAgentViewItem } from './agentSupervisorViewModel.js';
import {
  AGENT_VIEW_COMMAND_PALETTE_LIMIT,
  RESERVED_AGENT_VIEW_ACTION_KEYS,
  agentViewGroupStageLabel,
  agentViewNotificationDedupeKey,
  agentViewNotificationMessage,
  agentViewStatusLabel,
  formatAgentViewJobAge,
  formatAgentViewRefreshAge,
  getAgentViewCommandPaletteQuery,
  getAgentViewDispatchPrompt,
  getAgentViewFilterQuery,
  getAgentViewInputMode,
  getAgentViewNotificationMode,
  getAgentViewPaletteKindLabel,
  getAgentViewSlashCommandName,
  getSupervisorStatusFlashColor,
  groupSupervisorAgentViewItemsForDashboard,
  hasExplicitExternalEditor,
  isAgentViewExitCommand,
  isAgentViewPaletteCommand,
  isPlainAgentViewTextKey,
  matchesAgentViewPaletteCommandName,
  padVisualEnd,
  renderAgentViewHelpSections,
  shortenPathForAgentView,
  shouldNotifyAgentViewStatusTransition,
  shouldUseAgentViewHighDensity,
  type AgentViewCommandPaletteItem,
  type SupervisorAgentDisplayGroup,
} from '../agents/agentViewHelpers.js';
import { BackgroundTask as BackgroundTaskComponent } from './BackgroundTask.js';
import { DreamDetailDialog } from './DreamDetailDialog.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';
type ViewState = {
  mode: 'list';
} | {
  mode: 'detail';
  itemId: string;
};
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  toolUseContext: ToolUseContext;
  initialDetailTaskId?: string;
  agentView?: boolean;
  agentViewDispatchDefaults?: AgentViewDispatchDefaults;
};
export type AgentViewDispatchDefaults = {
  model?: string | null;
  permissionMode?: string | null;
  effort?: string | null;
  agent?: string | null;
  settings?: string | null;
  addDirs?: string[];
  mcpConfig?: string[];
  pluginDirs?: string[];
  strictMcpConfig?: boolean;
  fallbackModel?: string | null;
  allowDangerouslySkipPermissions?: boolean;
  dangerouslySkipPermissions?: boolean;
};
function formatAgentViewDispatchDefaults(defaults?: AgentViewDispatchDefaults): string | null {
  if (!defaults) return null;
  const parts: string[] = [];
  if (defaults.model) parts.push(`model=${defaults.model}`);
  if (defaults.effort) parts.push(`effort=${defaults.effort}`);
  if (defaults.permissionMode) parts.push(`permission=${defaults.permissionMode}`);
  if (defaults.agent) parts.push(`agent=${defaults.agent}`);
  if (defaults.settings) parts.push('settings');
  if ((defaults.addDirs ?? []).length > 0) parts.push(`add-dir=${defaults.addDirs?.length ?? 0}`);
  if ((defaults.mcpConfig ?? []).length > 0) parts.push(`mcp=${defaults.mcpConfig?.length ?? 0}`);
  if ((defaults.pluginDirs ?? []).length > 0) parts.push(`plugins=${defaults.pluginDirs?.length ?? 0}`);
  if (defaults.strictMcpConfig) parts.push('strict-mcp');
  if (defaults.fallbackModel) parts.push(`fallback=${defaults.fallbackModel}`);
  if (defaults.allowDangerouslySkipPermissions) parts.push('allow-bypass');
  if (defaults.dangerouslySkipPermissions) parts.push(t('ui.agentView.dispatchDefaultsSkipPermissions'));
  return parts.length > 0 ? parts.join(' · ') : null;
}
type ListItem = {
  id: string;
  type: 'local_bash';
  label: string;
  status: string;
  task: DeepImmutable<LocalShellTaskState>;
} | {
  id: string;
  type: 'local_agent';
  label: string;
  status: string;
  task: DeepImmutable<LocalAgentTaskState>;
} | {
  id: string;
  type: 'in_process_teammate';
  label: string;
  status: string;
  task: DeepImmutable<InProcessTeammateTaskState>;
} | {
  id: string;
  type: 'remote_agent';
  label: string;
  status: string;
  task: DeepImmutable<{
    id: string;
    type: 'remote_agent';
    title: string;
    status: string;
    startTime?: number;
    [key: string]: unknown;
  }>;
} | {
  id: string;
  type: 'local_workflow';
  label: string;
  status: string;
  task: DeepImmutable<LocalWorkflowTaskState>;
} | {
  id: string;
  type: 'monitor_mcp';
  label: string;
  status: string;
  task: DeepImmutable<MonitorMcpTaskState>;
} | {
  id: string;
  type: 'dream';
  label: string;
  status: string;
  task: DeepImmutable<DreamTaskState>;
} | {
  id: string;
  type: 'leader';
  label: string;
  status: 'running';
} | SupervisorAgentViewItem;
type SupervisorListItem = Extract<ListItem, { type: 'supervisor_agent' }>;
type NonLeaderListItem = Exclude<ListItem, { type: 'leader' } | { type: 'supervisor_agent' }>;
type BashListItem = Extract<ListItem, { type: 'local_bash' }>;
type RemoteListItem = Extract<ListItem, { type: 'remote_agent' }>;
type AgentListItem = Extract<ListItem, { type: 'local_agent' }>;
type TeammateListItem = Extract<ListItem, { type: 'leader' | 'in_process_teammate' }>;
type WorkflowListItem = Extract<ListItem, { type: 'local_workflow' }>;
type MonitorMcpListItem = Extract<ListItem, { type: 'monitor_mcp' }>;
type DreamListItem = Extract<ListItem, { type: 'dream' }>;
type CategorizedListItems = {
  supervisorJobs: SupervisorListItem[];
  supervisorGroups: SupervisorAgentDisplayGroup[];
  bashTasks: BashListItem[];
  remoteSessions: RemoteListItem[];
  agentTasks: AgentListItem[];
  teammateTasks: TeammateListItem[];
  workflowTasks: WorkflowListItem[];
  mcpMonitors: MonitorMcpListItem[];
  dreamTasks: DreamListItem[];
  allSelectableItems: ListItem[];
  agentViewItems: AgentViewItem[];
};
// SupervisorAgentDisplayStage / SupervisorAgentDisplayGroup are now exported
// from ../agents/agentViewHelpers (see Phase 8b). Imports above pull the
// canonical definitions; local duplicates would shadow the helper module
// versions and break the group rendering contract.

// WORKFLOW_SCRIPTS is internal-only (build_flags.yaml). Static imports would leak
// ~1.3K lines into external builds. Gate with feature() + require so the
// bundler can dead-code-eliminate the branch.
/* eslint-disable @typescript-eslint/no-require-imports */
const WorkflowDetailDialog = feature('WORKFLOW_SCRIPTS') ? (require('./WorkflowDetailDialog.js') as typeof import('./WorkflowDetailDialog.js')).WorkflowDetailDialog : null;
const workflowTaskModule = feature('WORKFLOW_SCRIPTS') ? require('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') : null;
const killWorkflowTask = workflowTaskModule?.killWorkflowTask ?? null;
const skipWorkflowAgent = workflowTaskModule?.skipWorkflowAgent ?? null;
const retryWorkflowAgent = workflowTaskModule?.retryWorkflowAgent ?? null;
// Relative path, not `src/...` path-mapping — Bun's DCE can statically
// resolve + eliminate `./` requires, but path-mapped strings stay opaque
// and survive as dead literals in the bundle. Matches tasks.ts pattern.
const monitorMcpModule = feature('MONITOR_TOOL') ? require('../../tasks/MonitorMcpTask/MonitorMcpTask.js') as typeof import('../../tasks/MonitorMcpTask/MonitorMcpTask.js') : null;
const killMonitorMcp = monitorMcpModule?.killMonitorMcp ?? null;
const MonitorMcpDetailDialog = feature('MONITOR_TOOL') ? (require('./MonitorMcpDetailDialog.js') as typeof import('./MonitorMcpDetailDialog.js')).MonitorMcpDetailDialog : null;
/* eslint-enable @typescript-eslint/no-require-imports */

const AGENT_VIEW_DISMISS_CONFIRM_WINDOW_MS = 2000;

async function readAgentSupervisorRosterForDashboard(): Promise<Awaited<ReturnType<typeof readAgentSupervisorRoster>>> {
  await reconcileAgentSupervisorStaleProcesses().catch(() => undefined);
  return await readAgentSupervisorRoster();
}

// Helper to get filtered background tasks (excludes foregrounded local_agent)
function getSelectableBackgroundTasks(tasks: Record<string, TaskState> | undefined, foregroundedTaskId: string | undefined, agentView = false): TaskState[] {
  const backgroundTasks = Object.values(tasks ?? {}).filter(task => agentView ? isAgentViewTaskState(task) : isBackgroundTask(task));
  if (agentView) return backgroundTasks;
  return backgroundTasks.filter(task => !(task.type === 'local_agent' && task.id === foregroundedTaskId));
}

function isActiveBackgroundStatus(status: ListItem['status']): boolean {
  return status === 'running' || status === 'pending';
}

function isInterruptibleBackgroundStatus(status: ListItem['status']): boolean {
  return status === 'running';
}

function matchesAgentViewQuery(item: ListItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const fields = [item.id, item.label, item.status];
  if (item.type === 'supervisor_agent') {
    fields.push(item.cwd, item.agent ?? '', item.lastSummaryLine ?? '');
  }
  return fields.join('\n').toLowerCase().includes(normalized);
}

// Agent View pure helpers (types, constants, formatting, grouping,
// notification decisions, help-section render block) live in
// components/agents/agentViewHelpers.tsx — see Phase 8b of the
// live-multiplex refactor (docs/upgrade/W397-agent-view-live-multiplex-baseline.md).
// Only state-bound / dialog-internal helpers stay below.
//
// SupervisorAgentDisplayStage / SupervisorAgentDisplayGroup are re-exported
// so existing callers that import them from this file keep working.
export type {
  AgentViewInputMode,
  AgentViewCommandPaletteItem,
  AgentViewNotificationMode,
  SupervisorAgentDisplayStage,
  SupervisorAgentDisplayGroup,
} from '../agents/agentViewHelpers.js';
export {
  getAgentViewNotificationMode,
  shouldNotifyAgentViewStatusTransition,
} from '../agents/agentViewHelpers.js';

function BackgroundTasksDialogImpl({
  onDone,
  toolUseContext,
  initialDetailTaskId,
  agentView = false,
  agentViewDispatchDefaults,
}: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const foregroundedTaskId = useAppState(s_0 => s_0.foregroundedTaskId);
  const showSpinnerTree = useAppState(s_1 => s_1.expandedView) === 'teammates';
  const setAppState = useSetAppState();
  const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
  const terminal = useTerminalNotification();
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const typedTasks = tasks as Record<string, TaskState> | undefined;

  // Track if we skipped list view on mount (for back button behavior)
  const skippedListOnMount = useRef(false);

  // Compute initial view state. The legacy Background Tasks dialog may skip
  // straight to detail for a single item, but Agent View is a dashboard first:
  // even one job should open the list so ← always returns to the dashboard.
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (initialDetailTaskId) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: initialDetailTaskId
      };
    }
    const allItems = getSelectableBackgroundTasks(typedTasks, foregroundedTaskId, agentView);
    if (!agentView && allItems.length === 1) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: allItems[0]!.id
      };
    }
    return {
      mode: 'list'
    };
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [pendingDismiss, setPendingDismiss] = useState<{
    id: string;
    expiresAt: number;
  } | null>(null);
  const [agentViewQuery, setAgentViewQuery] = useState('');
  const [agentViewQueryCursorOffset, setAgentViewQueryCursorOffset] = useState(0);
  const agentViewQueryRef = useRef('');
  const agentViewQueryCursorOffsetRef = useRef(0);
  const [agentViewCommandPaletteIndex, setAgentViewCommandPaletteIndex] = useState(0);
  const [agentSupervisorRows, setAgentSupervisorRows] = useState<SupervisorListItem[]>([]);
  const [agentSupervisorPrStatuses, setAgentSupervisorPrStatuses] = useState<Record<string, AgentSupervisorPrStatus>>({});
  const [agentSupervisorLastRefreshAt, setAgentSupervisorLastRefreshAt] = useState<number | null>(null);
  const [agentSupervisorStatusFlashColors, setAgentSupervisorStatusFlashColors] = useState<Map<string, string>>(() => new Map());
  const [agentSupervisorLoadError, setAgentSupervisorLoadError] = useState<string | null>(null);
  const [agentSupervisorDispatchError, setAgentSupervisorDispatchError] = useState<string | null>(null);
  const [agentSupervisorDispatching, setAgentSupervisorDispatching] = useState(false);
  const agentSupervisorDispatchingRef = useRef(false);
  const [agentViewRename, setAgentViewRename] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [agentViewHelpVisible, setAgentViewHelpVisible] = useState(false);
  const [collapsedSupervisorGroups, setCollapsedSupervisorGroups] = useState<Set<string>>(() => new Set());
  const [expandedSupervisorGroups, setExpandedSupervisorGroups] = useState<Set<string>>(() => new Set());
  const previousSupervisorStatusesRef = useRef<Map<string, string>>(new Map());
  const notifiedSupervisorTransitionsRef = useRef<Set<string>>(new Set());
  const trimmedAgentViewQuery = agentViewQuery.trim();
  const agentViewInputMode = getAgentViewInputMode(agentViewQuery);
  const agentViewDispatchQuery = agentViewInputMode === 'dispatch';
  const agentViewFilterQuery = agentViewInputMode === 'filter' ? getAgentViewFilterQuery(agentViewQuery) : '';
  const agentViewDispatchPaletteItems = useMemo<AgentViewCommandPaletteItem[]>(() => {
    if (!agentView) return [];
    const commands = toolUseContext.options.commands ?? [];
    return commands.filter(isAgentViewPaletteCommand).map(cmd => {
      const name = getCommandName(cmd);
      return {
        command: cmd,
        name,
        description: getLocalizedCommandDescription(cmd),
        kindLabel: getAgentViewPaletteKindLabel(cmd),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [agentView, toolUseContext.options.commands]);
  const agentViewCommandPaletteItems = useMemo<AgentViewCommandPaletteItem[]>(() => {
    if (!agentView || agentViewInputMode !== 'command') return [];
    const query = getAgentViewCommandPaletteQuery(agentViewQuery);
    const matches = agentViewDispatchPaletteItems.filter(item => {
      if (!query) return true;
      const name = item.name.toLowerCase();
      const description = item.description.toLowerCase();
      const aliases = item.command.aliases?.map(alias => alias.toLowerCase()) ?? [];
      return name.startsWith(query) || aliases.some(alias => alias.startsWith(query)) || description.includes(query);
    });
    const scored = matches.map(item => {
      const lowerName = item.name.toLowerCase();
      const startsWithQuery = query ? lowerName.startsWith(query) : true;
      return {
        ...item,
        score: startsWithQuery ? 0 : 1,
      };
    });
    return scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, AGENT_VIEW_COMMAND_PALETTE_LIMIT).map(({ score: _score, ...item }) => item);
  }, [agentView, agentViewInputMode, agentViewQuery, agentViewDispatchPaletteItems]);

  // Register as modal overlay so parent Chat keybindings (up/down for history)
  // are deactivated while this dialog is open
  useRegisterOverlay('background-tasks-dialog', true);

  useEffect(() => {
    setAgentViewCommandPaletteIndex(index => Math.min(index, Math.max(0, agentViewCommandPaletteItems.length - 1)));
  }, [agentViewCommandPaletteItems.length]);

  const setAgentViewQueryValue = (value: string, cursorOffset = value.length): void => {
    const safeOffset = Math.max(0, Math.min(cursorOffset, value.length));
    agentViewQueryRef.current = value;
    agentViewQueryCursorOffsetRef.current = safeOffset;
    setAgentViewQuery(value);
    setAgentViewQueryCursorOffset(safeOffset);
  };

  useEffect(() => {
    if (!agentView) {
      setAgentSupervisorRows([]);
      setAgentSupervisorLoadError(null);
      setAgentSupervisorLastRefreshAt(null);
      setAgentSupervisorStatusFlashColors(new Map());
      previousSupervisorStatusesRef.current = new Map();
      return;
    }
    // While another task dialog owns the screen, do not keep the dashboard
    // roster poll firing. Concurrent dashboard setState round-trips can race
    // the active surface and stamp partial frames on screen (the "文字叠加重叠"
    // symptom — characters from the previous frame leak through gaps in the
    // new frame). The resume below picks up the latest roster when the user
    // returns to the list.
    if (viewState.mode !== 'list') {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh(): Promise<void> {
      try {
        const roster = await readAgentSupervisorRosterForDashboard();
        if (cancelled) return;
        const nextRows = deriveSupervisorAgentViewItems(roster);
        const notificationMode = getAgentViewNotificationMode();
        const focusState = getTerminalFocusState();
        const notifications = nextRows.filter(row => {
          const previous = previousSupervisorStatusesRef.current.get(row.id) as AgentSupervisorStatus | undefined;
          if (!shouldNotifyAgentViewStatusTransition({
            previous,
            current: row.status,
            focusState,
            mode: notificationMode
          })) return false;
          const key = agentViewNotificationDedupeKey(row.id, row.status);
          if (notifiedSupervisorTransitionsRef.current.has(key)) return false;
          notifiedSupervisorTransitionsRef.current.add(key);
          return true;
        });
        const changedRows = nextRows.flatMap(row => {
          const previous = previousSupervisorStatusesRef.current.get(row.id);
          const color = previous && previous !== row.status ? getSupervisorStatusFlashColor(row.status) : null;
          return color ? [{ id: row.id, color }] : [];
        });
        previousSupervisorStatusesRef.current = new Map(nextRows.map(row => [row.id, row.status]));
        if (changedRows.length > 0) {
          setAgentSupervisorStatusFlashColors(previous => {
            const next = new Map(previous);
            for (const row of changedRows) next.set(row.id, row.color);
            return next;
          });
          setTimeout(() => {
            if (cancelled) return;
            setAgentSupervisorStatusFlashColors(previous => {
              const next = new Map(previous);
              for (const row of changedRows) next.delete(row.id);
              return next;
            });
          }, 1200);
        }
        setAgentSupervisorRows(nextRows);
        setAgentSupervisorLastRefreshAt(Date.now());
        setAgentSupervisorLoadError(null);
        for (const item of notifications) {
          void sendNotification({
            title: t('ui.agentView.notification.title'),
            message: agentViewNotificationMessage(item),
            notificationType: 'agent_view_needs_input'
          }, terminal);
        }
      } catch (error) {
        if (!cancelled) {
          setAgentSupervisorLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void refresh();
          }, 2000);
        }
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentView, terminal, viewState.mode]);

  useEffect(() => {
    if (!agentView || agentSupervisorRows.length === 0) {
      setAgentSupervisorPrStatuses({});
      return;
    }
    let cancelled = false;
    void resolveAgentSupervisorPrStatuses(agentSupervisorRows).then(statuses => {
      if (!cancelled) setAgentSupervisorPrStatuses(statuses);
    }).catch(() => {
      if (!cancelled) setAgentSupervisorPrStatuses({});
    });
    return () => {
      cancelled = true;
    };
  }, [agentView, agentSupervisorRows]);

  // Memoize the sorted and categorized items together to ensure stable references
  const {
    supervisorJobs,
    supervisorGroups,
    bashTasks,
    remoteSessions,
    agentTasks,
    teammateTasks,
    workflowTasks,
    mcpMonitors,
    dreamTasks: dreamTasks_0,
    allSelectableItems,
    agentViewItems
  } = useMemo<CategorizedListItems>(() => {
    // Background Tasks keeps the historic running/pending filter. Agent View
    // broadens that to retained terminal local_agent rows so users can peek,
    // reply, attach, or safely dismiss without losing transcript recovery.
    const query = agentView ? agentViewFilterQuery : '';
    const supervisorJobs_0 = agentView ? filterSupervisorAgentViewItems(agentSupervisorRows, query) : [];
    const supervisorGroups_0 = groupSupervisorAgentViewItemsForDashboard(supervisorJobs_0, expandedSupervisorGroups);
    const visibleSupervisorJobs = supervisorGroups_0.flatMap(group => collapsedSupervisorGroups.has(group.key) ? [] : group.items);
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(task => agentView ? isAgentViewTaskState(task) : isBackgroundTask(task));
    const agentViewItems_0 = agentView ? deriveAgentViewItems(typedTasks) : [];
    const allItems_0 = backgroundTasks.map(toListItem).filter(item => !agentView || matchesAgentViewQuery(item, query));
    const sorted = allItems_0.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      if (aStatus === 'running' && bStatus !== 'running') return -1;
      if (aStatus !== 'running' && bStatus === 'running') return 1;
      const aTime = 'task' in a ? a.task.startTime : 0;
      const bTime = 'task' in b ? b.task.startTime : 0;
      return bTime - aTime;
    });
    const bash = sorted.filter((item): item is BashListItem => item.type === 'local_bash');
    const remote = sorted.filter((item_0): item_0 is RemoteListItem => item_0.type === 'remote_agent');
    // Exclude foregrounded task - it's being viewed in the main UI, not a background task
    const agent = sorted.filter((item_1): item_1 is AgentListItem => item_1.type === 'local_agent' && (agentView || item_1.id !== foregroundedTaskId));
    const workflows = sorted.filter((item_2): item_2 is WorkflowListItem => item_2.type === 'local_workflow');
    const monitorMcp = sorted.filter((item_3): item_3 is MonitorMcpListItem => item_3.type === 'monitor_mcp');
    const dreamTasks = sorted.filter((item_4): item_4 is DreamListItem => item_4.type === 'dream');
    // In spinner-tree mode, exclude teammates from the dialog (they appear in the tree)
    const teammates = agentView ? sorted.filter((item_5): item_5 is Extract<ListItem, { type: 'in_process_teammate' }> => item_5.type === 'in_process_teammate') : showSpinnerTree ? [] : sorted.filter((item_6): item_6 is Extract<ListItem, { type: 'in_process_teammate' }> => item_6.type === 'in_process_teammate');
    // Add leader entry when there are teammates, so users can foreground back to leader
    const leaderItem: ListItem[] = (agentView ? allItems_0.length > 0 : teammates.length > 0) ? [{
      id: '__leader__',
      type: 'leader',
      label: `@${TEAM_LEAD_NAME}`,
      status: 'running'
    }] : [];
    return {
      supervisorJobs: supervisorJobs_0,
      supervisorGroups: supervisorGroups_0,
      bashTasks: bash,
      remoteSessions: remote,
      agentTasks: agent,
      workflowTasks: workflows,
      mcpMonitors: monitorMcp,
      dreamTasks,
      teammateTasks: [...leaderItem, ...teammates],
      // Order MUST match JSX render order (teammates \u2192 bash \u2192 monitorMcp \u2192
      // remote \u2192 agent \u2192 workflows \u2192 dream) so \u2193/\u2191 navigation moves the cursor
      // visually downward.
      allSelectableItems: [...visibleSupervisorJobs, ...leaderItem, ...teammates, ...bash, ...monitorMcp, ...remote, ...agent, ...workflows, ...dreamTasks],
      agentViewItems: agentViewItems_0
    };
  }, [typedTasks, foregroundedTaskId, showSpinnerTree, agentView, agentViewFilterQuery, agentSupervisorRows, collapsedSupervisorGroups, expandedSupervisorGroups]);
  const currentSelection: ListItem | null = allSelectableItems[selectedIndex] ?? null;
  const currentSupervisorSelection = currentSelection?.type === 'supervisor_agent' ? currentSelection : null;
  const attachAgentTaskToMainView = (taskId: string): boolean => {
    if (!agentView) return false;
    enterTeammateView(taskId, setAppState);
    onDone(t('ui.agentView.viewingAgent'), {
      display: 'system'
    });
    return true;
  };
  const attachSelectionToMainView = (item: ListItem): boolean => {
    if (!agentView) return false;
    if (item.type === 'leader') {
      exitTeammateView(setAppState);
      onDone(t('ui.agentView.viewingMain'), {
        display: 'system'
      });
      return true;
    }
    if (item.type === 'local_agent' || item.type === 'in_process_teammate') {
      return attachAgentTaskToMainView(item.id);
    }
    return false;
  };
  const getCurrentSupervisorGroupItems = (item: ListItem | undefined): SupervisorListItem[] => {
    if (item?.type === 'supervisor_agent') {
      const group = supervisorGroups.find(group_0 => group_0.items.some(candidate => candidate.id === item.id));
      if (group) return group.items;
    }
    return supervisorGroups[0]?.items ?? [];
  };
  const getCurrentSupervisorGroupKey = (item: ListItem | undefined): string | null => {
    if (item?.type !== 'supervisor_agent') return supervisorGroups[0]?.key ?? null;
    const group = supervisorGroups.find(group_0 => group_0.items.some(candidate => candidate.id === item.id));
    return group?.key ?? null;
  };
  const openNthSupervisorInCurrentGroup = (item: ListItem | undefined, index: number): boolean => {
    const target = getCurrentSupervisorGroupItems(item)[index];
    if (!target) return false;
    openSupervisorJobChannelFromAgentView(target.id);
    return true;
  };
  const supervisorActionLabel = (
    action: SupervisorListItem['primaryAction'],
  ): string => {
    switch (action.kind) {
      case 'attach':
        return t('ui.agentView.actionAttach');
      case 'inspect':
        return t('ui.agentView.actionInspect');
      case 'peek':
        return t('ui.agentView.actionPeek');
      case 'reply':
        return t('ui.agentView.actionReply');
      case 'review':
        return t('ui.agentView.actionReview');
    }
  };
  const agentViewNextHint = (): string | null => {
    if (!agentView) return null;
    if (agentViewInputMode === 'filter') return t('ui.agentView.nextFilter');
    if (agentViewInputMode === 'command') return t('ui.agentView.nextCommand');
    if (agentViewInputMode === 'dispatch') return t('ui.agentView.nextDispatch');
    if (!currentSelection) return t('ui.agentView.nextEmpty');
    if (currentSelection.type === 'supervisor_agent') {
      if (currentSelection.statusContext === 'blocked_question') {
        return t('ui.agentView.nextNeedsInput');
      }
      if (currentSelection.statusContext === 'ready_result') {
        return t('ui.agentView.nextReadyResult');
      }
      if (currentSelection.statusContext === 'running') {
        return t('ui.agentView.nextRunning');
      }
      if (currentSelection.status === 'failed' || currentSelection.status === 'stopped') {
        return t('ui.agentView.nextFailed');
      }
      return t('ui.agentView.nextTerminal');
    }
    if (currentSelection.type === 'leader') return t('ui.agentView.nextLeader');
    if (currentSelection.type === 'local_bash') return t('ui.agentView.nextShell');
    if (currentSelection.type === 'local_agent' || currentSelection.type === 'in_process_teammate') {
      return t('ui.agentView.nextLocalAgent');
    }
    return t('ui.agentView.nextGenericTask');
  };

  // Use configurable keybindings for standard navigation and confirm/cancel.
  // confirm:no is handled by Dialog's onCancel prop.
  useKeybindings({
    'confirm:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    'confirm:next': () => setSelectedIndex(prev_0 => Math.min(allSelectableItems.length - 1, prev_0 + 1)),
    'confirm:yes': () => {
      if (agentView && agentViewQueryRef.current.trim().length > 0) {
        // Inline Agent View input submission is owned by useInput. The dialog
        // confirm keybinding also observes Enter, so any active dashboard input
        // must block list opening/selection here. Otherwise Enter either creates
        // duplicate jobs or steals command/exit submission from the input row.
        return;
      }
      const current = allSelectableItems[selectedIndex];
      if (current) {
        if (current.type === 'supervisor_agent') {
          openSupervisorJobChannelFromAgentView(current.id);
          return;
        }
        if (attachSelectionToMainView(current)) {
          return;
        }
        if (current.type === 'leader') {
          exitTeammateView(setAppState);
          onDone('Viewing leader', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'detail',
            itemId: current.id
          });
        }
      }
    }
  }, {
    context: 'Confirmation',
    isActive: viewState.mode === 'list'
  });

  // Component-specific shortcuts (x=stop, f=foreground, right=zoom) shown in UI.
  // These are task-type and status dependent, not standard dialog keybindings.
  const dispatchAgentSupervisorJob = async (options: {
    prompt?: string;
    attachAfterDispatch?: boolean;
  } = {}): Promise<void> => {
    if (agentSupervisorDispatchingRef.current) return;
    const prompt = (options.prompt ?? getAgentViewDispatchPrompt(agentViewQuery)).trim();
    const slashCommandName = getAgentViewSlashCommandName(prompt);
    if (
      slashCommandName
      && !agentViewDispatchPaletteItems.some(item => matchesAgentViewPaletteCommandName(slashCommandName, item))
    ) {
      setAgentSupervisorDispatchError(t('ui.agentView.paletteBlockedCommand', { command: `/${slashCommandName}` }));
      return;
    }
    if (prompt.length < 3) {
      setAgentSupervisorDispatchError(t('ui.agentView.dispatchTooShort'));
      return;
    }
    agentSupervisorDispatchingRef.current = true;
    setAgentSupervisorDispatching(true);
    setAgentSupervisorDispatchError(null);
    try {
      const result = await launchAgentSupervisorBackgroundJob({
        prompt,
        model: agentViewDispatchDefaults?.model ?? null,
        permissionMode: agentViewDispatchDefaults?.permissionMode ?? null,
        effort: agentViewDispatchDefaults?.effort ?? null,
        agent: agentViewDispatchDefaults?.agent ?? null,
        settings: agentViewDispatchDefaults?.settings ?? null,
        addDirs: agentViewDispatchDefaults?.addDirs ?? [],
        mcpConfig: agentViewDispatchDefaults?.mcpConfig ?? [],
        pluginDirs: agentViewDispatchDefaults?.pluginDirs ?? [],
        strictMcpConfig: agentViewDispatchDefaults?.strictMcpConfig ?? false,
        fallbackModel: agentViewDispatchDefaults?.fallbackModel ?? null,
        allowDangerouslySkipPermissions: agentViewDispatchDefaults?.allowDangerouslySkipPermissions ?? false,
        dangerouslySkipPermissions: agentViewDispatchDefaults?.dangerouslySkipPermissions ?? false,
        testMode: isEnvTruthy(process.env.MOSSEN_CODE_AGENT_SUPERVISOR_TEST_JOBS)
      });
      const roster = await readAgentSupervisorRosterForDashboard();
      const nextRows = deriveSupervisorAgentViewItems(roster);
      setAgentSupervisorRows(nextRows);
      setAgentSupervisorLastRefreshAt(Date.now());
      setAgentViewQueryValue('', 0);
      const resultIndex = nextRows.findIndex(row => row.id === result.id);
      if (resultIndex >= 0) setSelectedIndex(resultIndex);
      if (options.attachAfterDispatch) {
        openSupervisorJobChannelFromAgentView(result.id);
      }
    } catch (error) {
      setAgentSupervisorDispatchError(error instanceof Error ? error.message : String(error));
    } finally {
      agentSupervisorDispatchingRef.current = false;
      setAgentSupervisorDispatching(false);
    }
  };
  const refreshSupervisorRowsOnce = async (): Promise<void> => {
    const roster = await readAgentSupervisorRosterForDashboard();
    setAgentSupervisorRows(deriveSupervisorAgentViewItems(roster));
    setAgentSupervisorLastRefreshAt(Date.now());
  };
  const openSupervisorJobChannelFromAgentView = (id: string): void => {
    setAgentSupervisorDispatchError(null);
    // Live PTY-backed jobs hand off to the shell-side session loop: the
    // outer handler (cli/handlers/agentsTui.tsx) unmounts this Ink instance
    // entirely, runs a tmux-style bridge from process.stdin/stdout to the
    // worker's PTY, and only re-renders the dashboard after the user
    // detaches. That avoids the raw-mode / readable-listener races that
    // plagued earlier in-process attach attempts. Dead jobs (worker exited
    // or socket missing) fall back to the read-only AgentSupervisorDetailDialog.
    const supervisorItem = agentSupervisorRows.find(item => item.id === id);
    // Any job that isn't in a terminal state is routed to the attach
    // surface. We deliberately do NOT gate on `processAlive` here — a
    // freshly-dispatched job lives in `queued` for a beat before the worker
    // boots and writes alive=true, but the user shouldn't see a summary
    // panel during that gap. attachClient retries the socket for a few
    // seconds so the early-attach race resolves cleanly.
    const isLive = supervisorItem !== undefined
      && supervisorItem.status !== 'completed'
      && supervisorItem.status !== 'failed'
      && supervisorItem.status !== 'stopped';
    if (isLive) {
      // Resolve the attach socket path locally so the React tree doesn't
      // need to import worker-side path helpers. The shell loop has the
      // jobId-only entry too, but passing socketPath here keeps both ends
      // explicit.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pathsMod = require('../../services/agentSupervisor/paths.js') as typeof import('../../services/agentSupervisor/paths.js');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sessionMod = require('../../services/agentSupervisor/agentViewSession.js') as typeof import('../../services/agentSupervisor/agentViewSession.js');
      const socketPath = pathsMod.getAgentSupervisorJobPaths(id).attachSocket;
      sessionMod.requestAgentViewAttach({ jobId: id, socketPath });
      // Don't change viewState — the outer loop will unmount this Ink
      // instance momentarily. Once detach returns, a fresh dashboard mounts
      // in list mode (the natural default).
      return;
    }
    setViewState({ mode: 'detail', itemId: id });
  };
  const openAgentViewDispatchEditor = async (): Promise<void> => {
    if (!hasExplicitExternalEditor()) {
      setAgentSupervisorDispatchError(t('ui.agentView.editorUnavailable'));
      return;
    }
    const currentPrompt = agentViewDispatchQuery ? getAgentViewDispatchPrompt(agentViewQuery) : trimmedAgentViewQuery;
    const result = editPromptInEditor(currentPrompt);
    if (result.error) {
      setAgentSupervisorDispatchError(result.error);
      return;
    }
    if (result.content === null) {
      setAgentSupervisorDispatchError(t('ui.agentView.editorUnavailable'));
      return;
    }
    const editedPrompt = result.content.trim();
    if (editedPrompt.length === 0) return;
    setAgentViewQueryValue(editedPrompt);
    setAgentSupervisorDispatchError(null);
  };
  const stopOrRemoveSupervisorJob = async (item: SupervisorListItem): Promise<void> => {
    const now = Date.now();
    if (pendingDismiss?.id === item.id && pendingDismiss.expiresAt > now) {
      await removeAgentSupervisorJob(item.id);
      setPendingDismiss(null);
      await refreshSupervisorRowsOnce();
      setAgentSupervisorDispatchError(t('ui.agentView.removedSupervisorJob'));
      return;
    }
    if (item.status === 'working' || item.status === 'queued' || item.status === 'needs_input' || item.status === 'idle') {
      await stopAgentSupervisorJob(item.id);
      await refreshSupervisorRowsOnce();
      setAgentSupervisorDispatchError(t('ui.agentView.stopRequestedSupervisorJob'));
    } else {
      setAgentSupervisorDispatchError(t('ui.agentView.removeSupervisorConfirm'));
    }
    setPendingDismiss({
      id: item.id,
      expiresAt: now + AGENT_VIEW_DISMISS_CONFIRM_WINDOW_MS
    });
  };
  const commitAgentViewRename = async (): Promise<void> => {
    if (!agentViewRename) return;
    try {
      await renameAgentSupervisorJob(agentViewRename.id, agentViewRename.text);
      await refreshSupervisorRowsOnce();
      setAgentViewRename(null);
      setAgentSupervisorDispatchError(null);
    } catch (error) {
      setAgentSupervisorDispatchError(error instanceof Error ? error.message : String(error));
    }
  };
  const handleAgentViewRenameKey = (e: KeyboardEvent): boolean => {
    if (!agentViewRename) return false;
    if (e.key === 'escape') {
      e.preventDefault();
      setAgentViewRename(null);
      return true;
    }
    if (e.key === 'return') {
      e.preventDefault();
      void commitAgentViewRename();
      return true;
    }
    if (e.key === 'backspace' || e.key === 'delete') {
      e.preventDefault();
      setAgentViewRename(value => value ? { ...value, text: value.text.slice(0, -1) } : value);
      return true;
    }
    if (e.meta || e.ctrl || e.key.length !== 1) return false;
    e.preventDefault();
    setAgentViewRename(value => value ? { ...value, text: value.text + e.key } : value);
    return true;
  };
  const applyAgentViewCommandPaletteSelection = (): boolean => {
    const selected = agentViewCommandPaletteItems[agentViewCommandPaletteIndex];
    if (!selected) return false;
    const next = `/${selected.name} `;
    setAgentViewQueryValue(next);
    setAgentSupervisorDispatchError(null);
    return true;
  };
  const handleAgentViewQueryKey = (e: KeyboardEvent): boolean => {
    if (!agentView) return false;
    if (e.ctrl && e.key === 'g') {
      e.preventDefault();
      void openAgentViewDispatchEditor();
      return true;
    }
    if (e.meta || e.ctrl) return false;
    if (e.key === 'return' && isAgentViewExitCommand(agentViewQuery)) {
      e.preventDefault();
      onDone(t('ui.agentView.dismissed'), {
        display: 'system'
      });
      return true;
    }
    if (e.key === 'return' && e.shift && agentViewDispatchQuery) {
      e.preventDefault();
      void dispatchAgentSupervisorJob({
        prompt: getAgentViewDispatchPrompt(agentViewQuery),
        attachAfterDispatch: true,
      });
      return true;
    }
    if (e.key === 'return' && agentViewDispatchQuery) {
      e.preventDefault();
      void dispatchAgentSupervisorJob({
        prompt: getAgentViewDispatchPrompt(agentViewQuery),
      });
      return true;
    }
    if (e.key === 'return' && agentViewInputMode === 'command') {
      e.preventDefault();
      applyAgentViewCommandPaletteSelection();
      return true;
    }
    if (e.key === 'escape') {
      e.preventDefault();
      if (agentViewQuery.length > 0) {
        setAgentViewQueryValue('', 0);
        setAgentSupervisorDispatchError(null);
      } else {
        setAgentSupervisorDispatchError(t('ui.agentView.rootBackHint'));
      }
      return true;
    }
    if (agentViewInputMode === 'command' && (e.key === 'tab' || e.key === 'right')) {
      e.preventDefault();
      applyAgentViewCommandPaletteSelection();
      return true;
    }
    if (agentViewInputMode === 'command' && e.key === 'down') {
      e.preventDefault();
      setAgentViewCommandPaletteIndex(index => Math.min(Math.max(0, agentViewCommandPaletteItems.length - 1), index + 1));
      return true;
    }
    if (agentViewInputMode === 'command' && e.key === 'up') {
      e.preventDefault();
      setAgentViewCommandPaletteIndex(index => Math.max(0, index - 1));
      return true;
    }
    if (agentViewQuery.length > 0) {
      // Once the inline Agent View input is active, let TextInput handle text
      // editing/paste/cursor movement, and only block parent list shortcuts
      // from seeing those keystrokes.
      return true;
    }
    // Printable insertion is owned by the useInput handler below. Keeping text
    // mutation in one place prevents dashboard input from racing list shortcuts
    // or double-inserting the first character.
    return false;
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle input when in list mode
    if (viewState.mode !== 'list') return;
    if (agentView && handleAgentViewRenameKey(e)) {
      return;
    }
    if (handleAgentViewQueryKey(e)) {
      return;
    }
    if (e.key === 'left') {
      e.preventDefault();
      if (agentView) {
        setAgentSupervisorDispatchError(t('ui.agentView.rootBackHint'));
        return;
      }
      onDone(agentView ? t('ui.agentView.dismissed') : 'Background tasks dialog dismissed', {
        display: 'system'
      });
      return;
    }

    if (agentView && e.key === '?') {
      e.preventDefault();
      setAgentViewHelpVisible(value => !value);
      return;
    }

    if (agentView && isPlainAgentViewTextKey(e)) {
      // In official Agent View parity, the dashboard is an input-first screen:
      // printable keys start a background task. Keep list actions on arrows,
      // Space, Enter/→, Ctrl-combos, and ? so task prompts like "review..."
      // or "memory..." do not lose their first character to a shortcut.
      return;
    }

    // Compute current selection at the time of the key press
    const currentSelection_0 = allSelectableItems[selectedIndex];
    if (!currentSelection_0) return; // everything below requires a selection

    if (agentView && e.meta && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      if (!openNthSupervisorInCurrentGroup(currentSelection_0, Number(e.key) - 1)) {
        setAgentSupervisorDispatchError(t('ui.agentView.noGroupShortcutTarget', { index: e.key }));
      }
      return;
    }

    if (agentView && currentSelection_0.type === 'supervisor_agent' && e.ctrl && e.key === 't') {
      e.preventDefault();
      void toggleAgentSupervisorPin(currentSelection_0.id).then(refreshSupervisorRowsOnce).catch(error => setAgentSupervisorDispatchError(error instanceof Error ? error.message : String(error)));
      return;
    }

    if (agentView && currentSelection_0.type === 'supervisor_agent' && e.ctrl && e.key === 'r') {
      e.preventDefault();
      setAgentViewRename({
        id: currentSelection_0.id,
        text: currentSelection_0.label
      });
      setAgentSupervisorDispatchError(null);
      return;
    }

    if (agentView && currentSelection_0.type === 'supervisor_agent' && e.shift && (e.key === 'up' || e.key === 'down')) {
      e.preventDefault();
      void moveAgentSupervisorJobOrder(currentSelection_0.id, e.key === 'up' ? -1 : 1).then(refreshSupervisorRowsOnce).catch(error => setAgentSupervisorDispatchError(error instanceof Error ? error.message : String(error)));
      return;
    }

    if (agentView && currentSelection_0.type === 'supervisor_agent' && e.ctrl && e.key === 'o') {
      e.preventDefault();
      const key = getCurrentSupervisorGroupKey(currentSelection_0);
      if (!key) return;
      const group = supervisorGroups.find(candidate => candidate.key === key);
      if (group?.hiddenCount || expandedSupervisorGroups.has(key)) {
        setExpandedSupervisorGroups(previous => {
          const next = new Set(previous);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        setCollapsedSupervisorGroups(previous => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
        return;
      }
      setCollapsedSupervisorGroups(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      if (currentSelection_0.type === 'supervisor_agent') {
        setViewState({
          mode: 'detail',
          itemId: currentSelection_0.id
        });
        return;
      }
      setViewState({
        mode: 'detail',
        itemId: currentSelection_0.id
      });
      return;
    }
    if (currentSelection_0.type === 'supervisor_agent' && e.key === 'right') {
      e.preventDefault();
      openSupervisorJobChannelFromAgentView(currentSelection_0.id);
      return;
    }
    if (currentSelection_0.type === 'supervisor_agent' && e.key === 'return') {
      // Mirror the right-arrow handler above so Enter opens the job too —
      // matches the "Enter/→ open" hint displayed in the dashboard footer.
      e.preventDefault();
      openSupervisorJobChannelFromAgentView(currentSelection_0.id);
      return;
    }
    if (e.key === 'right' && attachSelectionToMainView(currentSelection_0)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'r' && attachSelectionToMainView(currentSelection_0)) {
      e.preventDefault();
      return;
    }
    if (agentView && e.ctrl && e.key === 'x') {
      e.preventDefault();
      if (agentView && currentSelection_0.type === 'supervisor_agent') {
        void stopOrRemoveSupervisorJob(currentSelection_0).catch(error => setAgentSupervisorDispatchError(error instanceof Error ? error.message : String(error)));
      } else if (agentView && currentSelection_0.type === 'local_agent') {
        if (isInterruptibleBackgroundStatus(currentSelection_0.status)) {
          stopOrDismissAgent(currentSelection_0.id, setAppState);
          setPendingDismiss(null);
        } else {
          const now = Date.now();
          if (pendingDismiss?.id === currentSelection_0.id && pendingDismiss.expiresAt > now) {
            stopOrDismissAgent(currentSelection_0.id, setAppState);
            setPendingDismiss(null);
          } else {
            setPendingDismiss({
              id: currentSelection_0.id,
              expiresAt: now + AGENT_VIEW_DISMISS_CONFIRM_WINDOW_MS
            });
          }
        }
      } else if (currentSelection_0.type === 'local_bash' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killShellTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_agent' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killAgentTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'in_process_teammate' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killTeammateTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_workflow' && isInterruptibleBackgroundStatus(currentSelection_0.status) && killWorkflowTask) {
        killWorkflowTask(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'monitor_mcp' && isInterruptibleBackgroundStatus(currentSelection_0.status) && killMonitorMcp) {
        killMonitorMcp(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'dream' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killDreamTask(currentSelection_0.id);
      }
    }
    if (!agentView && e.key === 'x') {
      e.preventDefault();
      if (currentSelection_0.type === 'local_bash' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killShellTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_agent' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killAgentTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'in_process_teammate' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killTeammateTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_workflow' && isInterruptibleBackgroundStatus(currentSelection_0.status) && killWorkflowTask) {
        killWorkflowTask(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'monitor_mcp' && isInterruptibleBackgroundStatus(currentSelection_0.status) && killMonitorMcp) {
        killMonitorMcp(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'dream' && isInterruptibleBackgroundStatus(currentSelection_0.status)) {
        void killDreamTask(currentSelection_0.id);
      }
    }
    if (!agentView && e.key === 'f') {
      if (agentView && (currentSelection_0.type === 'local_agent' || currentSelection_0.type === 'in_process_teammate')) {
        e.preventDefault();
        attachSelectionToMainView(currentSelection_0);
      } else if (currentSelection_0.type === 'in_process_teammate' && currentSelection_0.status === 'running') {
        e.preventDefault();
        enterTeammateView(currentSelection_0.id, setAppState);
        onDone('Viewing teammate', {
          display: 'system'
        });
      } else if (currentSelection_0.type === 'leader') {
        e.preventDefault();
        exitTeammateView(setAppState);
        onDone('Viewing leader', {
          display: 'system'
        });
      }
    }
  };
  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }
  async function killAgentTask(taskId_0: string): Promise<void> {
    await LocalAgentTask.kill(taskId_0, setAppState);
  }
  async function killTeammateTask(taskId_1: string): Promise<void> {
    await InProcessTeammateTask.kill(taskId_1, setAppState);
  }
  async function killDreamTask(taskId_2: string): Promise<void> {
    await DreamTask.kill(taskId_2, setAppState);
  }
  // Wrap onDone in useEffectEvent to get a stable reference that always calls
  // the current onDone callback without causing the effect to re-fire.
  const onDoneEvent = useEffectEvent(onDone);
  useEffect(() => {
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      const supervisorDetailVisible = agentView && agentSupervisorRows.some(item => item.id === viewState.itemId);
      // Workflow tasks get a grace: their detail view stays open through
      // completion so the user sees the final state before eviction.
      const detailVisible = supervisorDetailVisible || (agentView ? isAgentViewTaskState(task) : task?.type === 'local_workflow' || isBackgroundTask(task));
      if (!detailVisible) {
        // Task was removed or is no longer a background task (e.g. killed).
        // If we skipped the list on mount, close the dialog entirely.
        if (skippedListOnMount.current) {
          onDoneEvent(agentView ? t('ui.agentView.dismissed') : 'Background tasks dialog dismissed', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'list'
          });
        }
      }
    }
    const totalItems = allSelectableItems.length;
    if (selectedIndex >= totalItems && totalItems > 0) {
      setSelectedIndex(totalItems - 1);
    }
  }, [viewState, typedTasks, selectedIndex, allSelectableItems, onDoneEvent, agentView, agentSupervisorRows]);

  // Helper to go back to list view (or close dialog if we skipped list on
  // mount AND there's still only ≤1 item). Checking current count prevents
  // the stale-state trap: if you opened with 1 task (auto-skipped to detail),
  // then a second task started, 'back' should show the list — not close.
  const goBackToList = () => {
    if (agentView) {
      skippedListOnMount.current = false;
      setViewState({
        mode: 'list'
      });
      return;
    }
    if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone(agentView ? t('ui.agentView.dismissed') : 'Background tasks dialog dismissed', {
        display: 'system'
      });
    } else {
      skippedListOnMount.current = false;
      setViewState({
        mode: 'list'
      });
    }
  };

  useInput((input, key, event) => {
    if (!agentView || viewState.mode !== 'list' || agentViewRename) return;
    if (
      input === '\u0003' ||
      input === '\u0004' ||
      (key.ctrl && (input === 'c' || input === 'd'))
    ) {
      event.stopImmediatePropagation();
      onDone(t('ui.agentView.dismissed'), {
        display: 'system'
      });
      return;
    }
    if (key.ctrl || key.meta) return;

    const currentQuery = agentViewQueryRef.current;
    const currentMode = getAgentViewInputMode(currentQuery);
    if (key.escape) {
      event.stopImmediatePropagation();
      if (currentQuery) {
        setAgentViewQueryValue('', 0);
        setAgentSupervisorDispatchError(null);
      } else {
        setAgentSupervisorDispatchError(t('ui.agentView.rootBackHint'));
      }
      return;
    }
    if (key.leftArrow || input === '\u001b[D') {
      event.stopImmediatePropagation();
      if (currentQuery) {
        setAgentViewQueryValue(currentQuery, Math.max(0, agentViewQueryCursorOffsetRef.current - 1));
      } else {
        setAgentSupervisorDispatchError(t('ui.agentView.rootBackHint'));
      }
      return;
    }
    if (key.rightArrow || input === '\u001b[C') {
      event.stopImmediatePropagation();
      if (currentQuery) {
        setAgentViewQueryValue(currentQuery, Math.min(currentQuery.length, agentViewQueryCursorOffsetRef.current + 1));
      }
      return;
    }
    if (key.return) {
      if (isAgentViewExitCommand(currentQuery)) {
        event.stopImmediatePropagation();
        onDone(t('ui.agentView.dismissed'), {
          display: 'system'
        });
        return;
      }
      if (currentMode === 'dispatch') {
        event.stopImmediatePropagation();
        void dispatchAgentSupervisorJob({
          prompt: getAgentViewDispatchPrompt(currentQuery),
          attachAfterDispatch: key.shift,
        });
        return;
      }
      if (currentMode === 'command') {
        event.stopImmediatePropagation();
        applyAgentViewCommandPaletteSelection();
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (!currentQuery) return;
      event.stopImmediatePropagation();
      const cursor = Math.max(
        0,
        Math.min(agentViewQueryCursorOffsetRef.current, currentQuery.length),
      );
      const start = key.backspace ? Math.max(0, cursor - 1) : cursor;
      const end = key.backspace ? cursor : Math.min(currentQuery.length, cursor + 1);
      setAgentViewQueryValue(
        `${currentQuery.slice(0, start)}${currentQuery.slice(end)}`,
        start,
      );
      setAgentSupervisorDispatchError(null);
      return;
    }

    if (!input || key.tab) return;
    if (input === ' ' && currentQuery.length === 0) return;
    if (currentQuery.length === 0 && RESERVED_AGENT_VIEW_ACTION_KEYS.has(input)) {
      return;
    }

    event.stopImmediatePropagation();
    const cursor = Math.max(
      0,
      Math.min(agentViewQueryCursorOffsetRef.current, currentQuery.length),
    );
    const newlineIndex = input.search(/[\r\n]/);
    const insertedText =
      newlineIndex >= 0 ? input.slice(0, newlineIndex) : input;
    const next = `${currentQuery.slice(0, cursor)}${insertedText}${currentQuery.slice(cursor)}`;
    setAgentViewQueryValue(next, cursor + insertedText.length);
    setAgentSupervisorDispatchError(null);
    if (newlineIndex >= 0 && getAgentViewInputMode(next) === 'dispatch') {
      void dispatchAgentSupervisorJob({
        prompt: getAgentViewDispatchPrompt(next),
      });
    }
  }, {
    isActive: agentView && viewState.mode === 'list',
  });

  // If an item is selected, show the appropriate view
  if (viewState.mode !== 'list') {
    const supervisorItem = agentSupervisorRows.find(item => item.id === viewState.itemId);
    if (agentView && supervisorItem) {
      // We only reach detail mode here for dead jobs (worker exited or
      // socket missing) — live jobs short-circuit in
      // openSupervisorJobChannelFromAgentView by handing off to the
      // shell-side session loop (Ink unmounts, raw bridge takes over).
      // The read-only DetailDialog is the fallback for completed / failed /
      // stopped jobs.
      return <AgentSupervisorDetailDialog jobId={supervisorItem.id} onBack={goBackToList} />;
    }
    if (!typedTasks) {
      return null;
    }
    const task_0 = typedTasks[viewState.itemId];
    if (!task_0) {
      return null;
    }

    // Detail mode - show appropriate detail dialog
    switch (task_0.type) {
      case 'local_bash':
        return <ShellDetailDialog shell={task_0} onDone={onDone} onKillShell={() => void killShellTask(task_0.id)} onBack={goBackToList} key={`shell-${task_0.id}`} />;
      case 'local_agent':
        return <AsyncAgentDetailDialog agent={task_0} onDone={onDone} onKillAgent={() => void killAgentTask(task_0.id)} onBack={goBackToList} onAttach={agentView ? () => attachAgentTaskToMainView(task_0.id) : undefined} key={`agent-${task_0.id}`} />;
      case 'in_process_teammate':
        return <InProcessTeammateDetailDialog teammate={task_0} onDone={onDone} onKill={isInterruptibleBackgroundStatus(task_0.status) ? () => void killTeammateTask(task_0.id) : undefined} onBack={goBackToList} onForeground={isInterruptibleBackgroundStatus(task_0.status) ? () => {
          enterTeammateView(task_0.id, setAppState);
          onDone('Viewing teammate', {
            display: 'system'
          });
        } : undefined} onAttach={agentView ? () => attachAgentTaskToMainView(task_0.id) : undefined} key={`teammate-${task_0.id}`} />;
      case 'local_workflow':
        if (!WorkflowDetailDialog) return null;
        return <WorkflowDetailDialog workflow={task_0} onDone={onDone} onKill={isInterruptibleBackgroundStatus(task_0.status) && killWorkflowTask ? () => killWorkflowTask(task_0.id, setAppState) : undefined} onSkipAgent={isInterruptibleBackgroundStatus(task_0.status) && skipWorkflowAgent ? agentId => skipWorkflowAgent(task_0.id, agentId, setAppState) : undefined} onRetryAgent={isInterruptibleBackgroundStatus(task_0.status) && retryWorkflowAgent ? agentId_0 => retryWorkflowAgent(task_0.id, agentId_0, setAppState) : undefined} onBack={goBackToList} key={`workflow-${task_0.id}`} />;
      case 'monitor_mcp':
        if (!MonitorMcpDetailDialog) return null;
        return <MonitorMcpDetailDialog task={task_0} onKill={isInterruptibleBackgroundStatus(task_0.status) && killMonitorMcp ? () => killMonitorMcp(task_0.id, setAppState) : undefined} onBack={goBackToList} key={`monitor-mcp-${task_0.id}`} />;
      case 'dream':
        return <DreamDetailDialog task={task_0} onDone={() => onDone('Background tasks dialog dismissed', {
          display: 'system'
        })} onBack={goBackToList} onKill={isInterruptibleBackgroundStatus(task_0.status) ? () => void killDreamTask(task_0.id) : undefined} key={`dream-${task_0.id}`} />;
    }
  }
  const activeBashCount = count<BashListItem>(bashTasks, item => isActiveBackgroundStatus(item.status));
  const activeSupervisorCount = agentView ? count<SupervisorListItem>(agentSupervisorRows, item_0 => item_0.status === 'working' || item_0.status === 'needs_input' || item_0.status === 'queued') : 0;
  const agentViewTotalCount = agentSupervisorRows.length + agentViewItems.length;
  const activeAgentCount = agentView ? activeSupervisorCount + count<AgentViewItem>(agentViewItems, item_0 => item_0.status === 'working' || item_0.status === 'needs_input') : count<RemoteListItem>(remoteSessions, item_1 => isActiveBackgroundStatus(item_1.status)) + count<AgentListItem>(agentTasks, item_2 => isActiveBackgroundStatus(item_2.status));
  const activeTeammateCount = count<TeammateListItem>(teammateTasks, item_2 => item_2.type !== 'leader' && isActiveBackgroundStatus(item_2.status));
  const subtitle = agentView ? intersperse([...(activeAgentCount > 0 ? [<Text key="activeAgents">{activeAgentCount} {activeAgentCount !== 1 ? t('ui.agentView.activeSessions') : t('ui.agentView.activeSession')}</Text>] : []), ...(agentViewTotalCount > 0 ? [<Text key="totalAgents">{agentViewTotalCount} {agentViewTotalCount !== 1 ? t('ui.agentView.totalSessions') : t('ui.agentView.totalSession')}</Text>] : [])], index => <Text key={`separator-${index}`}> · </Text>) : intersperse([...(activeTeammateCount > 0 ? [<Text key="teammates">
              {activeTeammateCount}{' '}
              {activeTeammateCount !== 1 ? 'teammates' : 'teammate'}
            </Text>] : []), ...(activeBashCount > 0 ? [<Text key="shells">
              {activeBashCount}{' '}
              {activeBashCount !== 1 ? 'background shells' : 'background shell'}
            </Text>] : []), ...(activeAgentCount > 0 ? [<Text key="agents">
              {activeAgentCount}{' '}
              {activeAgentCount !== 1 ? 'background agents' : 'background agent'}
            </Text>] : [])], index => <Text key={`separator-${index}`}> · </Text>);
  const agentDismissPending = agentView && currentSelection?.type === 'local_agent' && pendingDismiss?.id === currentSelection.id && pendingDismiss.expiresAt > Date.now();
  const supervisorDismissPending = agentView && currentSelection?.type === 'supervisor_agent' && pendingDismiss?.id === currentSelection.id && pendingDismiss.expiresAt > Date.now();
  const agentViewHighDensity = agentView && shouldUseAgentViewHighDensity(supervisorJobs.length, terminalColumns);
  const agentViewDashboardHeight = agentView ? Math.max(8, terminalRows - 3) : undefined;
  const agentViewDispatchDefaultsLabel = agentView ? formatAgentViewDispatchDefaults(agentViewDispatchDefaults) : null;
  const agentViewSelectionHint = agentViewNextHint();
  const actions = agentView ? [
    ...(currentSupervisorSelection ? [
      <KeyboardShortcutHint key="primary" shortcut={currentSupervisorSelection.primaryAction.shortcut} action={supervisorActionLabel(currentSupervisorSelection.primaryAction)} />,
      ...(currentSupervisorSelection.secondaryAction ? [
        <KeyboardShortcutHint key="secondary" shortcut={currentSupervisorSelection.secondaryAction.shortcut} action={supervisorActionLabel(currentSupervisorSelection.secondaryAction)} />,
      ] : []),
    ] : [
      <KeyboardShortcutHint key="enter" shortcut="Enter/→" action={t('ui.agentView.attach')} />,
      <KeyboardShortcutHint key="space" shortcut="Space" action={t('ui.agentView.peek')} />,
    ]),
    <KeyboardShortcutHint key="stop" shortcut="Ctrl+X" action={agentDismissPending || supervisorDismissPending ? t('ui.agentView.confirmDismiss') : t('ui.agentView.stop')} />,
    <KeyboardShortcutHint key="help" shortcut="?" action={t('ui.agentView.help')} />,
  ] : [<KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />, <KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />, ...(currentSelection?.type === 'in_process_teammate' && isInterruptibleBackgroundStatus(currentSelection.status) ? [<KeyboardShortcutHint key="foreground" shortcut="f" action="foreground" />] : []), ...((currentSelection?.type === 'local_bash' || currentSelection?.type === 'local_agent' || currentSelection?.type === 'in_process_teammate' || currentSelection?.type === 'local_workflow' || currentSelection?.type === 'monitor_mcp' || currentSelection?.type === 'dream' || currentSelection?.type === 'remote_agent') && isInterruptibleBackgroundStatus(currentSelection.status) ? [<KeyboardShortcutHint key="kill" shortcut="x" action="stop" />] : []), ...(agentTasks.some(t => isInterruptibleBackgroundStatus(t.status)) ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />] : []), <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />];
  const handleCancel = () => {
    if (agentView) {
      setAgentSupervisorDispatchError(t('ui.agentView.rootBackHint'));
      return;
    }
    onDone('Background tasks dialog dismissed', {
      display: 'system'
    });
  };
  const renderAgentViewInlineInput = (): React.ReactNode => {
    const modeColor = agentViewDispatchQuery ? "success" : agentViewInputMode === 'command' ? "warning" : "suggestion";
    const cursor = Math.max(0, Math.min(agentViewQueryCursorOffset, agentViewQuery.length));
    if (!agentViewQuery) {
      return <Box>
          <Text color={modeColor}>› </Text>
          <Text inverse> </Text>
          <Text dimColor>{t('ui.agentView.inputPlaceholder')}</Text>
        </Box>;
    }
    const cursorChar = agentViewQuery[cursor] ?? ' ';
    return <Box>
        <Text color={modeColor}>› </Text>
        {agentViewQuery.slice(0, cursor) && <Text>{agentViewQuery.slice(0, cursor)}</Text>}
        <Text inverse>{cursorChar}</Text>
        {cursor < agentViewQuery.length && <Text>{agentViewQuery.slice(cursor + 1)}</Text>}
      </Box>;
  };
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title={agentView ? t('ui.agentView.title') : 'Background tasks'} subtitle={<>{subtitle}</>} onCancel={handleCancel} color="background" inputGuide={renderInputGuide} hideInputGuide={agentView} hideBorder={agentView} isCancelActive={!agentView}>
        <Box flexDirection="column" height={agentViewDashboardHeight}>
        {allSelectableItems.length === 0 ? <Text dimColor>{agentView ? agentViewInputMode === 'filter' ? t('ui.agentView.noMatches') : agentViewInputMode === 'command' ? t('ui.agentView.commandPending') : t('ui.agentView.empty') : 'No tasks currently running'}</Text> : <Box flexDirection="column">
            {supervisorGroups.length > 0 && <Box flexDirection="column">
                {supervisorGroups.map((group, index) => <Box key={group.key} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                    <Text dimColor>{collapsedSupervisorGroups.has(group.key) ? '▸ ' : ''}<Text bold>{agentViewGroupStageLabel(group.stage)}</Text></Text>
                    {!collapsedSupervisorGroups.has(group.key) && group.items.map(item_5 => <Item key={item_5.id} item={item_5} isSelected={item_5.id === currentSelection?.id} prStatus={agentSupervisorPrStatuses[item_5.id]} highlightColor={agentSupervisorStatusFlashColors.get(item_5.id)} compact={agentViewHighDensity} />)}
                    {!collapsedSupervisorGroups.has(group.key) && group.hiddenCount ? <Text dimColor>{'  '}… {t('ui.agentView.moreCompleted', { count: String(group.hiddenCount) })}</Text> : null}
                  </Box>)}
              </Box>}

            {agentView && (teammateTasks.length > 0 || bashTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 || workflowTasks.length > 0 || dreamTasks_0.length > 0) && <Box marginTop={supervisorGroups.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}{t('ui.agentView.groupLiveLocalTasks')}</Text>
                </Text>
              </Box>}
            {teammateTasks.length > 0 && <Box flexDirection="column">
                {(bashTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}{agentView ? t('ui.agentView.groupAgents') : 'Agents'}</Text> (
                    {count<TeammateListItem>(teammateTasks, i => i.type !== 'leader')})
                  </Text>}
                <Box flexDirection="column">
                  <TeammateTaskGroups teammateTasks={teammateTasks} currentSelectionId={currentSelection?.id} />
                </Box>
              </Box>}

            {bashTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 ? 1 : 0}>
                {(teammateTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}Shells</Text> ({bashTasks.length})
                  </Text>}
                <Box flexDirection="column">
                  {bashTasks.map(item_6 => <Item key={item_6.id} item={item_6} isSelected={item_6.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {mcpMonitors.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Monitors</Text> ({mcpMonitors.length})
                </Text>
                <Box flexDirection="column">
                  {mcpMonitors.map(item_7 => <Item key={item_7.id} item={item_7} isSelected={item_7.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {remoteSessions.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}{agentView ? t('ui.agentView.groupRemoteAgents') : 'Remote agents'}</Text> ({remoteSessions.length}
                  )
                </Text>
                <Box flexDirection="column">
                  {remoteSessions.map(item_8 => <Item key={item_8.id} item={item_8} isSelected={item_8.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {agentTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}{agentView ? t('ui.agentView.groupLocalAgents') : 'Local agents'}</Text> ({agentTasks.length})
                </Text>
                <Box flexDirection="column">
                  {agentTasks.map(item_9 => <Item key={item_9.id} item={item_9} isSelected={item_9.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {workflowTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Workflows</Text> ({workflowTasks.length})
                </Text>
                <Box flexDirection="column">
                  {workflowTasks.map(item_10 => <Item key={item_10.id} item={item_10} isSelected={item_10.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {dreamTasks_0.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 || workflowTasks.length > 0 ? 1 : 0}>
                <Box flexDirection="column">
                  {dreamTasks_0.map(item_11 => <Item key={item_11.id} item={item_11} isSelected={item_11.id === currentSelection?.id} />)}
                </Box>
              </Box>}
          </Box>}
        {agentView && <Box flexGrow={1} />}
        {agentView && <Box flexDirection="column" marginTop={1}>
            {agentViewHelpVisible && renderAgentViewHelpSections()}
            {agentViewRename && <Text color="suggestion">{t('ui.agentView.renamePrompt')} {agentViewRename.text}</Text>}
            {agentViewInputMode === 'command' && <Box flexDirection="column" marginBottom={1}>
                <Text dimColor>{t('ui.agentView.paletteTitle')}</Text>
                {agentViewCommandPaletteItems.length === 0 ? <Text dimColor>{t('ui.agentView.paletteEmpty')}</Text> : agentViewCommandPaletteItems.map((item, index) => <Box key={item.name}>
                    <Text color={index === agentViewCommandPaletteIndex ? "success" : undefined}>{index === agentViewCommandPaletteIndex ? '› ' : '  '}/{item.name}</Text>
                    <Text dimColor> · {item.kindLabel} · {truncateVisual(item.description, Math.max(24, terminalColumns - item.name.length - 18))}</Text>
                  </Box>)}
                <Text dimColor>{t('ui.agentView.paletteHint')}</Text>
              </Box>}
            {agentSupervisorDispatching && <Text dimColor>{t('ui.agentView.dispatching')}</Text>}
            {agentSupervisorLoadError && <Text color="warning">{t('ui.agentView.supervisorLoadError')}: {agentSupervisorLoadError}</Text>}
            {agentSupervisorDispatchError && <Text color="warning">{agentSupervisorDispatchError}</Text>}
            {agentViewSelectionHint && <Text dimColor wrap="truncate-end">{t('ui.agentView.nextStep')}: {agentViewSelectionHint}</Text>}
            {renderAgentViewInlineInput()}
            {agentViewHelpVisible && <Text dimColor wrap="truncate-end">{t('ui.agentView.lastRefresh')}: {formatAgentViewRefreshAge(agentSupervisorLastRefreshAt)}
              {agentViewDispatchDefaultsLabel ? <> · {t('ui.agentView.dispatchDefaults')}: {agentViewDispatchDefaultsLabel}</> : null}
              {supervisorJobs.length > 0 ? <> · {t('ui.agentView.density', { groups: String(supervisorGroups.length), rows: String(supervisorJobs.length) })}</> : null}
              {agentViewHighDensity ? <> · {t('ui.agentView.highDensityMode')}</> : null}
            </Text>}
            <Text dimColor italic><Byline>{actions}</Byline></Text>
          </Box>}
        </Box>
      </Dialog>
    </Box>;
}
import { withErrorBoundary } from '../MossenErrorBoundary.js';
export const BackgroundTasksDialog = withErrorBoundary(BackgroundTasksDialogImpl, 'BackgroundTasksDialog');
function toListItem(task: BackgroundTaskState | AgentViewTaskState): ListItem {
  switch (task.type) {
    case 'local_bash':
      return {
        id: task.id,
        type: 'local_bash',
        label: task.kind === 'monitor' ? task.description : task.command,
        status: task.status,
        task
      };
    case 'remote_agent':
      return {
        id: task.id,
        type: 'remote_agent',
        label: task.title,
        status: task.status,
        task
      };
    case 'local_agent':
      return {
        id: task.id,
        type: 'local_agent',
        label: task.description,
        status: task.status,
        task
      };
    case 'in_process_teammate':
      return {
        id: task.id,
        type: 'in_process_teammate',
        label: `@${task.identity.agentName}`,
        status: task.status,
        task
      };
    case 'local_workflow':
      return {
        id: task.id,
        type: 'local_workflow',
        label: task.summary ?? task.description,
        status: task.status,
        task
      };
    case 'monitor_mcp':
      return {
        id: task.id,
        type: 'monitor_mcp',
        label: task.description,
        status: task.status,
        task
      };
    case 'dream':
      return {
        id: task.id,
        type: 'dream',
        label: task.description,
        status: task.status,
        task
      };
  }
}
function Item({
  item,
  isSelected,
  prStatus,
  highlightColor,
  compact = false
}: {
  item: ListItem;
  isSelected: boolean;
  prStatus?: AgentSupervisorPrStatus;
  highlightColor?: string;
  compact?: boolean;
  key?: React.Key;
}) {
  const {
    columns
  } = useTerminalSize();
  const maxActivityWidth = item.type === 'supervisor_agent'
    ? Math.max(36, columns - 4)
    : compact ? Math.max(22, columns - 16) : Math.max(30, columns - 26);
  const useGreyPointer = isCoordinatorMode();
  const pointer = isSelected ? figures.pointer + " " : "  ";
  const selectedColor = isSelected && !useGreyPointer ? "suggestion" : undefined;
  const pointerNode = <Text dimColor={useGreyPointer && isSelected}>{pointer}</Text>;
  const itemTask = item.type === "leader" || item.type === "supervisor_agent" ? null : item.task;
  if (item.type === "leader") {
    return <Box flexDirection="row">{pointerNode}<Text color={selectedColor}>@{TEAM_LEAD_NAME}</Text></Box>;
  }
  if (item.type === "supervisor_agent") {
    return <Box flexDirection="row">{pointerNode}<SupervisorAgentRow item={item} prStatus={prStatus} maxActivityWidth={maxActivityWidth} color={selectedColor} highlightColor={highlightColor} compact={compact} selected={isSelected} /></Box>;
  }
  if (itemTask === null) {
    return null;
  }
  return <Box flexDirection="row">{pointerNode}<Text color={selectedColor}><BackgroundTaskComponent task={itemTask} maxActivityWidth={maxActivityWidth} /></Text></Box>;
}
function SupervisorAgentRow({
  item,
  prStatus,
  maxActivityWidth,
  color,
  highlightColor,
  compact = false,
  selected = false
}: {
  item: SupervisorListItem;
  prStatus?: AgentSupervisorPrStatus;
  maxActivityWidth: number;
  color?: string;
  highlightColor?: string;
  compact?: boolean;
  selected?: boolean;
}) {
  const prLabel = prStatus?.label ?? getSupervisorAgentPrStatus(item);
  const cwd = shortenPathForAgentView(item.cwd);
  const fallbackSummary = item.cwdAvailable ? cwd : `${cwd} · missing cwd`;
  const rawSummary =
    item.lastQuestionText?.trim() ||
    item.resultSummary?.trim() ||
    item.lastSummaryLine?.trim() ||
    fallbackSummary;
  const summary = rawSummary.toLowerCase() === item.label.trim().toLowerCase() ? '' : rawSummary;
  const statusLabel = agentViewStatusLabel(item.status);
  const actionHint = `${item.primaryAction.shortcut} ${supervisorRowActionLabel(item.primaryAction.kind)}`;
  const activity = [statusLabel, actionHint, summary].filter(Boolean).join(' · ');
  const rowColor = color ?? highlightColor;
  const processShape = item.processAlive ? '✻ ' : '∙ ';
  const titlePrefix = `${processShape}${item.pinned ? '★ ' : ''}`;
  const prDotWidth = prStatus ? 2 : 0;
  const titleWidth = compact
    ? Math.min(28, Math.max(16, Math.floor(maxActivityWidth * 0.35)))
    : Math.min(42, Math.max(20, Math.floor(maxActivityWidth * 0.34)));
  const age = formatAgentViewJobAge(item.updatedAt);
  const ageWidth = age ? visualWidth(age) + 1 : 0;
  const titleTextWidth = Math.max(8, titleWidth - prDotWidth);
  const title = padVisualEnd(truncateVisual(`${titlePrefix}${item.label}`, titleTextWidth), titleTextWidth);
  const rightMetaParts = [
    prLabel,
    item.resultBadge,
    item.agent ? `@${item.agent}` : null,
    item.model,
  ].filter((part): part is string => Boolean(part));
  const rightMeta = rightMetaParts.length > 0
    ? truncateVisual(rightMetaParts.join(' · '), compact ? 18 : 30)
    : '';
  const metaWidth = rightMeta ? visualWidth(rightMeta) + 1 : 0;
  const summaryWidth = Math.max(12, maxActivityWidth - titleWidth - ageWidth - metaWidth - prDotWidth - 2);
  const summaryText = truncateVisual(activity, summaryWidth);
  const rowWithoutAge = `${title} ${summaryText}${rightMeta ? ` ${rightMeta}` : ''}`;
  const spacer = age ? ' '.repeat(Math.max(1, maxActivityWidth - prDotWidth - visualWidth(rowWithoutAge) - visualWidth(age))) : '';
  return <Text color={rowColor} dimColor={!rowColor && !selected} inverse={selected}>{prStatus && <PrStatusDot status={prStatus.state} />}{rowWithoutAge}{spacer}{age}</Text>;
}
function supervisorRowActionLabel(
  kind: SupervisorListItem['primaryAction']['kind'],
): string {
  switch (kind) {
    case 'attach':
      return t('ui.agentView.actionAttach');
    case 'inspect':
      return t('ui.agentView.actionInspect');
    case 'peek':
      return t('ui.agentView.actionPeek');
    case 'reply':
      return t('ui.agentView.actionReply');
    case 'review':
      return t('ui.agentView.actionReview');
  }
}
function PrStatusDot({ status }: { status: AgentSupervisorPrStatus['state'] }) {
  if (status === 'checks_running') return <Text color="warning">● </Text>;
  if (status === 'checks_passed') return <Text color="success">● </Text>;
  if (status === 'merged') return <Text color="suggestion">● </Text>;
  return <Text dimColor>● </Text>;
}
function TeammateTaskGroups(t0: {
  teammateTasks: TeammateListItem[];
  currentSelectionId?: string;
}) {
  const $ = _c(3);
  const {
    teammateTasks,
    currentSelectionId
  } = t0;
  let t1;
  if ($[0] !== currentSelectionId || $[1] !== teammateTasks) {
    const leaderItems = teammateTasks.filter(_temp);
    const teammateItems = teammateTasks.filter(_temp2);
    const teams = new Map<string, Extract<ListItem, { type: 'in_process_teammate' }>[]>();
    for (const item of teammateItems) {
      const teamName = item.task.identity.teamName;
      const group = teams.get(teamName);
      if (group) {
        group.push(item);
      } else {
        teams.set(teamName, [item]);
      }
    }
    const teamEntries = [...teams.entries()];
    t1 = <>{teamEntries.map(t2 => {
        const [teamName_0, items] = t2;
        const memberCount = items.length + leaderItems.length;
        return <Box key={teamName_0} flexDirection="column"><Text dimColor={true}>{"  "}Team: {teamName_0} ({memberCount})</Text>{leaderItems.map(item_0 => <Item key={`${item_0.id}-${teamName_0}`} item={item_0} isSelected={item_0.id === currentSelectionId} />)}{items.map(item_1 => <Item key={item_1.id} item={item_1} isSelected={item_1.id === currentSelectionId} />)}</Box>;
      })}</>;
    $[0] = currentSelectionId;
    $[1] = teammateTasks;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
function _temp2(i_0: TeammateListItem): i_0 is Extract<ListItem, { type: 'in_process_teammate' }> {
  return i_0.type === "in_process_teammate";
}
function _temp(i: TeammateListItem): i is Extract<ListItem, { type: 'leader' }> {
  return i.type === "leader";
}
