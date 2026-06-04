import { describe, expect, test } from 'bun:test'
import {
  clearSessionGoalState,
  completeSessionGoalState,
  estimateSessionGoalTokens,
  getSessionGoalHistory,
  getSessionGoalState,
  setSessionGoalState,
} from '../state.js'

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
})
