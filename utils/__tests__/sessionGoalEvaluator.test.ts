import { beforeEach, describe, expect, test } from 'bun:test'
import {
  addToTotalCostState,
  getSessionGoalState,
  resetStateForTests,
  resumeSessionGoalState,
  setSessionGoalState,
} from '../../bootstrap/state.js'
import { evaluateActiveSessionGoalAfterTurn } from '../sessionGoalEvaluator.js'

beforeEach(() => {
  resetStateForTests()
})

describe('evaluateActiveSessionGoalAfterTurn', () => {
  test('budget-limits before evaluator when the time budget is already exhausted', async () => {
    setSessionGoalState('stop before evaluator when time budget is exhausted', undefined, {
      maxDurationSec: 0,
    })

    const result = await evaluateActiveSessionGoalAfterTurn(
      [],
      new AbortController().signal,
    )

    expect(result.type).toBe('max_turns')
    expect(getSessionGoalState()?.status).toBe('budget_limited')
    if (result.type !== 'max_turns') throw new Error('expected max_turns action')
    expect(result.events.map(event => event.type)).toContain('goal_budget_limited')
    expect(result.reason).toContain('time budget')
  })

  test('budget-limits before evaluator when actual token usage reaches the budget', async () => {
    setSessionGoalState('stop before evaluator when token budget is exhausted', undefined, {
      tokenBudget: 10,
    })
    addToTotalCostState(
      0,
      {
        inputTokens: 7,
        outputTokens: 3,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      'test-model',
    )

    const result = await evaluateActiveSessionGoalAfterTurn(
      [],
      new AbortController().signal,
    )

    expect(result.type).toBe('max_turns')
    expect(getSessionGoalState()?.status).toBe('budget_limited')
    if (result.type !== 'max_turns') throw new Error('expected max_turns action')
    expect(result.events.map(event => event.type)).toContain('goal_budget_limited')
    expect(result.reason).toContain('token budget')
    expect(result.reason).toContain('actual tokens')
  })

  test('marks the goal failed after repeated evaluator errors', async () => {
    setSessionGoalState('fail after repeated evaluator errors')
    const signal = new AbortController().signal

    const first = await evaluateActiveSessionGoalAfterTurn([], signal)
    expect(first.type).toBe('error')
    expect(getSessionGoalState()?.status).toBe('paused')
    expect(getSessionGoalState()?.evaluationFailureCount).toBe(1)

    resumeSessionGoalState()
    const second = await evaluateActiveSessionGoalAfterTurn([], signal)
    expect(second.type).toBe('error')
    expect(getSessionGoalState()?.status).toBe('paused')
    expect(getSessionGoalState()?.evaluationFailureCount).toBe(2)

    resumeSessionGoalState()
    const third = await evaluateActiveSessionGoalAfterTurn([], signal)
    expect(third.type).toBe('error')
    expect(getSessionGoalState()?.status).toBe('failed')
    expect(getSessionGoalState()?.evaluationFailureCount).toBe(3)
    if (third.type !== 'error') throw new Error('expected error action')
    expect(third.events.map(event => event.type)).toContain('goal_failed')
  })
})
