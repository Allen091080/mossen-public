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
  getOriginalCwd,
  setProjectRoot,
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
  MAX_WORKFLOW_RESULT_LOG_LINES,
  setWorkflowRemoteDepsForTest,
  WorkflowTool,
} from '../WorkflowTool.js'
import { WORKFLOW_TOOL_NAME } from '../constants.js'
import { loadRunLog, loadRunMeta } from '../engine/journalStore.js'
import { getProjectWorkflowsDir } from '../savedWorkflows.js'
import { killWorkflowTask } from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
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
}: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
  mode?: AppState['toolPermissionContext']['mode']
  isBypassPermissionsModeAvailable?: boolean
  shouldAvoidPermissionPrompts?: boolean
} = {}): ToolUseContext {
  const base = getEmptyToolPermissionContext()
  return {
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

describe('WorkflowTool remote workflow launch', () => {
  it('launches a remote-workflow task when permission prompts cannot be shown', async () => {
    let state = {
      tasks: {},
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        shouldAvoidPermissionPrompts: true,
      },
    } as unknown as AppState
    let launched: {
      initialMessage: string
      description: string
      title: string
      model?: string
    } | null = null
    let polling:
      | {
          taskId: string
          sessionId: string
        }
      | null = null
    const reset = setWorkflowRemoteDepsForTest({
      launch: async options => {
        launched = options
        return { id: 'session_remote_workflow_1', title: 'Remote workflow title' }
      },
      getSessionUrl: id => `https://example.invalid/code/${id}`,
      startPolling: params => {
        polling = params
        return () => {}
      },
    })

    try {
      const result = await WorkflowTool.call!(
        {
          script: `
export const meta = { name: 'remote-flow', description: 'Remote workflow launch', model: 'sonnet' }
return agent('inspect remotely')
`,
          args: { ticket: 42 },
          timeoutMs: 1234,
        },
        {
          abortController: new AbortController(),
          toolUseId: 'toolu_remote_wf',
          getAppState: () => state,
          setAppState: (updater: (prev: AppState) => AppState) => {
            state = updater(state)
          },
        } as unknown as ToolUseContext,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data).toEqual({
        status: 'remote_launched',
        taskId: expect.stringMatching(/^r[a-z0-9]{8}$/),
        summary: 'Remote workflow launch',
        sessionUrl: 'https://example.invalid/code/session_remote_workflow_1',
      })
      expect(result.data.runId).toBeUndefined()
      expect(result.data.scriptPath).toBeUndefined()
      expect(result.data.transcriptDir).toBeUndefined()
      expect(launched?.description).toBe('Remote dynamic workflow: remote-flow')
      expect(launched?.title).toBe('workflow: remote-flow')
      expect(launched?.model).toBe('sonnet')
      expect(launched?.initialMessage).toContain('"ticket": 42')
      expect(launched?.initialMessage).toContain('"timeoutMs": 1234')
      expect(polling).toMatchObject({
        taskId: result.data.taskId,
        sessionId: 'session_remote_workflow_1',
      })
      expect(state.tasks[result.data.taskId]).toMatchObject({
        type: 'remote_agent',
        status: 'running',
        title: 'Remote workflow title',
        description: 'Remote workflow launch',
        sessionId: 'session_remote_workflow_1',
        sessionUrl: 'https://example.invalid/code/session_remote_workflow_1',
        remoteTaskType: 'remote-workflow',
        isBackgrounded: true,
      })
    } finally {
      reset()
    }
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
    ).rejects.toThrow('Must provide script, name, or scriptPath')
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
