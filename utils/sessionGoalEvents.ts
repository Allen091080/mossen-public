import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import type { Message } from '../types/message.js'

const SessionGoalCreatedEventSchema = z.object({
  type: z.literal('goal_created'),
  goalId: z.string(),
  condition: z.string(),
  successCriteria: z.string().optional(),
  constraints: z.string().optional(),
  createdAt: z.string(),
  evaluatorModel: z.string(),
  turnBudget: z.number(),
  tokenBudget: z.number().nullable().optional(),
  maxDurationSec: z.number().nullable().optional(),
})

const SessionGoalEvalEventSchema = z.object({
  type: z.literal('goal_eval'),
  goalId: z.string(),
  verdict: z.enum([
    'yes',
    'no',
    'error',
    'max_turns',
    'deferred',
    'launch_workflow',
    'wait_for_workflow',
  ]),
  reason: z.string(),
  turnsUsed: z.number(),
  turnBudget: z.number(),
  tokensUsed: z.number(),
  evaluatedAt: z.string(),
})

const SessionGoalClearedEventSchema = z.object({
  type: z.literal('goal_cleared'),
  goalId: z.string(),
  reason: z.string(),
  clearedAt: z.string(),
  turnsUsed: z.number(),
  tokensUsed: z.number(),
})

const SessionGoalPausedEventSchema = z.object({
  type: z.literal('goal_paused'),
  goalId: z.string(),
  cause: z.string(),
  pausedAt: z.string(),
})

const SessionGoalBlockedEventSchema = z.object({
  type: z.literal('goal_blocked'),
  goalId: z.string(),
  reason: z.string(),
  blockedAt: z.string(),
})

const SessionGoalFailedEventSchema = z.object({
  type: z.literal('goal_failed'),
  goalId: z.string(),
  reason: z.string(),
  failedAt: z.string(),
  turnsUsed: z.number(),
  tokensUsed: z.number(),
})

const SessionGoalBudgetLimitedEventSchema = z.object({
  type: z.literal('goal_budget_limited'),
  goalId: z.string(),
  reason: z.string(),
  limitedAt: z.string(),
  turnsUsed: z.number(),
  tokensUsed: z.number(),
})

const SessionGoalResumedEventSchema = z.object({
  type: z.literal('goal_resumed'),
  goalId: z.string(),
  resumedAt: z.string(),
})

export const SessionGoalEventSchema = z.discriminatedUnion('type', [
  SessionGoalCreatedEventSchema,
  SessionGoalEvalEventSchema,
  SessionGoalClearedEventSchema,
  SessionGoalPausedEventSchema,
  SessionGoalBlockedEventSchema,
  SessionGoalFailedEventSchema,
  SessionGoalBudgetLimitedEventSchema,
  SessionGoalResumedEventSchema,
])

export type SessionGoalEvent = z.infer<typeof SessionGoalEventSchema>

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
  const parsed = SessionGoalEventSchema.safeParse(event)
  return parsed.success ? parsed.data : null
}
