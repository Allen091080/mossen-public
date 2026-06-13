import {
  getSessionGoalActualTokenUsage,
  type MossenGoalState,
} from '../bootstrap/state.js';
import type React from 'react';
import { Box, Text } from '../ink.js';
import { formatTokens } from '../utils/format.js';
import { t } from '../utils/i18n/index.js';
import { formatSessionGoalStateReason } from '../utils/sessionGoalOutput.js';
import { truncateToGraphemeCount } from '../utils/truncate.js';
import { truncateVisual } from '../utils/visualWidth.js';

export const GOAL_OVERLAY_MIN_COLUMNS = 90;
export const GOAL_OVERLAY_WIDTH = 42;
// Below the full overlay's column threshold but still wide enough for a
// one-line status, show a compact inline summary instead of nothing (G3).
export const GOAL_INLINE_MIN_COLUMNS = 40;

const MAX_GOAL_TEXT_GRAPHEMES = 96;
const GOAL_INLINE_TEXT_GRAPHEMES = 32;

export type GoalOverlayDisplayState = Extract<
  MossenGoalState['status'],
  'active' | 'paused' | 'blocked' | 'budget_limited' | 'completed' | 'failed'
>;

export function isGoalOverlayEligible(
  goal: MossenGoalState | null,
): goal is MossenGoalState & { status: GoalOverlayDisplayState } {
  return (
    goal?.status === 'active' ||
    goal?.status === 'paused' ||
    goal?.status === 'blocked' ||
    goal?.status === 'budget_limited' ||
    goal?.status === 'completed' ||
    goal?.status === 'failed'
  );
}

export function shouldShowGoalOverlay(
  goal: MossenGoalState | null,
  columns: number,
  visible: boolean,
): boolean {
  return visible && columns >= GOAL_OVERLAY_MIN_COLUMNS && isGoalOverlayEligible(goal);
}

export function formatGoalOverlayElapsed(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return t('ui.goalOverlay.elapsedUnknown');
  const seconds = Math.max(0, Math.floor((now - created) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}:${String(restMinutes).padStart(2, '0')}`;
}

export function formatGoalOverlayTokens(goal: MossenGoalState): string {
  const actualTokens = getSessionGoalActualTokenUsage(goal);
  const total = actualTokens ?? goal.tokenEstimate ?? 0;
  if (total <= 0) {
    return actualTokens === null
      ? t('ui.goalOverlay.tokenPending')
      : formatTokens(total);
  }
  const parts = [
    actualTokens === null ? `~${formatTokens(total)}` : formatTokens(total),
  ];
  if (goal.lastTurnTokenEstimate !== undefined) {
    parts.push(`+${formatTokens(goal.lastTurnTokenEstimate)}`);
  }
  return parts.join(' ');
}

export function formatGoalOverlayStatus(
  goal: MossenGoalState & { status: GoalOverlayDisplayState },
): string {
  if (goal.status === 'paused') return t('ui.goalOverlay.statusPaused');
  if (goal.status === 'blocked') return t('ui.goalOverlay.statusBlocked');
  if (goal.status === 'budget_limited') return t('ui.goalOverlay.statusBudgetLimited');
  if (goal.status === 'completed') return t('ui.goalOverlay.statusCompleted');
  if (goal.status === 'failed') return t('ui.goalOverlay.statusFailed');
  return t('ui.goalOverlay.statusActive');
}

export function formatGoalOverlayNextAction(
  goal: MossenGoalState & { status: GoalOverlayDisplayState },
): string {
  if (goal.status === 'paused') return t('ui.goalOverlay.nextPaused');
  if (goal.status === 'blocked') return t('ui.goalOverlay.nextBlocked');
  if (goal.status === 'budget_limited') return t('ui.goalOverlay.nextBudgetLimited');
  if (goal.status === 'completed') return t('ui.goalOverlay.nextCompleted');
  if (goal.status === 'failed') return t('ui.goalOverlay.nextFailed');
  return t('ui.goalOverlay.nextActive');
}

export function formatGoalOverlayReason(goal: MossenGoalState): string {
  return truncateVisual(formatSessionGoalStateReason(goal), 48);
}

export type GoalOverlayRow = {
  label: string;
  value: string;
};

export function buildGoalOverlayRows(
  goal: MossenGoalState & { status: GoalOverlayDisplayState },
  now = Date.now(),
): GoalOverlayRow[] {
  return [
    {
      label: t('ui.goalOverlay.scope'),
      value: t('ui.goalOverlay.scopeValue'),
    },
    {
      label: t('cmd.goal.status.status'),
      value: formatGoalOverlayStatus(goal),
    },
    {
      label: t('ui.goalOverlay.next'),
      value: formatGoalOverlayNextAction(goal),
    },
    {
      label: t('cmd.goal.status.turns'),
      value: `${goal.turnCount}/${goal.turnBudget}`,
    },
    {
      label: t('cmd.goal.status.elapsed'),
      value: formatGoalOverlayElapsed(goal.createdAt, now),
    },
    {
      label: t('cmd.goal.status.tokens'),
      value: formatGoalOverlayTokens(goal),
    },
    {
      label: t('cmd.goal.status.reason'),
      value: formatGoalOverlayReason(goal),
    },
  ];
}

/**
 * True when the terminal is too narrow for the full overlay but wide enough for
 * the compact inline line.
 */
export function shouldShowGoalInline(
  goal: MossenGoalState | null,
  columns: number,
  visible: boolean,
): boolean {
  return (
    visible &&
    columns < GOAL_OVERLAY_MIN_COLUMNS &&
    columns >= GOAL_INLINE_MIN_COLUMNS &&
    isGoalOverlayEligible(goal)
  );
}

/**
 * One-line goal status for narrow terminals, e.g.
 * `GOAL active · 3/20 · ~1.2k · fix the parser`.
 */
export function formatGoalOverlayInline(
  goal: MossenGoalState & { status: GoalOverlayDisplayState },
): string {
  const actualTokens = getSessionGoalActualTokenUsage(goal);
  const totalTokens = actualTokens ?? goal.tokenEstimate ?? 0;
  const parts = [
    `${t('ui.goalOverlay.title')} ${formatGoalOverlayStatus(goal)}`,
    `${goal.turnCount}/${goal.turnBudget}`,
  ];
  if (totalTokens > 0) {
    parts.push(
      actualTokens === null
        ? `~${formatTokens(totalTokens)}`
        : formatTokens(totalTokens),
    );
  }
  parts.push(truncateToGraphemeCount(goal.text, GOAL_INLINE_TEXT_GRAPHEMES));
  return parts.join(' · ');
}

export function GoalOverlayInline({
  goal,
}: {
  goal: MossenGoalState & { status: GoalOverlayDisplayState };
}): React.ReactNode {
  const borderColor = goal.status === 'paused' || goal.status === 'blocked'
    ? 'warning'
    : goal.status === 'failed'
      ? 'error'
      : 'success';
  return (
    <Box>
      <Text color={borderColor} wrap="truncate-end">
        {formatGoalOverlayInline(goal)}
      </Text>
    </Box>
  );
}

export function GoalOverlay({
  goal,
  now,
}: {
  goal: MossenGoalState & { status: GoalOverlayDisplayState };
  now: number;
}): React.ReactNode {
  const rows = buildGoalOverlayRows(goal, now);
  const borderColor = goal.status === 'paused' || goal.status === 'blocked'
    ? 'warning'
    : goal.status === 'failed'
      ? 'error'
      : 'success';
  const goalText = truncateVisual(
    truncateToGraphemeCount(goal.text, MAX_GOAL_TEXT_GRAPHEMES),
    GOAL_OVERLAY_WIDTH - 10,
  );
  const fullGoalText = truncateToGraphemeCount(goal.text, MAX_GOAL_TEXT_GRAPHEMES);
  const isGoalCollapsed = goalText !== fullGoalText;

  return (
    <Box
      borderColor={borderColor}
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      width={GOAL_OVERLAY_WIDTH}
    >
      <Box justifyContent="space-between" width="100%">
        <Text bold color={borderColor}>{t('ui.goalOverlay.title')}</Text>
        <Text dimColor>{t('ui.goalOverlay.hideHint')}</Text>
      </Box>
      <Text dimColor>{t('ui.goalOverlay.subtitle')}</Text>
      <Text wrap="truncate">{goalText}</Text>
      {isGoalCollapsed ? <Text dimColor>{t('ui.goalOverlay.goalCollapsedHint')}</Text> : null}
      {rows.map(row => (
        <Box key={row.label} justifyContent="space-between" width="100%">
          <Text dimColor>{row.label}</Text>
          <Text wrap="truncate-end">{truncateVisual(row.value, 18)}</Text>
        </Box>
      ))}
    </Box>
  );
}
