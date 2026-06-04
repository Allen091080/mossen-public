import { describe, expect, test } from 'bun:test'
import {
  _resetForTesting,
  attachAnalyticsSink,
} from '../../../services/analytics/index.js'
import { resolveMossenEventName } from '../../../services/analytics/mossenEventLogger.js'
import {
  collectWorkflowPhaseCompletionMetrics,
  logWorkflowCompletionMetric,
  logWorkflowLaunchMetric,
  workflowSourceForTelemetry,
} from '../phaseTelemetry.js'

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

  test('logs launch and completion metrics with official wire suffixes', () => {
    const events: Array<{
      eventName: string
      metadata: Record<string, unknown>
    }> = []
    _resetForTesting()
    attachAnalyticsSink({
      logEvent: (eventName, metadata) => {
        events.push({ eventName, metadata })
      },
      logEventAsync: async (eventName, metadata) => {
        events.push({ eventName, metadata })
      },
    })

    try {
      expect(workflowSourceForTelemetry('bundled')).toBe('built-in')
      expect(
        resolveMossenEventName('mossen.workflow.phaseCompleted').endsWith(
          'workflow_phase_completed',
        ),
      ).toBe(true)
      logWorkflowLaunchMetric({
        invocationMode: 'named',
        workflowSource: 'built-in',
        workflowName: 'deep-research',
        workflowDescription: 'Deep research',
        phaseCount: 3,
        hasArgs: true,
        isResume: false,
        scriptSizeChars: 1234,
      })
      logWorkflowCompletionMetric({
        workflowRunId: 'wf_metric1',
        workflowSource: 'built-in',
        workflowName: 'deep-research',
        workflowDescription: 'Deep research',
        status: 'completed',
        agentCount: 4,
        totalTokens: 500,
        totalToolCalls: 6,
        durationMs: 7000,
      })
    } finally {
      _resetForTesting()
    }

    expect(events[0]?.eventName.endsWith('workflow_launched')).toBe(true)
    expect(events[0]?.metadata).toEqual({
      invocation_mode: 'named',
      workflow_source: 'built-in',
      workflow_name: 'deep-research',
      workflow_description: 'Deep research',
      phase_count: 3,
      has_args: true,
      is_resume: false,
      script_size_chars: 1234,
    })
    expect(events[1]?.eventName.endsWith('workflow_completed')).toBe(true)
    expect(events[1]?.metadata).toEqual({
      workflow_run_id: 'wf_metric1',
      workflow_source: 'built-in',
      workflow_name: 'deep-research',
      workflow_description: 'Deep research',
      status: 'completed',
      agent_count: 4,
      total_tokens: 500,
      total_tool_calls: 6,
      duration_ms: 7000,
    })
  })
})
