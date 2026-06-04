/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures';
import * as React from 'react';
import { BLACK_CIRCLE, PAUSE_ICON, PLAY_ICON } from '../constants/figures.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text, wrapText } from '../ink.js';
import { type AppState, useAppState, useSetAppState } from '../state/AppState.js';
import { enterTeammateView, exitTeammateView } from '../state/teammateViewHelpers.js';
import { isPanelAgentTask, type LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import { evictTerminalTask } from '../utils/task/framework.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { isTerminalStatus } from './tasks/taskStatusUtils.js';

export type BranchRow =
  | { kind: 'main'; id: 'main'; label: string; status: 'idle' | 'running' | 'waiting' }
  | {
      kind: 'fork';
      id: string;
      label: string;
      status: LocalAgentTaskState['status'];
      taskId: string;
      task: LocalAgentTaskState;
    };

/**
 * Which panel-managed tasks currently have a visible row.
 * Presence in AppState.tasks IS visibility — the 1s tick in
 * CoordinatorTaskPanel evicts tasks past their evictAfter deadline. The
 * evictAfter !== 0 check handles immediate dismiss (x key) without making
 * the filter time-dependent. Shared by panel render, useCoordinatorTaskCount,
 * and index resolvers so the math can't drift.
 */
export function getVisibleAgentTasks(tasks: AppState['tasks']): LocalAgentTaskState[] {
  return Object.values(tasks).filter((t): t is LocalAgentTaskState => isPanelAgentTask(t) && t.evictAfter !== 0).sort((a, b) => a.startTime - b.startTime);
}

export function deriveBranchRows(
  tasks: AppState['tasks'],
  agentNameRegistry: AppState['agentNameRegistry'] = new Map(),
): BranchRow[] {
  const visibleTasks = getVisibleAgentTasks(tasks);
  if (visibleTasks.length === 0) return [];
  const nameByAgentId = new Map<string, string>();
  for (const [name, id] of agentNameRegistry) nameByAgentId.set(id, name);
  const mainRunning = visibleTasks.some(task => !isTerminalStatus(task.status));
  return [
    {
      kind: 'main',
      id: 'main',
      label: getLocalizedText({ en: 'main', zh: '主会话' }),
      status: mainRunning ? 'running' : 'idle',
    },
    ...visibleTasks.map(task => ({
      kind: 'fork' as const,
      id: task.id,
      label: nameByAgentId.get(task.id) ?? task.description,
      status: task.status,
      taskId: task.id,
      task,
    })),
  ];
}

export function CoordinatorTaskPanel(): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s_0 => s_0.viewingAgentTaskId);
  const agentNameRegistry = useAppState(s_1 => s_1.agentNameRegistry);
  const coordinatorTaskIndex = useAppState(s_2 => s_2.coordinatorTaskIndex);
  const tasksSelected = useAppState(s_3 => s_3.footerSelection === 'tasks');
  const selectedIndex = tasksSelected ? coordinatorTaskIndex : undefined;
  const setAppState = useSetAppState();
  const visibleTasks = getVisibleAgentTasks(tasks);
  const hasTasks = Object.values(tasks).some(isPanelAgentTask);

  // 1s tick: re-render for elapsed time + evict tasks past their deadline.
  // The eviction deletes from prev.tasks, which makes useCoordinatorTaskCount
  // (and other consumers) see the updated count without their own tick.
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!hasTasks) return;
    const interval = setInterval((tasksRef_0, setAppState_0, setTick_0) => {
      const now = Date.now();
      for (const t of Object.values(tasksRef_0.current)) {
        if (isPanelAgentTask(t) && (t.evictAfter ?? Infinity) <= now) {
          evictTerminalTask(t.id, setAppState_0);
        }
      }
      setTick_0((prev: number) => prev + 1);
    }, 1000, tasksRef, setAppState, setTick);
    return () => clearInterval(interval);
  }, [hasTasks, setAppState]);
  const branchRows = React.useMemo(() => deriveBranchRows(tasks, agentNameRegistry), [tasks, agentNameRegistry]);
  if (branchRows.length === 0) {
    return null;
  }
  return <Box flexDirection="column" marginTop={1}>
      <MainLine row={branchRows[0]} isSelected={selectedIndex === 0} isViewed={viewingAgentTaskId === undefined} onClick={() => exitTeammateView(setAppState)} />
      {branchRows.slice(1).map((row, i) => row.kind === 'fork' ? <AgentLine key={row.id} row={row} isSelected={selectedIndex === i + 1} isViewed={viewingAgentTaskId === row.taskId} onClick={() => enterTeammateView(row.taskId, setAppState)} /> : null)}
    </Box>;
}

/**
 * Returns the number of visible coordinator tasks (for selection bounds).
 * The panel's 1s tick evicts expired tasks from prev.tasks, so this count
 * stays accurate without needing its own tick.
 */
export function useCoordinatorTaskCount() {
  const tasks = useAppState(_temp);
  const count = getVisibleAgentTasks(tasks).length;
  return count === 0 ? 0 : count + 1;
}
function _temp(s) {
  return s.tasks;
}
function MainLine(t0) {
  const $ = _c(12);
  const {
    row,
    isSelected,
    isViewed,
    onClick
  } = t0;
  const [hover, setHover] = React.useState(false);
  const prefix = isSelected || hover ? figures.pointer + " " : "  ";
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const statusLabel = row.status === 'running' ? getLocalizedText({ en: 'running', zh: '运行中' }) : getLocalizedText({ en: 'idle', zh: '空闲' });
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setHover(true);
    t2 = () => setHover(false);
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  const t3 = !isSelected && !isViewed && !hover;
  let t4;
  if ($[2] !== bullet || $[3] !== isViewed || $[4] !== prefix || $[5] !== row.label || $[6] !== statusLabel || $[7] !== t3) {
    t4 = <Text dimColor={t3} bold={isViewed}>{prefix}{bullet} {row.label} <Text dimColor>{statusLabel}</Text></Text>;
    $[2] = bullet;
    $[3] = isViewed;
    $[4] = prefix;
    $[5] = row.label;
    $[6] = statusLabel;
    $[7] = t3;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== onClick || $[10] !== t4) {
    t5 = <Box onClick={onClick} onMouseEnter={t1} onMouseLeave={t2}>{t4}</Box>;
    $[9] = onClick;
    $[10] = t4;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  return t5;
}
type AgentLineProps = {
  row: Extract<BranchRow, { kind: 'fork' }>;
  isSelected?: boolean;
  isViewed?: boolean;
  onClick?: () => void;
};
function AgentLine(t0) {
  const $ = _c(32);
  const {
    row,
    isSelected,
    isViewed,
    onClick
  } = t0;
  const task = row.task;
  const name = row.label === task.description ? undefined : row.label;
  const {
    columns
  } = useTerminalSize();
  const [hover, setHover] = React.useState(false);
  const isRunning = !isTerminalStatus(task.status);
  const pausedMs = task.totalPausedMs ?? 0;
  const elapsedMs = Math.max(0, isRunning ? Date.now() - task.startTime - pausedMs : (task.endTime ?? task.startTime) - task.startTime - pausedMs);
  let t1;
  if ($[0] !== elapsedMs) {
    t1 = formatDuration(elapsedMs);
    $[0] = elapsedMs;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const elapsed = t1;
  const tokenCount = task.progress?.tokenCount;
  const lastActivity = task.progress?.lastActivity;
  const arrow = lastActivity ? figures.arrowDown : figures.arrowUp;
  let t2;
  if ($[2] !== arrow || $[3] !== tokenCount) {
    t2 = tokenCount !== undefined && tokenCount > 0 ? ` · ${arrow} ${formatNumber(tokenCount)} tokens` : "";
    $[2] = arrow;
    $[3] = tokenCount;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const tokenText = t2;
  const queuedCount = task.pendingMessages.length;
  const queuedText = queuedCount > 0 ? ` · ${queuedCount} queued` : "";
  const displayDescription = task.progress?.summary || task.description;
  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + " " : "  ";
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const dim = !highlighted && !isViewed;
  const sep = isRunning ? PLAY_ICON : PAUSE_ICON;
  const namePart = name ? `${name}: ` : "";
  const hintPart = isSelected && !isViewed ? ` · x to ${isRunning ? "stop" : "clear"}` : "";
  const suffixPart = ` ${sep} ${elapsed}${tokenText}${queuedText}${hintPart}`;
  const availableForDesc = columns - stringWidth(prefix) - stringWidth(`${bullet} `) - stringWidth(namePart) - stringWidth(suffixPart);
  const t3 = Math.max(0, availableForDesc);
  let t4;
  if ($[5] !== displayDescription || $[6] !== t3) {
    t4 = wrapText(displayDescription, t3, "truncate-end");
    $[5] = displayDescription;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const truncated = t4;
  let t5;
  if ($[8] !== name) {
    t5 = name && <><Text dimColor={false} bold={true}>{name}</Text>{": "}</>;
    $[8] = name;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== queuedCount || $[11] !== queuedText) {
    t6 = queuedCount > 0 && <Text color="warning">{queuedText}</Text>;
    $[10] = queuedCount;
    $[11] = queuedText;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== hintPart) {
    t7 = hintPart && <Text dimColor={true}>{hintPart}</Text>;
    $[13] = hintPart;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== bullet || $[16] !== dim || $[17] !== elapsed || $[18] !== isViewed || $[19] !== prefix || $[20] !== sep || $[21] !== t5 || $[22] !== t6 || $[23] !== t7 || $[24] !== tokenText || $[25] !== truncated) {
    t8 = <Text dimColor={dim} bold={isViewed}>{prefix}{bullet}{" "}{t5}{truncated} {sep} {elapsed}{tokenText}{t6}{t7}</Text>;
    $[15] = bullet;
    $[16] = dim;
    $[17] = elapsed;
    $[18] = isViewed;
    $[19] = prefix;
    $[20] = sep;
    $[21] = t5;
    $[22] = t6;
    $[23] = t7;
    $[24] = tokenText;
    $[25] = truncated;
    $[26] = t8;
  } else {
    t8 = $[26];
  }
  const line = t8;
  if (!onClick) {
    return line;
  }
  let t10;
  let t9;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = () => setHover(true);
    t10 = () => setHover(false);
    $[27] = t10;
    $[28] = t9;
  } else {
    t10 = $[27];
    t9 = $[28];
  }
  let t11;
  if ($[29] !== line || $[30] !== onClick) {
    t11 = <Box onClick={onClick} onMouseEnter={t9} onMouseLeave={t10}>{line}</Box>;
    $[29] = line;
    $[30] = onClick;
    $[31] = t11;
  } else {
    t11 = $[31];
  }
  return t11;
}
