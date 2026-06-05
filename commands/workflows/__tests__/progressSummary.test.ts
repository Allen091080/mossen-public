import { describe, expect, test } from 'bun:test'
import {
  buildWorkflowPhaseMetricSummary,
  buildWorkflowRunMetricSummary,
  formatWorkflowMetricSummary,
  formatWorkflowPhaseMetricSummary,
  workflowAgentElapsedMs,
  workflowStatusSummary,
} from '../progressSummary.js'

describe('/workflows progress summary model', () => {
  test('summarizes live run counters with paused time excluded', () => {
    const summary = buildWorkflowRunMetricSummary(
      {
        status: 'running',
        startTime: 1_000,
        totalPausedMs: 1_500,
        agentCount: 8,
        tokensSpent: 12_345,
        totalToolCalls: 17,
      },
      [{ status: 'completed', tokens: 1, toolCalls: 1 }],
      10_000,
    )

    expect(summary).toEqual({
      agentCount: 8,
      tokens: 12_345,
      toolCalls: 17,
      elapsedMs: 7_500,
    })
    expect(formatWorkflowMetricSummary(summary)).toContain(
      '8 agents · 12.3k tok · 17 tools',
    )
  })

  test('falls back to persisted agent rows for completed history runs', () => {
    const summary = buildWorkflowRunMetricSummary(
      {
        status: 'completed',
        durationMs: 4_600,
      },
      [
        { status: 'completed', tokens: 25, toolCalls: 1 },
        { status: 'failed', tokens: 30, toolCalls: 2 },
      ],
    )

    expect(summary).toEqual({
      agentCount: 2,
      tokens: 55,
      toolCalls: 3,
      elapsedMs: 4_600,
    })
    expect(formatWorkflowMetricSummary(summary, { approximateTokens: true }))
      .toContain('2 agents · ~55 tok · 3 tools')
  })

  test('summarizes official phase progress fields for /workflows views', () => {
    const summary = buildWorkflowPhaseMetricSummary(
      'Verify',
      [
        {
          status: 'running',
          tokens: 10,
          toolCalls: 1,
          startedAt: 8_000,
        },
        {
          status: 'completed',
          tokens: 20,
          toolCalls: 2,
          durationMs: 1_250,
        },
        {
          status: 'failed',
          tokens: 30,
          toolCalls: 3,
          durationMs: 500,
        },
      ],
      10_000,
    )

    expect(summary).toEqual({
      title: 'Verify',
      agentCount: 3,
      statusSummary: '1 running, 1 completed, 1 failed',
      tokens: 60,
      toolCalls: 6,
      elapsedMs: 3_750,
    })
    expect(formatWorkflowPhaseMetricSummary(summary)).toContain(
      'Verify · 3 agent(s) · 1 running, 1 completed, 1 failed · 60 tok · 6 tools',
    )
    expect(workflowStatusSummary([])).toBe('')
    expect(workflowAgentElapsedMs({ startedAt: 9_000 }, 10_000)).toBe(1_000)
  })
})
