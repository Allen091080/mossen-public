import { beforeEach, describe, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setStatsStore,
} from '../../bootstrap/state.js'
import {
  GOAL_EVALUATOR_ATTEMPT_METRIC,
  observeSessionGoalMetric,
} from '../sessionGoalMetrics.js'

beforeEach(() => {
  resetStateForTests()
})

describe('observeSessionGoalMetric', () => {
  test('forwards goal metrics to the stats store', () => {
    const observations: Array<{ name: string; value: number }> = []
    setStatsStore({
      observe(name, value) {
        observations.push({ name, value })
      },
    })

    observeSessionGoalMetric(GOAL_EVALUATOR_ATTEMPT_METRIC, 2)

    expect(observations).toEqual([
      { name: GOAL_EVALUATOR_ATTEMPT_METRIC, value: 2 },
    ])
  })

  test('does not require a stats store', () => {
    setStatsStore(null)

    expect(() =>
      observeSessionGoalMetric(GOAL_EVALUATOR_ATTEMPT_METRIC),
    ).not.toThrow()
  })
})
