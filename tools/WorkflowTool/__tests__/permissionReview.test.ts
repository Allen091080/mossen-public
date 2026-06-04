import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { buildWorkflowPermissionReview } from '../permissionReview.js'

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
`

describe('buildWorkflowPermissionReview', () => {
  test('extracts review metadata from an inline workflow without running it', () => {
    const review = buildWorkflowPermissionReview({
      script: WORKFLOW_SOURCE,
      args: { target: 'HEAD' },
      run_in_background: true,
      timeoutMs: 5000,
    })

    expect(review.sourceKind).toBe('inline')
    expect(review.meta?.name).toBe('ship-check')
    expect(review.meta?.phases?.map(phase => phase.title)).toEqual([
      'Inspect',
      'Verify',
    ])
    expect(review.argsPreview).toContain('"target": "HEAD"')
    expect(review.runInBackground).toBe(true)
    expect(review.timeoutMs).toBe(5000)
    expect(review.metaError).toBeNull()
    expect(review.scriptPreview).toContain('export const meta')
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

  test('surfaces parse failures in the review payload', () => {
    const review = buildWorkflowPermissionReview({
      script: 'log("missing meta")',
    })

    expect(review.meta).toBeNull()
    expect(review.metaError).toContain('Workflow script must begin')
  })

  test('can suppress the usage warning for users who already accepted it', () => {
    const review = buildWorkflowPermissionReview(
      { script: WORKFLOW_SOURCE },
      { showUsageWarning: false },
    )

    expect(review.showUsageWarning).toBe(false)
  })
})
