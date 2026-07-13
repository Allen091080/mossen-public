import { describe, expect, test } from 'bun:test'
import { Console } from 'node:console'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import {
  getProjectRoot,
  getSessionId,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import { getMossenConfigHomeDir } from '../../../utils/envUtils.js'
import {
  clearActiveWorkflowRunsForTests,
  initRunArtifacts,
  type WorkflowRunMeta,
} from '../../../tools/WorkflowTool/engine/journalStore.js'
import { getProjectWorkflowsDir } from '../../../tools/WorkflowTool/savedWorkflows.js'
import {
  buildWorkflowProgressTree,
  buildWorkflowVerificationSummary,
  buildWorkflowTree,
  workflowRunToJson,
  workflowRunsToJson,
  workflowStatusToMachineState,
} from '../../../commands/workflows/workflowProgressTree.js'
import { recordWorkbenchWorkflowActionReceipt } from '../../../commands/workflows/workbenchActionReceipts.js'
import { renderWorkflowReport } from '../../../commands/workflows/exportWorkflowReport.js'
import {
  workflowHandler,
  workflowsHandler,
} from '../workflows.js'

function resetConfigHomeMemo(): void {
  getMossenConfigHomeDir.cache.clear?.()
}

function captureStream(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk ?? ''))
      callback()
    },
  })
}

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
        state: 'queued',
        summary: 'Verification evidence pending',
        evidence: [],
        commands: [],
        artifacts: [expect.stringContaining('report.md')],
        failures: [],
      },
      artifacts: expect.arrayContaining([
        expect.stringContaining('report.md'),
        expect.stringContaining('checkpoint.json'),
      ]),
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
            state: 'queued',
            resultSummary: 'Verification evidence pending',
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

describe('workflow CLI handlers', () => {
  test('can read workflow runs from an explicit session id', async () => {
    const priorSession = getSessionId()
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'workflow-cli-session-'))
    const targetSession =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ReturnType<typeof getSessionId>
    const runId = 'wf_cli_session_lookup'
    const logs: string[] = []
    const errors: string[] = []
    const priorConsole = globalThis.console
    const priorStdout = process.stdout

    try {
      process.env.MOSSEN_CONFIG_DIR = join(root, '.mossen')
      resetConfigHomeMemo()
      switchSession(targetSession)
      initRunArtifacts(runId, 'return "ok"', {
        ...meta({
          runId,
          workflowName: 'cli-session-flow',
          title: 'CLI session flow',
          status: 'completed',
        }),
      })
      switchSession('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as ReturnType<typeof getSessionId>)

      const stdout = captureStream(logs)
      Object.defineProperty(process, 'stdout', {
        value: stdout,
        configurable: true,
      })
      globalThis.console = new Console({
        stdout,
        stderr: captureStream(errors),
      }) as unknown as typeof globalThis.console

      await workflowsHandler({ json: true, sessionId: targetSession })
      await workflowHandler(runId, { json: true, sessionId: targetSession })

      expect(errors).toEqual([])
      expect(logs.join('\n')).toContain(runId)
      expect(logs.join('\n')).toContain('cli-session-flow')
    } finally {
      Object.defineProperty(process, 'stdout', {
        value: priorStdout,
        configurable: true,
      })
      globalThis.console = priorConsole
      switchSession(priorSession)
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      resetConfigHomeMemo()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('emits a Workbench workflow snapshot with registry, controls, and goal evidence', async () => {
    const priorSession = getSessionId()
    const priorProjectRoot = getProjectRoot()
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'workflow-workbench-snapshot-'))
    const projectRoot = join(root, 'project')
    const targetSession =
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as ReturnType<typeof getSessionId>
    const logs: string[] = []
    const errors: string[] = []
    const priorConsole = globalThis.console
    const priorStdout = process.stdout

    try {
      process.env.MOSSEN_CONFIG_DIR = join(root, '.mossen')
      resetConfigHomeMemo()
      mkdirSync(getProjectWorkflowsDir(projectRoot), { recursive: true })
      writeFileSync(
        join(getProjectWorkflowsDir(projectRoot), 'project-flow.js'),
        `export const meta = {
  name: 'project-flow',
  description: 'Project workflow for Workbench snapshot tests',
  budgets: { timeoutMs: 60000, phaseTimeoutMs: 10000, maxAgents: 2, maxParallel: 1, maxNestedWorkflows: 0 },
  allowedTools: ['Read'],
  allowedRoots: ['.'],
  allowedHosts: [],
  evidence: { finalReport: true, validationCommands: ['bun test cli/handlers/__tests__/workflows.test.ts'], artifacts: ['./reports/project-flow.md'] },
  lifecycle: { version: '0.1.0', owner: 'test', status: 'tested', lastTestArtifact: './reports/project-flow.md' },
  phases: [{ title: 'Plan', detail: 'Plan the work' }, { title: 'Verify', detail: 'Check evidence' }],
}
return { summary: 'ok' }
`,
        'utf8',
      )

      setProjectRoot(projectRoot)
      switchSession(targetSession)
      initRunArtifacts('wf_snapshot_completed', 'return "completed"', {
        ...meta({
          runId: 'wf_snapshot_completed',
          workflowName: 'project-flow',
          status: 'completed',
          parentGoalId: 'goal_snapshot',
          result: JSON.stringify({
            summary: 'Artifact reviewed.',
            verification: {
              evidence: ['Artifact reviewed.'],
              commands: ['bun test cli/handlers/__tests__/workflows.test.ts'],
              artifacts: ['./reports/project-flow.md'],
            },
          }),
        }),
      })
      initRunArtifacts('wf_snapshot_running', 'return "running"', {
        ...meta({
          runId: 'wf_snapshot_running',
          workflowName: 'running-flow',
          status: 'running',
          parentGoalId: null,
        }),
      })
      initRunArtifacts('wf_snapshot_resumable', 'return "resumable"', {
        ...meta({
          runId: 'wf_snapshot_resumable',
          workflowName: 'resumable-flow',
          status: 'killed',
          parentGoalId: 'goal_snapshot',
          scriptPath: undefined,
        }),
      })
      recordWorkbenchWorkflowActionReceipt({
        actionId: 'workflow.run.pause',
        status: 'accepted',
        input: '/workflows pause wf_snapshot_running',
        runId: 'wf_snapshot_running',
        workflowName: 'running-flow',
        message: 'Workflow wf_snapshot_running paused.',
        source: 'workbench',
        createdAt: '2026-06-12T08:01:00.000Z',
      })

      const stdout = captureStream(logs)
      Object.defineProperty(process, 'stdout', {
        value: stdout,
        configurable: true,
      })
      globalThis.console = new Console({
        stdout,
        stderr: captureStream(errors),
      }) as unknown as typeof globalThis.console

      await workflowsHandler({
        json: true,
        workbench: true,
        sessionId: targetSession,
      })

      const snapshot = JSON.parse(logs.join(''))
      const projectAsset = snapshot.registry.assets.find(
        (asset: { name: string }) => asset.name === 'project-flow',
      )
      const completedRun = snapshot.runs.items.find(
        (run: { runId: string }) => run.runId === 'wf_snapshot_completed',
      )
      const resumableRun = snapshot.runs.items.find(
        (run: { runId: string }) => run.runId === 'wf_snapshot_resumable',
      )
      const goalLink = snapshot.goalLinks.find(
        (link: { goalId: string }) => link.goalId === 'goal_snapshot',
      )

      expect(errors).toEqual([])
      expect(snapshot).toMatchObject({
        version: 1,
        surface: 'workbench-workflows',
        summary: {
          runs: 3,
          running: 1,
          completed: 1,
          cancelled: 1,
          goalLinkedRuns: 2,
          goalLinks: 1,
          actionReceipts: 1,
        },
      })
      expect(snapshot.registry.actions.map((action: { id: string }) => action.id)).toContain(
        'workflow.registry.create',
      )
      expect(projectAsset).toMatchObject({
        validation: { ok: true },
        lifecycle: {
          status: 'tested',
          lastTestArtifact: './reports/project-flow.md',
        },
      })
      expect(
        projectAsset.actions.find(
          (action: { id: string }) => action.id === 'workflow.asset.deprecate',
        ),
      ).toMatchObject({
        available: false,
        reason: 'no stable workflow deprecate command exists yet',
      })
      expect(completedRun.verification.evidence).toContain('Artifact reviewed.')
      expect(
        resumableRun.controls.find(
          (action: { id: string }) => action.id === 'workflow.run.resume',
        ),
      ).toMatchObject({
        available: true,
        input: '/workflows resume wf_snapshot_resumable',
      })
      expect(goalLink).toMatchObject({
        goalId: 'goal_snapshot',
        runIds: ['wf_snapshot_resumable', 'wf_snapshot_completed'],
      })
      expect(goalLink.evidence).toContain('Artifact reviewed.')
      expect(goalLink.artifacts).toEqual(
        expect.arrayContaining(['./reports/project-flow.md']),
      )
      expect(snapshot.actionReceipts.items).toMatchObject([
        {
          actionId: 'workflow.run.pause',
          status: 'accepted',
          input: '/workflows pause wf_snapshot_running',
          runId: 'wf_snapshot_running',
          workflowName: 'running-flow',
          message: 'Workflow wf_snapshot_running paused.',
        },
      ])
    } finally {
      Object.defineProperty(process, 'stdout', {
        value: priorStdout,
        configurable: true,
      })
      globalThis.console = priorConsole
      clearActiveWorkflowRunsForTests()
      setProjectRoot(priorProjectRoot)
      switchSession(priorSession)
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      resetConfigHomeMemo()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
