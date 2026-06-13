import { describe, expect, test } from 'bun:test'
import type { WorkflowRunMeta } from '../../../tools/WorkflowTool/engine/journalStore.js'
import {
  buildWorkflowProgressTree,
  buildWorkflowVerificationSummary,
  buildWorkflowTree,
  workflowRunToJson,
  workflowRunsToJson,
  workflowStatusToMachineState,
} from '../../../commands/workflows/workflowProgressTree.js'
import { renderWorkflowReport } from '../../../commands/workflows/exportWorkflowReport.js'

function meta(overrides: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta {
  return {
    runId: 'wf_run_123',
    workflowName: 'repo-audit',
    title: 'Repo audit',
    description: 'Audit the repository',
    phases: [{ title: 'Scan', detail: 'Find issues', model: 'mossen-fast' }],
    defaultModel: 'mossen-fast',
    args: { scope: 'agent-view' },
    scriptPath: '/repo/.mossen/workflows/repo-audit.js',
    transcriptDir: '/repo/.mossen/subagents',
    parentGoalId: 'goal_run_123',
    createdAt: '2026-06-12T08:00:00.000Z',
    status: 'running',
    agentCount: 3,
    totalToolCalls: 9,
    tokensSpent: 1200,
    failures: [],
    durationMs: 4000,
    result: '  Audit complete.  Ready for review. ',
    ...overrides,
  }
}

describe('workflowStatusToMachineState', () => {
  test('maps persisted workflow status to workbench states', () => {
    expect(workflowStatusToMachineState('running')).toBe('running')
    expect(workflowStatusToMachineState('paused')).toBe('blocked')
    expect(workflowStatusToMachineState('completed')).toBe('completed')
    expect(workflowStatusToMachineState('failed')).toBe('failed')
    expect(workflowStatusToMachineState('killed')).toBe('cancelled')
  })
})

describe('workflowRunToJson', () => {
  test('projects workflow run metadata into the machine protocol', () => {
    expect(workflowRunToJson(meta())).toMatchObject({
      id: 'wf_run_123',
      runId: 'wf_run_123',
      kind: 'workflow',
      state: 'running',
      status: 'running',
      workflowName: 'repo-audit',
      title: 'Repo audit',
      description: 'Audit the repository',
      defaultModel: 'mossen-fast',
      args: { scope: 'agent-view' },
      scriptPath: '/repo/.mossen/workflows/repo-audit.js',
      transcriptDir: '/repo/.mossen/subagents',
      reportPath: expect.stringContaining('report.md'),
      createdAt: '2026-06-12T08:00:00.000Z',
      updatedAt: null,
      durationMs: 4000,
      parentGoalId: 'goal_run_123',
      agentCount: 3,
      totalToolCalls: 9,
      tokenUsage: {
        inputTokens: null,
        outputTokens: 1200,
        totalTokens: 1200,
      },
      phases: [
        {
          title: 'Scan',
          detail: 'Find issues',
          model: 'mossen-fast',
          state: 'running',
        },
      ],
      failures: [],
      verification: {
        state: 'verifying',
        summary: 'Audit complete. Ready for review.',
        evidence: ['Audit complete. Ready for review.'],
        commands: [],
        artifacts: [expect.stringContaining('report.md')],
        failures: [],
      },
      artifacts: [expect.stringContaining('report.md')],
      result: '  Audit complete.  Ready for review. ',
      resultSummary: 'Audit complete. Ready for review.',
      tree: {
        id: 'wf_run_123',
        kind: 'workflow',
        label: 'Repo audit',
        state: 'running',
        tokenUsage: {
          inputTokens: null,
          outputTokens: 1200,
          totalTokens: 1200,
        },
        toolCalls: 9,
        durationMs: 4000,
        resultSummary: 'Audit complete. Ready for review.',
        children: [
          {
            id: 'wf_run_123:phase:Scan',
            kind: 'phase',
            label: 'Scan',
            state: 'running',
            phase: 'Scan',
            model: 'mossen-fast',
            resultSummary: 'Find issues',
          },
          {
            id: 'wf_run_123:verification',
            kind: 'verification',
            label: 'Verification evidence',
            state: 'verifying',
            resultSummary: 'Audit complete. Ready for review.',
          },
          {
            id: 'wf_run_123:result',
            kind: 'result',
            label: 'Result ready for review',
            state: 'ready',
            resultSummary: 'Audit complete. Ready for review.',
          },
        ],
      },
    })
  })

  test('adds failure nodes to the workflow tree', () => {
    const tree = buildWorkflowTree(
      meta({
        status: 'failed',
        failures: ['validator failed', 'agent abandoned'],
        result: undefined,
      }),
    )

    expect(tree.state).toBe('failed')
    expect(tree.children.map(node => [node.kind, node.label, node.state])).toEqual([
      ['phase', 'Scan', 'failed'],
      ['verification', 'Verification evidence', 'failed'],
      ['failure', 'Failure 1', 'failed'],
      ['failure', 'Failure 2', 'failed'],
    ])
    expect(tree.children[1]?.error).toBe('validator failed; agent abandoned')
    expect(tree.children[2]?.error).toBe('validator failed')
    expect(tree.children[3]?.error).toBe('agent abandoned')
  })

  test('projects agent observability fields into workflow tree nodes', () => {
    const tree = buildWorkflowProgressTree({
      runId: 'wf_observable',
      label: 'Observable run',
      state: 'running',
      agents: [
        {
          agentNumber: 1,
          agentId: 'agent_tree_1',
          transcriptPath: '/repo/subagents/workflows/wf_observable/agent-agent_tree_1.jsonl',
          label: 'Scan routes',
          phase: 'Scan',
          status: 'running',
          model: 'mossen-fast',
          agentType: 'Explore',
          isolation: 'remote',
          tokens: 42,
          toolCalls: 3,
          promptPreview: 'Inspect workflow routing and summarize findings.',
          queuedAt: 1_800_000_000_000,
          startedAt: 1_800_000_001_000,
          lastProgressAt: 1_800_000_002_000,
          remoteSessionId: 'session_remote_tree',
          lastToolName: 'Read',
          lastToolSummary: 'commands/workflows/workflows.tsx',
          recentToolCalls: [
            { name: 'Glob', summary: 'commands/workflows/*.tsx' },
            { name: 'Read', summary: 'commands/workflows/workflows.tsx' },
          ],
        },
      ],
    })

    const agentNode = tree.children
      .flatMap(node => [node, ...node.children])
      .find(node => node.kind === 'agent')

    expect(agentNode).toMatchObject({
      id: 'wf_observable:agent:1',
      kind: 'agent',
      agentId: 'agent_tree_1',
      transcriptPath: '/repo/subagents/workflows/wf_observable/agent-agent_tree_1.jsonl',
      state: 'running',
      statusContext: 'tool: commands/workflows/workflows.tsx',
      model: 'mossen-fast',
      agentType: 'Explore',
      isolation: 'remote',
      promptPreview: 'Inspect workflow routing and summarize findings.',
      queuedAt: 1_800_000_000_000,
      startedAt: 1_800_000_001_000,
      lastProgressAt: 1_800_000_002_000,
      remoteSessionId: 'session_remote_tree',
      lastToolName: 'Read',
      lastToolSummary: 'commands/workflows/workflows.tsx',
      recentToolCalls: [
        { name: 'Glob', summary: 'commands/workflows/*.tsx' },
        { name: 'Read', summary: 'commands/workflows/workflows.tsx' },
      ],
      tokenUsage: {
        inputTokens: null,
        outputTokens: 42,
        totalTokens: 42,
      },
      toolCalls: 3,
    })
  })

  test('keeps list projection stable', () => {
    expect(workflowRunsToJson([meta({ runId: 'wf_a' }), meta({ runId: 'wf_b' })]).map(run => run.id)).toEqual([
      'wf_a',
      'wf_b',
    ])
  })

  test('renders a Markdown report from the workflow protocol', () => {
    const report = renderWorkflowReport(workflowRunToJson(meta({
      failures: ['validator failed'],
    })), { log: ['phase: Scan', 'done'] })

    expect(report).toContain('# Workflow Report: Repo audit')
    expect(report).toContain('- Run ID: wf_run_123')
    expect(report).toContain('- Parent goal: goal_run_123')
    expect(report).toContain('## Progress Tree')
    expect(report).toContain('- [running] phase: Scan')
    expect(report).toContain('## Verification Evidence')
    expect(report).toContain('- State: failed')
    expect(report).toContain('## Failures')
    expect(report).toContain('- validator failed')
    expect(report).toContain('```text')
    expect(report).toContain('phase: Scan')
  })

  test('extracts structured verification evidence from workflow results', () => {
    const run = workflowRunToJson(meta({
      status: 'completed',
      result: JSON.stringify({
        summary: 'All migration checks passed.',
        verification: {
          commands: ['bun test packages/app'],
          artifacts: ['./reports/migration.md'],
          evidence: ['No failing assertions remain.'],
        },
      }),
    }))

    expect(run.verification).toMatchObject({
      state: 'completed',
      evidence: expect.arrayContaining([
        'All migration checks passed.',
        'No failing assertions remain.',
      ]),
      commands: ['bun test packages/app'],
      artifacts: expect.arrayContaining([
        expect.stringContaining('report.md'),
        './reports/migration.md',
      ]),
      failures: [],
    })
    expect(run.reportPath).toContain('report.md')
    expect(run.artifacts).toEqual(run.verification.artifacts)
    expect(
      run.tree.children.some(
        node =>
          node.kind === 'verification' &&
          node.state === 'completed' &&
          node.resultSummary === 'All migration checks passed.',
      ),
    ).toBe(true)
  })

  test('marks completed workflows without explicit evidence as ready for review', () => {
    expect(
      buildWorkflowVerificationSummary({
        state: 'completed',
        result: undefined,
      }),
    ).toMatchObject({
      state: 'ready',
      summary: 'No explicit verification evidence captured',
      evidence: [],
    })
  })
})
