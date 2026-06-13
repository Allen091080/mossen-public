import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getSessionGoalState,
  resetStateForTests,
  setSessionGoalState,
} from '../../bootstrap/state.js'
import {
  buildSessionGoalContinuationPrompt,
  buildSessionGoalStartPrompt,
} from '../sessionGoalEvaluator.js'
import { getActiveSessionGoalPromptSection } from '../sessionGoalPrompt.js'

beforeEach(() => {
  resetStateForTests()
})

describe('session goal workflow contract prompts', () => {
  test('start and continuation prompts steer broad goals through Workflow task runs', () => {
    const goal = setSessionGoalState(
      'Audit the whole repo and fix the highest-risk issues',
      'workflow report exists\nvalidation commands pass',
    )

    const start = buildSessionGoalStartPrompt(goal)
    const continuation = buildSessionGoalContinuationPrompt(
      goal,
      'Evaluator saw only partial progress',
    )

    for (const prompt of [start, continuation]) {
      expect(prompt).toContain('Workflow({ task:')
      expect(prompt).toContain('/workflows')
      expect(prompt).toContain('A launched workflow is not completion evidence')
      expect(prompt).toContain('workflow/agent')
      expect(prompt).toContain('concrete evidence')
    }
  })

  test('active goal prompt exposes workflow completion guardrails to the model', () => {
    setSessionGoalState('Migrate a subsystem with verification')

    const section = getActiveSessionGoalPromptSection()

    expect(section).toContain('Workflow({ task:')
    expect(section).toContain('/workflows')
    expect(section).toContain('not completion evidence by itself')
    expect(section).toContain('terminal workflow/agent state')
    expect(getSessionGoalState()?.status).toBe('active')
  })
})
