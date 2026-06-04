import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../../state/AppState.js'
import type { SetAppState } from '../../../Task.js'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import {
  isWorkflowTaskPaused,
  pauseWorkflowTask,
  resumeWorkflowTask,
  type LocalWorkflowTaskState,
  waitForWorkflowTaskResume,
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
    workflowName: 'demo',
    isBackgrounded: true,
    abortController: new AbortController(),
    agentCount: 0,
    tokensSpent: 0,
    phases: [],
    agents: [],
    log: [],
    paused: false,
  }
}

describe('LocalWorkflowTask pause/resume controls', () => {
  test('pause blocks waiters until resume releases them', async () => {
    const runId = 'wf_pause_test'
    let state = {
      tasks: {
        [runId]: workflowTask(runId),
      },
    } as unknown as AppState
    const setAppState: SetAppState = updater => {
      state = updater(state)
    }

    expect(pauseWorkflowTask(runId, setAppState)).toBe(true)
    expect(isWorkflowTaskPaused(runId)).toBe(true)
    expect((state.tasks[runId] as LocalWorkflowTaskState).paused).toBe(true)

    let released = false
    const waiter = waitForWorkflowTaskResume(runId).then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)

    expect(resumeWorkflowTask(runId, setAppState)).toBe(true)
    await waiter
    const task = state.tasks[runId] as LocalWorkflowTaskState
    expect(released).toBe(true)
    expect(isWorkflowTaskPaused(runId)).toBe(false)
    expect(task.paused).toBe(false)
    expect(task.totalPausedMs ?? 0).toBeGreaterThanOrEqual(0)
  })
})
