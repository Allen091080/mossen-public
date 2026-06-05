import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement } from 'react'
import {
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import { buildWorkflowResumeNextInput, call } from '../workflows.js'
import { deriveWorkflowSaveName, saveRun } from '../saveWorkflow.js'
import {
  shouldRouteWorkflowAgentControl,
  shouldShowRunLevelAgents,
  workflowAgentBackTarget,
  workflowRunOpenTarget,
} from '../WorkflowRunsDialog.js'
import { initRunArtifacts } from '../../../tools/WorkflowTool/engine/journalStore.js'
import {
  getProjectWorkflowsDir,
  loadWorkflowCommandsFrom,
} from '../../../tools/WorkflowTool/savedWorkflows.js'
import type { LocalWorkflowTaskState } from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

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
}): LocalWorkflowTaskState {
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
    currentPhase: 'Scan',
    abortController,
    agentCount: 2,
    totalToolCalls: 3,
    tokensSpent: 55,
    phases: ['Scan', 'Write'],
    phaseDefinitions: [
      { title: 'Scan', detail: 'Map the repo' },
      { title: 'Write', detail: 'Prepare changes' },
    ],
    workflowProgress: [],
    progressVersion: 0,
    agents: [
      {
        agentNumber: 1,
        label: 'Scan routes',
        phase: 'Scan',
        status: 'running',
        tokens: 25,
        toolCalls: 1,
        startedAt: Date.now() - 2000,
        promptPreview: 'Inspect workflow routing and report the important files.',
        lastToolName: 'Read',
        lastToolSummary: 'commands/workflows/workflows.tsx',
        resultPreview: 'Found the command detail renderer.',
      },
      {
        agentNumber: 2,
        label: 'Review findings',
        phase: 'Write',
        status: 'completed',
        tokens: 30,
        toolCalls: 2,
        durationMs: 5000,
      },
    ],
    log: ['phase: Scan', 'agent #1 progress: Scan routes (Read workflows.tsx)'],
    logs: ['phase: Scan', 'agent #1 progress: Scan routes (Read workflows.tsx)'],
    isBackgrounded: true,
    paused: false,
  }
}

describe('/workflows resume', () => {
  test('derives a command-safe name for save dialog and save command', () => {
    expect(
      deriveWorkflowSaveName({
        runId: 'wf_fallback',
        metaName: 'Audit routes + handlers',
      }),
    ).toBe('Audit-routes-handlers')
    expect(
      deriveWorkflowSaveName({
        runId: 'wf_fallback',
        explicit: '  release/checklist  ',
      }),
    ).toBe('release-checklist')
  })

  test('save writes the selected slash command name into workflow meta', () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-save-command-name-'))
    const sessionId =
      '33333333-3333-4333-8333-333333333333' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_save_command'
      initRunArtifacts(
        runId,
        `
export const meta = { name: 'generated-flow', description: 'Generated flow' }
return 'ok'
`,
        {
          runId,
          workflowName: 'generated-flow',
          description: 'Generated flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )

      const message = saveRun([runId, 'explicit-flow'])
      const savedPath = join(getProjectWorkflowsDir(root), 'explicit-flow.js')

      expect(message).toContain('/explicit-flow')
      expect(readFileSync(savedPath, 'utf8')).toContain('name: "explicit-flow"')
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).toContain(
        'explicit-flow',
      )
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).not.toContain(
        'generated-flow',
      )
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('opens the interactive workflow progress view with no args', async () => {
    const state = { tasks: {} }
    let message = ''

    const result = await call(
      nextMessage => {
        message = nextMessage ?? ''
      },
      workflowCommandContext(state) as never,
      '',
    )

    expect(isValidElement(result)).toBe(true)
    expect(message).toBe('')
  })

  test('interactive controls target agents only when an agent is selected', () => {
    expect(shouldRouteWorkflowAgentControl('phase')).toBe(true)
    expect(shouldRouteWorkflowAgentControl('agent')).toBe(true)
    expect(shouldRouteWorkflowAgentControl('run')).toBe(false)
    expect(shouldRouteWorkflowAgentControl('list')).toBe(false)
    expect(shouldRouteWorkflowAgentControl('save')).toBe(false)
  })

  test('interactive run view can drill into agents when a workflow has no phases', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_unphased',
      runId: 'wf_cmd_unphased',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(0, 1)).toBe(true)
    expect(workflowRunOpenTarget('wf_cmd_unphased', [], 0, agent)).toEqual({
      mode: 'agent',
      runId: 'wf_cmd_unphased',
      agentNumber: 1,
    })
    expect(workflowAgentBackTarget('wf_cmd_unphased', null)).toEqual({
      mode: 'run',
      runId: 'wf_cmd_unphased',
    })
  })

  test('interactive run view keeps phase drilldown when phases exist', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_phased',
      runId: 'wf_cmd_phased',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(1, 2)).toBe(false)
    expect(
      workflowRunOpenTarget('wf_cmd_phased', ['Scan'], 0, agent),
    ).toEqual({
      mode: 'phase',
      runId: 'wf_cmd_phased',
      phase: 'Scan',
    })
    expect(workflowAgentBackTarget('wf_cmd_phased', 'Scan')).toEqual({
      mode: 'phase',
      runId: 'wf_cmd_phased',
      phase: 'Scan',
    })
  })

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

  test('run detail prefers live task progress with phase and agent summaries', async () => {
    const taskId = 'wtaskcmd_detail'
    const runId = 'wf_cmd_detail'
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
      runId,
    )

    expect(message).toContain(`demo (${runId})`)
    expect(message).toContain('Scan · 1 agent(s) · 1 running · 25 tok · 1 tools')
    expect(message).toContain('Write · 1 agent(s) · 1 completed · 30 tok · 2 tools')
    expect(message).toContain('#1 [Scan] Scan routes · running · 25 tok · 1 tools')
    expect(message).toContain('Read commands/workflows/workflows.tsx')
    expect(message).toContain(`/workflows pause ${runId}`)
  })

  test('agent detail drills into prompt, latest tool, and result preview', async () => {
    const taskId = 'wtaskcmd_agent_detail'
    const runId = 'wf_cmd_agent_detail'
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
      `agent ${runId} 1`,
    )

    expect(message).toContain('#1 Scan routes')
    expect(message).toContain('running')
    expect(message).toContain('Scan')
    expect(message).toContain(
      'Prompt: Inspect workflow routing and report the important files.',
    )
    expect(message).toContain('Read commands/workflows/workflows.tsx')
    expect(message).toContain('Found the command detail renderer.')
    expect(message).toContain(`/workflows restart-agent ${runId} 1`)
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

  test('restart-agent requests a restart for the selected workflow agent', async () => {
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
      `restart-agent ${runId} 1`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#1')
    expect(state.tasks[taskId]?.agents?.[0]?.status).toBe('retry_requested')
    expect(state.tasks[taskId]?.summary).toBe('retry requested for agent #1')
  })

  test('restart-agent only restarts a running agent', async () => {
    const taskId = 'wtaskcmd_retry_completed_agent'
    const runId = 'wf_cmd_retry_completed_agent'
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
      `restart-agent ${runId} 2`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#2')
    expect(state.tasks[taskId]?.agents?.[1]?.status).toBe('completed')
    expect(state.tasks[taskId]?.summary).toBe('demo')
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

  test('resume-task queues stopped workflow runs like the interactive view', async () => {
    const taskId = 'wtaskcmd_stopped_resume'
    const runId = 'wf_cmd_stopped_resume'
    const state = {
      tasks: {
        [taskId]: {
          ...runningWorkflowTask({ taskId, runId }),
          status: 'killed',
          abortController: undefined,
          endTime: Date.now(),
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
      "Workflow({scriptPath: '/tmp/workflows/wf_cmd_stopped_resume/script.js'",
    )
    expect(nextInput).toContain("resumeFromRunId: 'wf_cmd_stopped_resume'")
    expect(nextInput).not.toContain(taskId)
  })
})
