import { randomUUID } from 'crypto'
import type { MossenGoalState } from '../bootstrap/state.js'
import type { SessionGoalEvent } from './sessionGoalEvents.js'
import type { SessionGoalPostTurnAction } from './sessionGoalEvaluator.js'
import { t } from './i18n/index.js'

export type SDKGoalEventMessage = {
  type: 'goal_event'
  event: SessionGoalEvent
  summary: string
  uuid: `${string}-${string}-${string}-${string}-${string}`
  session_id: string
}

export type SessionGoalReasonKind =
  | 'pending'
  | 'deferred'
  | 'continue'
  | 'completed'
  | 'paused'
  | 'max_turns'
  | 'error'
  | 'cleared'

function reasonOrPending(reason?: string): string {
  const trimmed = reason?.trim()
  return trimmed || t('ui.goalOverlay.reasonPending')
}

export function formatSessionGoalReason(
  kind: SessionGoalReasonKind,
  reason?: string,
): string {
  const detail = reasonOrPending(reason)
  switch (kind) {
    case 'continue':
      return t('cmd.goal.reason.continue', { reason: detail })
    case 'deferred':
      return t('cmd.goal.reason.deferred', { reason: detail })
    case 'completed':
      return t('cmd.goal.reason.completed', { reason: detail })
    case 'paused':
      return t('cmd.goal.reason.paused', { reason: detail })
    case 'max_turns':
      return t('cmd.goal.reason.maxTurns', { reason: detail })
    case 'error':
      return t('cmd.goal.reason.error', { reason: detail })
    case 'cleared':
      return t('cmd.goal.reason.cleared', { reason: detail })
    case 'pending':
      return t('cmd.goal.reason.pending')
  }
}

export function getSessionGoalStateReasonKind(
  goal: MossenGoalState,
): SessionGoalReasonKind {
  if (goal.status === 'paused') {
    return goal.lastEvaluatorStatus === 'error' ? 'error' : 'paused'
  }
  if (goal.status === 'completed' || goal.lastEvaluatorStatus === 'met') {
    return 'completed'
  }
  if (goal.lastEvaluatorStatus === 'not_met') return 'continue'
  if (goal.lastEvaluatorStatus === 'deferred') return 'deferred'
  if (goal.lastEvaluatorStatus === 'max_turns') return 'max_turns'
  if (goal.status === 'failed' || goal.lastEvaluatorStatus === 'error') {
    return 'error'
  }
  if (goal.status === 'cleared') return 'cleared'
  return 'pending'
}

export function formatSessionGoalStateReason(goal: MossenGoalState): string {
  return formatSessionGoalReason(
    getSessionGoalStateReasonKind(goal),
    goal.lastEvaluatorReason ?? goal.clearReason,
  )
}

export function getSessionGoalEventReasonKind(
  event: SessionGoalEvent,
): SessionGoalReasonKind {
  switch (event.type) {
    case 'goal_eval':
      if (event.verdict === 'yes') return 'completed'
      if (event.verdict === 'no') return 'continue'
      if (event.verdict === 'max_turns') return 'max_turns'
      return 'error'
    case 'goal_paused':
      return 'paused'
    case 'goal_cleared':
      if (event.reason === 'condition_met') return 'completed'
      if (event.reason === 'turn_budget_exhausted') return 'max_turns'
      return 'cleared'
    case 'goal_created':
    case 'goal_resumed':
      return 'pending'
  }
}

export function formatSessionGoalEventReason(
  event: SessionGoalEvent,
): string {
  switch (event.type) {
    case 'goal_eval':
      return formatSessionGoalReason(
        getSessionGoalEventReasonKind(event),
        event.reason,
      )
    case 'goal_paused':
      return formatSessionGoalReason('paused', event.cause)
    case 'goal_cleared':
      return formatSessionGoalReason(
        getSessionGoalEventReasonKind(event),
        event.reason,
      )
    case 'goal_created':
    case 'goal_resumed':
      return formatSessionGoalReason('pending')
  }
}

export function formatSessionGoalActionReason(
  action: Exclude<SessionGoalPostTurnAction, { type: 'none' }>,
): string {
  switch (action.type) {
    case 'continue':
      return formatSessionGoalReason('continue', action.reason)
    case 'completed':
      return formatSessionGoalReason('completed', action.reason)
    case 'paused':
      return formatSessionGoalReason('paused', action.reason)
    case 'max_turns':
      return formatSessionGoalReason('max_turns', action.reason)
    case 'error':
      return formatSessionGoalReason('error', action.reason)
  }
}

export function summarizeSessionGoalEvent(event: SessionGoalEvent): string {
  switch (event.type) {
    case 'goal_created':
      return `goal created: ${event.condition}`
    case 'goal_eval':
      return `goal ${event.verdict}: turn ${event.turnsUsed}/${event.turnBudget}, estimated tokens ${event.tokensUsed}; ${formatSessionGoalEventReason(event)}`
    case 'goal_cleared':
      return `goal cleared: ${formatSessionGoalEventReason(event)}; turns ${event.turnsUsed}, estimated tokens ${event.tokensUsed}`
    case 'goal_paused':
      return `goal paused: ${formatSessionGoalEventReason(event)}`
    case 'goal_resumed':
      return 'goal resumed'
  }
}

export function createSDKGoalEventMessage(
  event: SessionGoalEvent,
  sessionId: string,
): SDKGoalEventMessage {
  return {
    type: 'goal_event',
    event,
    summary: summarizeSessionGoalEvent(event),
    uuid: randomUUID(),
    session_id: sessionId,
  }
}

export function formatSessionGoalEventForStderr(event: SessionGoalEvent): string {
  if (event.type !== 'goal_eval') return `[goal] ${summarizeSessionGoalEvent(event)}`
  return `[goal] turn ${event.turnsUsed}/${event.turnBudget} · estimated tokens ${event.tokensUsed} · eval=${event.verdict}: ${formatSessionGoalEventReason(event)}`
}
