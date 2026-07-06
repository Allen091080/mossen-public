import { describe, expect, test } from 'bun:test'
import { loadBundledWorkflows } from '../bundled/index.js'
import {
  validateWorkflowAssetSource,
  validateWorkflowAssetSources,
} from '../workflowAsset.js'

const FULL_ASSET_SOURCE = `export const meta = {
  name: 'asset-review',
  description: 'Review a workflow asset.',
  whenToUse: 'Use when a workflow asset needs bounded execution.',
  argsSchema: { type: 'object', required: ['target'] },
  budgets: {
    timeoutMs: 60000,
    phaseTimeoutMs: 10000,
    maxAgents: 4,
    maxParallel: 2,
    maxNestedWorkflows: 1,
  },
  allowedTools: ['Read', 'Grep'],
  allowedRoots: ['.'],
  allowedHosts: ['docs.example.test'],
  effort: 'medium',
  evidence: {
    finalReport: true,
    citations: false,
    realProvider: false,
    processClean: true,
    validationCommands: [
      'bun test tools/WorkflowTool/__tests__/workflowAsset.test.ts',
    ],
    artifacts: ['final-report.json'],
  },
  lifecycle: {
    version: '1.2.3',
    owner: 'platform',
    status: 'tested',
    lastTestedAt: '2026-07-06T00:00:00.000Z',
    lastTestArtifact: '/tmp/mossen-harness/workflow/artifacts/assertions.json',
    compatibility: 'Mossen workflow asset contract v1',
  },
  phases: [{ title: 'Inspect' }, { title: 'Report' }],
}
return args
`

describe('WorkflowAsset contract', () => {
  test('builds a strict asset contract from extended workflow metadata', () => {
    const result = validateWorkflowAssetSource(FULL_ASSET_SOURCE, {
      scope: 'project',
      requireBoundedBudgets: true,
      requirePhases: true,
    })

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.asset).toMatchObject({
      version: 1,
      name: 'asset-review',
      scope: 'project',
      phases: [{ title: 'Inspect' }, { title: 'Report' }],
      budgets: {
        timeoutMs: 60000,
        phaseTimeoutMs: 10000,
        maxAgents: 4,
        maxParallel: 2,
        maxNestedWorkflows: 1,
      },
      allowedTools: ['Read', 'Grep'],
      allowedRoots: ['.'],
      allowedHosts: ['docs.example.test'],
      effort: 'medium',
      evidence: {
        finalReport: true,
        processClean: true,
        validationCommands: [
          'bun test tools/WorkflowTool/__tests__/workflowAsset.test.ts',
        ],
      },
      lifecycle: {
        version: '1.2.3',
        owner: 'platform',
        status: 'tested',
        lastTestedAt: '2026-07-06T00:00:00.000Z',
        lastTestArtifact: '/tmp/mossen-harness/workflow/artifacts/assertions.json',
        compatibility: 'Mossen workflow asset contract v1',
      },
    })
    expect(result.asset?.argsSchema).toEqual({
      type: 'object',
      required: ['target'],
    })
  })

  test('keeps legacy saved workflows compatible while reporting contract gaps', () => {
    const result = validateWorkflowAssetSource(
      "export const meta = { name: 'legacy', description: 'Legacy flow' }\nreturn 1\n",
      { scope: 'project', legacyCompatible: true },
    )

    expect(result.ok).toBe(true)
    expect(result.asset?.name).toBe('legacy')
    expect(result.issues.map(issue => issue.code)).toEqual([
      'legacy-missing-phases',
      'legacy-missing-budgets',
    ])
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
  })

  test('fails strict assets when phase metadata or bounded budgets are missing', () => {
    const result = validateWorkflowAssetSource(
      "export const meta = { name: 'strict', description: 'Strict flow' }\nreturn 1\n",
      {
        scope: 'bundled',
        requireBoundedBudgets: true,
        requirePhases: true,
      },
    )

    expect(result.ok).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual([
      'missing-phases',
      'missing-bounded-budgets',
    ])
  })

  test('rejects invalid budget metadata before asset construction succeeds', () => {
    const result = validateWorkflowAssetSource(
      `export const meta = {
        name: 'bad-budget',
        description: 'Bad budget',
        budgets: { timeoutMs: 0 },
      }
      return 1
      `,
      { scope: 'project' },
    )

    expect(result.ok).toBe(false)
    expect(result.asset).toBeUndefined()
    expect(result.issues[0]).toMatchObject({
      severity: 'error',
      code: 'invalid-meta',
    })
    expect(result.issues[0]?.message).toContain(
      'meta.budgets.timeoutMs must be a positive integer',
    )
  })

  test('rejects invalid workflow lifecycle status metadata', () => {
    const result = validateWorkflowAssetSource(
      `export const meta = {
        name: 'bad-lifecycle',
        description: 'Bad lifecycle',
        lifecycle: { status: 'ready' },
      }
      return 1
      `,
      { scope: 'project' },
    )

    expect(result.ok).toBe(false)
    expect(result.asset).toBeUndefined()
    expect(result.issues[0]).toMatchObject({
      severity: 'error',
      code: 'invalid-meta',
    })
    expect(result.issues[0]?.message).toContain(
      'meta.lifecycle.status must be one of: draft, tested, deprecated',
    )
  })

  test('bundled workflow assets have strict phases and bounded budgets', () => {
    const bundled = loadBundledWorkflows().map(workflow => ({
      source: workflow.source,
      scope: 'bundled' as const,
    }))
    const results = validateWorkflowAssetSources(bundled, {
      requireBoundedBudgets: true,
      requirePhases: true,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every(result => result.ok)).toBe(true)
    expect(results.map(result => result.asset?.name)).toContain('deep-research')
    for (const result of results) {
      expect(result.asset?.phases.length).toBeGreaterThan(0)
      expect(result.asset?.budgets).toMatchObject({
        timeoutMs: expect.any(Number),
        phaseTimeoutMs: expect.any(Number),
        maxAgents: expect.any(Number),
        maxParallel: expect.any(Number),
        maxNestedWorkflows: expect.any(Number),
      })
    }
  })
})
