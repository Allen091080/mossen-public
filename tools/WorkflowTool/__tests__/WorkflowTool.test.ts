import { describe, it, expect } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement } from 'react'
import { getProjectRoot, setProjectRoot } from '../../../bootstrap/state.js'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import {
  appendWorkflowResultLogLine,
  MAX_WORKFLOW_RESULT_LOG_LINES,
  WorkflowTool,
} from '../WorkflowTool.js'
import { WORKFLOW_TOOL_NAME } from '../constants.js'
import { getProjectWorkflowsDir } from '../savedWorkflows.js'

function toolUseContextWithWorkflowRules({
  allow = [],
  ask = [],
  deny = [],
}: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
} = {}): ToolUseContext {
  const base = getEmptyToolPermissionContext()
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...base,
        alwaysAllowRules: allow.length ? { localSettings: allow } : {},
        alwaysAskRules: ask.length ? { localSettings: ask } : {},
        alwaysDenyRules: deny.length ? { localSettings: deny } : {},
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

describe('WorkflowTool named workflow permissions', () => {
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
  it('uses scriptPath contents before inline script when both are provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-scriptpath-priority-'))
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
export const meta = { name: 'inline-flow', description: 'Inline workflow loses' }
return 'ok'
`,
        },
        {
          abortController: new AbortController(),
          setAppState: () => {},
        } as never,
        async () => ({ behavior: 'allow' }) as never,
      )

      expect(result.data.summary).toBe('File workflow wins')
      expect(result.data.error).toContain('Workflow scripts cannot use import')
      expect(result.data.scriptPath).toBeUndefined()
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
})
