import { beforeEach, describe, expect, test } from 'bun:test'
import {
  addToTotalCostState,
  blockSessionGoalState,
  clearSessionGoalState,
  completeSessionGoalState,
  budgetLimitSessionGoalState,
  editSessionGoalState,
  estimateSessionGoalTokens,
  failSessionGoalState,
  getSessionGoalActualTokenUsage,
  getSessionGoalHistory,
  getSessionGoalState,
  incrementSessionGoalTurnCount,
  recordSessionGoalBlockerAttempt,
  recordSessionGoalNegativeEvidence,
  resetStateForTests,
  resumeSessionGoalState,
  setSessionGoalState,
  updateSessionGoalBudgets,
} from '../state.js'

beforeEach(() => {
  resetStateForTests()
})

describe('estimateSessionGoalTokens (G5)', () => {
  test('empty string floors at 1', () => {
    expect(estimateSessionGoalTokens('')).toBe(1)
  })

  test('latin text counts ~4 chars/token', () => {
    // 8 ASCII chars → ceil(8/4) = 2
    expect(estimateSessionGoalTokens('abcdefgh')).toBe(2)
  })

  test('CJK counts ~1 token per character', () => {
    // 4 Chinese chars → 4 tokens (vs the old chars/4 = 1)
    expect(estimateSessionGoalTokens('实现解析器')).toBe('实现解析器'.length)
  })

  test('mixed text adds CJK + latin/4', () => {
    // '实现 API' → 2 CJK + 4 others ('  API' has a space + 3 letters = 4)
    const text = '实现 API'
    const cjk = 2
    const other = text.length - cjk // space + A P I = 4
    expect(estimateSessionGoalTokens(text)).toBe(cjk + Math.ceil(other / 4))
  })

  test('result is always at least 1', () => {
    expect(estimateSessionGoalTokens('a')).toBeGreaterThanOrEqual(1)
  })
})

describe('session goal history (G4)', () => {
  test('clearing a goal archives it into history', () => {
    const before = getSessionGoalHistory().length
    setSessionGoalState('first goal')
    clearSessionGoalState('user_cancel')
    const history = getSessionGoalHistory()
    expect(history.length).toBe(before + 1)
    const last = history[history.length - 1]!
    expect(last.text).toBe('first goal')
    expect(last.status).toBe('cleared')
    // Active goal is the cleared one (clear doesn't null it), confirm archived copy is terminal.
    expect(getSessionGoalState()?.status).toBe('cleared')
  })

  test('completing a goal archives it', () => {
    const before = getSessionGoalHistory().length
    setSessionGoalState('second goal')
    completeSessionGoalState('done')
    const history = getSessionGoalHistory()
    expect(history.length).toBe(before + 1)
    expect(history[history.length - 1]!.text).toBe('second goal')
    expect(history[history.length - 1]!.status).toBe('completed')
  })

  test('replacing an active goal archives the previous one as replaced', () => {
    setSessionGoalState('original goal')
    const before = getSessionGoalHistory().length
    setSessionGoalState('replacement goal')
    const history = getSessionGoalHistory()
    expect(history.length).toBe(before + 1)
    const archived = history[history.length - 1]!
    expect(archived.text).toBe('original goal')
    expect(archived.clearReason).toBe('replaced')
    expect(getSessionGoalState()?.text).toBe('replacement goal')
  })

  test('history is capped (most recent retained)', () => {
    // Drive well past the cap; the oldest should fall off, newest retained.
    for (let i = 0; i < 15; i++) {
      setSessionGoalState(`capped goal ${i}`)
      clearSessionGoalState('user_cancel')
    }
    const history = getSessionGoalHistory()
    expect(history.length).toBeLessThanOrEqual(10)
    expect(history[history.length - 1]!.text).toBe('capped goal 14')
  })

  test('budget-limited goals remain visible and can resume after budget edit', () => {
    setSessionGoalState('budgeted goal')
    const limited = budgetLimitSessionGoalState('turn budget reached')
    expect(limited?.status).toBe('budget_limited')
    expect(getSessionGoalState()?.status).toBe('budget_limited')

    const updated = updateSessionGoalBudgets({
      turnBudget: 40,
      resumeIfBudgetLimited: true,
    })
    expect(updated?.status).toBe('active')
    expect(updated?.turnBudget).toBe(40)
  })

  test('failed goals are terminal and archived', () => {
    setSessionGoalState('fail after repeated evaluator errors')
    const failed = failSessionGoalState('evaluator failed repeatedly')
    expect(failed?.status).toBe('failed')
    expect(getSessionGoalState()?.status).toBe('failed')
    expect(getSessionGoalHistory().at(-1)?.status).toBe('failed')
    expect(resumeSessionGoalState()).toBeNull()
  })

  test('edit preserves usage while updating contract fields', () => {
    setSessionGoalState('old goal')
    const before = getSessionGoalState()
    const edited = editSessionGoalState({
      text: 'new goal',
      successCriteria: 'tests pass',
      constraints: 'no secrets',
    })
    expect(edited?.id).toBe(before?.id)
    expect(edited?.text).toBe('new goal')
    expect(edited?.successCriteria).toBe('tests pass')
    expect(edited?.constraints).toBe('no secrets')
  })

  test('budget-limited goals are resumable explicitly', () => {
    setSessionGoalState('resume budget limited')
    budgetLimitSessionGoalState('token budget reached')
    expect(resumeSessionGoalState()?.status).toBe('active')
  })

  test('records negative evidence for active goals', () => {
    setSessionGoalState('capture tool errors')
    recordSessionGoalNegativeEvidence('Tool update_goal failed: InputValidationError')
    expect(getSessionGoalState()?.negativeEvidence).toEqual([
      'Tool update_goal failed: InputValidationError',
    ])
  })

  test('counts only consecutive same-blocker attempts across turns', () => {
    setSessionGoalState('audit blockers')
    expect(recordSessionGoalBlockerAttempt('waiting for API key').repeatCount).toBe(1)
    recordSessionGoalBlockerAttempt('waiting for API key')
    expect(getSessionGoalState()?.blockerHistory).toHaveLength(1)
    incrementSessionGoalTurnCount()
    expect(recordSessionGoalBlockerAttempt('waiting for network').repeatCount).toBe(1)
    incrementSessionGoalTurnCount()
    expect(recordSessionGoalBlockerAttempt('waiting for API key').repeatCount).toBe(1)
    incrementSessionGoalTurnCount()
    expect(recordSessionGoalBlockerAttempt('waiting for API key').repeatCount).toBe(2)
    incrementSessionGoalTurnCount()
    expect(recordSessionGoalBlockerAttempt('waiting for API key').repeatCount).toBe(3)
  })

  test('resuming a blocked goal starts a fresh blocker audit', () => {
    setSessionGoalState('resume blocker audit')
    recordSessionGoalBlockerAttempt('same blocker')
    incrementSessionGoalTurnCount()
    recordSessionGoalBlockerAttempt('same blocker')
    incrementSessionGoalTurnCount()
    recordSessionGoalBlockerAttempt('same blocker')
    expect(getSessionGoalState()?.blockerHistory).toHaveLength(3)
    blockSessionGoalState('same blocker')
    expect(resumeSessionGoalState()?.blockerHistory).toEqual([])
  })

  test('tracks actual token usage from goal creation baseline', () => {
    addToTotalCostState(
      0,
      {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 10,
      },
      'test-model',
    )
    const goal = setSessionGoalState('measure real usage')
    expect(getSessionGoalActualTokenUsage(goal)).toBe(0)

    addToTotalCostState(
      0,
      {
        inputTokens: 125,
        outputTokens: 60,
        cacheReadInputTokens: 25,
        cacheCreationInputTokens: 12,
      },
      'test-model',
    )

    expect(getSessionGoalActualTokenUsage(getSessionGoalState())).toBe(42)
  })
})
