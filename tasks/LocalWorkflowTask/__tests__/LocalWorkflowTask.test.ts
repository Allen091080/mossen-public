import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setIsInteractive } from '../../../bootstrap/state.js'
import type { AppState } from '../../../state/AppState.js'
import type { SetAppState } from '../../../Task.js'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import { dequeueAll } from '../../../utils/messageQueueManager.js'
import { drainSdkEvents } from '../../../utils/sdkEventQueue.js'
import {
  buildWorkflowResumePrompt,
  completeWorkflowTask,
  failWorkflowTask,
  hasPendingWorkflows,
  isWorkflowTaskPaused,
  pauseWorkflowTask,
  pendingWorkflowCount,
  registerWorkflowTask,
  resumeWorkflowTask,
  type LocalWorkflowTaskState,
  updateWorkflowTaskProgress,
} from '../LocalWorkflowTask.js'

function workflowTask(id: string): LocalWorkflowTaskState {
  return {
    id,
    type: 'local_workflow',
    status: 'running',
    description: 'demo workflow',
    startTime: Date.now(),
    outputFile: getTaskOutputPath(id),
    outputOffset: 0,
    notified: false,
    runId: id,
    workflowRunId: id,
    workflowName: 'demo',
    prompt: 'export const meta = {}',
    scriptPath: `/tmp/workflows/${id}/script.js`,
    args: { ticket: 42 },
    transcriptDir: `/tmp/workflows/${id}/transcripts`,
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
    paused: false,
  }
}

beforeEach(() => {
  dequeueAll()
  drainSdkEvents()
  setIsInteractive(true)
})

afterEach(() => {
  dequeueAll()
  drainSdkEvents()
  setIsInteractive(true)
})

describe('LocalWorkflowTask pause/resume controls', () => {
  test('registerWorkflowTask stores official resume metadata on the task', () => {
    const runId = 'wf_register_test'
    let state = { tasks: {} } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    registerWorkflowTask({
      runId,
      workflowName: 'demo',
      description: 'demo workflow',
      script: 'export const meta = {}',
      scriptPath: '/tmp/workflows/wf_register_test/script.js',
      args: { ticket: 42 },
      title: 'Demo',
      phaseDefinitions: [{ title: 'Plan', model: 'fast' }],
      transcriptDir: '/tmp/workflows/wf_register_test/transcripts',
      defaultModel: 'default-model',
      abortController: new AbortController(),
      setAppState,
    })

    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.scriptPath).toBe('/tmp/workflows/wf_register_test/script.js')
    expect(task.workflowRunId).toBe(runId)
    expect(task.prompt).toBe('export const meta = {}')
    expect(task.args).toEqual({ ticket: 42 })
    expect(task.title).toBe('Demo')
    expect(task.phaseDefinitions).toEqual([{ title: 'Plan', model: 'fast' }])
    expect(task.transcriptDir).toBe(
      '/tmp/workflows/wf_register_test/transcripts',
    )
    expect(task.defaultModel).toBe('default-model')
    expect(task.logs).toEqual([])
  })

  test('registerWorkflowTask can separate background task id from workflow run id', () => {
    const taskId = 'wtasksep1'
    const runId = 'wf_register_separate'
    let state = { tasks: {} } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    registerWorkflowTask({
      taskId,
      runId,
      workflowRunId: runId,
      workflowName: 'demo',
      description: 'demo workflow',
      script: 'export const meta = {}',
      scriptPath: '/tmp/workflows/wf_register_separate/script.js',
      abortController: new AbortController(),
      setAppState,
    })

    expect(state.tasks[runId]).toBeUndefined()
    const task = state.tasks[taskId] as LocalWorkflowTaskState
    expect(task.id).toBe(taskId)
    expect(task.runId).toBe(runId)
    expect(task.workflowRunId).toBe(runId)
    expect(task.outputFile).toBe(getTaskOutputPath(taskId))
    expect(task.scriptPath).toBe('/tmp/workflows/wf_register_separate/script.js')
  })

  test('buildWorkflowResumePrompt includes args like official paused workflow prompt', () => {
    expect(
      buildWorkflowResumePrompt({
        runId: 'wf_resume_test',
        scriptPath: '/tmp/workflows/wf_resume_test/script.js',
        args: { ticket: 42 },
      }),
    ).toBe(
      "Resume the paused workflow by calling: Workflow({scriptPath: '/tmp/workflows/wf_resume_test/script.js', resumeFromRunId: 'wf_resume_test', args: {\"ticket\":42}}) — completed agents return cached results.",
    )
  })

  test('pending workflow helpers count only unfinished workflow tasks', () => {
    const running = workflowTask('wf_running')
    const paused = {
      ...workflowTask('wf_paused'),
      status: 'paused' as const,
      paused: true,
    }
    const pending = { ...workflowTask('wf_pending'), status: 'pending' as const }
    const completed = {
      ...workflowTask('wf_completed'),
      status: 'completed' as const,
    }
    const unrelated = {
      ...workflowTask('agent_running'),
      type: 'local_agent' as const,
      status: 'running' as const,
    }

    const tasks = {
      running,
      paused,
      pending,
      completed,
      unrelated,
    }

    expect(pendingWorkflowCount(tasks)).toBe(2)
    expect(hasPendingWorkflows(tasks)).toBe(true)
    expect(pendingWorkflowCount({ completed, unrelated })).toBe(0)
    expect(hasPendingWorkflows({ completed, unrelated })).toBe(false)
  })

  test('updateWorkflowTaskProgress emits official-shaped SDK workflow progress', () => {
    const runId = 'wf_sdk_progress_test'
    let state = {
      tasks: {
        [runId]: workflowTask(runId),
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    setIsInteractive(false)
    updateWorkflowTaskProgress(
      runId,
      { kind: 'phase', title: 'Plan' },
      setAppState,
    )
    updateWorkflowTaskProgress(
      runId,
      {
        kind: 'agent_start',
        agentNumber: 1,
        label: 'Inspect',
        phase: 'Plan',
      },
      setAppState,
    )
    updateWorkflowTaskProgress(
      runId,
      {
        kind: 'agent_end',
        agentNumber: 1,
        label: 'Inspect',
        phase: 'Plan',
        ok: true,
        status: 'completed',
        tokens: 25,
        toolCalls: 2,
      },
      setAppState,
    )

    const events = drainSdkEvents()
    expect(events.map(event => event.subtype)).toEqual([
      'task_progress',
      'task_progress',
      'task_progress',
    ])
    const progressEvents = events.filter(
      (
        event,
      ): event is Extract<(typeof events)[number], { subtype: 'task_progress' }> =>
        event.subtype === 'task_progress',
    )
    expect(progressEvents[0]?.workflow_progress).toEqual([
      {
        type: 'workflow_phase',
        index: 1,
        title: 'Plan',
        state: 'start',
      },
    ])
    expect(progressEvents[1]?.workflow_progress).toEqual([
      {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'start',
      },
    ])
    expect(progressEvents[2]?.workflow_progress).toEqual([
      {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'completed',
        tokens: 25,
        toolCalls: 2,
      },
    ])
    expect(progressEvents[2]?.usage.total_tokens).toBe(25)
    expect(progressEvents[2]?.usage.tool_uses).toBe(2)
    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.workflowProgress).toEqual([
      {
        type: 'workflow_phase',
        index: 1,
        title: 'Plan',
        state: 'start',
      },
      {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'start',
      },
      {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'completed',
        tokens: 25,
        toolCalls: 2,
      },
    ])
    expect(task.progressVersion).toBe(3)
    expect(task.totalToolCalls).toBe(2)
    expect(task.logs).toEqual(task.log)
  })

  test('pause transitions to official paused status and aborts the run', async () => {
    const runId = 'wf_pause_test'
    const abortController = new AbortController()
    let state = {
      tasks: {
        [runId]: {
          ...workflowTask(runId),
          abortController,
        },
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    expect(pauseWorkflowTask(runId, setAppState)).toBe(true)
    expect(isWorkflowTaskPaused(runId)).toBe(true)
    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.status).toBe('paused')
    expect(task.notified).toBe(true)
    expect(typeof task.endTime).toBe('number')
    expect(task.abortController).toBeUndefined()
    expect(task.paused).toBe(true)
    expect(abortController.signal.aborted).toBe(true)
    expect(abortController.signal.reason).toBe('workflow_paused')
    expect(resumeWorkflowTask(runId, setAppState)).toBe(false)
    expect(task.logs).toEqual(task.log)
    expect(task.logs).toContain('workflow paused')
  })

  test('completeWorkflowTask finalizes task and clears paused state', () => {
    const runId = 'wf_complete_test'
    let state = {
      tasks: {
        [runId]: workflowTask(runId),
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    completeWorkflowTask(runId, setAppState, {
      agentCount: 2,
      totalToolCalls: 7,
      tokensSpent: 345,
    })

    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.status).toBe('completed')
    expect(task.summary).toBe('completed')
    expect(task.notified).toBe(true)
    expect(typeof task.endTime).toBe('number')
    expect(task.abortController).toBeUndefined()
    expect(task.paused).toBe(false)
    expect(task.pauseStartedAt).toBeUndefined()
    expect(task.agentCount).toBe(2)
    expect(task.totalToolCalls).toBe(7)
    expect(task.tokensSpent).toBe(345)
    expect(isWorkflowTaskPaused(runId)).toBe(false)
  })

  test('failWorkflowTask records error and recovery metadata', () => {
    const runId = 'wf_fail_test'
    let state = {
      tasks: {
        [runId]: workflowTask(runId),
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    failWorkflowTask(runId, setAppState, {
      agentCount: 1,
      totalToolCalls: 3,
      tokensSpent: 123,
      error: 'boom',
    })

    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.status).toBe('failed')
    expect(task.summary).toBe('boom')
    expect(task.error).toBe('boom')
    expect(task.notified).toBe(true)
    expect(typeof task.endTime).toBe('number')
    expect(task.abortController).toBeUndefined()
    expect(task.paused).toBe(false)
    expect(task.pauseStartedAt).toBeUndefined()
    expect(task.agentCount).toBe(1)
    expect(task.totalToolCalls).toBe(3)
    expect(task.tokensSpent).toBe(123)
    expect(isWorkflowTaskPaused(runId)).toBe(false)

    const notification = dequeueAll()[0]?.value
    expect(notification).toContain('<recovery>')
    expect(notification).toContain(
      "To resume after editing the script, call: Workflow({scriptPath: '/tmp/workflows/wf_fail_test/script.js', resumeFromRunId: 'wf_fail_test', args: {\"ticket\":42}})",
    )
    expect(notification).toContain(
      'Agent transcripts: /tmp/workflows/wf_fail_test/transcripts',
    )
  })
})
