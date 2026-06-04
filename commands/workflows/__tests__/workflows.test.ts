import { describe, expect, test } from 'bun:test'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import { buildWorkflowResumeNextInput, call } from '../workflows.js'

function workflowCommandContext(state: { tasks: Record<string, unknown> }) {
  const setAppState = (updater: (prev: typeof state) => typeof state) => {
    Object.assign(state, updater(state))
  }
  return {
    getAppState: () => state,
    setAppState,
    setAppStateForTasks: setAppState,
  }
}

function runningWorkflowTask(params: {
  taskId: string
  runId: string
  abortController?: AbortController
}) {
  const { taskId, runId, abortController = new AbortController() } = params
  return {
    id: taskId,
    type: 'local_workflow',
    status: 'running',
    description: 'demo workflow',
    startTime: Date.now(),
    outputFile: getTaskOutputPath(taskId),
    outputOffset: 0,
    notified: false,
    runId,
    workflowRunId: runId,
    workflowName: 'demo',
    scriptPath: `/tmp/workflows/${runId}/script.js`,
    summary: 'demo',
    abortController,
    agentCount: 2,
    totalToolCalls: 0,
    tokensSpent: 0,
    phases: ['Scan'],
    workflowProgress: [],
    progressVersion: 0,
    agents: [
      {
        agentNumber: 1,
        label: 'Scan routes',
        phase: 'Scan',
        status: 'running',
        tokens: 0,
        toolCalls: 0,
      },
      {
        agentNumber: 2,
        label: 'Review findings',
        phase: 'Scan',
        status: 'queued',
        tokens: 0,
        toolCalls: 0,
      },
    ],
    log: [],
    logs: [],
    isBackgrounded: true,
    paused: false,
  }
}

describe('/workflows resume', () => {
  test('queues an official-shaped Workflow tool call with scriptPath, resumeFromRunId, and args', () => {
    const nextInput = buildWorkflowResumeNextInput(
      'wf_resume1',
      '/tmp/workflows/wf_resume1/script.js',
      { ticket: 42 },
    )

    expect(nextInput).toContain(
      "Workflow({scriptPath: '/tmp/workflows/wf_resume1/script.js'",
    )
    expect(nextInput).toContain("resumeFromRunId: 'wf_resume1'")
    expect(nextInput).toContain('args: {"ticket":42}')
    expect(nextInput).not.toContain('no new script')
  })

  test('pause resolves a workflow run id to the separated background task id', async () => {
    const taskId = 'wtaskcmd1'
    const runId = 'wf_cmd_lookup'
    const abortController = new AbortController()
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId, abortController }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `pause ${runId}`,
    )

    expect(message).toContain(runId)
    expect(state.tasks[taskId]?.status).toBe('paused')
    expect(abortController.signal.aborted).toBe(true)
  })

  test('stop resolves a workflow run id and kills the backing task', async () => {
    const taskId = 'wtaskcmd_stop'
    const runId = 'wf_cmd_stop'
    const abortController = new AbortController()
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId, abortController }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `stop ${runId}`,
    )

    expect(message).toContain(runId)
    expect(state.tasks[taskId]?.status).toBe('killed')
    expect(abortController.signal.aborted).toBe(true)
  })

  test('stop-agent requests a skip for the selected workflow agent', async () => {
    const taskId = 'wtaskcmd_stop_agent'
    const runId = 'wf_cmd_stop_agent'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `stop-agent ${runId} 1`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#1')
    expect(state.tasks[taskId]?.agents?.[0]?.status).toBe('skipped')
    expect(state.tasks[taskId]?.summary).toBe('skip requested for agent #1')
  })

  test('retry-agent requests a restart for the selected workflow agent', async () => {
    const taskId = 'wtaskcmd_retry_agent'
    const runId = 'wf_cmd_retry_agent'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `retry-agent ${runId} 2`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#2')
    expect(state.tasks[taskId]?.agents?.[1]?.status).toBe('retry_requested')
    expect(state.tasks[taskId]?.summary).toBe('retry requested for agent #2')
  })

  test('resume-task queues Workflow input with the workflow run id, not the task id', async () => {
    const taskId = 'wtaskcmd2'
    const runId = 'wf_cmd_resume'
    const state = {
      tasks: {
        [taskId]: {
          id: taskId,
          type: 'local_workflow',
          status: 'paused',
          runId,
          workflowRunId: runId,
          scriptPath: '/tmp/workflows/wf_cmd_resume/script.js',
          args: { ticket: 42 },
        },
      },
    }
    let nextInput = ''

    await call(
      (_message, options) => {
        nextInput = options?.nextInput ?? ''
      },
      workflowCommandContext(state) as never,
      `resume-task ${runId}`,
    )

    expect(nextInput).toContain(
      "Workflow({scriptPath: '/tmp/workflows/wf_cmd_resume/script.js'",
    )
    expect(nextInput).toContain("resumeFromRunId: 'wf_cmd_resume'")
    expect(nextInput).toContain('args: {"ticket":42}')
    expect(nextInput).not.toContain(taskId)
  })
})
