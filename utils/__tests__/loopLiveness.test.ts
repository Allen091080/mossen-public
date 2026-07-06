import { describe, expect, test } from 'bun:test'
import { createTaskStateBase, type TaskStatus } from '../../Task.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  buildLoopLivenessReport,
  DEFAULT_LOOP_STALE_AFTER_MS,
} from '../loopLiveness.js'

function workflowTask(
  patch: Partial<LocalWorkflowTaskState> = {},
): LocalWorkflowTaskState {
  const id = patch.id ?? 'wf_task'
  return {
    ...createTaskStateBase(id, 'local_workflow', 'loop workflow'),
    type: 'local_workflow',
    status: 'running',
    runId: 'wf_run',
    workflowRunId: 'wf_run',
    workflowName: 'loop-check',
    scriptPath: '/tmp/mossen/wf_run/script.js',
    transcriptDir: '/tmp/mossen/wf_run/transcripts',
    parentGoalId: 'goal-1',
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

function agentTask(
  patch: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  const id = patch.id ?? 'agent_task'
  return {
    ...createTaskStateBase(id, 'local_agent', 'loop agent'),
    type: 'local_agent',
    status: 'running',
    agentId: id,
    prompt: 'verify loop state',
    agentType: 'verification',
    parentWorkflowId: 'wf_run',
    parentGoalId: 'goal-1',
    abortController: new AbortController(),
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    ...patch,
  }
}

describe('buildLoopLivenessReport', () => {
  test('reports active attached workflow work as wait', () => {
    const task = workflowTask({
      startTime: 1_000,
      agents: [
        {
          agentNumber: 1,
          label: 'Inspect',
          phase: 'Plan',
          status: 'running',
          tokens: 0,
          toolCalls: 0,
          lastProgressAt: 1_500,
        },
      ],
    })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      { goalId: 'goal-1', now: 2_000 },
    )

    expect(report.verdict).toBe('wait')
    expect(report.works).toHaveLength(1)
    expect(report.works[0]).toMatchObject({
      taskId: task.id,
      kind: 'workflow',
      status: 'active',
      attachedToGoal: true,
      nextAction: 'wait',
      runId: 'wf_run',
    })
  })

  test('marks running workflow without current process controller as stale', () => {
    const task = workflowTask({ abortController: undefined })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      { goalId: 'goal-1', now: Date.now() },
    )

    expect(report.verdict).toBe('stale')
    expect(report.works[0]).toMatchObject({
      status: 'stale',
      issue: 'missing_controller',
      nextAction: 'inspect',
    })
  })

  test('marks old progress as stale before clearing evidence', () => {
    const task = workflowTask({
      startTime: 1_000,
      agents: [
        {
          agentNumber: 1,
          label: 'Inspect',
          phase: 'Plan',
          status: 'running',
          tokens: 0,
          toolCalls: 0,
          lastProgressAt: 1_000,
        },
      ],
    })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      {
        goalId: 'goal-1',
        now: 1_000 + DEFAULT_LOOP_STALE_AFTER_MS,
      },
    )

    expect(report.verdict).toBe('stale')
    expect(report.works[0]).toMatchObject({
      status: 'stale',
      issue: 'stale_progress',
      nextAction: 'inspect',
      ageMs: DEFAULT_LOOP_STALE_AFTER_MS,
    })
    expect(report.works[0]?.evidence).toContain('/tmp/mossen/wf_run/script.js')
  })

  test('keeps paused recoverable workflows visible as wait/resume', () => {
    const task = workflowTask({
      status: 'paused',
      abortController: undefined,
      paused: true,
    })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      { goalId: 'goal-1' },
    )

    expect(report.verdict).toBe('wait')
    expect(report.works[0]).toMatchObject({
      status: 'paused',
      nextAction: 'resume',
    })
  })

  test('marks completed workflow without terminal result as unverifiable', () => {
    const task = workflowTask({
      status: 'completed',
      abortController: undefined,
      result: undefined,
    })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      { goalId: 'goal-1' },
    )

    expect(report.verdict).toBe('verify')
    expect(report.works[0]).toMatchObject({
      status: 'unverifiable',
      issue: 'missing_terminal_evidence',
      nextAction: 'verify',
    })
  })

  test.each([
    ['failed', 'terminal_failure'],
    ['killed', 'terminal_killed'],
  ] as const)('marks %s workflow as failed verdict', (status, issue) => {
    const task = workflowTask({
      status: status as TaskStatus,
      abortController: undefined,
      error: status === 'failed' ? 'validator failed' : undefined,
    })

    const report = buildLoopLivenessReport(
      { [task.id]: task },
      { goalId: 'goal-1' },
    )

    expect(report.verdict).toBe('failed')
    expect(report.works[0]).toMatchObject({
      status,
      issue,
      nextAction: 'review_failure',
    })
  })

  test('filters unattached work unless requested for session-level risk display', () => {
    const attached = workflowTask({ id: 'attached', parentGoalId: 'goal-1' })
    const unattached = workflowTask({
      id: 'unattached',
      parentGoalId: null,
      workflowRunId: 'wf_other',
      runId: 'wf_other',
    })

    expect(
      buildLoopLivenessReport(
        { attached, unattached },
        { goalId: 'goal-1' },
      ).works.map(item => item.taskId),
    ).toEqual(['attached'])

    expect(
      buildLoopLivenessReport(
        { attached, unattached },
        { goalId: 'goal-1', includeUnattached: true },
      ).works.map(item => item.taskId),
    ).toEqual(['attached', 'unattached'])
  })

  test('includes workflow-owned local agents in the same goal report', () => {
    const agent = agentTask({ startTime: 10_000 })

    const report = buildLoopLivenessReport(
      { [agent.id]: agent },
      { goalId: 'goal-1', now: 11_000 },
    )

    expect(report.verdict).toBe('wait')
    expect(report.works[0]).toMatchObject({
      kind: 'agent',
      status: 'active',
      parentWorkflowId: 'wf_run',
      attachedToGoal: true,
    })
  })
})
