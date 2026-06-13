import { describe, expect, test } from 'bun:test'
import {
  hasSessionGoalNegativeSignal,
  splitSessionGoalSuccessCriteria,
  validateSessionGoalCompletionEvidence,
} from '../sessionGoalValidation.js'

describe('splitSessionGoalSuccessCriteria', () => {
  test('splits bullets, numbered lines, and semicolons', () => {
    expect(
      splitSessionGoalSuccessCriteria(
        '1. tests pass\n- overlay does not pollute output；blocked audit works',
      ),
    ).toEqual([
      'tests pass',
      'overlay does not pollute output',
      'blocked audit works',
    ])
  })
})

describe('validateSessionGoalCompletionEvidence', () => {
  test('requires evidence for each success criterion', () => {
    const result = validateSessionGoalCompletionEvidence(
      {
        successCriteria: 'tests pass\nsidecar active restore pauses',
        negativeEvidence: [],
      },
      ['bun test passed'],
    )
    expect(result.ok).toBe(false)
    expect(result.missingCriteria).toEqual(['sidecar active restore pauses'])
  })

  test('rejects unresolved negative evidence', () => {
    const result = validateSessionGoalCompletionEvidence(
      {
        successCriteria: 'tests pass',
        negativeEvidence: ['Tool update_goal failed: InputValidationError: status missing'],
      },
      ['bun test passed'],
    )
    expect(result.ok).toBe(false)
    expect(result.unresolvedNegativeEvidence).toHaveLength(1)
  })

  test('accepts explicit resolution evidence for a prior tool error', () => {
    const result = validateSessionGoalCompletionEvidence(
      {
        successCriteria: 'tests pass',
        negativeEvidence: ['Tool update_goal failed: InputValidationError: status missing'],
      },
      [
        'bun test passed',
        'Fixed tool parameter validation error and reran update_goal successfully.',
      ],
    )
    expect(result.ok).toBe(true)
  })
})

describe('hasSessionGoalNegativeSignal', () => {
  test('recognizes compact invalid-parameter UI text', () => {
    expect(hasSessionGoalNegativeSignal('工具参数无效')).toBe(true)
    expect(hasSessionGoalNegativeSignal('Invalid tool parameters')).toBe(true)
  })
})
