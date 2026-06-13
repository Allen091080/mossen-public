import { describe, expect, test } from 'bun:test'
import {
  createSessionGoalEventMessage,
  getSessionGoalEventFromMessage,
  SessionGoalEventSchema,
} from '../sessionGoalEvents.js'

describe('SessionGoalEventSchema', () => {
  test('parses a valid budget-limited event from a message', () => {
    const message = createSessionGoalEventMessage({
      type: 'goal_budget_limited',
      goalId: 'goal_1',
      reason: 'turn budget reached',
      limitedAt: '2026-06-07T00:00:00.000Z',
      turnsUsed: 3,
      tokensUsed: 42,
    })

    expect(getSessionGoalEventFromMessage(message)).toEqual(message.goalEvent)
  })

  test('rejects an invalid eval verdict', () => {
    const parsed = SessionGoalEventSchema.safeParse({
      type: 'goal_eval',
      goalId: 'goal_1',
      verdict: 'maybe',
      reason: 'not sure',
      turnsUsed: 1,
      turnBudget: 20,
      tokensUsed: 10,
      evaluatedAt: '2026-06-07T00:00:00.000Z',
    })

    expect(parsed.success).toBe(false)
  })

  test('parses a valid failed event', () => {
    const parsed = SessionGoalEventSchema.safeParse({
      type: 'goal_failed',
      goalId: 'goal_1',
      reason: 'evaluator failed repeatedly',
      failedAt: '2026-06-07T00:00:00.000Z',
      turnsUsed: 3,
      tokensUsed: 42,
    })

    expect(parsed.success).toBe(true)
  })

  test('rejects budget-limited events without token usage', () => {
    const message = {
      type: 'system',
      subtype: 'informational',
      content: '',
      isMeta: true,
      timestamp: '2026-06-07T00:00:00.000Z',
      uuid: 'uuid',
      level: 'info',
      goalEvent: {
        type: 'goal_budget_limited',
        goalId: 'goal_1',
        reason: 'turn budget reached',
        limitedAt: '2026-06-07T00:00:00.000Z',
        turnsUsed: 3,
      },
    }

    expect(getSessionGoalEventFromMessage(message as never)).toBeNull()
  })
})
