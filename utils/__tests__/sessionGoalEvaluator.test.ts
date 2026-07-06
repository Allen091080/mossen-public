import { beforeEach, describe, expect, test } from 'bun:test'
import {
  addToTotalCostState,
  getSessionGoalState,
  resetStateForTests,
  resumeSessionGoalState,
  setSessionGoalState,
} from '../../bootstrap/state.js'
import {
  clearMossenConfigOverrides,
  setMossenConfigOverride,
} from '../../services/config/facade.js'
import {
  evaluateActiveSessionGoalAfterTurn,
  getSessionGoalEvaluatorTimeoutMs,
  hasCompletedWorkflowGoalEvidence,
  isGoalEvaluatorBackendUnavailableError,
  runSessionGoalEvaluatorWithTimeout,
} from '../sessionGoalEvaluator.js'

const BACKEND_ENV_KEYS = [
  'MOSSEN_CODE_API_BASE_URL',
  'MOSSEN_CODE_AUTH_TOKEN',
  'MOSSEN_CODE_AUTH_TOKEN_FILE_DESCRIPTOR',
  'MOSSEN_CODE_AUTH_REFRESH_TOKEN',
  'MOSSEN_CODE_CUSTOM_BASE_URL',
  'MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER',
  'MOSSEN_CODE_USE_CUSTOM_BACKEND',
] as const

beforeEach(() => {
  resetStateForTests()
  clearMossenConfigOverrides()
})

async function withNoBackendConfigured(
  callback: () => Promise<void>,
): Promise<void> {
  const previousEnv = new Map<string, string | undefined>()
  for (const key of BACKEND_ENV_KEYS) {
    previousEnv.set(key, process.env[key])
    delete process.env[key]
  }
  setMossenConfigOverride('mossen.activeProfile', null)
  try {
    await callback()
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    clearMossenConfigOverrides()
  }
}

describe('evaluateActiveSessionGoalAfterTurn', () => {
  test('detects completed workflow evidence without failed workflow evidence', () => {
    expect(
      hasCompletedWorkflowGoalEvidence({
        id: 'goal_1',
        text: 'verify workflow completion',
        recentEvidence: ['Workflow audit (wf_1) completed; result: passed'],
        negativeEvidence: [],
        blockerHistory: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        evaluatorModel: 'haiku',
        turnBudget: 4,
        turnCount: 1,
        evaluationFailureCount: 0,
        status: 'active',
      }),
    ).toBe(true)

    expect(
      hasCompletedWorkflowGoalEvidence({
        id: 'goal_1',
        text: 'verify workflow completion',
        recentEvidence: ['Workflow audit (wf_1) completed; result: passed'],
        negativeEvidence: ['Workflow audit (wf_2) ended failed: validator failed'],
        blockerHistory: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        evaluatorModel: 'haiku',
        turnBudget: 4,
        turnCount: 1,
        evaluationFailureCount: 0,
        status: 'active',
      }),
    ).toBe(false)

    expect(
      hasCompletedWorkflowGoalEvidence({
        id: 'goal_1',
        text: 'verify workflow completion',
        recentEvidence: ['Workflow audit (wf_1) completed; result: passed'],
        negativeEvidence: [
          'Workflow audit (wf_1) needs verification: final report has no explicit evidence',
        ],
        blockerHistory: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        evaluatorModel: 'haiku',
        turnBudget: 4,
        turnCount: 1,
        evaluationFailureCount: 0,
        status: 'active',
      }),
    ).toBe(false)
  })

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

  test('pauses instead of querying when evaluator backend is not configured', async () => {
    await withNoBackendConfigured(async () => {
      setSessionGoalState('finish the visible user journey')

      const result = await evaluateActiveSessionGoalAfterTurn(
        [
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'I have a concrete transcript to evaluate.',
                },
              ],
            },
          },
        ],
        new AbortController().signal,
      )

      if (result.type !== 'paused') throw new Error('expected paused action')
      expect(result.reason).toContain('Goal auto-evaluation paused')
      expect(result.reason).toContain('no Mossen backend is configured')
      expect(getSessionGoalState()?.status).toBe('paused')
      expect(getSessionGoalState()?.lastEvaluatorStatus).toBe('deferred')
      expect(getSessionGoalState()?.evaluationFailureCount).toBe(0)
      expect(result.events.map(event => event.type)).toEqual([
        'goal_eval',
        'goal_paused',
      ])
    })
  })

  test('classifies missing backend configuration as evaluator unavailable', () => {
    expect(
      isGoalEvaluatorBackendUnavailableError(
        new Error('No Mossen backend is configured. Set MOSSEN_CODE_CUSTOM_BASE_URL.'),
      ),
    ).toBe(true)
    expect(
      isGoalEvaluatorBackendUnavailableError(
        new Error('Custom backend mode requires MOSSEN_CODE_CUSTOM_BASE_URL to be set.'),
      ),
    ).toBe(true)
    expect(
      isGoalEvaluatorBackendUnavailableError(
        'APIError: No Mossen backend is configured. For personal edition, set MOSSEN_CODE_CUSTOM_BASE_URL.',
      ),
    ).toBe(true)
    expect(isGoalEvaluatorBackendUnavailableError(new Error('invalid JSON'))).toBe(false)
  })

  test('bounds evaluator calls with a wall-clock timeout', async () => {
    await expect(
      runSessionGoalEvaluatorWithTimeout(
        () => new Promise(() => undefined),
        new AbortController().signal,
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow('Goal evaluator timed out after 10ms.')
  })

  test('parses evaluator timeout overrides within the safety bounds', () => {
    expect(getSessionGoalEvaluatorTimeoutMs({
      MOSSEN_CODE_GOAL_EVALUATOR_TIMEOUT_MS: '25',
    })).toBe(25)
    expect(getSessionGoalEvaluatorTimeoutMs({
      MOSSEN_CODE_GOAL_EVALUATOR_TIMEOUT_MS: '0',
    })).toBe(1)
    expect(getSessionGoalEvaluatorTimeoutMs({
      MOSSEN_CODE_GOAL_EVALUATOR_TIMEOUT_MS: '999999999',
    })).toBe(300000)
  })
})
