import { describe, expect, test } from 'bun:test'
import {
  canPauseWorkflowDetail,
  canResumeWorkflowDetail,
  canStopWorkflowDetail,
  workflowPhaseSummaries,
} from '../WorkflowDetailDialog.js'

describe('WorkflowDetailDialog controls', () => {
  test('running workflows can pause and stop', () => {
    const workflow = { status: 'running' as const, paused: false }

    expect(canPauseWorkflowDetail(workflow)).toBe(true)
    expect(canResumeWorkflowDetail(workflow)).toBe(false)
    expect(canStopWorkflowDetail(workflow)).toBe(true)
  })

  test('paused workflows can resume and stop from the task panel', () => {
    const workflow = { status: 'paused' as const, paused: true }

    expect(canPauseWorkflowDetail(workflow)).toBe(false)
    expect(canResumeWorkflowDetail(workflow)).toBe(true)
    expect(canStopWorkflowDetail(workflow)).toBe(true)
  })

  test('completed workflows are read-only in the detail panel', () => {
    const workflow = { status: 'completed' as const, paused: false }

    expect(canPauseWorkflowDetail(workflow)).toBe(false)
    expect(canResumeWorkflowDetail(workflow)).toBe(false)
    expect(canStopWorkflowDetail(workflow)).toBe(false)
  })

  test('task panel detail summarizes phase counts, tokens, tools, and elapsed time', () => {
    const summaries = workflowPhaseSummaries({
      phaseDefinitions: [
        { title: 'Scan' },
        { title: 'Write' },
      ],
      phases: ['Scan', 'Verify'],
      agents: [
        {
          phase: 'Scan',
          status: 'completed',
          tokens: 10,
          toolCalls: 1,
          durationMs: 1200,
        },
        {
          phase: 'Scan',
          status: 'running',
          tokens: 20,
          toolCalls: 2,
          durationMs: 800,
        },
        {
          phase: 'Verify',
          status: 'queued',
          tokens: 0,
          toolCalls: 0,
        },
      ],
    })

    expect(summaries).toEqual([
      {
        title: 'Scan',
        agentCount: 2,
        statusSummary: '1 completed, 1 running',
        tokens: 30,
        toolCalls: 3,
        elapsedMs: 2000,
      },
      {
        title: 'Write',
        agentCount: 0,
        statusSummary: '',
        tokens: 0,
        toolCalls: 0,
        elapsedMs: 0,
      },
      {
        title: 'Verify',
        agentCount: 1,
        statusSummary: '1 queued',
        tokens: 0,
        toolCalls: 0,
        elapsedMs: 0,
      },
    ])
  })
})
