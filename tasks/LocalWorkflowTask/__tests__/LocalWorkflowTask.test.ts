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
  killWorkflowTask,
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
    expect(task.phases).toEqual(['Plan'])
    expect(task.workflowProgress).toEqual([
      {
        type: 'workflow_phase',
        index: 1,
        title: 'Plan',
        state: 'start',
      },
    ])
    expect(task.progressVersion).toBe(1)
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

  test('buildWorkflowResumePrompt includes args like official resumable workflow prompt', () => {
    expect(
      buildWorkflowResumePrompt({
        runId: 'wf_resume_test',
        scriptPath: '/tmp/workflows/wf_resume_test/script.js',
        args: { ticket: 42 },
      }),
    ).toBe(
      "Resume the workflow run by calling: Workflow({scriptPath: '/tmp/workflows/wf_resume_test/script.js', resumeFromRunId: 'wf_resume_test', args: {\"ticket\":42}}) — completed agents return cached results.",
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
        kind: 'agent_queued',
        agentNumber: 1,
        label: 'Inspect',
        phase: 'Plan',
        queuedAt: 1000,
        lastProgressAt: 1000,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
      },
      setAppState,
    )
    updateWorkflowTaskProgress(
      runId,
      {
        kind: 'agent_start',
        agentNumber: 1,
        label: 'Inspect',
        phase: 'Plan',
        queuedAt: 1000,
        startedAt: 1010,
        lastProgressAt: 1010,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
      },
      setAppState,
    )
      updateWorkflowTaskProgress(
        runId,
        {
          kind: 'agent_progress',
          agentNumber: 1,
          label: 'Inspect',
          phase: 'Plan',
          tokens: 12,
          toolCalls: 1,
          queuedAt: 1000,
          startedAt: 1010,
          lastProgressAt: 1100,
          promptPreview: 'inspect the repo',
          agentType: 'reviewer',
          model: 'model-a',
          isolation: 'worktree',
          lastToolName: 'Read',
          lastToolSummary: 'src/index.ts',
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
          durationMs: 190,
          queuedAt: 1000,
          startedAt: 1010,
          lastProgressAt: 1200,
          promptPreview: 'inspect the repo',
          agentType: 'reviewer',
          model: 'model-a',
          isolation: 'worktree',
          resultPreview: 'inspection finished',
        },
        setAppState,
      )

    const events = drainSdkEvents()
      expect(events.map(event => event.subtype)).toEqual([
        'task_progress',
        'task_progress',
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
        queuedAt: 1000,
        lastProgressAt: 1000,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
      },
    ])
    expect(progressEvents[2]?.workflow_progress).toEqual([
      {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'start',
        queuedAt: 1000,
        startedAt: 1010,
        lastProgressAt: 1010,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
      },
    ])
      const progressUpdate = {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'progress',
        tokens: 12,
        toolCalls: 1,
        queuedAt: 1000,
        startedAt: 1010,
        lastProgressAt: 1100,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
        lastToolName: 'Read',
        lastToolSummary: 'src/index.ts',
      }
      const doneUpdate = {
        type: 'workflow_agent',
        index: 1,
        label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'done',
        tokens: 25,
        toolCalls: 2,
        durationMs: 190,
        queuedAt: 1000,
        startedAt: 1010,
        lastProgressAt: 1200,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
        resultPreview: 'inspection finished',
      }
      expect(progressEvents[3]?.workflow_progress).toEqual([progressUpdate])
      expect(progressEvents[3]?.usage.total_tokens).toBe(0)
      expect(progressEvents[3]?.usage.tool_uses).toBe(0)
      expect(progressEvents[4]?.workflow_progress).toEqual([doneUpdate])
      expect(progressEvents[4]?.usage.total_tokens).toBe(25)
      expect(progressEvents[4]?.usage.tool_uses).toBe(2)
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
        queuedAt: 1000,
        lastProgressAt: 1000,
          promptPreview: 'inspect the repo',
          agentType: 'reviewer',
          model: 'model-a',
          isolation: 'worktree',
        },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Inspect',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'start',
        queuedAt: 1000,
        startedAt: 1010,
        lastProgressAt: 1010,
        promptPreview: 'inspect the repo',
        agentType: 'reviewer',
          model: 'model-a',
          isolation: 'worktree',
        },
        progressUpdate,
        doneUpdate,
      ])
      expect(task.progressVersion).toBe(5)
      expect(task.totalToolCalls).toBe(2)
      expect(task.agents[0]).toMatchObject({
        status: 'completed',
        agentType: 'reviewer',
        model: 'model-a',
        isolation: 'worktree',
        lastToolName: 'Read',
        lastToolSummary: 'src/index.ts',
        resultPreview: 'inspection finished',
        durationMs: 190,
      })
    expect(task.logs).toEqual(task.log)
  })

  test('updateWorkflowTaskProgress maps skipped agents to official error progress', () => {
    const runId = 'wf_sdk_skipped_progress_test'
    let state = {
      tasks: {
        [runId]: {
          ...workflowTask(runId),
          phases: ['Plan'],
        },
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    setIsInteractive(false)
    updateWorkflowTaskProgress(
      runId,
      {
        kind: 'agent_end',
        agentNumber: 2,
        label: 'Optional',
        phase: 'Plan',
        ok: false,
        status: 'skipped',
        tokens: 0,
        toolCalls: 0,
        durationMs: 5,
        queuedAt: 2000,
        startedAt: 2010,
        lastProgressAt: 2015,
      },
      setAppState,
    )

    const [event] = drainSdkEvents().filter(
      (
        event,
      ): event is Extract<ReturnType<typeof drainSdkEvents>[number], { subtype: 'task_progress' }> =>
        event.subtype === 'task_progress',
    )
    expect(event?.workflow_progress).toEqual([
      {
        type: 'workflow_agent',
        index: 2,
        label: 'Optional',
        phaseTitle: 'Plan',
        phaseIndex: 1,
        state: 'error',
        tokens: 0,
        toolCalls: 0,
        queuedAt: 2000,
        startedAt: 2010,
        lastProgressAt: 2015,
        skipped: true,
        error: 'skipped by user',
        durationMs: 5,
      },
    ])
  })

  test('seeded phase titles are not duplicated when the script enters the phase', () => {
    const runId = 'wf_seeded_phase_test'
    let state = { tasks: {} } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    registerWorkflowTask({
      runId,
      workflowName: 'demo',
      description: 'demo workflow',
      phaseDefinitions: [{ title: 'Plan' }, { title: 'Build' }],
      abortController: new AbortController(),
      setAppState,
    })
    drainSdkEvents()

    updateWorkflowTaskProgress(
      runId,
      {
        kind: 'phase',
        title: 'Plan',
      },
      setAppState,
    )

    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(task.currentPhase).toBe('Plan')
    expect(task.phases).toEqual(['Plan', 'Build'])
    expect(task.workflowProgress).toEqual([
      {
        type: 'workflow_phase',
        index: 1,
        title: 'Plan',
        state: 'start',
      },
      {
        type: 'workflow_phase',
        index: 2,
        title: 'Build',
        state: 'start',
      },
    ])
    expect(task.progressVersion).toBe(2)
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

    killWorkflowTask(runId, setAppState)
    const killedTask = state.tasks[runId] as LocalWorkflowTaskState
    expect(killedTask.status).toBe('killed')
    expect(killedTask.summary).toBe('stopped')
    expect(killedTask.paused).toBe(false)
    expect(killedTask.pauseStartedAt).toBeUndefined()
    expect(isWorkflowTaskPaused(runId)).toBe(false)
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
