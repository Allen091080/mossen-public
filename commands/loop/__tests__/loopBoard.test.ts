import { describe, expect, test } from 'bun:test'
import { createTaskStateBase } from '../../../Task.js'
import type { LocalWorkflowTaskState } from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  resetStateForTests,
  setSessionGoalState,
  type MossenGoalState,
} from '../../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../../types/command.js'
import type { WorkflowRunMeta } from '../../../tools/WorkflowTool/engine/journalStore.js'
import {
  buildLoopBoard,
  renderLoopBoard,
  renderLoopBoardJson,
  type LoopBoardProviderGate,
} from '../loopBoard.js'
import { call } from '../loop.js'

const NOW = Date.parse('2026-07-06T00:00:00.000Z')

function goal(overrides: Partial<MossenGoalState> = {}): MossenGoalState {
  return {
    id: 'goal_loop_board',
    text: 'Ship unified loop board',
    recentEvidence: [],
    negativeEvidence: [],
    blockerHistory: [],
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    evaluatorModel: 'haiku',
    turnBudget: 20,
    turnCount: 2,
    tokenEstimate: 100,
    evaluationFailureCount: 0,
    status: 'active',
    ...overrides,
  }
}

function workflowTask(
  status: LocalWorkflowTaskState['status'],
  overrides: Partial<LocalWorkflowTaskState> = {},
): LocalWorkflowTaskState {
  const id = overrides.id ?? `task_${status}`
  const runId = overrides.workflowRunId ?? `wf_${status}`
  return {
    ...createTaskStateBase(id, 'local_workflow', `${status} workflow`),
    type: 'local_workflow',
    status,
    runId,
    workflowRunId: runId,
    workflowName: `${status}-workflow`,
    scriptPath: `/tmp/mossen/${runId}/script.js`,
    transcriptDir: `/tmp/mossen/${runId}/transcripts`,
    parentGoalId: 'goal_loop_board',
    isBackgrounded: true,
    abortController: status === 'running' ? new AbortController() : undefined,
    agentCount: 1,
    totalToolCalls: 1,
    tokensSpent: 10,
    phases: ['Plan'],
    phaseDefinitions: [{ title: 'Plan', detail: 'Plan work' }],
    workflowProgress: [],
    progressVersion: 0,
    agents: [
      {
        agentNumber: 1,
        label: 'planner',
        phase: 'Plan',
        status:
          status === 'failed'
            ? 'failed'
            : status === 'completed'
              ? 'completed'
              : 'running',
        tokens: 10,
        toolCalls: 1,
        lastProgressAt: NOW,
        transcriptPath: `/tmp/mossen/${runId}/agent.jsonl`,
      },
    ],
    log: ['started'],
    logs: ['started'],
    ...overrides,
  }
}

function runMeta(
  status: WorkflowRunMeta['status'],
  overrides: Partial<WorkflowRunMeta> = {},
): WorkflowRunMeta {
  return {
    runId: overrides.runId ?? `wf_${status}`,
    workflowName: overrides.workflowName ?? `${status}-workflow`,
    description: `${status} workflow`,
    createdAt: '2026-07-06T00:00:00.000Z',
    status,
    parentGoalId: 'goal_loop_board',
    phases: [{ title: 'Plan', detail: 'Plan work' }],
    agentCount: 1,
    totalToolCalls: 1,
    tokensSpent: 10,
    ...overrides,
  }
}

const gates: LoopBoardProviderGate[] = [
  {
    id: 'provider-key',
    label: 'Provider key',
    status: 'missing',
    envName: 'MOSSEN_W472_REAL_API_KEY_ENV',
    nextAction: 'configure env var',
  },
  {
    id: 'release-artifact',
    label: 'Release artifact',
    status: 'passed',
    artifactPath: '/tmp/mossen-harness/release/artifacts/assertions.json',
  },
]

describe('buildLoopBoard', () => {
  test('surfaces active and paused live workflows with next actions', () => {
    const active = workflowTask('running', {
      id: 'task_active',
      workflowRunId: 'wf_active',
    })
    const paused = workflowTask('paused', {
      id: 'task_paused',
      workflowRunId: 'wf_paused',
    })
    const board = buildLoopBoard({
      goal: goal(),
      tasks: { [active.id]: active, [paused.id]: paused },
      runs: [],
      now: NOW,
      providerGates: gates,
    })

    expect(board.liveness.verdict).toBe('wait')
    expect(board.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'wf_active',
          state: 'active',
          nextAction: 'wait',
          attachedToGoal: true,
        }),
        expect.objectContaining({
          runId: 'wf_paused',
          state: 'paused',
          nextAction: 'resume',
          attachedToGoal: true,
        }),
      ]),
    )
  })

  test('surfaces stale and failed live workflows', () => {
    const stale = workflowTask('running', {
      id: 'task_stale',
      workflowRunId: 'wf_stale',
      abortController: undefined,
      agents: [],
    })
    const failed = workflowTask('failed', {
      id: 'task_failed',
      workflowRunId: 'wf_failed',
      failures: ['terminal failure'],
    })
    const board = buildLoopBoard({
      goal: goal(),
      tasks: { [stale.id]: stale, [failed.id]: failed },
      runs: [],
      now: NOW,
      providerGates: gates,
    })

    expect(board.liveness.verdict).toBe('stale')
    expect(board.nextAction).toBe('/goal doctor')
    expect(board.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'wf_stale',
          state: 'stale',
          staleRisk: true,
          issue: 'missing_controller',
          nextAction: 'inspect',
        }),
        expect.objectContaining({
          runId: 'wf_failed',
          state: 'failed',
          nextAction: 'review_failure',
        }),
      ]),
    )
  })

  test('distinguishes completed from unverifiable persisted runs', () => {
    const completed = runMeta('completed', {
      runId: 'wf_completed',
      workflowName: 'completed-workflow',
      result: JSON.stringify({
        summary: 'verified',
        verification: {
          evidence: ['unit tests passed'],
          commands: ['bun test commands/loop/__tests__/loopBoard.test.ts'],
          artifacts: ['/tmp/wf/final-report.json'],
        },
      }),
      finalReportPath: '/tmp/wf/final-report.json',
    })
    const unverifiable = runMeta('completed', {
      runId: 'wf_unverifiable',
      workflowName: 'unverifiable-workflow',
      result: 'All checks passed.',
    })
    const board = buildLoopBoard({
      goal: goal(),
      tasks: {},
      runs: [completed, unverifiable],
      now: NOW,
      providerGates: gates,
    })

    expect(board.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'wf_completed',
          state: 'completed',
          validationCommand:
            'bun test commands/loop/__tests__/loopBoard.test.ts',
          nextAction: 'none',
        }),
        expect.objectContaining({
          runId: 'wf_unverifiable',
          state: 'unverifiable',
          nextAction: 'verify',
        }),
      ]),
    )
    expect(board.nextAction).toBe('verify workflow evidence before completion')
  })

  test('renders human and JSON board output with provider gates and diagnostics', () => {
    const board = buildLoopBoard({
      goal: goal({ nextPlan: 'run board smoke' }),
      tasks: {},
      runs: [
        runMeta('failed', {
          runId: 'wf_failed_history',
          workflowName: 'failed-history',
          failures: ['boom'],
        }),
      ],
      now: NOW,
      providerGates: gates,
    })
    const text = renderLoopBoard(board)
    const parsed = JSON.parse(renderLoopBoardJson(board)) as ReturnType<
      typeof buildLoopBoard
    >

    expect(text).toContain('Loop board')
    expect(text).toContain('Provider gates:')
    expect(text).toContain('Process diagnostics: read-only')
    expect(text).toContain('/goal doctor')
    expect(text).toContain('failed-history')
    expect(parsed.version).toBe(1)
    expect(parsed.providerGates[0]?.status).toBe('missing')
    expect(parsed.processDiagnostics.mode).toBe('read-only')
  })

  test('/loop status --json routes through the command entry', async () => {
    resetStateForTests()
    const activeGoal = setSessionGoalState('ship loop status command')
    const task = workflowTask('running', {
      id: 'task_loop_command',
      workflowRunId: 'wf_loop_command',
      parentGoalId: activeGoal.id,
    })
    let result = ''

    await call(
      nextResult => {
        result = nextResult ?? ''
      },
      {
        getAppState: () => ({ tasks: { [task.id]: task } }),
      } as unknown as LocalJSXCommandContext,
      'status --json',
    )

    const board = JSON.parse(result) as {
      version: number
      goal: { id: string }
      workflows: Array<{ runId: string }>
    }
    expect(board.version).toBe(1)
    expect(board.goal.id).toBe(activeGoal.id)
    expect(board.workflows[0]?.runId).toBe('wf_loop_command')
  })
})
