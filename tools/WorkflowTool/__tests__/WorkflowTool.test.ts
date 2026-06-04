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
  appendWorkflowResultLogLine,
  MAX_WORKFLOW_RESULT_LOG_LINES,
  WorkflowTool,
} from '../WorkflowTool.js'
import { getProjectWorkflowsDir } from '../savedWorkflows.js'

// Regression for the Ink crash seen in real use: renderToolResultMessage used
// to return a bare string, which crashes the entire render tree with
// `Text string "..." must be rendered within a <Text> component` and exits the
// app. It must return a React element (with strings wrapped in <Text>), never a
// bare string. ink-testing-library is not a dependency here, so we assert on the
// returned node shape directly — string vs element is exactly the bug.
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
})

describe('WorkflowTool syntax preflight', () => {
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
    expect(result.data.taskId).toMatch(/^wf_[a-z0-9]+$/)
    expect(result.data.runId).toBe(result.data.taskId)
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
      expect(result.data.taskId).toMatch(/^wf_[a-z0-9]+$/)
      expect(result.data.runId).toBe(result.data.taskId)
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
