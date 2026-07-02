import { describe, it, expect } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement } from 'react'
import {
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  getOriginalCwd,
  clearSessionGoalState,
  setProjectRoot,
  setSessionGoalState,
  switchSession,
  setOriginalCwd,
  setUltracodeActive,
  snapshotOutputTokensForTurn,
} from '../../../bootstrap/state.js'
import type { AppState } from '../../../state/AppState.js'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import {
  appendWorkflowResultLogLine,
  getWorkflowAgentStallTimeoutMs,
  MAX_WORKFLOW_RESULT_LOG_LINES,
  setWorkflowAgentRunnerFactoryForTests,
  WorkflowTool,
} from '../WorkflowTool.js'
import { WORKFLOW_TOOL_NAME } from '../constants.js'
import { hashCall } from '../engine/journal.js'
import {
  appendJournalEntry,
  clearActiveWorkflowRunsForTests,
  initRunArtifacts,
  loadJournal,
  loadRunLog,
  loadRunMeta,
  STALE_RUNNING_WORKFLOW_MESSAGE,
  workflowReportPath,
} from '../engine/journalStore.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
  loadWorkflowCommandsFrom,
  savedWorkflowToolInputForArgs,
  WORKFLOW_HOME_ENV,
} from '../savedWorkflows.js'
import { saveRun } from '../../../commands/workflows/saveWorkflow.js'
import { call as workflowsCommandCall } from '../../../commands/workflows/workflows.js'
import {
  killWorkflowTask,
  type LocalWorkflowTaskState,
} from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  WORKFLOW_AGENT_RETRY_ABORT_REASON,
  WORKFLOW_AGENT_SKIP_ABORT_REASON,
} from '../engine/types.js'
import { dequeueAll } from '../../../utils/messageQueueManager.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import {
  recordWorkflowUsageConsent,
  workflowUsageConsentHash,
} from '../usageConsent.js'

function toolUseContextWithWorkflowRules({
  allow = [],
  ask = [],
  deny = [],
  mode = 'default',
  isBypassPermissionsModeAvailable = false,
  shouldAvoidPermissionPrompts = false,
  isNonInteractiveSession = false,
}: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
  mode?: AppState['toolPermissionContext']['mode']
  isBypassPermissionsModeAvailable?: boolean
  shouldAvoidPermissionPrompts?: boolean
  isNonInteractiveSession?: boolean
} = {}): ToolUseContext {
  const base = getEmptyToolPermissionContext()
  return {
    options: {
      isNonInteractiveSession,
    },
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...base,
        mode,
        alwaysAllowRules: allow.length ? { localSettings: allow } : {},
        alwaysAskRules: ask.length ? { localSettings: ask } : {},
        alwaysDenyRules: deny.length ? { localSettings: deny } : {},
        isBypassPermissionsModeAvailable,
        shouldAvoidPermissionPrompts,
      },
    }),
  } as unknown as ToolUseContext
}

describe('getWorkflowAgentStallTimeoutMs', () => {
  it('uses the default, clamps invalid lows, and caps high env overrides', () => {
    expect(getWorkflowAgentStallTimeoutMs({})).toBe(60_000)
    expect(
      getWorkflowAgentStallTimeoutMs({
        MOSSEN_CODE_WORKFLOW_AGENT_STALL_TIMEOUT_MS: '0',
      }),
    ).toBe(1)
    expect(
      getWorkflowAgentStallTimeoutMs({
        MOSSEN_CODE_WORKFLOW_AGENT_STALL_TIMEOUT_MS: '999999999',
      }),
    ).toBe(300_000)
    expect(
      getWorkflowAgentStallTimeoutMs({
        MOSSEN_CODE_WORKFLOW_AGENT_STALL_TIMEOUT_MS: 'abc',
      }),
    ).toBe(60_000)
  })
})

function workflowValidationContext(
  tasks: Record<string, unknown> = {},
): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      tasks,
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    setAppState: () => {},
  } as unknown as ToolUseContext
}

async function waitForWorkflowLog(
  runId: string,
  predicate: (lines: string[]) => boolean,
): Promise<string[]> {
  for (let i = 0; i < 25; i++) {
    const lines = loadRunLog(runId)
    if (predicate(lines)) return lines
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return loadRunLog(runId)
}

async function waitForRunMetaStatus(
  runId: string,
  status: string,
): Promise<string | undefined> {
  for (let i = 0; i < 25; i++) {
    const current = loadRunMeta(runId)?.status
    if (current === status) return current
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return loadRunMeta(runId)?.status
}

async function waitForTaskStatus(
  getTask: () => LocalWorkflowTaskState | undefined,
  status: string,
): Promise<LocalWorkflowTaskState | undefined> {
  for (let i = 0; i < 25; i++) {
    const task = getTask()
    if (task?.status === status) return task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return getTask()
}

async function waitForTaskAgentStatus(
  getTask: () => LocalWorkflowTaskState | undefined,
  agentNumber: number,
  status: LocalWorkflowTaskState['agents'][number]['status'],
): Promise<LocalWorkflowTaskState | undefined> {
  for (let i = 0; i < 50; i++) {
    const task = getTask()
    const agent = task?.agents.find(current => current.agentNumber === agentNumber)
    if (agent?.status === status) return task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return getTask()
}

async function waitForCondition(
  predicate: () => boolean,
): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return predicate()
}

async function waitForWorkflowLogLine(
  runId: string,
  fragment: string,
): Promise<string> {
  let lines: string[] = []
  for (let i = 0; i < 100; i++) {
    lines = loadRunLog(runId)
    const line = lines.find(current => current.includes(fragment))
    if (line) return line
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return lines.find(line => line.includes(fragment)) ?? ''
}

// Regression for the Ink crash seen in real use: renderToolResultMessage used
// to return a bare string, which crashes the entire render tree with
// `Text string "..." must be rendered within a <Text> component` and exits the
// app. It must return a React element (with strings wrapped in <Text>), never a
// bare string. ink-testing-library is not a dependency here, so we assert on the
// returned node shape directly — string vs element is exactly the bug.
describe('WorkflowTool official tool contract', () => {
  it('exposes the official alias, result ceiling, and classifier input', () => {
    expect(WorkflowTool.aliases).toContain('RunWorkflow')
    expect(WorkflowTool.maxResultSizeChars).toBe(100_000)
    expect(
      WorkflowTool.toAutoClassifierInput({
        script: 'export const meta = {}',
      } as never),
    ).toBe('export const meta = {}')
    expect(WorkflowTool.toAutoClassifierInput({ name: 'deep-research' })).toBe(
      'deep-research',
    )
    expect(
      WorkflowTool.toAutoClassifierInput({ scriptPath: '/tmp/workflow.js' }),
    ).toBe('')
    expect(
      WorkflowTool.toAutoClassifierInput({ task: 'audit the project' }),
    ).toBe('audit the project')
  })

  it('uses a strict object input schema and requires a workflow source', () => {
    expect(
      WorkflowTool.inputSchema.safeParse({
        script: `
export const meta = { name: 'strict-flow', description: 'strict flow' }
return 'ok'
`,
        unexpected: true,
      }).success,
    ).toBe(false)
    expect(WorkflowTool.inputSchema.safeParse({ args: { ticket: 42 } }).success).toBe(
      false,
    )
    expect(WorkflowTool.inputSchema.safeParse({ task: 'audit the diff' }).success).toBe(
      true,
    )
  })

  it('validates workflow source and deterministic APIs before permissions', async () => {
    const invalid = await WorkflowTool.validateInput!(
      {
        script: `
return 'ok'
`,
      },
      workflowValidationContext(),
    )
    expect(invalid.result).toBe(false)
    if (invalid.result === false) {
      expect(invalid.errorCode).toBe(2)
      expect(invalid.message).toContain('Invalid workflow script:')
    }

    const nondeterministic = await WorkflowTool.validateInput!(
      {
        script: `
export const meta = { name: 'clock-flow', description: 'clock flow' }
return Date.now()
`,
      },
      workflowValidationContext(),
    )
    expect(nondeterministic).toEqual({
      result: false,
      message:
        'Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.',
      errorCode: 4,
    })
  })

  it('allows nondeterministic API names inside workflow prompt strings', async () => {
    const result = await WorkflowTool.validateInput!(
      {
        script: `
export const meta = { name: 'prompt-flow', description: 'Prompt flow' }
const prompt = 'Explain Date.now(), Math.random(), and new Date() migrations.'
return agent(prompt)
`,
      },
      workflowValidationContext(),
    )

    expect(result).toEqual({ result: true })
  })

  it('validates the official active-run resume guard before permissions', async () => {
    const result = await WorkflowTool.validateInput!(
      {
        script: `
export const meta = { name: 'running-resume', description: 'running resume' }
return 'ok'
`,
        resumeFromRunId: 'wf_resume1',
      },
      workflowValidationContext({
        task_slot: {
          id: 'wf_live_task',
          type: 'local_workflow',
          status: 'running',
          runId: 'wf_resume1',
          workflowRunId: 'wf_resume1',
        },
      }),
    )

    expect(result).toEqual({
      result: false,
      message:
        'Workflow wf_resume1 is still running (task wf_live_task). Stop it first with TaskStop({task_id: "wf_live_task"}) before resuming.',
      errorCode: 3,
    })
  })

  it('refuses resumeFromRunId for stale running runs from a previous process', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-stale-running-resume-'))
    const sessionId =
      '66666666-6666-4666-8666-666666666666' as ReturnType<typeof getSessionId>
    const runId = 'wf_stale-running'
    const script = `
export const meta = { name: 'stale-running', description: 'stale running flow' }
const result = await agent('should not reuse cached result')
return result
`

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      initRunArtifacts(runId, script, {
        runId,
        workflowName: 'stale-running',
        description: 'stale running flow',
        createdAt: new Date(0).toISOString(),
        status: 'running',
      })
      appendJournalEntry(runId, {
        index: 0,
        hash: hashCall('should not reuse cached result', {}),
        value: 'stale cached result',
        tokens: 7,
        toolCalls: 1,
        ok: true,
      })
      clearActiveWorkflowRunsForTests()

      const validation = await WorkflowTool.validateInput!(
        {
          script,
          resumeFromRunId: runId,
        },
        workflowValidationContext(),
      )

      expect(validation).toEqual({
        result: false,
        message:
          'Workflow wf_stale-running cannot be resumed from status "failed". Relaunch the workflow without resumeFromRunId to start fresh.',
        errorCode: 3,
      })
      expect(loadRunMeta(runId)?.failures).toContain(
        STALE_RUNNING_WORKFLOW_MESSAGE,
      )
      await expect(
        WorkflowTool.call!(
          {
            script,
            resumeFromRunId: runId,
          },
          {
            abortController: new AbortController(),
            toolUseId: 'toolu_stale_running_wf',
            getAppState: () => ({
              tasks: {},
              toolPermissionContext: getEmptyToolPermissionContext(),
            }),
            setAppState: () => {},
          } as unknown as ToolUseContext,
          async () => ({ behavior: 'allow' }) as never,
        ),
      ).rejects.toThrow(
        'Workflow wf_stale-running cannot be resumed from status "failed". Relaunch the workflow without resumeFromRunId to start fresh.',
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
})

describe('WorkflowTool renderToolResultMessage (Ink crash regression)', () => {
  it('returns a React element for an async launched run, not a bare string', () => {
    const out = {
      status: 'async_launched' as const,
      taskId: 'wf_demo',
      runId: 'wf_demo',
      summary: 'Project analysis',
      transcriptDir: '/tmp/wf_demo/transcripts',
      scriptPath: '/tmp/wf_demo/script.js',
    }
    const el = WorkflowTool.renderToolResultMessage!(out as never)
    expect(typeof el).not.toBe('string')
    expect(isValidElement(el)).toBe(true)
  })

  it('returns a React element for a remote launched run', () => {
    const out = {
      status: 'remote_launched' as const,
      taskId: 'remote-task',
      summary: 'Remote workflow',
      sessionUrl: 'https://example.invalid/session',
    }
    const el = WorkflowTool.renderToolResultMessage!(out as never)
    expect(typeof el).not.toBe('string')
    expect(isValidElement(el)).toBe(true)
  })
})

describe('WorkflowTool captured run log', () => {
  it('caps result logs to the official runner limit', () => {
    const log: string[] = []
    for (let i = 0; i < MAX_WORKFLOW_RESULT_LOG_LINES + 10; i++) {
      appendWorkflowResultLogLine(log, `line-${i}`)
    }

    expect(log).toHaveLength(MAX_WORKFLOW_RESULT_LOG_LINES)
    expect(log[0]).toBe('line-0')
    expect(log[MAX_WORKFLOW_RESULT_LOG_LINES - 1]).toBe(
      `line-${MAX_WORKFLOW_RESULT_LOG_LINES - 1}`,
    )
  })
})

describe('WorkflowTool runtime budget', () => {
  it('passes the current turn token budget into real workflow runs', async () => {
    snapshotOutputTokensForTurn(123_456)
    try {
      const result = await WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'budget-flow', description: 'Budget flow' }
log('budget:' + JSON.stringify({
  total: budget.total,
  remaining: budget.remaining(),
  spent: budget.spent(),
}))
return 'ok'
`,
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)

      const lines = await waitForWorkflowLog(
        result.data.runId!,
        current => current.some(line => line.startsWith('budget:')),
      )
      const budgetLine = lines.find(line => line.startsWith('budget:'))
      expect(budgetLine).toBeDefined()
      expect(JSON.parse(budgetLine!.slice('budget:'.length))).toEqual({
        total: 123_456,
        remaining: 123_456,
        spent: 0,
      })
    } finally {
      snapshotOutputTokensForTurn(null)
    }
  })
})

describe('WorkflowTool headless launch', () => {
  it('runs locally when permission prompts cannot be shown', async () => {
    let state = {
      tasks: {},
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        shouldAvoidPermissionPrompts: true,
      },
    } as unknown as AppState

    const result = await WorkflowTool.call!(
      {
        script: `
export const meta = { name: 'headless-flow', description: 'Headless workflow launch', model: 'sonnet' }
return 'ok'
`,
        args: { ticket: 42 },
        timeoutMs: 1234,
      },
      {
        abortController: new AbortController(),
        toolUseId: 'toolu_headless_wf',
        getAppState: () => state,
        setAppState: (updater: (prev: AppState) => AppState) => {
          state = updater(state)
        },
      } as unknown as ToolUseContext,
      async () => ({ behavior: 'allow' }) as never,
    )

    expect(result.data.status).toBe('async_launched')
    expect(result.data.taskId).toMatch(/^[a-z0-9]{9}$/)
    expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)
    expect(result.data.summary).toBe('Headless workflow launch')
    expect(result.data.transcriptDir).toContain(`/workflows/${result.data.runId}`)
    expect(result.data.scriptPath).toContain(`/${result.data.runId}/script.js`)
    expect((result.data as { sessionUrl?: string }).sessionUrl).toBeUndefined()
    expect(state.tasks[result.data.taskId]).toMatchObject({
      type: 'local_workflow',
      status: 'running',
      workflowName: 'headless-flow',
      description: 'Headless workflow launch',
      isBackgrounded: true,
    })
  })

  it('persists the active goal id as the workflow parent goal', async () => {
    const goal = setSessionGoalState('ship workflow parent goal linkage')
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState

    try {
      const result = await WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'goal-parent-flow', description: 'Goal parent workflow' }
return 'ok'
`,
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_goal_parent_wf',
          getAppState: () => state,
          setAppState: (updater: (prev: AppState) => AppState) => {
            state = updater(state)
          },
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(loadRunMeta(result.data.runId!)?.parentGoalId).toBe(goal.id)
      expect(
        (state.tasks[result.data.taskId!] as LocalWorkflowTaskState)
          .parentGoalId,
      ).toBe(goal.id)
    } finally {
      clearSessionGoalState('user_cancel')
    }
  })
})

describe('WorkflowTool dynamic task launch', () => {
  it('auto-plans a natural-language task into an executable workflow run', async () => {
    const priorFactory = setWorkflowAgentRunnerFactoryForTests
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    const calls: Array<{ label: string; phase: string | null; prompt: string }> = []

    setWorkflowAgentRunnerFactoryForTests(() => async (prompt, _opts, meta) => {
      calls.push({ label: meta.label, phase: meta.phase, prompt })
      if (meta.label === 'planner') {
        return {
          value: {
            summary: 'Plan Agent View recovery audit',
            successCriteria: ['stale workers are detected'],
            verificationPlan: ['run focused tests'],
            workItems: [
              {
                key: 'state',
                title: 'Inspect state model',
                prompt: 'Check stale worker state projection.',
              },
              {
                key: 'ui',
                title: 'Inspect UI actions',
                prompt: 'Check Agent View action labels.',
              },
            ],
          },
          tokens: 11,
          toolCalls: 1,
          ok: true,
        }
      }
      if (meta.label.startsWith('execute:')) {
        return {
          value: {
            key: meta.label.replace('execute:', ''),
            summary: `executed ${meta.label}`,
            evidence: ['focused evidence'],
            artifacts: ['commands/workflows/workflows.tsx'],
            risks: [],
            nextActions: [],
          },
          tokens: 13,
          toolCalls: 2,
          ok: true,
        }
      }
      if (meta.label.startsWith('verify:')) {
        return {
          value: {
            key: meta.label.replace('verify:', ''),
            accepted: true,
            summary: `verified ${meta.label}`,
            evidence: ['verification evidence'],
            gaps: [],
          },
          tokens: 7,
          toolCalls: 1,
          ok: true,
        }
      }
      return {
        value: {
          summary: 'Agent View dynamic workflow completed.',
          evidence: ['planner, execution, and verification agents completed'],
          validationCommands: ['bun test tools/WorkflowTool/__tests__/WorkflowTool.test.ts'],
          artifacts: ['commands/workflows/workflows.tsx'],
          residualRisks: [],
          openQuestions: [],
        },
        tokens: 5,
        toolCalls: 1,
        ok: true,
      }
    })

    try {
      const result = await WorkflowTool.call!(
        {
          task: 'Audit Agent View status recovery and produce verification evidence.',
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_dynamic_task_wf',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(result.data.summary).toContain('Auto-plan, execute, verify')
      expect(result.data.scriptPath).toContain(`${result.data.runId}/script.js`)
      expect(readFileSync(result.data.scriptPath!, 'utf8')).toContain(
        'const PLAN_SCHEMA',
      )
      expect(await waitForRunMetaStatus(result.data.runId!, 'completed')).toBe(
        'completed',
      )
      const meta = loadRunMeta(result.data.runId!)
      expect(meta?.workflowName).toStartWith(
        'dynamic-audit-agent-view-status-recovery',
      )
      expect(meta?.workflowName).toContain('produce-verification')
      expect(meta?.phases?.map(phase => phase.title)).toEqual([
        'Plan',
        'Execute',
        'Verify',
        'Synthesize',
      ])
      expect(meta?.result).toContain('Agent View dynamic workflow completed.')
      expect(meta?.result).toContain(
        'bun test tools/WorkflowTool/__tests__/WorkflowTool.test.ts',
      )
      expect(calls.map(call => `${call.phase}:${call.label}`)).toEqual([
        'Plan:planner',
        'Execute:execute:state',
        'Execute:execute:ui',
        'Verify:verify:state',
        'Verify:verify:ui',
        'Synthesize:synthesis',
      ])
      expect(calls[0]?.prompt).toContain(
        'Audit Agent View status recovery and produce verification evidence.',
      )
    } finally {
      priorFactory(null)
    }
  })
})

describe('WorkflowTool final result delivery', () => {
  it('returns the workflow top-level value to the current session notification', async () => {
    dequeueAll()
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    const result = await WorkflowTool.call!(
      {
        script: `
export const meta = { name: 'result-flow', description: 'Result delivery flow' }
return { answer: 42, text: 'done <ok>' }
`,
      },
      {
        abortController: new AbortController(),
        toolUseId: 'toolu_result_wf',
        getAppState: () => state,
        setAppState,
      } as unknown as ToolUseContext,
      async () => ({ behavior: 'allow' }) as never,
    )

    expect(result.data.status).toBe('async_launched')
    expect(await waitForRunMetaStatus(result.data.runId!, 'completed')).toBe(
      'completed',
    )
    const task = await waitForTaskStatus(
      () => state.tasks[result.data.taskId] as LocalWorkflowTaskState | undefined,
      'completed',
    )
    const meta = loadRunMeta(result.data.runId!)
    expect(meta?.result).toContain('"answer": 42')
    expect(meta?.result).toContain('"text": "done <ok>"')
    expect(task?.result).toBe(meta?.result)
    const runLogText = loadRunLog(result.data.runId!).join('\n')
    expect(runLogText).toContain('result: {')
    expect(runLogText).toContain('"answer": 42')
    const reportPath = workflowReportPath(result.data.runId!)
    expect(await waitForCondition(() => existsSync(reportPath))).toBe(true)
    const reportText = readFileSync(reportPath, 'utf8')
    expect(reportText).toContain('# Workflow Report: result-flow')
    expect(reportText).toContain('## Verification Evidence')
    expect(reportText).toContain('"answer": 42')

    const notification = dequeueAll()
      .map(command => command.value)
      .find(
        value =>
          typeof value === 'string' &&
          value.includes(`<task-id>${result.data.taskId}</task-id>`),
      )
    expect(notification).toContain('<result>{')
    expect(notification).toContain('"answer": 42')
    expect(notification).toContain('"text": "done &lt;ok&gt;"')
  })
})

describe('WorkflowTool named workflow permissions', () => {
  const AUTO_CONSENT_WORKFLOW = `
export const meta = { name: 'auto-flow', description: 'Auto consent flow' }
return 'ok'
`

  it('asks by default for dynamic workflows and suggests a named workflow allow rule', async () => {
    const decision = await WorkflowTool.checkPermissions(
      { name: ' ship-check ' },
      toolUseContextWithWorkflowRules(),
    )

    expect(decision.behavior).toBe('ask')
    if (decision.behavior !== 'ask') {
      throw new Error(`Expected ask, got ${decision.behavior}`)
    }
    expect(decision.message).toBe('Run workflow: ship-check')
    expect(decision.updatedInput).toEqual({ name: ' ship-check ' })
    expect(decision.suggestions).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: WORKFLOW_TOOL_NAME, ruleContent: 'ship-check' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })

  it('allows a workflow when an exact named workflow rule exists', async () => {
    const decision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        allow: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
      }),
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.decisionReason?.type).toBe('rule')
    if (decision.decisionReason?.type === 'rule') {
      expect(decision.decisionReason.rule.ruleValue).toEqual({
        toolName: WORKFLOW_TOOL_NAME,
        ruleContent: 'ship-check',
      })
    }
  })

  it('respects exact named workflow ask and deny rules', async () => {
    const askDecision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        ask: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
      }),
    )

    expect(askDecision.behavior).toBe('ask')
    if (askDecision.behavior !== 'ask') {
      throw new Error(`Expected ask, got ${askDecision.behavior}`)
    }
    expect(askDecision.decisionReason?.type).toBe('rule')
    if (askDecision.decisionReason?.type === 'rule') {
      expect(askDecision.decisionReason.rule.ruleBehavior).toBe('ask')
    }

    const denyDecision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        allow: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
        deny: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
      }),
    )

    expect(denyDecision.behavior).toBe('deny')
    if (denyDecision.behavior !== 'deny') {
      throw new Error(`Expected deny, got ${denyDecision.behavior}`)
    }
    expect(denyDecision.message).toContain('ship-check')
  })

  it('does not suggest a reusable rule for inline dynamic workflow scripts', async () => {
    const decision = await WorkflowTool.checkPermissions(
      {
        script: `
export const meta = { name: 'inline-flow', description: 'Inline flow' }
return 'ok'
`,
      },
      toolUseContextWithWorkflowRules(),
    )

    expect(decision.behavior).toBe('ask')
    if (decision.behavior !== 'ask') {
      throw new Error(`Expected ask, got ${decision.behavior}`)
    }
    expect(decision.message).toBe('Run dynamic workflow')
    expect(decision.suggestions).toBeUndefined()
  })

  it('requires an interactive launch decision so auto mode does not use the classifier', () => {
    expect(WorkflowTool.requiresUserInteraction?.()).toBe(true)
  })

  it('allows repeated default-mode inline workflow launches after explicit local source consent', async () => {
    const priorCwd = getOriginalCwd()
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const tempRoot = mkdtempSync(join(tmpdir(), 'mossen-workflow-default-consent-'))
    const configRoot = join(tempRoot, 'config')
    try {
      setOriginalCwd(tempRoot)
      process.env.MOSSEN_CONFIG_DIR = configRoot
      resetSettingsCache()

      const firstDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'default' }),
      )

      expect(firstDecision.behavior).toBe('ask')
      expect(recordWorkflowUsageConsent(
        workflowUsageConsentHash(AUTO_CONSENT_WORKFLOW),
      )).toBe(true)

      const secondDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'default' }),
      )

      expect(secondDecision.behavior).toBe('allow')
      expect(secondDecision.decisionReason).toEqual({
        type: 'mode',
        mode: 'default',
      })
      const localSettings = JSON.parse(
        readFileSync(join(tempRoot, '.mossen', 'settings.local.json'), 'utf8'),
      )
      expect(localSettings.workflowUsageConsentHashes).toEqual([
        workflowUsageConsentHash(AUTO_CONSENT_WORKFLOW),
      ])
      expect(JSON.stringify(localSettings)).not.toContain('auto-flow')
    } finally {
      setOriginalCwd(priorCwd)
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      resetSettingsCache()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not reuse auto-mode user consent as default or acceptEdits launch consent', async () => {
    const priorCwd = getOriginalCwd()
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const tempRoot = mkdtempSync(join(tmpdir(), 'mossen-workflow-mode-consent-'))
    const configRoot = join(tempRoot, 'config')
    try {
      setOriginalCwd(tempRoot)
      process.env.MOSSEN_CONFIG_DIR = configRoot
      resetSettingsCache()

      expect(recordWorkflowUsageConsent(
        workflowUsageConsentHash(AUTO_CONSENT_WORKFLOW),
        'userSettings',
      )).toBe(true)

      const autoDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'auto' }),
      )
      expect(autoDecision.behavior).toBe('allow')

      const defaultDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'default' }),
      )
      expect(defaultDecision.behavior).toBe('ask')
      if (defaultDecision.behavior !== 'ask') {
        throw new Error(`Expected ask, got ${defaultDecision.behavior}`)
      }
      expect(defaultDecision.message).toBe('Run dynamic workflow')

      const acceptEditsDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'acceptEdits' }),
      )
      expect(acceptEditsDecision.behavior).toBe('ask')
    } finally {
      setOriginalCwd(priorCwd)
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      resetSettingsCache()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('asks on first auto-mode launch, then allows after user-scoped workflow consent', async () => {
    const priorCwd = getOriginalCwd()
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const tempRoot = mkdtempSync(join(tmpdir(), 'mossen-workflow-auto-consent-'))
    const configRoot = join(tempRoot, 'config')
    try {
      setOriginalCwd(tempRoot)
      process.env.MOSSEN_CONFIG_DIR = configRoot
      resetSettingsCache()

      const firstDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'auto' }),
      )

      expect(firstDecision.behavior).toBe('ask')
      expect(recordWorkflowUsageConsent(
        workflowUsageConsentHash(AUTO_CONSENT_WORKFLOW),
        'userSettings',
      )).toBe(true)

      const secondDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'auto' }),
      )

      expect(secondDecision.behavior).toBe('allow')
      expect(secondDecision.decisionReason).toEqual({
        type: 'mode',
        mode: 'auto',
      })
      const userSettings = JSON.parse(
        readFileSync(join(configRoot, 'settings.json'), 'utf8'),
      )
      expect(userSettings.workflowUsageConsentHashes).toEqual([
        workflowUsageConsentHash(AUTO_CONSENT_WORKFLOW),
      ])
    } finally {
      setOriginalCwd(priorCwd)
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      resetSettingsCache()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('skips the launch prompt for auto-mode ultracode, bypass mode, and headless contexts', async () => {
    try {
      setUltracodeActive(true)
      const ultracodeDecision = await WorkflowTool.checkPermissions(
        { script: AUTO_CONSENT_WORKFLOW },
        toolUseContextWithWorkflowRules({ mode: 'auto' }),
      )
      expect(ultracodeDecision.behavior).toBe('allow')
      expect(ultracodeDecision.decisionReason).toEqual({
        type: 'mode',
        mode: 'auto',
      })
    } finally {
      setUltracodeActive(false)
    }

    const bypassDecision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        ask: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
        mode: 'bypassPermissions',
      }),
    )
    expect(bypassDecision.behavior).toBe('allow')
    expect(bypassDecision.decisionReason).toEqual({
      type: 'mode',
      mode: 'bypassPermissions',
    })

    const headlessDecision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        shouldAvoidPermissionPrompts: true,
      }),
    )
    expect(headlessDecision.behavior).toBe('allow')
    expect(headlessDecision.decisionReason).toEqual({
      type: 'mode',
      mode: 'default',
    })

    const printModeDecision = await WorkflowTool.checkPermissions(
      { name: 'ship-check' },
      toolUseContextWithWorkflowRules({
        ask: [`${WORKFLOW_TOOL_NAME}(ship-check)`],
        isNonInteractiveSession: true,
      }),
    )
    expect(printModeDecision.behavior).toBe('allow')
    expect(printModeDecision.decisionReason).toEqual({
      type: 'mode',
      mode: 'default',
    })
  })
})

describe('WorkflowTool resume input contract', () => {
  it('requires script, scriptPath, or name even when resumeFromRunId is present', async () => {
    await expect(
      WorkflowTool.call!(
        {
          resumeFromRunId: 'wf_resume1',
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      ),
    ).rejects.toThrow('Must provide script, name, scriptPath, or task')
  })

  it('validates resumeFromRunId against the official run id shape', async () => {
    await expect(
      WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'bad-resume', description: 'bad resume id' }
return 'ok'
`,
          resumeFromRunId: 'resume1',
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      ),
    ).rejects.toThrow('resumeFromRunId must match')
  })

  it('rejects resumeFromRunId while the same workflow run is still running', async () => {
    let setAppStateCalls = 0

    await expect(
      WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'running-resume', description: 'running resume' }
return 'ok'
`,
          resumeFromRunId: 'wf_resume1',
        },
        {
          abortController: new AbortController(),
          getAppState: () => ({
            tasks: {
              task_slot: {
                id: 'wf_live_task',
                type: 'local_workflow',
                status: 'running',
                runId: 'wf_resume1',
                workflowRunId: 'wf_resume1',
              },
            },
          }),
          setAppState: () => {
            setAppStateCalls++
          },
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      ),
    ).rejects.toThrow(
      'Workflow wf_resume1 is still running (task wf_live_task). Stop it first with TaskStop({task_id: "wf_live_task"}) before resuming.',
    )
    expect(setAppStateCalls).toBe(0)
  })

  it('resumes from persisted journal entries and runs uncached agents live', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-tool-resume-cache-'))
    const sessionId =
      '55555555-5555-4555-8555-555555555555' as ReturnType<typeof getSessionId>
    const runId = `wf_resume-tool-${Date.now().toString(36)}`
    const script = `
export const meta = { name: 'resume-cache-flow', description: 'Resume cache flow' }
const first = await agent('first persisted task', { label: 'first persisted' })
const second = await agent('second live task', { label: 'second live' })
return { first, second }
`
    const livePrompts: string[] = []
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'config')
      setProjectRoot(root)
      switchSession(sessionId)
      initRunArtifacts(runId, script, {
        runId,
        workflowName: 'resume-cache-flow',
        description: 'Resume cache flow',
        createdAt: new Date(0).toISOString(),
        status: 'killed',
        args: { ticket: 42 },
      })
      appendJournalEntry(runId, {
        index: 0,
        hash: hashCall('first persisted task', { label: 'first persisted' }),
        value: 'cached first result',
        tokens: 7,
        toolCalls: 1,
        ok: true,
      })
      setWorkflowAgentRunnerFactoryForTests(() => async prompt => {
        livePrompts.push(prompt)
        return {
          value: `live result for ${prompt}`,
          tokens: 11,
          toolCalls: 2,
          ok: true,
        }
      })

      const result = await WorkflowTool.call!(
        {
          script,
          resumeFromRunId: runId,
          args: { ticket: 42 },
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_resume_cache_wf',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(result.data.runId).toBe(runId)

      expect(
        await waitForWorkflowLogLine(runId, 'first persisted (cached'),
      ).toContain('~7 tok')
      const liveLine = await waitForWorkflowLogLine(
        runId,
        'second live (completed',
      )
      expect(liveLine).toContain('~11 tok')
      expect(await waitForRunMetaStatus(runId, 'completed')).toBe('completed')

      const task = await waitForTaskStatus(
        () => state.tasks[result.data.taskId] as LocalWorkflowTaskState | undefined,
        'completed',
      )
      expect(livePrompts).toEqual(['second live task'])
      expect(task?.log).toContain('agent #1 cached: first persisted (7 tokens)')
      expect(task?.log).toContain('agent #2 completed: second live (11 tokens)')
      expect(task?.agents.map(agent => [agent.agentNumber, agent.status])).toEqual(
        [
          [1, 'cached'],
          [2, 'completed'],
        ],
      )
      const meta = loadRunMeta(runId)
      expect(meta?.result).toContain('"first": "cached first result"')
      expect(meta?.result).toContain(
        '"second": "live result for second live task"',
      )
      expect(meta?.args).toEqual({ ticket: 42 })
    } finally {
      setWorkflowAgentRunnerFactoryForTests(null)
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resumes a stopped real run by replaying completed agents and running the rest live', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-tool-real-stop-resume-'))
    const sessionId =
      '99999999-9999-4999-8999-999999999999' as ReturnType<typeof getSessionId>
    const script = `
export const meta = { name: 'real-stop-resume-flow', description: 'Real stop resume flow' }
const first = await agent('first real task', { label: 'first real' })
const second = await agent('second resumed task', { label: 'second resumed' })
return { first, second }
`
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    const firstRunPrompts: string[] = []
    const resumePrompts: string[] = []
    let secondAgentAbortSeen = false

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'config')
      setProjectRoot(root)
      switchSession(sessionId)

      setWorkflowAgentRunnerFactoryForTests(deps => async prompt => {
        firstRunPrompts.push(prompt)
        if (prompt === 'first real task') {
          return {
            value: 'first persisted result',
            tokens: 5,
            toolCalls: 1,
            ok: true,
          }
        }
        return new Promise((_, reject) => {
          const signal = deps.abortController?.signal
          const onAbort = () => {
            secondAgentAbortSeen = true
            reject(new Error('workflow killed during second agent'))
          }
          if (signal?.aborted) {
            onAbort()
            return
          }
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      })

      const firstLaunch = await WorkflowTool.call!(
        {
          script,
          args: { ticket: 7 },
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_real_stop_resume_wf',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(firstLaunch.data.status).toBe('async_launched')
      const runId = firstLaunch.data.runId!
      const taskId = firstLaunch.data.taskId
      const runningTask = await waitForTaskAgentStatus(
        () => state.tasks[taskId] as LocalWorkflowTaskState | undefined,
        2,
        'running',
      )
      expect(
        runningTask?.agents.find(agent => agent.agentNumber === 1)?.status,
      ).toBe('completed')
      expect(
        runningTask?.agents.find(agent => agent.agentNumber === 2)?.status,
      ).toBe('running')
      expect(loadJournal(runId)?.entries).toHaveLength(1)

      killWorkflowTask(taskId, setAppState)

      expect(await waitForRunMetaStatus(runId, 'killed')).toBe('killed')
      expect(secondAgentAbortSeen).toBe(true)
      expect(firstRunPrompts).toEqual(['first real task', 'second resumed task'])

      setWorkflowAgentRunnerFactoryForTests(() => async prompt => {
        resumePrompts.push(prompt)
        return {
          value: `live resume result for ${prompt}`,
          tokens: 13,
          toolCalls: 3,
          ok: true,
        }
      })

      const resumeLaunch = await WorkflowTool.call!(
        {
          scriptPath: firstLaunch.data.scriptPath,
          resumeFromRunId: runId,
          args: { ticket: 7 },
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_real_stop_resume_wf_2',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(resumeLaunch.data.status).toBe('async_launched')
      expect(resumeLaunch.data.runId).toBe(runId)
      expect(resumeLaunch.data.taskId).not.toBe(taskId)
      expect(await waitForRunMetaStatus(runId, 'completed')).toBe('completed')
      const resumedTask = await waitForTaskStatus(
        () =>
          state.tasks[resumeLaunch.data.taskId] as
            | LocalWorkflowTaskState
            | undefined,
        'completed',
      )
      expect(resumePrompts).toEqual(['second resumed task'])
      expect(
        resumedTask?.agents.map(agent => [agent.agentNumber, agent.status]),
      ).toEqual([
        [1, 'cached'],
        [2, 'completed'],
      ])
      expect(resumedTask?.log).toContain('agent #1 cached: first real (5 tokens)')
      expect(resumedTask?.log).toContain(
        'agent #2 completed: second resumed (13 tokens)',
      )
      expect(loadJournal(runId)?.entries).toHaveLength(2)
      const meta = loadRunMeta(runId)
      expect(meta?.args).toEqual({ ticket: 7 })
      expect(meta?.result).toContain('"first": "first persisted result"')
      expect(meta?.result).toContain(
        '"second": "live resume result for second resumed task"',
      )
    } finally {
      setWorkflowAgentRunnerFactoryForTests(null)
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('routes /workflows stop-agent and restart-agent into live runtime controls', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-tool-agent-controls-'))
    const sessionId =
      'abababab-abab-4bab-8bab-abababababab' as ReturnType<typeof getSessionId>
    const script = `
export const meta = { name: 'agent-control-flow', description: 'Agent control flow' }
const skipped = await agent('skip target', { label: 'skip target' })
const retried = await agent('retry target', { label: 'retry target' })
return { skipped, retried }
`
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    const commandContext = {
      getAppState: () => state,
      setAppState,
      setAppStateForTasks: setAppState,
    }
    const prompts: string[] = []
    const registeredAgents = new Set<number>()
    let retryAttempts = 0

    const waitForAgentControl = async (
      signal: AbortSignal,
    ): Promise<{
      value: null
      tokens: 0
      toolCalls: 0
      ok: false
      status: 'skipped' | 'retry_requested' | 'failed'
    }> => {
      if (!signal.aborted) {
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
      if (signal.reason === WORKFLOW_AGENT_SKIP_ABORT_REASON) {
        return {
          value: null,
          tokens: 0,
          toolCalls: 0,
          ok: false,
          status: 'skipped',
        }
      }
      if (signal.reason === WORKFLOW_AGENT_RETRY_ABORT_REASON) {
        return {
          value: null,
          tokens: 0,
          toolCalls: 0,
          ok: false,
          status: 'retry_requested',
        }
      }
      return {
        value: null,
        tokens: 0,
        toolCalls: 0,
        ok: false,
        status: 'failed',
      }
    }

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'config')
      setProjectRoot(root)
      switchSession(sessionId)

      setWorkflowAgentRunnerFactoryForTests(deps => async (prompt, _opts, meta) => {
        prompts.push(`${meta.agentNumber}:${prompt}`)
        const agentController = new AbortController()
        const unregister = deps.registerAgentController?.(
          meta.agentNumber,
          agentController,
        )
        registeredAgents.add(meta.agentNumber)
        try {
          if (prompt === 'skip target') {
            return await waitForAgentControl(agentController.signal)
          }
          if (prompt === 'retry target') {
            retryAttempts += 1
            if (retryAttempts === 1) {
              return await waitForAgentControl(agentController.signal)
            }
            return {
              value: 'retried result',
              tokens: 9,
              toolCalls: 2,
              ok: true,
            }
          }
          return {
            value: `unexpected prompt ${prompt}`,
            tokens: 1,
            toolCalls: 0,
            ok: true,
          }
        } finally {
          unregister?.()
        }
      })

      const launch = await WorkflowTool.call!(
        { script },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_agent_control_wf',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(launch.data.status).toBe('async_launched')
      const runId = launch.data.runId!
      const taskId = launch.data.taskId
      await waitForTaskAgentStatus(
        () => state.tasks[taskId] as LocalWorkflowTaskState | undefined,
        1,
        'running',
      )
      expect(await waitForCondition(() => registeredAgents.has(1))).toBe(true)

      let stopMessage = ''
      await workflowsCommandCall(
        nextMessage => {
          stopMessage = nextMessage ?? ''
        },
        commandContext as never,
        `stop-agent ${runId} 1`,
      )
      expect(stopMessage).toContain(runId)
      expect(stopMessage).toContain('#1')

      await waitForTaskAgentStatus(
        () => state.tasks[taskId] as LocalWorkflowTaskState | undefined,
        2,
        'running',
      )
      expect(await waitForCondition(() => registeredAgents.has(2))).toBe(true)

      let retryMessage = ''
      await workflowsCommandCall(
        nextMessage => {
          retryMessage = nextMessage ?? ''
        },
        commandContext as never,
        `restart-agent ${runId} 2`,
      )
      expect(retryMessage).toContain(runId)
      expect(retryMessage).toContain('#2')

      const completedTask = await waitForTaskStatus(
        () => state.tasks[taskId] as LocalWorkflowTaskState | undefined,
        'completed',
      )
      expect(completedTask?.agents.map(agent => [agent.agentNumber, agent.status])).toEqual([
        [1, 'skipped'],
        [2, 'completed'],
      ])
      expect(prompts).toEqual([
        '1:skip target',
        '2:retry target',
        '2:retry target',
      ])
      expect(completedTask?.log).toContain(
        'agent #1 skipped: skip target (0 tokens)',
      )
      expect(completedTask?.log).toContain('retrying agent #2: retry target')
      expect(completedTask?.log).toContain(
        'agent #2 completed: retry target (9 tokens)',
      )
      const meta = loadRunMeta(runId)
      expect(meta?.status).toBe('completed')
      expect(meta?.result).toContain('"skipped": null')
      expect(meta?.result).toContain('"retried": "retried result"')
    } finally {
      setWorkflowAgentRunnerFactoryForTests(null)
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('WorkflowTool scriptPath guards', () => {
  it('uses inline script when scriptPath and script are both provided, returning a session snapshot path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-scriptpath-inline-'))
    const scriptPath = join(dir, 'file.js')
    try {
      writeFileSync(
        scriptPath,
        `
export const meta = { name: 'file-flow', description: 'File workflow wins' }
import fs from 'fs'
`,
      )

      const result = await WorkflowTool.call!(
        {
          scriptPath,
          script: `
export const meta = { name: 'inline-flow', description: 'Inline workflow wins' }
return 'ok'
`,
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.summary).toBe('Inline workflow wins')
      expect(result.data.error).toBeUndefined()
      expect(result.data.scriptPath).toContain(`${result.data.runId}/script.js`)
      expect(result.data.scriptPath).not.toBe(scriptPath)
      expect(existsSync(result.data.scriptPath!)).toBe(true)
      expect(readFileSync(result.data.scriptPath!, 'utf8')).toContain(
        "name: 'inline-flow'",
      )
      expect(loadRunMeta(result.data.runId!)?.scriptPath).toBe(
        result.data.scriptPath,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads scriptPath sources while returning the editable session snapshot path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-scriptpath-file-'))
    const scriptPath = join(dir, 'file.js')
    const fileSource = `
export const meta = { name: 'file-flow', description: 'File workflow wins' }
return 'ok'
`
    try {
      writeFileSync(scriptPath, fileSource)

      const result = await WorkflowTool.call!(
        {
          scriptPath,
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.summary).toBe('File workflow wins')
      expect(result.data.error).toBeUndefined()
      expect(result.data.scriptPath).toContain(`${result.data.runId}/script.js`)
      expect(result.data.scriptPath).not.toBe(scriptPath)
      expect(existsSync(result.data.scriptPath!)).toBe(true)
      expect(readFileSync(result.data.scriptPath!, 'utf8')).toBe(fileSource)
      expect(loadRunMeta(result.data.runId!)?.scriptPath).toBe(
        result.data.scriptPath,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates inline script without reading a missing scriptPath when both are provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-scriptpath-inline-missing-'))
    const scriptPath = join(dir, 'missing.js')
    try {
      const result = await WorkflowTool.validateInput!(
        {
          scriptPath,
          script: `
export const meta = { name: 'inline-missing', description: 'Inline missing path' }
return 'ok'
`,
        },
        workflowValidationContext(),
      )

      expect(result).toEqual({ result: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('surfaces the official missing-file error before launching a workflow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-missing-tool-'))
    const scriptPath = join(dir, 'missing.js')
    try {
      await expect(
        WorkflowTool.call!(
          {
            scriptPath,
          },
          {
            abortController: new AbortController(),
            setAppState: () => {},
          } as never,
          async () => ({ behavior: 'allow' }) as never,
        ),
      ).rejects.toThrow(`Workflow script file not found: ${scriptPath}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('WorkflowTool syntax preflight', () => {
  it.each([
    ['Date.now()', 'return Date.now()'],
    ['Math.random()', 'return Math.random()'],
    ['argless new Date()', 'return new Date()'],
  ])(
    'rejects nondeterministic %s before launching a task',
    async (_, body) => {
      let setAppStateCalls = 0
      const result = await WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'bad-determinism', description: 'Uses clock' }
${body}
`,
        },
        {
          abortController: new AbortController(),
          setAppState: () => {
            setAppStateCalls++
          },
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(result.data.taskId).toMatch(/^w[a-z0-9]{8}$/)
      expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)
      expect(result.data.taskId).not.toBe(result.data.runId)
      expect(result.data.summary).toBe('Uses clock')
      expect(result.data.error).toBe(
        'Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.',
      )
      expect(result.data.scriptPath).toBeUndefined()
      expect(result.data.transcriptDir).toBeUndefined()
      expect(setAppStateCalls).toBe(0)
    },
  )

  it('allows deterministic Date construction with explicit arguments', async () => {
    const result = await WorkflowTool.call!(
      {
        script: `
export const meta = { name: 'fixed-date', description: 'Uses fixed date' }
return new Date(2020, 0, 1).getFullYear()
`,
      },
      {
        abortController: new AbortController(),
        setAppState: () => {},
      } as never,
      async () => ({ behavior: 'allow' }) as never,
    )

    expect(result.data.status).toBe('async_launched')
    expect(result.data.taskId).toMatch(/^w[a-z0-9]{8}$/)
    expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)
    expect(result.data.taskId).not.toBe(result.data.runId)
    expect(result.data.summary).toBe('Uses fixed date')
    expect(result.data.error).toBeUndefined()
    expect(result.data.scriptPath).toContain(`${result.data.runId}/script.js`)
  })

  it('returns an official error receipt without launching a task', async () => {
    let setAppStateCalls = 0
    const result = await WorkflowTool.call!(
      {
        script: `
export const meta = { name: 'bad-syntax', description: 'Has syntax error' }
import fs from 'fs'
`,
      },
      {
        abortController: new AbortController(),
        setAppState: () => {
          setAppStateCalls++
        },
      } as never,
      async () => ({ behavior: 'allow' }) as never,
    )

    expect(result.data.status).toBe('async_launched')
    expect(result.data.taskId).toMatch(/^w[a-z0-9]{8}$/)
    expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)
    expect(result.data.taskId).not.toBe(result.data.runId)
    expect(result.data.summary).toBe('Has syntax error')
    expect(result.data.error).toContain('Workflow scripts cannot use import')
    expect(result.data.scriptPath).toBeUndefined()
    expect(result.data.transcriptDir).toBeUndefined()
    expect(setAppStateCalls).toBe(0)

    const block = WorkflowTool.mapToolResultToToolResultBlockParam!(
      result.data,
      'toolu_syntax',
    )
    expect(block.is_error).toBe(true)
    expect(block.content).toContain(
      'Workflow script has a syntax error and was not launched:',
    )
  })
})

describe('WorkflowTool named workflows', () => {
  it('runs a saved workflow by name like the official tool input', async () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'wf-named-tool-'))
    try {
      const workflowDir = getProjectWorkflowsDir(root)
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'named.js'),
        `
export const meta = { name: 'named-flow', description: 'Run by name' }
return args.value * 2
`,
      )
      setProjectRoot(root)

      const result = await WorkflowTool.call!(
        {
          name: 'named-flow',
          description: 'ignored input description',
          title: 'ignored input title',
          args: { value: 21 },
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(result.data.taskId).toMatch(/^w[a-z0-9]{8}$/)
      expect(result.data.runId).toMatch(/^wf_[a-z0-9]+$/)
      expect(result.data.taskId).not.toBe(result.data.runId)
      expect(result.data.summary).toBe('Run by name')
      expect(result.data.transcriptDir).toContain(
        `subagents/workflows/${result.data.runId}`,
      )
      expect(result.data.scriptPath).toContain(`${result.data.runId}/script.js`)
      expect(existsSync(result.data.scriptPath!)).toBe(true)
    } finally {
      setProjectRoot(priorRoot)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes named workflows with structured args and project scope priority', async () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-named-priority-tool-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'home')
      const projectDir = getProjectWorkflowsDir(root)
      const userDir = getUserWorkflowsDir()
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(userDir, { recursive: true })
      writeFileSync(
        join(projectDir, 'shared.js'),
        `
export const meta = { name: 'shared-flow', description: 'Project flow' }
return 'project:' + args.value
`,
      )
      writeFileSync(
        join(userDir, 'shared.js'),
        `
export const meta = { name: 'shared-flow', description: 'User flow' }
return 'user:' + args.value
`,
      )
      setProjectRoot(root)

      const result = await WorkflowTool.call!(
        {
          name: 'shared-flow',
          args: { value: 21 },
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(await waitForRunMetaStatus(result.data.runId!, 'completed')).toBe(
        'completed',
      )
      const meta = loadRunMeta(result.data.runId!)
      expect(meta?.description).toBe('Project flow')
      expect(meta?.args).toEqual({ value: 21 })
      expect(meta?.result).toBe('project:21')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes nested saved workflows with structured args and grouped child progress', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-nested-tool-'))
    const sessionId =
      '99999999-9999-4999-9999-999999999999' as ReturnType<typeof getSessionId>
    let state = {
      tasks: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    const prompts: string[] = []

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      switchSession(sessionId)
      const workflowDir = getProjectWorkflowsDir(root)
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'child.js'),
        `
export const meta = {
  name: 'child-nested-flow',
  description: 'Child nested flow',
  phases: [{ title: 'Child phase', detail: 'Nested saved workflow' }],
}
phase('Child phase')
log('child args ' + args.topic)
const detail = await agent('inspect nested ' + args.topic, { label: 'child inspection' })
return { childTopic: args.topic, detail }
`,
      )

      setWorkflowAgentRunnerFactoryForTests(() => async (prompt, _opts, meta) => {
        prompts.push(`${meta.agentNumber}:${meta.phase}:${meta.label}:${prompt}`)
        return {
          value: `agent:${prompt}`,
          tokens: 12,
          toolCalls: 2,
          ok: true,
        }
      })

      const result = await WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'parent-nested-flow', description: 'Parent nested flow' }
const child = await workflow('child-nested-flow', { topic: args.topic })
return { parentTopic: args.topic, child }
`,
          args: { topic: 'alpha' },
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_nested_wf',
          getAppState: () => state,
          setAppState,
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(await waitForRunMetaStatus(result.data.runId!, 'completed')).toBe(
        'completed',
      )
      const completedTask = await waitForTaskStatus(
        () => state.tasks[result.data.taskId] as LocalWorkflowTaskState | undefined,
        'completed',
      )
      expect(prompts).toEqual([
        '1:▶ child-nested-flow:child inspection:inspect nested alpha',
      ])
      expect(completedTask?.agents).toHaveLength(1)
      expect(completedTask?.agents[0]).toMatchObject({
        agentNumber: 1,
        phase: '▶ child-nested-flow',
        label: 'child inspection',
        status: 'completed',
        tokens: 12,
        toolCalls: 2,
        resultPreview: 'agent:inspect nested alpha',
      })
      expect(completedTask?.log).toContain(
        'phase: ▶ child-nested-flow',
      )
      expect(completedTask?.log).toContain(
        '▶ running dynamic workflow child-nested-flow',
      )
      expect(completedTask?.log).toContain(
        '[child-nested-flow] child args alpha',
      )
      expect(completedTask?.log).toContain('▶ child-nested-flow done')
      const meta = loadRunMeta(result.data.runId!)
      expect(meta?.args).toEqual({ topic: 'alpha' })
      expect(meta?.result).toContain('"parentTopic": "alpha"')
      expect(meta?.result).toContain('"childTopic": "alpha"')
      expect(meta?.result).toContain('"detail": "agent:inspect nested alpha"')
      expect(meta?.agentCount).toBe(1)
      expect(meta?.totalToolCalls).toBe(2)
      expect(meta?.tokensSpent).toBe(12)
    } finally {
      setWorkflowAgentRunnerFactoryForTests(null)
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

  it('runs a workflow saved from /workflows as a slash command with structured args', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-saved-command-chain-'))
    const sessionId =
      '88888888-8888-4888-8888-888888888888' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      switchSession(sessionId)
      const savedRunId = 'wf_saved_command_chain'
      initRunArtifacts(
        savedRunId,
        `
export const meta = { name: 'draft-chain', description: 'Saved command chain' }
return {
  source: 'saved-command',
  issues: args.issues.map(issue => issue + 1),
  urgent: args.urgent,
}
`,
        {
          runId: savedRunId,
          workflowName: 'Saved command chain',
          description: 'Saved command chain',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )

      const saveMessage = saveRun([savedRunId])
      expect(saveMessage).toContain('/Saved-command-chain')

      const command = loadWorkflowCommandsFrom(root).find(
        current => current.name === 'Saved-command-chain',
      )
      expect(command?.type).toBe('local')
      expect(command?.kind).toBe('workflow')
      expect((command as { supportsNonInteractive?: boolean }).supportsNonInteractive).toBe(true)
      expect(
        savedWorkflowToolInputForArgs(
          {
            name: 'Saved-command-chain',
            commandName: 'Saved-command-chain',
            description: 'Saved command chain',
            scope: 'project',
          },
          '{"issues":[1024,1025],"urgent":true}',
        ),
      ).toEqual({
        name: 'Saved-command-chain',
        args: { issues: [1024, 1025], urgent: true },
      })

      const result = await WorkflowTool.call!(
        {
          name: 'Saved-command-chain',
          args: { issues: [1024, 1025], urgent: true },
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.status).toBe('async_launched')
      expect(await waitForRunMetaStatus(result.data.runId!, 'completed')).toBe(
        'completed',
      )
      const meta = loadRunMeta(result.data.runId!)
      expect(meta?.workflowName).toBe('Saved-command-chain')
      expect(meta?.args).toEqual({ issues: [1024, 1025], urgent: true })
      expect(meta?.result).toContain('"source": "saved-command"')
      expect(meta?.result).toContain('"issues": [\n    1025,\n    1026\n  ]')
      expect(meta?.result).toContain('"urgent": true')
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

  it('persists stopped runs as killed so /workflows can resume them distinctly from failures', async () => {
    const state = { tasks: {} as Record<string, unknown> }
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(state, updater(state as AppState))
    }

    const result = await WorkflowTool.call!(
      {
        script: `
export const meta = { name: 'stoppable-flow', description: 'Can be stopped' }
await timers.wait(5000)
return 'done'
`,
      },
      {
        abortController: new AbortController(),
        getAppState: () => state,
        setAppState,
      } as never,
      async () => ({ behavior: 'allow' }) as never,
    )

    expect(result.data.status).toBe('async_launched')
    expect(
      (state.tasks[result.data.taskId] as { status?: string } | undefined)?.status,
    ).toBe('running')

    killWorkflowTask(result.data.taskId, setAppState)

    expect(await waitForRunMetaStatus(result.data.runId, 'killed')).toBe('killed')
    expect(
      (state.tasks[result.data.taskId] as { status?: string } | undefined)?.status,
    ).toBe('killed')
  })
})
