import { randomUUID } from 'crypto'
import type { Message } from '../types/message.js'

export type SessionGoalEvent =
  | {
      type: 'goal_created'
      goalId: string
      condition: string
      createdAt: string
      evaluatorModel: string
      turnBudget: number
      tokenBudget?: number | null
      maxDurationSec?: number | null
    }
  | {
      type: 'goal_eval'
      goalId: string
      verdict: 'yes' | 'no' | 'error' | 'max_turns'
      reason: string
      turnsUsed: number
      turnBudget: number
      tokensUsed: number
      evaluatedAt: string
    }
  | {
      type: 'goal_cleared'
      goalId: string
      reason: string
      clearedAt: string
      turnsUsed: number
      tokensUsed: number
    }
  | {
      type: 'goal_paused'
      goalId: string
      cause: string
      pausedAt: string
    }
  | {
      type: 'goal_blocked'
      goalId: string
      reason: string
      blockedAt: string
    }
  | {
      type: 'goal_resumed'
      goalId: string
      resumedAt: string
    }

export type SessionGoalEventMessage = Message & {
  goalEvent: SessionGoalEvent
}

export function createSessionGoalEventMessage(
  goalEvent: SessionGoalEvent,
): SessionGoalEventMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content: '',
    isMeta: true,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    goalEvent,
  }
}

export function getSessionGoalEventFromMessage(
  message: Message,
): SessionGoalEvent | null {
  const event = (message as { goalEvent?: unknown }).goalEvent
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null
  }
  const record = event as Record<string, unknown>
  if (typeof record.type !== 'string') return null
  if (typeof record.goalId !== 'string') return null
  switch (record.type) {
    case 'goal_created':
      return typeof record.condition === 'string' &&
        typeof record.createdAt === 'string' &&
        typeof record.evaluatorModel === 'string' &&
        typeof record.turnBudget === 'number'
        ? (event as SessionGoalEvent)
        : null
    case 'goal_eval':
      return typeof record.reason === 'string' &&
        typeof record.turnsUsed === 'number' &&
        typeof record.turnBudget === 'number' &&
        typeof record.tokensUsed === 'number' &&
        typeof record.evaluatedAt === 'string'
        ? (event as SessionGoalEvent)
        : null
    case 'goal_cleared':
      return typeof record.reason === 'string' &&
        typeof record.clearedAt === 'string'
        ? (event as SessionGoalEvent)
        : null
    case 'goal_paused':
      return typeof record.cause === 'string' &&
        typeof record.pausedAt === 'string'
        ? (event as SessionGoalEvent)
        : null
    case 'goal_blocked':
      return typeof record.reason === 'string' &&
        typeof record.blockedAt === 'string'
        ? (event as SessionGoalEvent)
        : null
    case 'goal_resumed':
      return typeof record.resumedAt === 'string'
        ? (event as SessionGoalEvent)
        : null
    default:
      return null
  }
}
