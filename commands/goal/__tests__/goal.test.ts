import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getSessionGoalState,
  resetStateForTests,
  setSessionGoalState,
} from '../../../bootstrap/state.js'
import { createTaskStateBase } from '../../../Task.js'
import type { LocalWorkflowTaskState } from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  clearMossenConfigOverrides,
  setMossenConfigOverride,
} from '../../../services/config/facade.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../../types/command.js'
import { getSessionGoalEventFromMessage } from '../../../utils/sessionGoalEvents.js'
import { parseSessionGoalAction } from '../../../utils/sessionGoalCommand.js'
import { call } from '../goal.js'
import { renderGoalDoctorFromPsOutput } from '../render.js'

const BACKEND_ENV_KEYS = [
  'MOSSEN_CODE_API_BASE_URL',
  'MOSSEN_CODE_AUTH_TOKEN',
  'MOSSEN_CODE_AUTH_TOKEN_FILE_DESCRIPTOR',
  'MOSSEN_CODE_AUTH_REFRESH_TOKEN',
  'MOSSEN_CODE_CUSTOM_BASE_URL',
  'MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER',
  'MOSSEN_CODE_USE_CUSTOM_BACKEND',
] as const

beforeEach(() => {
  resetStateForTests()
  clearMossenConfigOverrides()
})

async function withNoBackendConfigured(
  callback: () => Promise<void>,
): Promise<void> {
  const previousEnv = new Map<string, string | undefined>()
  for (const key of BACKEND_ENV_KEYS) {
    previousEnv.set(key, process.env[key])
    delete process.env[key]
  }
  setMossenConfigOverride('mossen.activeProfile', null)
  try {
    await callback()
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    clearMossenConfigOverrides()
  }
}

function createCommandContext(
  tasks: Record<string, unknown> = {},
): LocalJSXCommandContext {
  return {
    getAppState: () => ({ tasks }),
    setMessages: () => {},
    options: {
      ideInstallationStatus: null,
      theme: 'dark',
    },
    onChangeAPIKey: () => {},
  } as unknown as LocalJSXCommandContext
}

function workflowTask(goalId: string): LocalWorkflowTaskState {
  return {
    ...createTaskStateBase('wf_goal_status', 'local_workflow', 'goal workflow'),
    type: 'local_workflow',
    status: 'running',
    runId: 'wf_goal_status',
    workflowRunId: 'wf_goal_status',
    workflowName: 'goal-status-workflow',
    scriptPath: '/tmp/mossen/wf_goal_status/script.js',
    transcriptDir: '/tmp/mossen/wf_goal_status/transcripts',
    parentGoalId: goalId,
    isBackgrounded: true,
    abortController: undefined,
    agentCount: 1,
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

describe('/goal command', () => {
  test('sets a paused goal without querying when no backend is configured', async () => {
    await withNoBackendConfigured(async () => {
      let result = ''
      let options: Parameters<LocalJSXCommandOnDone>[1] | undefined

      await call(
        (nextResult, nextOptions) => {
          result = nextResult ?? ''
          options = nextOptions
        },
        createCommandContext(),
        'set finish the user journey',
      )

      expect(result).toContain('finish the user journey')
      expect(result).toContain('/goal resume')
      expect(options?.shouldQuery).toBe(false)
      expect(options?.metaMessages).toEqual([])
      expect(
        options?.systemMessages?.map(message =>
          getSessionGoalEventFromMessage(message)?.type,
        ),
      ).toEqual(['goal_created', 'goal_paused'])
      expect(getSessionGoalState()?.status).toBe('paused')
      expect(getSessionGoalState()?.lastEvaluatorReason).toContain(
        'No Mossen backend is configured',
      )
    })
  })

  test('status surfaces stale workflow liveness for the active goal', async () => {
    const goal = setSessionGoalState('ship loop visibility')
    const task = workflowTask(goal.id)
    let result = ''

    await call(
      nextResult => {
        result = nextResult ?? ''
      },
      createCommandContext({ [task.id]: task }),
      'status',
    )

    expect(result).toContain('Loop')
    expect(result).toMatch(/陈旧|stale/)
    expect(result).toContain('goal-status-workflow')
    expect(result).toMatch(/缺少当前进程控制器|missing current-process controller/)
    expect(result).toContain('wf_goal_status')
  })

  test('doctor aliases route to read-only loop process diagnostics', () => {
    expect(parseSessionGoalAction('doctor').action).toBe('doctor')
    expect(parseSessionGoalAction('diagnostics').action).toBe('doctor')
    expect(parseSessionGoalAction('diag').action).toBe('doctor')

    const result = renderGoalDoctorFromPsOutput(
      [
        '44827 1 9-00:00:00 99.7 supervisor --dangerously-skip-permissions',
        '19446 45412 1-22:03:04 99.1 bun test sessionGoalEvaluator.test.ts',
        '16074 1 00:10 4.8 supervisor job',
      ].join('\n'),
      { generatedAt: '2026-07-06T00:00:00.000Z' },
    )

    expect(result).toContain('doctor')
    expect(result).toMatch(/Read-only|只读/)
    expect(result).toContain('ps -axo pid=,ppid=,etime=,pcpu=,command=')
    expect(result).toContain('44827')
    expect(result).toContain('19446')
    expect(result).toMatch(/explicit operator confirmation|明确确认/)
    expect(result).not.toContain('16074')
  })

  test('board aliases route to unified loop board JSON', async () => {
    expect(parseSessionGoalAction('board').action).toBe('board')
    expect(parseSessionGoalAction('loop').action).toBe('board')
    const goal = setSessionGoalState('ship loop board')
    const task = workflowTask(goal.id)
    let result = ''

    await call(
      nextResult => {
        result = nextResult ?? ''
      },
      createCommandContext({ [task.id]: task }),
      'board --json',
    )

    const board = JSON.parse(result) as {
      version: number
      goal: { id: string }
      workflows: Array<{ runId: string; state: string }>
      processDiagnostics: { mode: string }
    }
    expect(board.version).toBe(1)
    expect(board.goal.id).toBe(goal.id)
    expect(board.workflows[0]).toMatchObject({
      runId: 'wf_goal_status',
      state: 'stale',
    })
    expect(board.processDiagnostics.mode).toBe('read-only')
  })
})
