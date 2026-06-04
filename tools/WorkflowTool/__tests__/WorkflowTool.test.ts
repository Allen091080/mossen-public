import { describe, it, expect } from 'bun:test'
import { isValidElement } from 'react'
import { WorkflowTool } from '../WorkflowTool.js'

// Regression for the Ink crash seen in real use: renderToolResultMessage used
// to return a bare string, which crashes the entire render tree with
// `Text string "..." must be rendered within a <Text> component` and exits the
// app. It must return a React element (with strings wrapped in <Text>), never a
// bare string. ink-testing-library is not a dependency here, so we assert on the
// returned node shape directly — string vs element is exactly the bug.
describe('WorkflowTool renderToolResultMessage (Ink crash regression)', () => {
  it('returns a React element for a completed run, not a bare string', () => {
    const out = {
      status: 'completed' as const,
      workflowName: 'project-analysis',
      runId: 'wf_demo',
      agentCount: 3,
      tokensSpent: 69723,
      result: 'hello from the workflow',
      log: ['phase: scan', 'done'],
    }
    const el = WorkflowTool.renderToolResultMessage!(out as never)
    expect(typeof el).not.toBe('string')
    expect(isValidElement(el)).toBe(true)
  })

  it('returns a React element for a backgrounded (launched) run', () => {
    const out = {
      status: 'launched' as const,
      workflowName: 'bg-job',
      runId: 'wf_bg',
    }
    const el = WorkflowTool.renderToolResultMessage!(out as never)
    expect(typeof el).not.toBe('string')
    expect(isValidElement(el)).toBe(true)
  })
})
