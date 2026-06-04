import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../../state/AppState.js'
import { getTaskByType } from '../../../tasks.js'
import {
  finishRemoteAgentTask,
  registerRemoteAgentTask,
  restoreRemoteAgentTasks,
  startRemoteAgentTaskPolling,
} from '../RemoteAgentTask.js'
import type { RemoteAgentMetadata } from '../../../utils/sessionStorage.js'

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
    const deleted: string[] = []
    registerRemoteAgentTask({
      taskId: 'rworkflow1',
      sessionId: 'session_remote_workflow_1',
      title: 'Remote workflow',
      description: 'Run remote workflow',
      remoteTaskType: 'remote-workflow',
      sessionUrl: 'https://example.invalid/code/session_remote_workflow_1',
      setAppState: harness.setAppState,
    }, {
      writeMetadata: async () => {},
      deleteMetadata: async taskId => {
        deleted.push(taskId)
      },
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
        deleteMetadata: async taskId => {
          deleted.push(taskId)
        },
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
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deleted).toEqual(['rworkflow1'])
  })

  test('registers remote_agent as a stoppable task type', () => {
    expect(getTaskByType('remote_agent')?.name).toBe('RemoteAgentTask')
  })

  test('persists metadata while running and removes it on finish', async () => {
    const harness = createState()
    const writes: RemoteAgentMetadata[] = []
    const deleted: string[] = []
    registerRemoteAgentTask(
      {
        taskId: 'rworkflow_persist',
        sessionId: 'session_persist',
        title: 'workflow: persist',
        description: 'Persist remote workflow',
        remoteTaskType: 'remote-workflow',
        command: 'run remote workflow',
        toolUseId: 'toolu_persist',
        remoteTaskMetadata: {
          workflowName: 'persist',
          phaseTitles: ['one'],
        },
        setAppState: harness.setAppState,
      },
      {
        writeMetadata: async (_taskId, metadata) => {
          writes.push(metadata)
        },
        deleteMetadata: async taskId => {
          deleted.push(taskId)
        },
      },
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      taskId: 'rworkflow_persist',
      sessionId: 'session_persist',
      remoteTaskType: 'remote-workflow',
      title: 'workflow: persist',
      command: 'run remote workflow',
      toolUseId: 'toolu_persist',
      remoteTaskMetadata: {
        workflowName: 'persist',
        phaseTitles: ['one'],
      },
    })

    finishRemoteAgentTask(
      'rworkflow_persist',
      'completed',
      harness.setAppState,
      undefined,
      {
        deleteMetadata: async taskId => {
          deleted.push(taskId)
        },
      },
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deleted).toEqual(['rworkflow_persist'])
  })

  test('restores persisted remote agents and resumes polling', async () => {
    const harness = createState()
    const deleted: string[] = []
    let resolvePoll:
      | ((result: {
          newEvents: Array<Record<string, unknown>>
          lastEventId: string
          sessionStatus: 'idle'
        }) => void)
      | undefined
    const pollPromise = new Promise<{
      newEvents: Array<Record<string, unknown>>
      lastEventId: string
      sessionStatus: 'idle'
    }>(resolve => {
      resolvePoll = resolve
    })
    const restored = await restoreRemoteAgentTasks(harness.setAppState, {
      listMetadata: async () => [
        {
          taskId: 'rworkflow_restore',
          sessionId: 'session_restore',
          remoteTaskType: 'remote-workflow',
          title: 'workflow: restore',
          command: 'resume remote workflow',
          spawnedAt: 123,
          toolUseId: 'toolu_restore',
          remoteTaskMetadata: {
            workflowName: 'restore',
          },
        },
      ],
      poll: async () => pollPromise,
      pollIntervalMs: 1,
      deleteMetadata: async taskId => {
        deleted.push(taskId)
      },
    })

    expect(restored.restored).toBe(1)
    expect(restored.skipped).toBe(0)
    expect(harness.state.tasks.rworkflow_restore).toMatchObject({
      type: 'remote_agent',
      status: 'running',
      startTime: 123,
      sessionId: 'session_restore',
      remoteTaskType: 'remote-workflow',
      toolUseId: 'toolu_restore',
      command: 'resume remote workflow',
    })

    resolvePoll?.({
      newEvents: [
        {
          type: 'result',
          subtype: 'success',
          result: 'restored workflow done',
        },
      ],
      lastEventId: 'evt_restore',
      sessionStatus: 'idle',
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    for (const cleanup of restored.cleanups) cleanup()

    expect(harness.state.tasks.rworkflow_restore).toMatchObject({
      status: 'completed',
      notified: true,
      log: [
        {
          type: 'result',
          subtype: 'success',
          result: 'restored workflow done',
        },
      ],
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deleted).toEqual(['rworkflow_restore'])
  })
})
