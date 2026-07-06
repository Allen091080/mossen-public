import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addToTotalCostState,
  getSessionGoalState,
  pauseSessionGoalState,
  resetStateForTests,
  setSessionGoalState,
} from '../../bootstrap/state.js'
import { createTaskStateBase, type TaskStatus, type TaskType } from '../../Task.js'
import type { DreamTaskState } from '../../tasks/DreamTask/DreamTask.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { MonitorMcpTaskState } from '../../tasks/MonitorMcpTask/MonitorMcpTask.js'
import type { RemoteAgentTaskState, TaskState } from '../../tasks/types.js'
import {
  enqueueSessionGoalContinuation,
  evaluateSessionGoalRuntimeAfterTurn,
  getSessionGoalPendingWorkReason,
  getSessionGoalTaskBudgetForRequest,
  getSessionGoalTerminalNotificationEvidence,
  getSessionGoalTerminalWorkEvidence,
  getSessionGoalTerminalWorkNegativeEvidence,
} from '../sessionGoalRuntime.js'
import type { AppState } from '../../state/AppState.js'
import { registerDreamTask } from '../../tasks/DreamTask/DreamTask.js'
import { registerAsyncAgent } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { registerWorkflowTask } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { registerRemoteAgentTask } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import { registerTask } from '../task/framework.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'

function createTaskHarness(): {
  get state(): AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
} {
  let state = { tasks: {} } as unknown as AppState
  return {
    get state() {
      return state
    },
    setAppState(updater) {
      state = updater(state)
    },
  }
}

function baseTask<T extends TaskType>(
  id: string,
  type: T,
  status: TaskStatus = 'running',
) {
  return {
    ...createTaskStateBase(id, type, `${type} task`),
    status,
  }
}

function localShellTask(status: TaskStatus = 'running'): LocalShellTaskState {
  return {
    ...baseTask('bash_1', 'local_bash', status),
    type: 'local_bash',
    command: 'bun test',
    completionStatusSentInAttachment: false,
    shellCommand: null,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
  }
}

function localAgentTask(status: TaskStatus = 'running'): LocalAgentTaskState {
  return {
    ...baseTask('agent_1', 'local_agent', status),
    type: 'local_agent',
    agentId: 'agent_1',
    prompt: 'review the goal implementation',
    agentType: 'subagent',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
  }
}

function remoteAgentTask(status: TaskStatus = 'running'): RemoteAgentTaskState {
  return {
    ...baseTask('remote_1', 'remote_agent', status),
    type: 'remote_agent',
    title: 'remote agent',
    isBackgrounded: true,
  }
}

function teammateTask(status: TaskStatus = 'running'): InProcessTeammateTaskState {
  return {
    ...baseTask('teammate_1', 'in_process_teammate', status),
    type: 'in_process_teammate',
    identity: {
      agentId: 'worker@test',
      agentName: 'worker',
      teamName: 'test',
      planModeRequired: false,
      parentSessionId: 'session_1',
    },
    prompt: 'finish the delegated work',
    awaitingPlanApproval: false,
    permissionMode: 'default',
    pendingUserMessages: [],
    isIdle: false,
    shutdownRequested: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
  }
}

function localWorkflowTask(
  status: TaskStatus = 'running',
): LocalWorkflowTaskState {
  return {
    ...baseTask('workflow_1', 'local_workflow', status),
    type: 'local_workflow',
    runId: 'workflow_run_1',
    workflowRunId: 'workflow_run_1',
    workflowName: 'goal-verification',
    isBackgrounded: true,
    agentCount: 0,
    totalToolCalls: 0,
    tokensSpent: 0,
    phases: [],
    workflowProgress: [],
    progressVersion: 0,
    agents: [],
    log: [],
    logs: [],
  }
}

function writeWorkflowFinalReport(
  patch: Record<string, unknown>,
): { path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'goal-final-report-'))
  const path = join(root, 'final-report.json')
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      runId: 'workflow_run_1',
      workflowName: 'goal-verification',
      status: 'completed',
      evidenceState: 'needs_verification',
      summary: 'summary only',
      evidence: [],
      validationCommands: [],
      artifacts: [],
      failures: [],
      openQuestions: [],
      reportPath: path,
      resultPreview: 'summary only',
      generatedAt: '2026-07-06T00:00:00.000Z',
      ...patch,
    }, null, 2),
    'utf8',
  )
  return { path, root }
}

function monitorMcpTask(status: TaskStatus = 'running'): MonitorMcpTaskState {
  return {
    ...baseTask('mcp_1', 'monitor_mcp', status),
    type: 'monitor_mcp',
    isBackgrounded: true,
  }
}

function dreamTask(status: TaskStatus = 'running'): DreamTaskState {
  return {
    ...baseTask('dream_1', 'dream', status),
    type: 'dream',
    phase: 'starting',
    sessionsReviewing: 1,
    filesTouched: [],
    turns: [],
    priorMtime: Date.now(),
  }
}

function realTaskFixtures(status: TaskStatus = 'running'): TaskState[] {
  return [
    localShellTask(status),
    localAgentTask(status),
    remoteAgentTask(status),
    teammateTask(status),
    localWorkflowTask(status),
    monitorMcpTask(status),
    dreamTask(status),
  ]
}

async function runtimeActionForTasks(tasks: AppState['tasks']) {
  setSessionGoalState('wait for registered background work before evaluating')
  const result = await evaluateSessionGoalRuntimeAfterTurn({
    messages: [],
    signal: new AbortController().signal,
    tasks,
  })
  return result.action.type
}

beforeEach(() => {
  resetStateForTests()
})

describe('getSessionGoalTaskBudgetForRequest', () => {
  test('returns undefined outside goal continuation workload', () => {
    setSessionGoalState('budget only applies to goal continuations', undefined, {
      tokenBudget: 100,
    })

    expect(getSessionGoalTaskBudgetForRequest(undefined)).toBeUndefined()
    expect(getSessionGoalTaskBudgetForRequest('human')).toBeUndefined()
  })

  test('returns remaining actual token budget for active goal continuations', () => {
    setSessionGoalState('continue with server-side task budget', undefined, {
      tokenBudget: 100,
    })
    addToTotalCostState(
      0,
      {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 2,
      },
      'test-model',
    )

    expect(getSessionGoalTaskBudgetForRequest('goal')).toEqual({
      total: 100,
      remaining: 70,
    })
  })

  test('does not expose task budget after the goal is paused', () => {
    setSessionGoalState('paused goals do not get continuation budget', undefined, {
      tokenBudget: 100,
    })
    pauseSessionGoalState('waiting for user')

    expect(getSessionGoalTaskBudgetForRequest('goal')).toBeUndefined()
  })
})

describe('getSessionGoalPendingWorkReason', () => {
  test('defers for every active concrete background task state', () => {
    for (const status of ['pending', 'running', 'paused'] as const) {
      for (const task of realTaskFixtures(status)) {
        expect(
          getSessionGoalPendingWorkReason({ [task.id]: task }),
          `${task.type} ${status}`,
        ).toBeTruthy()
      }
    }
  })

  test('ignores terminal concrete background task states', () => {
    for (const status of ['completed', 'failed', 'killed'] as const) {
      for (const task of realTaskFixtures(status)) {
        expect(
          getSessionGoalPendingWorkReason({ [task.id]: task }),
          `${task.type} ${status}`,
        ).toBeNull()
      }
    }
  })

  test('summarizes terminal workflow and agent failures for goal evidence', () => {
    const workflow = localWorkflowTask('failed')
    workflow.error = 'validator failed'
    workflow.failures = ['bun test failed']
    const agent = localAgentTask('killed')

    expect(
      getSessionGoalTerminalWorkNegativeEvidence({
        workflow_1: workflow,
        agent_1: agent,
      }),
    ).toEqual([
      'Workflow goal-verification (workflow_run_1) ended failed: validator failed',
      'Agent task local_agent task (agent_1) ended killed: no failure detail captured',
    ])
  })

  test('summarizes completed workflow output for goal evidence', () => {
    const workflow = localWorkflowTask('completed')
    workflow.agentCount = 3
    workflow.totalToolCalls = 9
    workflow.tokensSpent = 1234
    workflow.result = 'verification passed; report written to workflow report.md'
    workflow.scriptPath = '/repo/.mossen/workflows/wf_goal/script.js'

    expect(getSessionGoalTerminalWorkEvidence({ workflow_1: workflow })).toEqual([
      'Workflow goal-verification (workflow_run_1) completed, 3 agent(s), 9 tool call(s), 1234 token(s); result: verification passed; report written to workflow report.md; artifact: /repo/.mossen/workflows/wf_goal/script.js',
    ])
  })

  test('summarizes completed workflow task notifications for goal evidence', () => {
    const result = getSessionGoalTerminalNotificationEvidence([
      {
        type: 'user',
        origin: { kind: 'task-notification' },
        message: {
          content: [
            {
              type: 'text',
              text: `<task-notification>
<task-id>wf_1</task-id>
<task-type>local_workflow</task-type>
<output-file>/tmp/wf_1.output</output-file>
<status>completed</status>
<summary>Workflow "goal evidence" completed</summary>
<result>{"summary":"checks passed"}</result>
</task-notification>`,
            },
          ],
        },
      },
    ])

    expect(result.positive).toEqual([
      'Workflow "goal evidence" completed; result: {"summary":"checks passed"}; artifact: /tmp/wf_1.output',
    ])
    expect(result.negative).toEqual([])
  })

  test('does not treat completed workflows with failures as positive evidence', () => {
    const workflow = localWorkflowTask('completed')
    workflow.failures = ['verification gap remained']
    workflow.result = 'partial result'

    expect(getSessionGoalTerminalWorkEvidence({ workflow_1: workflow })).toEqual([])
  })

  test('records terminal workflow failures before goal completion evaluation', async () => {
    setSessionGoalState('failed workflow must block goal completion', undefined, {
      maxDurationSec: 0,
    })
    const workflow = localWorkflowTask('failed')
    workflow.error = 'validator failed'

    const result = await evaluateSessionGoalRuntimeAfterTurn({
      messages: [],
      signal: new AbortController().signal,
      tasks: { workflow_1: workflow },
    })

    expect(result.action.type).toBe('max_turns')
    expect(getSessionGoalState()?.negativeEvidence).toContain(
      'Workflow goal-verification (workflow_run_1) ended failed: validator failed',
    )
  })

  test('records completed workflow evidence before goal completion evaluation', async () => {
    setSessionGoalState('workflow completion should become goal evidence', undefined, {
      maxDurationSec: 0,
    })
    const workflow = localWorkflowTask('completed')
    workflow.agentCount = 2
    workflow.totalToolCalls = 4
    workflow.tokensSpent = 500
    workflow.result = 'all acceptance checks passed'

    const result = await evaluateSessionGoalRuntimeAfterTurn({
      messages: [],
      signal: new AbortController().signal,
      tasks: { workflow_1: workflow },
    })

    expect(result.action.type).toBe('max_turns')
    expect(getSessionGoalState()?.recentEvidence).toContain(
      'Workflow goal-verification (workflow_run_1) completed, 2 agent(s), 4 tool call(s), 500 token(s); result: all acceptance checks passed',
    )
  })

  test('records verified workflow final reports as goal evidence', async () => {
    const report = writeWorkflowFinalReport({
      evidenceState: 'verified',
      summary: 'verified by unit test',
      evidence: ['unit test passed'],
      validationCommands: ['bun test utils/__tests__/sessionGoalRuntime.test.ts'],
      artifacts: ['/tmp/workflow/artifact.json'],
    })
    try {
      setSessionGoalState('workflow final report should become goal evidence', undefined, {
        maxDurationSec: 0,
      })
      const workflow = localWorkflowTask('completed')
      workflow.result = 'summary should not be the evidence source'
      workflow.finalReportPath = report.path

      const result = await evaluateSessionGoalRuntimeAfterTurn({
        messages: [],
        signal: new AbortController().signal,
        tasks: { workflow_1: workflow },
      })

      expect(result.action.type).toBe('max_turns')
      expect(getSessionGoalState()?.recentEvidence).toContain(
        `Workflow goal-verification (workflow_run_1) completed with verified final report; evidence: unit test passed; validation: bun test utils/__tests__/sessionGoalRuntime.test.ts; artifact: /tmp/workflow/artifact.json; report: ${report.path}`,
      )
    } finally {
      rmSync(report.root, { recursive: true, force: true })
    }
  })

  test('records summary-only workflow final reports as negative evidence', async () => {
    const report = writeWorkflowFinalReport({
      evidenceState: 'needs_verification',
      summary: 'summary only',
      missingChecks: ['no command output captured'],
    })
    try {
      setSessionGoalState('summary-only workflow must not complete goal', undefined, {
        maxDurationSec: 0,
      })
      const workflow = localWorkflowTask('completed')
      workflow.result = 'everything is done'
      workflow.finalReportPath = report.path

      const result = await evaluateSessionGoalRuntimeAfterTurn({
        messages: [],
        signal: new AbortController().signal,
        tasks: { workflow_1: workflow },
      })

      expect(result.action.type).toBe('max_turns')
      expect(getSessionGoalState()?.recentEvidence).toEqual([])
      expect(getSessionGoalState()?.negativeEvidence).toContain(
        `Workflow goal-verification (workflow_run_1) needs verification: missing checks: no command output captured; report: ${report.path}`,
      )
    } finally {
      rmSync(report.root, { recursive: true, force: true })
    }
  })

  test('defers the runtime before evaluator when real workflow work is active', async () => {
    const goal = setSessionGoalState('wait for workflow work before evaluating')
    const workflow = localWorkflowTask()
    workflow.parentGoalId = goal.id

    const result = await evaluateSessionGoalRuntimeAfterTurn({
      messages: [],
      signal: new AbortController().signal,
      tasks: { workflow_1: workflow },
    })
    const stateGoal = getSessionGoalState()

    expect(result.action.type).toBe('wait_for_workflow')
    expect(stateGoal?.status).toBe('active')
    expect(stateGoal?.lastEvaluatorStatus).toBe('deferred')
    expect(result.events.map(event => event.type)).toContain('goal_eval')
  })

  test('launches a workflow policy continuation for broad goals without workflow evidence', async () => {
    setSessionGoalState(
      '根据 docs/upgrade/W473-loop-os-goal-workflow-plan-2026-07-06.md 的内容，实现目标',
    )

    const result = await evaluateSessionGoalRuntimeAfterTurn({
      messages: [],
      signal: new AbortController().signal,
      tasks: {},
    })

    expect(result.action.type).toBe('launch_workflow')
    if (result.action.type !== 'launch_workflow') {
      throw new Error('expected launch_workflow action')
    }
    expect(result.action.prompt).toContain('<session-goal-workflow-launch>')
    expect(result.action.prompt).toContain('Workflow({ task: <workflow_task> })')
    expect(result.events[0]?.type).toBe('goal_eval')
    expect(result.events[0]?.type === 'goal_eval'
      ? result.events[0].verdict
      : null).toBe('launch_workflow')
    expect(getSessionGoalState()?.nextPlan).toContain('Launch Workflow')
  })

  test('queues launch workflow actions as goal continuations', () => {
    const enqueued: unknown[] = []
    enqueueSessionGoalContinuation(
      {
        type: 'launch_workflow',
        reason: 'Goal is workflow-scale.',
        prompt: '<session-goal-workflow-launch />',
        task: 'workflow task',
        event: {
          type: 'goal_eval',
          goalId: 'goal_1',
          verdict: 'launch_workflow',
          reason: 'Goal is workflow-scale.',
          turnsUsed: 1,
          turnBudget: 20,
          tokensUsed: 0,
          evaluatedAt: '2026-07-06T00:00:00.000Z',
        },
      },
      {
        enqueue: command => enqueued.push(command),
        removeByFilter: () => {},
        workload: 'goal',
      },
    )

    expect(enqueued).toMatchObject([
      {
        mode: 'prompt',
        value: '<session-goal-workflow-launch />',
        isMeta: true,
        skipSlashCommands: true,
        priority: 'later',
        workload: 'goal',
      },
    ])
  })

  test('defers for tasks written by concrete registration paths', async () => {
    const workflowHarness = createTaskHarness()
    registerWorkflowTask({
      taskId: 'workflow_registered_1',
      runId: 'workflow_run_registered_1',
      workflowRunId: 'workflow_run_registered_1',
      workflowName: 'goal-runtime-registration',
      description: 'registered workflow',
      script: 'export const meta = {}',
      abortController: new AbortController(),
      setAppState: workflowHarness.setAppState,
    })
    expect(await runtimeActionForTasks(workflowHarness.state.tasks)).toBe(
      'deferred',
    )

    resetStateForTests()
    const remoteHarness = createTaskHarness()
    registerRemoteAgentTask(
      {
        taskId: 'remote_registered_1',
        sessionId: 'session_remote_registered_1',
        title: 'remote registered',
        description: 'registered remote agent',
        remoteTaskType: 'remote-agent',
        setAppState: remoteHarness.setAppState,
      },
      { writeMetadata: async () => {} },
    )
    expect(await runtimeActionForTasks(remoteHarness.state.tasks)).toBe(
      'deferred',
    )

    resetStateForTests()
    const dreamHarness = createTaskHarness()
    registerDreamTask(dreamHarness.setAppState, {
      sessionsReviewing: 1,
      priorMtime: Date.now(),
      abortController: new AbortController(),
    })
    expect(await runtimeActionForTasks(dreamHarness.state.tasks)).toBe(
      'deferred',
    )

    resetStateForTests()
    const agentHarness = createTaskHarness()
    const selectedAgent: AgentDefinition = {
      agentType: 'goal-test-agent',
      whenToUse: 'goal runtime registration test',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => 'You are a test agent.',
    }
    registerAsyncAgent({
      agentId: 'agent_registered_1',
      description: 'registered local agent',
      prompt: 'inspect goal runtime',
      selectedAgent,
      setAppState: agentHarness.setAppState,
    })
    expect(await runtimeActionForTasks(agentHarness.state.tasks)).toBe(
      'deferred',
    )

    resetStateForTests()
    const mcpHarness = createTaskHarness()
    registerTask(monitorMcpTask(), mcpHarness.setAppState)
    expect(await runtimeActionForTasks(mcpHarness.state.tasks)).toBe(
      'deferred',
    )
  })
})
