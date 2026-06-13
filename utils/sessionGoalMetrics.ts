import { getStatsStore } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

export const GOAL_CREATED_METRIC = 'mossen.goal.created'
export const GOAL_COMPLETED_METRIC = 'mossen.goal.completed'
export const GOAL_BLOCKED_METRIC = 'mossen.goal.blocked'
export const GOAL_FAILED_METRIC = 'mossen.goal.failed'
export const GOAL_PAUSED_METRIC = 'mossen.goal.paused'
export const GOAL_DEFERRED_METRIC = 'mossen.goal.deferred'
export const GOAL_CONTINUED_METRIC = 'mossen.goal.continued'
export const GOAL_BUDGET_LIMITED_METRIC = 'mossen.goal.budget_limited'
export const GOAL_EVALUATOR_ATTEMPT_METRIC = 'mossen.goal.evaluator.attempt'
export const GOAL_EVALUATOR_SUCCESS_METRIC = 'mossen.goal.evaluator.success'
export const GOAL_EVALUATOR_FAILURE_METRIC = 'mossen.goal.evaluator.failure'
export const GOAL_EVALUATOR_DURATION_MS_METRIC = 'mossen.goal.evaluator.duration_ms'
export const GOAL_NEGATIVE_EVIDENCE_METRIC = 'mossen.goal.negative_evidence'
export const GOAL_SNAPSHOT_WRITE_METRIC = 'mossen.goal.snapshot.write'
export const GOAL_SNAPSHOT_RESTORE_METRIC = 'mossen.goal.snapshot.restore'
export const GOAL_SNAPSHOT_RESTORE_FAILURE_METRIC =
  'mossen.goal.snapshot.restore_failure'
export const GOAL_CONTINUATION_ENQUEUED_METRIC =
  'mossen.goal.continuation.enqueued'

export type SessionGoalMetricName =
  | typeof GOAL_CREATED_METRIC
  | typeof GOAL_COMPLETED_METRIC
  | typeof GOAL_BLOCKED_METRIC
  | typeof GOAL_FAILED_METRIC
  | typeof GOAL_PAUSED_METRIC
  | typeof GOAL_DEFERRED_METRIC
  | typeof GOAL_CONTINUED_METRIC
  | typeof GOAL_BUDGET_LIMITED_METRIC
  | typeof GOAL_EVALUATOR_ATTEMPT_METRIC
  | typeof GOAL_EVALUATOR_SUCCESS_METRIC
  | typeof GOAL_EVALUATOR_FAILURE_METRIC
  | typeof GOAL_EVALUATOR_DURATION_MS_METRIC
  | typeof GOAL_NEGATIVE_EVIDENCE_METRIC
  | typeof GOAL_SNAPSHOT_WRITE_METRIC
  | typeof GOAL_SNAPSHOT_RESTORE_METRIC
  | typeof GOAL_SNAPSHOT_RESTORE_FAILURE_METRIC
  | typeof GOAL_CONTINUATION_ENQUEUED_METRIC

export function observeSessionGoalMetric(
  name: SessionGoalMetricName,
  value = 1,
): void {
  try {
    getStatsStore()?.observe(name, value)
  } catch (error) {
    logForDebugging(`[goal] failed to observe metric ${name}: ${String(error)}`)
  }
}
