import type { LocalJSXCommandContext } from '../../commands.js'
import {
  clearSessionGoalState,
  completeSessionGoalState,
  editSessionGoalState,
  getSessionGoalState,
  pauseSessionGoalState,
  resumeSessionGoalState,
  setSessionGoalState,
  updateSessionGoalBudgets,
} from '../../bootstrap/state.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { t } from '../../utils/i18n/index.js'
import {
  extractGoalContract,
  extractTurnBudget,
  parseSessionGoalAction,
} from '../../utils/sessionGoalCommand.js'
import {
  buildSessionGoalStartPrompt,
  getSessionGoalBackendConfigurationError,
} from '../../utils/sessionGoalEvaluator.js'
import { createSessionGoalEventMessage } from '../../utils/sessionGoalEvents.js'
import {
  GOAL_COMPLETED_METRIC,
  GOAL_CREATED_METRIC,
  GOAL_PAUSED_METRIC,
  observeSessionGoalMetric,
} from '../../utils/sessionGoalMetrics.js'
import { isSessionGoalUnavailableByHooksPolicy } from '../../utils/sessionGoalPolicy.js'
import { persistCurrentSessionGoalSnapshot } from '../../utils/sessionGoalStore.js'
import { truncateToGraphemeCount } from '../../utils/truncate.js'
import {
  getGoalTokenUsageValue,
  renderGoalExplanation,
  renderGoalHistory,
  renderGoalStatus,
} from './render.js'

const MAX_GOAL_GRAPHEMES = 2000

function parsePositiveIntFlag(text: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(\\d+)(?=\\s|$)`, 'i').exec(text)
  if (!match) return undefined
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.floor(parsed))
}

function hasNoneFlag(text: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)none(?=\\s|$)`, 'i').test(text)
}

function parseSessionGoalBudget(text: string): {
  ok: boolean
  value?: {
    turnBudget?: number
    tokenBudget?: number | null
    maxDurationSec?: number | null
  }
} {
  const turnBudget = parsePositiveIntFlag(text, 'turns')
  const tokenBudget = parsePositiveIntFlag(text, 'tokens')
  const maxDurationSec = parsePositiveIntFlag(text, 'seconds')
  if (
    turnBudget === undefined &&
    tokenBudget === undefined &&
    maxDurationSec === undefined &&
    !hasNoneFlag(text, 'tokens') &&
    !hasNoneFlag(text, 'seconds')
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    value: {
      ...(turnBudget !== undefined ? { turnBudget: Math.min(500, turnBudget) } : {}),
      ...(tokenBudget !== undefined
        ? { tokenBudget }
        : hasNoneFlag(text, 'tokens')
          ? { tokenBudget: null }
          : {}),
      ...(maxDurationSec !== undefined
        ? { maxDurationSec }
        : hasNoneFlag(text, 'seconds')
          ? { maxDurationSec: null }
          : {}),
    },
  }
}

function parseGoalEditOptionalField(value?: string): string | null | undefined {
  if (value === undefined) return undefined
  return /^(?:none|clear|unset|-)$/i.test(value.trim()) ? null : value
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
    onDone(renderGoalStatus(getSessionGoalState()))
    return null
  }

  if (action === 'explain') {
    onDone(renderGoalExplanation(getSessionGoalState()))
    return null
  }

  if (action === 'clear') {
    const cleared = clearSessionGoalState()
    if (cleared) persistCurrentSessionGoalSnapshot()
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
                tokensUsed: getGoalTokenUsageValue(cleared),
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  if (action === 'done') {
    const completed = completeSessionGoalState('user_marked_done')
    if (completed) persistCurrentSessionGoalSnapshot()
    if (completed) observeSessionGoalMetric(GOAL_COMPLETED_METRIC)
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
                tokensUsed: getGoalTokenUsageValue(completed),
              }),
            ],
          }
        : undefined,
    )
    return null
  }

  if (action === 'pause') {
    const paused = pauseSessionGoalState('user_pause')
    if (paused) persistCurrentSessionGoalSnapshot()
    if (paused) observeSessionGoalMetric(GOAL_PAUSED_METRIC)
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
    if (resumed) persistCurrentSessionGoalSnapshot()
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

  if (action === 'history') {
    onDone(renderGoalHistory())
    return null
  }

  if (action === 'edit') {
    const { text: budgetText, turnBudget } = extractTurnBudget(body.trim())
    const {
      text: rawGoal,
      successCriteria,
      constraints,
    } = extractGoalContract(budgetText)
    const editedSuccessCriteria = parseGoalEditOptionalField(successCriteria)
    const editedConstraints = parseGoalEditOptionalField(constraints)
    const edited = editSessionGoalState({
      ...(rawGoal ? { text: truncateToGraphemeCount(rawGoal, MAX_GOAL_GRAPHEMES) } : {}),
      ...(editedSuccessCriteria !== undefined ? { successCriteria: editedSuccessCriteria } : {}),
      ...(editedConstraints !== undefined ? { constraints: editedConstraints } : {}),
    })
    const updated =
      edited && turnBudget !== undefined
        ? updateSessionGoalBudgets({ turnBudget, resumeIfBudgetLimited: true })
        : edited
    if (updated) persistCurrentSessionGoalSnapshot()
    onDone(
      updated
        ? [t('cmd.goal.edit.ok'), '', renderGoalStatus(updated)].join('\n')
        : t('cmd.goal.edit.none'),
    )
    return null
  }

  if (action === 'budget') {
    const parsed = parseSessionGoalBudget(body)
    if (!parsed.ok || !parsed.value) {
      onDone(t('cmd.goal.budget.usage'))
      return null
    }
    const updated = updateSessionGoalBudgets({
      ...parsed.value,
      resumeIfBudgetLimited: true,
    })
    if (updated) persistCurrentSessionGoalSnapshot()
    onDone(
      updated
        ? [t('cmd.goal.budget.ok'), '', renderGoalStatus(updated)].join('\n')
        : t('cmd.goal.budget.none'),
    )
    return null
  }

  // Pull an optional `--turns N` budget out of the goal text before validating.
  const { text: budgetText, turnBudget } = extractTurnBudget(body.trim())
  const {
    text: rawGoal,
    successCriteria,
    constraints,
  } = extractGoalContract(budgetText)
  if (!rawGoal) {
    onDone(t('cmd.goal.set.empty'))
    return null
  }

  const goalText = truncateToGraphemeCount(rawGoal, MAX_GOAL_GRAPHEMES)
  const truncated = goalText !== rawGoal
  const previousGoal = getSessionGoalState()
  const replacementEvent =
    previousGoal &&
    (previousGoal.status === 'active' ||
      previousGoal.status === 'paused' ||
      previousGoal.status === 'blocked' ||
      previousGoal.status === 'budget_limited')
      ? createSessionGoalEventMessage({
          type: 'goal_cleared',
          goalId: previousGoal.id,
          reason: 'replaced',
          clearedAt: new Date().toISOString(),
          turnsUsed: previousGoal.turnCount,
          tokensUsed: getGoalTokenUsageValue(previousGoal),
        })
      : null
  const goal = setSessionGoalState(
    goalText,
    successCriteria,
    {
      ...(turnBudget !== undefined ? { turnBudget } : {}),
      ...(constraints ? { constraints } : {}),
    },
  )
  const backendConfigurationError = getSessionGoalBackendConfigurationError()
  const backendPauseReason = backendConfigurationError
    ? `${t('cmd.goal.set.pausedBackendUnavailable')} (${backendConfigurationError})`
    : null
  const statusGoal = backendPauseReason
    ? pauseSessionGoalState(backendPauseReason) ?? goal
    : goal
  persistCurrentSessionGoalSnapshot()
  observeSessionGoalMetric(GOAL_CREATED_METRIC)
  if (backendPauseReason && statusGoal.status === 'paused') {
    observeSessionGoalMetric(GOAL_PAUSED_METRIC)
  }
  onDone(
    [
      t('cmd.goal.set.ok'),
      truncated
        ? t('cmd.goal.set.truncated', { max: MAX_GOAL_GRAPHEMES })
        : null,
      backendPauseReason ? t('cmd.goal.set.pausedBackendUnavailable') : null,
      '',
      renderGoalStatus(statusGoal),
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    {
      display: 'system',
      shouldQuery: !backendPauseReason,
      systemMessages: [
        ...(replacementEvent ? [replacementEvent] : []),
        createSessionGoalEventMessage({
          type: 'goal_created',
          goalId: goal.id,
          condition: goal.text,
          successCriteria: goal.successCriteria,
          constraints: goal.constraints,
          createdAt: goal.createdAt,
          evaluatorModel: goal.evaluatorModel,
          turnBudget: goal.turnBudget,
          tokenBudget: goal.tokenBudget,
          maxDurationSec: goal.maxDurationSec,
        }),
        ...(backendPauseReason && statusGoal.status === 'paused'
          ? [
              createSessionGoalEventMessage({
                type: 'goal_paused',
                goalId: statusGoal.id,
                cause: backendPauseReason,
                pausedAt: statusGoal.updatedAt,
              }),
            ]
          : []),
      ],
      metaMessages: backendPauseReason ? [] : [buildSessionGoalStartPrompt(goal)],
    },
  )
  return null
}
