import { describe, expect, test } from 'bun:test'
import { buildWorkflowFinalReport } from '../finalReport.js'

describe('buildWorkflowFinalReport', () => {
  test('extracts explicit workflow evidence and artifacts', () => {
    const report = buildWorkflowFinalReport({
      runId: 'wf_final_report',
      workflowName: 'final-report',
      status: 'completed',
      result: {
        summary: 'verified',
        verification: {
          evidence: ['unit tests passed'],
          commands: ['bun test tools/WorkflowTool/__tests__/finalReport.test.ts'],
          artifacts: ['/tmp/wf/final-report.json'],
        },
        openQuestions: [],
      },
      reportPath: '/tmp/wf/report.md',
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(report.evidenceState).toBe('verified')
    expect(report.summary).toBe('verified')
    expect(report.evidence).toEqual(['unit tests passed'])
    expect(report.validationCommands).toEqual([
      'bun test tools/WorkflowTool/__tests__/finalReport.test.ts',
    ])
    expect(report.artifacts).toContain('/tmp/wf/final-report.json')
    expect(report.artifacts).toContain('/tmp/wf/report.md')
  })

  test('marks summary-only workflow output as needing verification', () => {
    const report = buildWorkflowFinalReport({
      runId: 'wf_summary_only',
      workflowName: 'summary-only',
      status: 'completed',
      result: 'All checks passed.',
      failures: [],
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(report.evidenceState).toBe('needs_verification')
    expect(report.evidence).toEqual([])
    expect(report.validationCommands).toEqual([])
    expect(report.artifacts).toEqual([])
    expect(report.resultPreview).toBe('All checks passed.')
  })

  test('turns rejected verifier outputs into report failures', () => {
    const report = buildWorkflowFinalReport({
      runId: 'wf_rejected',
      workflowName: 'rejected',
      status: 'completed',
      result: {
        summary: 'not enough evidence',
        verifications: [
          {
            key: 'audit',
            accepted: false,
            weakEvidence: true,
            gaps: ['no command output'],
          },
        ],
      },
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(report.evidenceState).toBe('failed')
    expect(report.failures).toEqual(['audit: no command output'])
  })

  test('keeps timeout metadata as machine-readable failure evidence', () => {
    const report = buildWorkflowFinalReport({
      runId: 'wf_timeout',
      workflowName: 'timeout',
      status: 'failed',
      result: {
        summary: 'Workflow timed out after 25ms.',
      },
      failures: ['Workflow timed out after 25ms.'],
      timeout: {
        timeoutMs: 25,
        elapsedMs: 31,
        activeAgentCount: 0,
        currentPhase: 'Wait',
      },
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(report.evidenceState).toBe('failed')
    expect(report.timeout).toEqual({
      timeoutMs: 25,
      elapsedMs: 31,
      activeAgentCount: 0,
      currentPhase: 'Wait',
    })
    expect(report.failures).toEqual(['Workflow timed out after 25ms.'])
  })
})
