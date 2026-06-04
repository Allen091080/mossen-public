import { describe, expect, test } from 'bun:test'
import { collectWorkflowPhaseCompletionMetrics } from '../phaseTelemetry.js'

describe('workflow phase completion telemetry', () => {
  test('aggregates the latest agent row per phase', () => {
    expect(
      collectWorkflowPhaseCompletionMetrics([
        {
          type: 'workflow_phase',
          index: 1,
          title: 'Plan',
          state: 'start',
        },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Map',
          phaseTitle: 'Plan',
          phaseIndex: 1,
          state: 'start',
        },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Map',
          phaseTitle: 'Plan',
          phaseIndex: 1,
          state: 'done',
          tokens: 40,
          toolCalls: 2,
          durationMs: 1200,
        },
        {
          type: 'workflow_agent',
          index: 2,
          label: 'Check',
          phaseTitle: 'Plan',
          phaseIndex: 1,
          state: 'done',
          cached: true,
          tokens: 0,
          toolCalls: 0,
          durationMs: 0,
        },
      ]),
    ).toEqual([
      {
        phaseIndex: 1,
        phaseTitle: 'Plan',
        phaseTokens: 40,
        phaseToolCalls: 2,
        phaseAgentDurationMs: 1200,
        phaseAgentCount: 2,
        phaseErrorCount: 0,
        phaseSkipCount: 0,
      },
    ])
  })

  test('counts failed and skipped agents separately', () => {
    expect(
      collectWorkflowPhaseCompletionMetrics([
        {
          type: 'workflow_phase',
          index: 1,
          title: 'Build',
          state: 'start',
        },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Compile',
          phaseIndex: 1,
          state: 'error',
          error: 'compile failed',
          tokens: 11,
          toolCalls: 1,
          durationMs: 75,
        },
        {
          type: 'workflow_agent',
          index: 2,
          label: 'Optional',
          phaseTitle: 'Build',
          phaseIndex: 1,
          state: 'error',
          error: 'skipped by user',
          tokens: 0,
          toolCalls: 0,
          durationMs: 5,
        },
      ]),
    ).toEqual([
      {
        phaseIndex: 1,
        phaseTitle: 'Build',
        phaseTokens: 11,
        phaseToolCalls: 1,
        phaseAgentDurationMs: 80,
        phaseAgentCount: 2,
        phaseErrorCount: 1,
        phaseSkipCount: 1,
      },
    ])
  })
})
