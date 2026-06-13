import { describe, expect, test } from 'bun:test'
import {
  assertDynamicWorkflowScriptValid,
  buildDynamicWorkflowScript,
  MAX_DYNAMIC_WORKFLOW_TASK_CHARS,
} from '../dynamicWorkflow.js'
import { extractMeta } from '../engine/meta.js'

describe('dynamic workflow task compiler', () => {
  test('builds a valid multi-agent workflow script from a natural-language task', () => {
    const source = buildDynamicWorkflowScript(
      'Audit Agent View UX and verify stale workers are not shown as active.',
    )
    const { meta, scriptBody } = extractMeta(source)

    expect(meta.name).toStartWith('dynamic-audit-agent-view-ux')
    expect(meta.name).toContain('verify-stale-workers')
    expect(meta.description).toContain('Auto-plan, execute, verify')
    expect(meta.whenToUse).toContain('multi-agent workflow orchestration')
    expect(meta.phases?.map(phase => phase.title)).toEqual([
      'Plan',
      'Execute',
      'Verify',
      'Synthesize',
    ])
    expect(scriptBody).toContain('const PLAN_SCHEMA')
    expect(scriptBody).toContain("label: 'planner'")
    expect(scriptBody).toContain("label: 'synthesis'")
    expect(scriptBody).toContain('await parallel(workItems.map')
    expect(scriptBody).toContain('verification: {')
    expect(scriptBody).toContain(
      'Audit Agent View UX and verify stale workers are not shown as active.',
    )
    expect(() => assertDynamicWorkflowScriptValid(source)).not.toThrow()
  })

  test('rejects empty or oversized tasks before script generation', () => {
    expect(() => buildDynamicWorkflowScript('   ')).toThrow(
      'Workflow task must be a non-empty string.',
    )
    expect(() =>
      buildDynamicWorkflowScript('x'.repeat(MAX_DYNAMIC_WORKFLOW_TASK_CHARS + 1)),
    ).toThrow(`Workflow task exceeds ${MAX_DYNAMIC_WORKFLOW_TASK_CHARS} characters.`)
  })
})
