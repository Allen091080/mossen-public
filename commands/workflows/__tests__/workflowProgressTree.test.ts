import { describe, expect, test } from 'bun:test'
import {
  buildWorkflowVerificationSummary,
  workflowRunToJson,
} from '../workflowProgressTree.js'

describe('buildWorkflowVerificationSummary', () => {
  test('does not treat summary-only workflow result as verification evidence', () => {
    const summary = buildWorkflowVerificationSummary({
      state: 'completed',
      result: 'All checks passed.',
      failures: [],
      reportPath: '/tmp/wf/report.md',
    })

    expect(summary.state).toBe('ready')
    expect(summary.summary).toBe('No explicit verification evidence captured')
    expect(summary.evidence).toEqual([])
    expect(summary.artifacts).toEqual(['/tmp/wf/report.md'])
  })

  test('accepts explicit evidence, validation commands, and artifacts', () => {
    const summary = buildWorkflowVerificationSummary({
      state: 'completed',
      result: JSON.stringify({
        summary: 'verified with commands',
        verification: {
          evidence: ['unit tests passed'],
          commands: ['bun test utils/__tests__/loopLiveness.test.ts'],
          artifacts: ['/tmp/wf/final-report.json'],
        },
      }),
      failures: [],
      reportPath: '/tmp/wf/report.md',
      finalReportPath: '/tmp/wf/final-report.json',
    })

    expect(summary.state).toBe('completed')
    expect(summary.evidence).toContain('unit tests passed')
    expect(summary.commands).toEqual([
      'bun test utils/__tests__/loopLiveness.test.ts',
    ])
    expect(summary.artifacts).toContain('/tmp/wf/final-report.json')
    expect(summary.artifacts).toContain('/tmp/wf/report.md')
  })

  test('workflow JSON exposes checkpoint artifact for recovery audits', () => {
    const run = workflowRunToJson({
      runId: 'wf_checkpoint_json',
      workflowName: 'checkpoint-json',
      description: 'checkpoint json',
      createdAt: '2026-07-06T00:00:00.000Z',
      status: 'killed',
      result: JSON.stringify({
        summary: 'needs resume',
        verification: {
          evidence: ['checkpoint exists'],
          artifacts: ['/tmp/wf/final-report.json'],
        },
      }),
    })

    expect(run.artifacts.some(path => path.endsWith('/checkpoint.json'))).toBe(true)
  })
})
