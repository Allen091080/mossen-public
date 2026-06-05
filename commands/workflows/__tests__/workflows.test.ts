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
  recentToolCallLines,
  shouldRouteWorkflowAgentControl,
  shouldShowRunLevelAgents,
  sumAgentElapsedMs,
  toggleWorkflowSaveScope,
  workflowAgentBackTarget,
  workflowRunOpenTarget,
  workflowSaveOpenTarget,
  workflowSaveRunArgs,
} from '../WorkflowRunsDialog.js'
import {
  appendJournalEntry,
  appendJournalStartedEntry,
  clearActiveWorkflowRunsForTests,
  initRunArtifacts,
  loadRunMeta,
  STALE_RUNNING_WORKFLOW_MESSAGE,
} from '../../../tools/WorkflowTool/engine/journalStore.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
  loadWorkflowCommandsFrom,
  WORKFLOW_HOME_ENV,
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
        recentToolCalls: [
          { name: 'Glob', summary: 'commands/workflows/*.tsx' },
          { name: 'Read', summary: 'commands/workflows/workflows.tsx' },
        ],
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
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-save-command-name-'))
    const sessionId =
      '33333333-3333-4333-8333-333333333333' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
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
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('save dialog maps project/user scopes and user save uses run metadata name', () => {
    const saveView = workflowSaveOpenTarget('wf_scope_save', {
      mode: 'run',
      runId: 'wf_active',
    })
    expect(saveView).toEqual({
      mode: 'save',
      runId: 'wf_scope_save',
      scope: 'project',
      previous: { mode: 'run', runId: 'wf_active' },
    })
    expect(
      workflowSaveOpenTarget('wf_scope_save_again', {
        ...saveView,
        scope: 'user',
      }),
    ).toEqual({
      mode: 'save',
      runId: 'wf_scope_save_again',
      scope: 'project',
      previous: { mode: 'run', runId: 'wf_active' },
    })
    expect(toggleWorkflowSaveScope('project')).toBe('user')
    expect(toggleWorkflowSaveScope('user')).toBe('project')
    expect(workflowSaveRunArgs('wf_scope_save', 'project')).toEqual([
      'wf_scope_save',
    ])
    expect(workflowSaveRunArgs('wf_scope_save', 'user')).toEqual([
      'wf_scope_save',
      '--user',
    ])

    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-save-user-scope-'))
    const sessionId =
      '66666666-6666-4666-8666-666666666666' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_user_scope_save'
      initRunArtifacts(
        runId,
        `
export const meta = { name: 'draft-name', description: 'Generated flow' }
return 'ok'
`,
        {
          runId,
          workflowName: 'Team audit flow',
          description: 'Generated flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )

      const message = saveRun(workflowSaveRunArgs(runId, 'user'))
      const savedPath = join(getUserWorkflowsDir(), 'Team-audit-flow.js')

      expect(message).toContain('/Team-audit-flow')
      expect(message).toContain('user')
      expect(readFileSync(savedPath, 'utf8')).toContain(
        'name: "Team-audit-flow"',
      )
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).toContain(
        'Team-audit-flow',
      )
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
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
    expect(shouldRouteWorkflowAgentControl('run', true)).toBe(true)
    expect(shouldRouteWorkflowAgentControl('list')).toBe(false)
    expect(shouldRouteWorkflowAgentControl('save')).toBe(false)
  })

  test('unphased run view treats the selected run-level row as an agent target', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_run_level_control',
      runId: 'wf_cmd_run_level_control',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(0, 1)).toBe(true)
    expect(workflowRunOpenTarget('wf_cmd_run_level_control', [], 0, agent)).toEqual({
      mode: 'agent',
      runId: 'wf_cmd_run_level_control',
      agentNumber: 1,
    })
    expect(shouldRouteWorkflowAgentControl('run', true)).toBe(true)
    expect(shouldRouteWorkflowAgentControl('run', false)).toBe(false)
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

  test('interactive progress view totals elapsed time across phase agents', () => {
    const agents: LocalWorkflowTaskState['agents'] = [
      {
        agentNumber: 1,
        label: 'Scan routes',
        phase: 'Scan',
        status: 'completed',
        tokens: 10,
        toolCalls: 1,
        durationMs: 1200,
      },
      {
        agentNumber: 2,
        label: 'Review findings',
        phase: 'Scan',
        status: 'completed',
        tokens: 20,
        toolCalls: 2,
        durationMs: 3400,
      },
      {
        agentNumber: 3,
        label: 'Queued follow-up',
        phase: 'Scan',
        status: 'queued',
        tokens: 0,
        toolCalls: 0,
      },
    ]

    expect(sumAgentElapsedMs(agents)).toBe(4600)
  })

  test('interactive agent detail renders recent tool calls in order', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_recent_tools',
      runId: 'wf_cmd_recent_tools',
    }).agents[0]!

    expect(recentToolCallLines(agent)).toEqual([
      'Tool 1: Glob commands/workflows/*.tsx',
      'Tool 2: Read commands/workflows/workflows.tsx',
    ])
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

  test('resume queues stopped journal runs but not completed history', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-resume-status-'))
    const sessionId =
      '44444444-4444-4444-8444-444444444444' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      initRunArtifacts(
        'wf_stopped-resume',
        'return "stopped"',
        {
          runId: 'wf_stopped-resume',
          workflowName: 'stopped-flow',
          description: 'Stopped flow',
          createdAt: new Date(0).toISOString(),
          status: 'killed',
          args: { ticket: 42 },
        },
      )
      initRunArtifacts(
        'wf_completed-history',
        'return "completed"',
        {
          runId: 'wf_completed-history',
          workflowName: 'completed-flow',
          description: 'Completed flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )
      initRunArtifacts(
        'wf_stale-running',
        'return "stale"',
        {
          runId: 'wf_stale-running',
          workflowName: 'stale-flow',
          description: 'Stale flow',
          createdAt: new Date(0).toISOString(),
          status: 'running',
        },
      )
      clearActiveWorkflowRunsForTests()

      let stoppedMessage = ''
      let stoppedNextInput = ''
      await call(
        (nextMessage, options) => {
          stoppedMessage = nextMessage
          stoppedNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_stopped-resume',
      )

      expect(stoppedMessage).toContain('wf_stopped-resume')
      expect(stoppedNextInput).toContain(
        "Workflow({scriptPath: '",
      )
      expect(stoppedNextInput).toContain("resumeFromRunId: 'wf_stopped-resume'")
      expect(stoppedNextInput).toContain('args: {"ticket":42}')

      let completedMessage = ''
      let completedNextInput = ''
      await call(
        (nextMessage, options) => {
          completedMessage = nextMessage
          completedNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_completed-history',
      )

      expect(completedMessage).toContain('wf_completed-history')
      expect(completedNextInput).toBe('')

      let staleMessage = ''
      let staleNextInput = ''
      await call(
        (nextMessage, options) => {
          staleMessage = nextMessage
          staleNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_stale-running',
      )

      expect(staleMessage).toContain('wf_stale-running')
      expect(staleNextInput).toBe('')
      expect(loadRunMeta('wf_stale-running')?.status).toBe('failed')
      expect(loadRunMeta('wf_stale-running')?.failures).toContain(
        STALE_RUNNING_WORKFLOW_MESSAGE,
      )
    } finally {
      clearActiveWorkflowRunsForTests()
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

  test('run detail reconstructs completed history progress from the journal', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-history-detail-'))
    const sessionId =
      '55555555-5555-4555-8555-555555555555' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_detail'
      initRunArtifacts(
        runId,
        'return "history"',
        {
          runId,
          workflowName: 'history-flow',
          description: 'History flow',
          phases: [{ title: 'Scan' }, { title: 'Review' }],
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          agentCount: 2,
          tokensSpent: 55,
          totalToolCalls: 3,
          durationMs: 4600,
          result: 'Final historical report\n- Found routes and reviews.',
        },
      )
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 0,
        hash: 'h0',
        label: 'Scan routes',
        phase: 'Scan',
        agentNumber: 1,
        opts: { model: 'fast', agentType: 'Explore' },
      })
      appendJournalEntry(runId, {
        index: 0,
        hash: 'h0',
        value: 'Found historical routes.',
        tokens: 25,
        toolCalls: 1,
        ok: true,
      })
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 1,
        hash: 'h1',
        label: 'Review findings',
        phase: 'Review',
        agentNumber: 2,
        opts: {},
      })
      appendJournalEntry(runId, {
        index: 1,
        hash: 'h1',
        value: { ok: true },
        tokens: 30,
        toolCalls: 2,
        ok: true,
      })

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        runId,
      )

      expect(message).toContain(`history-flow (${runId})`)
      expect(message).toContain('Scan · 1 agent(s) · 1 completed · 25 tok · 1 tools')
      expect(message).toContain('Review · 1 agent(s) · 1 completed · 30 tok · 2 tools')
      expect(message).toMatch(/(?:Result|结果):/)
      expect(message).toContain('Final historical report')
      expect(message).toContain('- Found routes and reviews.')
      expect(message).toContain('#1 [Scan] Scan routes · completed · 25 tok · 1 tools')
      expect(message).toContain('Found historical routes.')
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

  test('run detail shows completed final result even when there are no agent journal entries', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-history-result-only-'))
    const sessionId =
      '77777777-7777-4777-8777-777777777777' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_result_only'
      initRunArtifacts(
        runId,
        'return "final"',
        {
          runId,
          workflowName: 'result-only-flow',
          description: 'Result only flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          result: 'Top-level report\n- answer: 42',
        },
      )

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        runId,
      )

      expect(message).toContain(`result-only-flow (${runId})`)
      expect(message).toMatch(/(?:Result|结果):/)
      expect(message).toContain('Top-level report')
      expect(message).toContain('- answer: 42')
      expect(message).toMatch(/(?:No progress recorded for this run|没有记录执行过程)/)
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
    expect(message).toContain('Glob commands/workflows/*.tsx')
    expect(message).toContain('Read commands/workflows/workflows.tsx')
    expect(message).toContain('Found the command detail renderer.')
    expect(message).toContain(`/workflows restart-agent ${runId} 1`)
  })

  test('agent detail reconstructs completed history agents from the journal', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-history-agent-detail-'))
    const sessionId =
      '66666666-6666-4666-8666-666666666666' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_agent_detail'
      initRunArtifacts(
        runId,
        'return "history"',
        {
          runId,
          workflowName: 'history-agent-flow',
          description: 'History agent flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 0,
        hash: 'h0',
        label: 'Scan routes',
        phase: 'Scan',
        agentNumber: 1,
        opts: { isolation: 'remote' },
      })
      appendJournalEntry(runId, {
        index: 0,
        hash: 'h0',
        value: 'Historical agent result.',
        tokens: 25,
        toolCalls: 1,
        ok: true,
      })

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        `agent ${runId} 1`,
      )

      expect(message).toContain('#1 Scan routes')
      expect(message).toContain('completed')
      expect(message).toContain('Scan')
      expect(message).toContain('isolation: remote')
      expect(message).toContain('Historical agent result.')
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
