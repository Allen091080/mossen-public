import { describe, expect, test } from 'bun:test'
import {
  assertDynamicWorkflowScriptValid,
  buildDynamicWorkflowScript,
  MAX_DYNAMIC_WORKFLOW_TASK_CHARS,
} from '../dynamicWorkflow.js'
import { extractMeta } from '../engine/meta.js'
import { validateWorkflowAssetSource } from '../workflowAsset.js'

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
    expect(meta.budgets?.maxAgents).toBe(8)
    expect(meta.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
    expect(meta.allowedRoots).toEqual(['.'])
    expect(meta.allowedHosts).toEqual([])
    expect(meta.evidence?.finalReport).toBe(true)
    expect(meta.lifecycle?.status).toBe('draft')
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
    const validation = validateWorkflowAssetSource(source, {
      scope: 'project',
      requireBoundedBudgets: true,
      requirePhases: true,
    })
    expect(validation.ok).toBe(true)
    expect(validation.asset?.lifecycle?.compatibility).toContain(
      'Generated from a broad goal',
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
