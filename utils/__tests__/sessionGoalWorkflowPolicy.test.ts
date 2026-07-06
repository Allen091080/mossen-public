import { describe, expect, test } from 'bun:test'
import type { MossenGoalState } from '../../bootstrap/state.js'
import { createTaskStateBase } from '../../Task.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  buildSessionGoalWorkflowTask,
  evaluateSessionGoalWorkflowPolicy,
} from '../sessionGoalWorkflowPolicy.js'

function goal(patch: Partial<MossenGoalState> = {}): MossenGoalState {
  return {
    id: 'goal-policy-1',
    text: 'Ship the implementation',
    recentEvidence: [],
    negativeEvidence: [],
    blockerHistory: [],
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    evaluatorModel: 'haiku',
    turnBudget: 20,
    turnCount: 1,
    evaluationFailureCount: 0,
    status: 'active',
    ...patch,
  }
}

function workflowTask(
  patch: Partial<LocalWorkflowTaskState> = {},
): LocalWorkflowTaskState {
  return {
    ...createTaskStateBase('workflow-policy-1', 'local_workflow', 'policy wf'),
    type: 'local_workflow',
    status: 'running',
    runId: 'wf_policy_1',
    workflowRunId: 'wf_policy_1',
    workflowName: 'policy-workflow',
    parentGoalId: 'goal-policy-1',
    scriptPath: '/tmp/wf_policy_1/script.js',
    isBackgrounded: true,
    abortController: new AbortController(),
    agentCount: 0,
    totalToolCalls: 0,
    tokensSpent: 0,
    phases: [],
    workflowProgress: [],
    progressVersion: 0,
    agents: [],
    log: [],
    logs: [],
    ...patch,
  }
}

describe('evaluateSessionGoalWorkflowPolicy', () => {
  test('recommends workflow launch for broad planned implementation goals', () => {
    const verdict = evaluateSessionGoalWorkflowPolicy(goal({
      text: '根据 docs/upgrade/W473-loop-os-goal-workflow-plan-2026-07-06.md 的内容，实现目标',
    }))

    expect(verdict.type).toBe('launch_workflow')
    if (verdict.type !== 'launch_workflow') {
      throw new Error('expected launch_workflow')
    }
    expect(verdict.signals).toContain('planned implementation')
    expect(verdict.task).toContain('Workflow contract:')
    expect(verdict.task).toContain('final report')
  })

  test('keeps narrow single-turn goals in the main loop', () => {
    const verdict = evaluateSessionGoalWorkflowPolicy(goal({
      text: '解释一下 goal 命令',
    }))

    expect(verdict.type).toBe('continue')
    expect(verdict.reason).toContain('narrow')
  })

  test('waits when attached workflow work is active', () => {
    const verdict = evaluateSessionGoalWorkflowPolicy(
      goal(),
      { workflow: workflowTask() },
    )

    expect(verdict.type).toBe('wait_for_workflow')
    if (verdict.type !== 'wait_for_workflow') {
      throw new Error('expected wait_for_workflow')
    }
    expect(verdict.works[0]?.runId).toBe('wf_policy_1')
  })

  test('does not launch a second workflow when workflow evidence exists', () => {
    const verdict = evaluateSessionGoalWorkflowPolicy(goal({
      recentEvidence: ['Workflow audit (wf_1) completed with verified final report'],
    }))

    expect(verdict.type).toBe('continue')
    expect(verdict.reason).toContain('Workflow evidence already exists')
  })
})

describe('buildSessionGoalWorkflowTask', () => {
  test('includes objective, criteria, constraints, and evidence contract', () => {
    const task = buildSessionGoalWorkflowTask(goal({
      text: 'Audit the workflow runtime',
      successCriteria: 'Find and verify regressions',
      constraints: 'Do not loosen permissions',
    }))

    expect(task).toContain('Audit the workflow runtime')
    expect(task).toContain('Find and verify regressions')
    expect(task).toContain('Do not loosen permissions')
    expect(task).toContain('validationCommands')
    expect(task).toContain('missingChecks')
  })
})
