import {
  getSessionGoalActualTokenUsage,
  getSessionGoalHistory,
  type MossenGoalState,
} from '../../bootstrap/state.js'
import { formatTokens } from '../../utils/format.js'
import { t } from '../../utils/i18n/index.js'
import {
  formatSessionGoalStateReason,
  getSessionGoalStateReasonKind,
} from '../../utils/sessionGoalOutput.js'
import { truncateToGraphemeCount } from '../../utils/truncate.js'

const MAX_STATUS_GOAL_GRAPHEMES = 280
const MAX_STATUS_HISTORY_LINES = 3

function formatElapsed(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return 'unknown'
  const seconds = Math.max(0, Math.floor((now - created) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function statusLabel(status: MossenGoalState['status']): string {
  switch (status) {
    case 'active':
      return t('cmd.goal.status.value.active')
    case 'cleared':
      return t('cmd.goal.status.value.cleared')
    case 'completed':
      return t('cmd.goal.status.value.completed')
    case 'paused':
      return t('cmd.goal.status.value.paused')
    case 'blocked':
      return t('cmd.goal.status.value.blocked')
    case 'budget_limited':
      return t('cmd.goal.status.value.budgetLimited')
    case 'failed':
      return t('cmd.goal.status.value.failed')
  }
}

function goalOutcomeLabel(goal: MossenGoalState): string {
  switch (getSessionGoalStateReasonKind(goal)) {
    case 'continue':
      return t('cmd.goal.explain.outcome.continue')
    case 'completed':
      return t('cmd.goal.explain.outcome.completed')
    case 'paused':
      return t('cmd.goal.explain.outcome.paused')
    case 'blocked':
      return t('cmd.goal.explain.outcome.blocked')
    case 'max_turns':
      return t('cmd.goal.explain.outcome.maxTurns')
    case 'error':
      return t('cmd.goal.explain.outcome.error')
    case 'cleared':
      return t('cmd.goal.explain.outcome.cleared')
    case 'pending':
      return t('cmd.goal.explain.outcome.pending')
    case 'deferred':
      return t('cmd.goal.explain.outcome.deferred')
  }
}

function formatGoalTokenUsage(goal: MossenGoalState): string {
  const actualTokens = getSessionGoalActualTokenUsage(goal)
  if (actualTokens !== null) return formatTokens(actualTokens)
  return goal.tokenEstimate
    ? `~${formatTokens(goal.tokenEstimate)}`
    : t('ui.goalOverlay.tokenPending')
}

export function getGoalTokenUsageValue(goal: MossenGoalState): number {
  return getSessionGoalActualTokenUsage(goal) ?? goal.tokenEstimate ?? 0
}

export function renderGoalExplanation(goal: MossenGoalState | null): string {
  if (!goal) {
    return [
      t('cmd.goal.explain.none'),
      t('cmd.goal.status.startHint'),
    ].join('\n')
  }

  return [
    t('cmd.goal.explain.title'),
    `${t('cmd.goal.status.status')}: ${statusLabel(goal.status)}`,
    `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
      goal.text,
      MAX_STATUS_GOAL_GRAPHEMES,
    )}`,
    goal.successCriteria
      ? `${t('cmd.goal.status.criteria')}: ${truncateToGraphemeCount(goal.successCriteria, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.constraints
      ? `${t('cmd.goal.status.constraints')}: ${truncateToGraphemeCount(goal.constraints, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.explain.outcome')}: ${goalOutcomeLabel(goal)}`,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}/${goal.turnBudget}`,
    `${t('cmd.goal.status.tokens')}: ${formatGoalTokenUsage(goal)}`,
    goal.lastTurnTokenEstimate !== undefined
      ? `${t('cmd.goal.status.lastTurnTokens')}: ~${formatTokens(goal.lastTurnTokenEstimate)}`
      : null,
    goal.lastEvaluatorTokenEstimate !== undefined
      ? `${t('cmd.goal.status.evaluatorTokens')}: ~${formatTokens(goal.lastEvaluatorTokenEstimate)}`
      : null,
    t('cmd.goal.explain.hint'),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function renderGoalHistoryTrailer(): string[] {
  const history = getSessionGoalHistory()
  if (history.length === 0) return []
  const recent = history.slice(-MAX_STATUS_HISTORY_LINES).reverse()
  const lines = recent.map(
    past =>
      `  • ${statusLabel(past.status)} (${past.turnCount}/${past.turnBudget}) — ${truncateToGraphemeCount(
        past.text,
        MAX_STATUS_GOAL_GRAPHEMES,
      )}`,
  )
  return ['', t('cmd.goal.status.historyTitle'), ...lines]
}

export function renderGoalHistory(): string {
  const history = renderGoalHistoryTrailer().filter(line => line.trim())
  return history.length > 0
    ? history.join('\n')
    : t('cmd.goal.status.historyEmpty')
}

export function renderGoalStatus(goal: MossenGoalState | null): string {
  if (
    !goal ||
    (goal.status !== 'active' &&
      goal.status !== 'paused' &&
      goal.status !== 'blocked' &&
      goal.status !== 'budget_limited')
  ) {
    const previous = goal
      ? [
          '',
          `${t('cmd.goal.status.previous')}: ${statusLabel(goal.status)}`,
          `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
            goal.text,
            MAX_STATUS_GOAL_GRAPHEMES,
          )}`,
        ]
      : []
    return [
      t('cmd.goal.status.none'),
      t('cmd.goal.status.scope'),
      t('cmd.goal.status.startHint'),
      ...previous,
      ...renderGoalHistoryTrailer(),
    ].join('\n')
  }

  const nextAction =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'budget_limited'
      ? t('cmd.goal.status.nextPaused')
      : t('cmd.goal.status.nextActive')

  return [
    t('cmd.goal.status.title'),
    `${t('cmd.goal.status.status')}: ${statusLabel(goal.status)}`,
    `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
      goal.text,
      MAX_STATUS_GOAL_GRAPHEMES,
    )}`,
    goal.successCriteria
      ? `${t('cmd.goal.status.criteria')}: ${truncateToGraphemeCount(goal.successCriteria, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.constraints
      ? `${t('cmd.goal.status.constraints')}: ${truncateToGraphemeCount(goal.constraints, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}`,
    `${t('cmd.goal.status.budget')}: ${goal.turnBudget}`,
    `${t('cmd.goal.status.elapsed')}: ${formatElapsed(goal.createdAt)}`,
    `${t('cmd.goal.status.tokens')}: ${formatGoalTokenUsage(goal)}`,
    goal.lastTurnTokenEstimate !== undefined
      ? `${t('cmd.goal.status.lastTurnTokens')}: ~${formatTokens(goal.lastTurnTokenEstimate)}`
      : null,
    goal.lastEvaluatorTokenEstimate !== undefined
      ? `${t('cmd.goal.status.evaluatorTokens')}: ~${formatTokens(goal.lastEvaluatorTokenEstimate)}`
      : null,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    goal.recentEvidence.length
      ? `${t('cmd.goal.status.evidence')}: ${truncateToGraphemeCount(goal.recentEvidence.join('; '), MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.negativeEvidence.length
      ? `${t('cmd.goal.status.negativeEvidence')}: ${truncateToGraphemeCount(goal.negativeEvidence.join('; '), MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.nextPlan
      ? `${t('cmd.goal.status.nextPlan')}: ${truncateToGraphemeCount(goal.nextPlan, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.status.next')}: ${nextAction}`,
    t('cmd.goal.status.overlayHint'),
    t('cmd.goal.status.scope'),
    ...renderGoalHistoryTrailer(),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
