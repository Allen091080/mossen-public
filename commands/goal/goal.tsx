import type { LocalJSXCommandContext } from '../../commands.js'
import {
  clearSessionGoalState,
  completeSessionGoalState,
  getSessionGoalHistory,
  getSessionGoalState,
  pauseSessionGoalState,
  resumeSessionGoalState,
  setSessionGoalState,
  type MossenGoalState,
} from '../../bootstrap/state.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { t } from '../../utils/i18n/index.js'
import {
  extractTurnBudget,
  parseSessionGoalAction,
} from '../../utils/sessionGoalCommand.js'
import { buildSessionGoalStartPrompt } from '../../utils/sessionGoalEvaluator.js'
import { createSessionGoalEventMessage } from '../../utils/sessionGoalEvents.js'
import {
  formatSessionGoalStateReason,
  getSessionGoalStateReasonKind,
} from '../../utils/sessionGoalOutput.js'
import { isSessionGoalUnavailableByHooksPolicy } from '../../utils/sessionGoalPolicy.js'
import { formatTokens } from '../../utils/format.js'
import { truncateToGraphemeCount } from '../../utils/truncate.js'

const MAX_GOAL_GRAPHEMES = 2000
const MAX_STATUS_GOAL_GRAPHEMES = 280

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

function renderExplanation(goal: MossenGoalState | null): string {
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
    `${t('cmd.goal.explain.outcome')}: ${goalOutcomeLabel(goal)}`,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}/${goal.turnBudget}`,
    `${t('cmd.goal.status.tokens')}: ${
      goal.tokenEstimate ? `~${formatTokens(goal.tokenEstimate)}` : t('ui.goalOverlay.tokenPending')
    }`,
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

// G4: a short "previously this session" trail of terminal goals, shown under
// /goal status. Most-recent first, capped to a few lines.
const MAX_STATUS_HISTORY_LINES = 3

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

function renderStatus(goal: MossenGoalState | null): string {
  if (!goal || (goal.status !== 'active' && goal.status !== 'paused' && goal.status !== 'blocked')) {
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
    goal.status === 'paused' || goal.status === 'blocked'
      ? t('cmd.goal.status.nextPaused')
      : t('cmd.goal.status.nextActive')

  return [
    t('cmd.goal.status.title'),
    `${t('cmd.goal.status.status')}: ${statusLabel(goal.status)}`,
    `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
      goal.text,
      MAX_STATUS_GOAL_GRAPHEMES,
    )}`,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}`,
    `${t('cmd.goal.status.budget')}: ${goal.turnBudget}`,
    `${t('cmd.goal.status.elapsed')}: ${formatElapsed(goal.createdAt)}`,
    `${t('cmd.goal.status.tokens')}: ${
      goal.tokenEstimate ? `~${formatTokens(goal.tokenEstimate)}` : t('ui.goalOverlay.tokenPending')
    }`,
    goal.lastTurnTokenEstimate !== undefined
      ? `${t('cmd.goal.status.lastTurnTokens')}: ~${formatTokens(goal.lastTurnTokenEstimate)}`
      : null,
    goal.lastEvaluatorTokenEstimate !== undefined
      ? `${t('cmd.goal.status.evaluatorTokens')}: ~${formatTokens(goal.lastEvaluatorTokenEstimate)}`
      : null,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    `${t('cmd.goal.status.next')}: ${nextAction}`,
    t('cmd.goal.status.overlayHint'),
    t('cmd.goal.status.scope'),
    ...renderGoalHistoryTrailer(),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<null> {
  if (isSessionGoalUnavailableByHooksPolicy()) {
    onDone(t('cmd.goal.unavailable.hooksDisabled'))
    return null
  }

  const { action, body } = parseSessionGoalAction(args)

  if (action === 'status') {
    onDone(renderStatus(getSessionGoalState()))
    return null
  }

  if (action === 'explain') {
    onDone(renderExplanation(getSessionGoalState()))
    return null
  }

  if (action === 'clear') {
    const cleared = clearSessionGoalState()
    onDone(
      cleared ? t('cmd.goal.clear.ok') : t('cmd.goal.clear.none'),
      cleared
        ? {
            display: 'system',
            systemMessages: [
              createSessionGoalEventMessage({
                type: 'goal_cleared',
                goalId: cleared.id,
                reason: cleared.clearReason ?? 'user_cancel',
                clearedAt: cleared.updatedAt,
                turnsUsed: cleared.turnCount,
                tokensUsed: cleared.tokenEstimate ?? 0,
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  if (action === 'done') {
    const completed = completeSessionGoalState()
    onDone(
      completed ? t('cmd.goal.done.ok') : t('cmd.goal.done.none'),
      completed
        ? {
            display: 'system',
            systemMessages: [
              createSessionGoalEventMessage({
                type: 'goal_cleared',
                goalId: completed.id,
                reason: 'condition_met',
                clearedAt: completed.updatedAt,
                turnsUsed: completed.turnCount,
                tokensUsed: completed.tokenEstimate ?? 0,
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  if (action === 'pause') {
    const paused = pauseSessionGoalState('user_pause')
    onDone(
      paused ? t('cmd.goal.pause.ok') : t('cmd.goal.pause.none'),
      paused
        ? {
            display: 'system',
            systemMessages: [
              createSessionGoalEventMessage({
                type: 'goal_paused',
                goalId: paused.id,
                cause: paused.lastEvaluatorReason ?? 'user_pause',
                pausedAt: paused.updatedAt,
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  if (action === 'resume') {
    const resumed = resumeSessionGoalState()
    onDone(
      resumed ? t('cmd.goal.resume.ok') : t('cmd.goal.resume.none'),
      resumed
        ? {
            display: 'system',
            shouldQuery: true,
            metaMessages: [buildSessionGoalStartPrompt(resumed)],
            systemMessages: [
              createSessionGoalEventMessage({
                type: 'goal_resumed',
                goalId: resumed.id,
                resumedAt: resumed.updatedAt,
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  // Pull an optional `--turns N` budget out of the goal text before validating.
  const { text: rawGoal, turnBudget } = extractTurnBudget(body.trim())
  if (!rawGoal) {
    onDone(t('cmd.goal.set.empty'))
    return null
  }

  const goalText = truncateToGraphemeCount(rawGoal, MAX_GOAL_GRAPHEMES)
  const truncated = goalText !== rawGoal
  const previousGoal = getSessionGoalState()
  const replacementEvent =
    previousGoal &&
    (previousGoal.status === 'active' || previousGoal.status === 'paused' || previousGoal.status === 'blocked')
      ? createSessionGoalEventMessage({
          type: 'goal_cleared',
          goalId: previousGoal.id,
          reason: 'replaced',
          clearedAt: new Date().toISOString(),
          turnsUsed: previousGoal.turnCount,
          tokensUsed: previousGoal.tokenEstimate ?? 0,
        })
      : null
  const goal = setSessionGoalState(
    goalText,
    undefined,
    turnBudget !== undefined ? { turnBudget } : undefined,
  )
  onDone(
    [
      t('cmd.goal.set.ok'),
      truncated
        ? t('cmd.goal.set.truncated', { max: MAX_GOAL_GRAPHEMES })
        : null,
      '',
      renderStatus(goal),
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    {
      display: 'system',
      shouldQuery: true,
      systemMessages: [
        ...(replacementEvent ? [replacementEvent] : []),
        createSessionGoalEventMessage({
          type: 'goal_created',
          goalId: goal.id,
          condition: goal.text,
          createdAt: goal.createdAt,
          evaluatorModel: goal.evaluatorModel,
          turnBudget: goal.turnBudget,
          tokenBudget: goal.tokenBudget,
          maxDurationSec: goal.maxDurationSec,
        }),
      ],
      metaMessages: [buildSessionGoalStartPrompt(goal)],
    },
  )
  return null
}
