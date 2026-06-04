import { describe, expect, test } from 'bun:test'
import {
  formatGoalOverlayInline,
  shouldShowGoalInline,
  GOAL_INLINE_MIN_COLUMNS,
  GOAL_OVERLAY_MIN_COLUMNS,
  type GoalOverlayDisplayState,
} from '../GoalOverlay.js'
import type { MossenGoalState } from '../../bootstrap/state.js'

function goal(
  overrides: Partial<MossenGoalState> = {},
): MossenGoalState & { status: GoalOverlayDisplayState } {
  return {
    id: 'goal_test',
    text: 'fix the parser edge cases',
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    evaluatorModel: 'haiku',
    turnBudget: 20,
    turnCount: 3,
    evaluationFailureCount: 0,
    status: 'active',
    ...overrides,
  } as MossenGoalState & { status: GoalOverlayDisplayState }
}

describe('shouldShowGoalInline (G3)', () => {
  test('true in the narrow band [40, 90)', () => {
    expect(shouldShowGoalInline(goal(), 60, true)).toBe(true)
    expect(shouldShowGoalInline(goal(), GOAL_INLINE_MIN_COLUMNS, true)).toBe(true)
    expect(shouldShowGoalInline(goal(), GOAL_OVERLAY_MIN_COLUMNS - 1, true)).toBe(true)
  })

  test('false at/above the full-overlay threshold (full overlay takes over)', () => {
    expect(shouldShowGoalInline(goal(), GOAL_OVERLAY_MIN_COLUMNS, true)).toBe(false)
    expect(shouldShowGoalInline(goal(), 120, true)).toBe(false)
  })

  test('false below the inline minimum', () => {
    expect(shouldShowGoalInline(goal(), GOAL_INLINE_MIN_COLUMNS - 1, true)).toBe(false)
    expect(shouldShowGoalInline(goal(), 10, true)).toBe(false)
  })

  test('false when hidden', () => {
    expect(shouldShowGoalInline(goal(), 60, false)).toBe(false)
  })

  test('false when goal is null or not overlay-eligible', () => {
    expect(shouldShowGoalInline(null, 60, true)).toBe(false)
    expect(shouldShowGoalInline(goal({ status: 'cleared' as GoalOverlayDisplayState }), 60, true)).toBe(false)
  })
})

describe('formatGoalOverlayInline (G3)', () => {
  test('includes turns and goal text', () => {
    const line = formatGoalOverlayInline(goal())
    expect(line).toContain('3/20')
    expect(line).toContain('fix the parser')
    expect(line).toContain(' · ')
  })

  test('includes a token estimate when present', () => {
    const line = formatGoalOverlayInline(goal({ tokenEstimate: 1234 }))
    expect(line).toMatch(/~1\.2k/)
  })

  test('omits token estimate when zero/absent', () => {
    const line = formatGoalOverlayInline(goal({ tokenEstimate: 0 }))
    expect(line).not.toContain('~')
  })

  test('truncates a very long goal text', () => {
    const longText = 'a'.repeat(100)
    const line = formatGoalOverlayInline(goal({ text: longText }))
    // 32-grapheme cap + ellipsis means the full 100-char run never appears.
    expect(line).not.toContain(longText)
  })
})
