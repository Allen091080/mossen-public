import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../../state/AppState.js'
import { getTaskByType } from '../../../tasks.js'
import {
  registerRemoteAgentTask,
  startRemoteAgentTaskPolling,
} from '../RemoteAgentTask.js'

function createState(): {
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

describe('RemoteAgentTask', () => {
  test('registers remote workflow tasks and completes them from result events', async () => {
    const harness = createState()
    registerRemoteAgentTask({
      taskId: 'rworkflow1',
      sessionId: 'session_remote_workflow_1',
      title: 'Remote workflow',
      description: 'Run remote workflow',
      remoteTaskType: 'remote-workflow',
      sessionUrl: 'https://example.invalid/code/session_remote_workflow_1',
      setAppState: harness.setAppState,
    })

    expect(harness.state.tasks.rworkflow1).toMatchObject({
      type: 'remote_agent',
      status: 'running',
      sessionId: 'session_remote_workflow_1',
      remoteTaskType: 'remote-workflow',
      isBackgrounded: true,
    })

    const stopPolling = startRemoteAgentTaskPolling(
      {
        taskId: 'rworkflow1',
        sessionId: 'session_remote_workflow_1',
        setAppState: harness.setAppState,
      },
      {
        poll: async () => ({
          newEvents: [
            {
              type: 'result',
              subtype: 'success',
              result: 'workflow done',
            },
          ],
          lastEventId: 'evt_1',
          sessionStatus: 'idle',
        }),
        pollIntervalMs: 1,
      },
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    stopPolling()

    expect(harness.state.tasks.rworkflow1).toMatchObject({
      type: 'remote_agent',
      status: 'completed',
      notified: true,
      log: [
        {
          type: 'result',
          subtype: 'success',
          result: 'workflow done',
        },
      ],
    })
  })

  test('registers remote_agent as a stoppable task type', () => {
    expect(getTaskByType('remote_agent')?.name).toBe('RemoteAgentTask')
  })
})
