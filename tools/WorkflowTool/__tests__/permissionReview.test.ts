import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { getProjectRoot, setProjectRoot } from '../../../bootstrap/state.js'
import { buildWorkflowPermissionReview } from '../permissionReview.js'
import { getProjectWorkflowsDir } from '../savedWorkflows.js'

const WORKFLOW_SOURCE = `
export const meta = {
  name: 'ship-check',
  description: 'Validate a change before shipping',
  whenToUse: 'Before pushing a multi-file change',
  phases: [
    { title: 'Inspect', detail: 'Read the diff' },
    { title: 'Verify', model: 'deep' },
  ],
}

phase('Inspect')
log('ready')
const findings = await parallel([
  () => agent('inspect api changes'),
  () => agent('inspect ui changes'),
])
for (const finding of findings) {
  await agent(\`verify \${finding}\`)
}
return findings
`

describe('buildWorkflowPermissionReview', () => {
  test('extracts review metadata from an inline workflow without running it', () => {
    const review = buildWorkflowPermissionReview({
      script: WORKFLOW_SOURCE,
      description: 'ignored input description',
      title: 'ignored input title',
      args: { target: 'HEAD' },
      timeoutMs: 5000,
    })

    expect(review.sourceKind).toBe('inline')
    expect(review.meta?.name).toBe('ship-check')
    expect(review.meta?.description).toBe('Validate a change before shipping')
    expect(review.meta?.phases?.map(phase => phase.title)).toEqual([
      'Inspect',
      'Verify',
    ])
    expect(review.argsPreview).toContain('"target": "HEAD"')
    expect(review.timeoutMs).toBe(5000)
    expect(review.metaError).toBeNull()
    expect(review.scriptSource).toBe(WORKFLOW_SOURCE)
    expect(review.scriptPreview).toContain('export const meta')
    expect(review.staticSummary?.phases.map(phase => phase.kind)).toEqual([
      'parallel',
      'loop',
    ])
    expect(review.staticSummary?.estimatedAgents).toBe(9)
    expect(review.staticSummary?.hasReturn).toBe(true)
    expect(review.usageConsentHash).toMatch(/^wf_sha256:[a-f0-9]{64}$/)
  })

  test('loads workflow metadata from scriptPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mossen-workflow-review-'))
    const scriptPath = join(dir, 'ship-check.js')
    writeFileSync(scriptPath, WORKFLOW_SOURCE)

    const review = buildWorkflowPermissionReview({ scriptPath })

    expect(review.sourceKind).toBe('file')
    expect(review.sourceLabel).toBe(scriptPath)
    expect(review.meta?.description).toBe('Validate a change before shipping')
  })

  test('loads workflow metadata from name', () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'mossen-workflow-name-review-'))
    const workflowDir = getProjectWorkflowsDir(root)
    const scriptPath = join(workflowDir, 'ship-check.js')
    try {
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(scriptPath, WORKFLOW_SOURCE, { flag: 'w' })
      setProjectRoot(root)

      const review = buildWorkflowPermissionReview({ name: 'ship-check' })

      expect(review.sourceKind).toBe('named')
      expect(review.sourceLabel).toBe('ship-check')
      expect(review.meta?.description).toBe('Validate a change before shipping')
      expect(review.scriptPreview).toContain('export const meta')
    } finally {
      setProjectRoot(priorRoot)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('surfaces parse failures in the review payload', () => {
    const review = buildWorkflowPermissionReview({
      script: 'log("missing meta")',
    })

    expect(review.meta).toBeNull()
    expect(review.metaError).toContain('FIRST statement')
  })

  test('does not treat resumeFromRunId alone as a workflow source', () => {
    const review = buildWorkflowPermissionReview({
      resumeFromRunId: 'wf_resume1',
    })

    expect(review.sourceKind).toBe('missing')
    expect(review.resumeFromRunId).toBe('wf_resume1')
    expect(review.metaError).toBe('Must provide script, name, or scriptPath')
    expect(review.scriptPreview).toBeNull()
    expect(review.staticSummary).toBeNull()
  })

  test('can suppress the usage warning for users who already accepted it', () => {
    const review = buildWorkflowPermissionReview(
      { script: WORKFLOW_SOURCE },
      { showUsageWarning: false },
    )

    expect(review.showUsageWarning).toBe(false)
  })
})
