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
        [taskId]: {
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
          scriptPath: '/tmp/workflows/wf_cmd_lookup/script.js',
          abortController,
          log: [],
          logs: [],
        },
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
