import { describe, expect, test } from 'bun:test'
import { buildWorkflowPermissionReview } from '../permissionReview.js'
import {
  buildWorkflowPermissionDisplayModel,
  buildWorkflowPermissionOptionSpecs,
  WORKFLOW_PERMISSION_QUESTION,
  WORKFLOW_PERMISSION_TITLE,
  WORKFLOW_PROMPT_FEEDBACK_CONFIG,
  WORKFLOW_USAGE_WARNING_MESSAGE,
} from '../WorkflowPermissionRequest.js'

const WORKFLOW_SOURCE = `
export const meta = {
  name: 'ship-check',
  description: 'Validate a change before shipping',
  whenToUse: 'Before pushing a multi-file change',
  model: 'xhigh',
  phases: [
    { title: 'Inspect', detail: 'Read the diff' },
    { title: 'Verify', model: 'deep', detail: 'Check findings' },
  ],
}

phase('Inspect')
const findings = await parallel([
  () => agent('inspect api changes'),
  () => agent('inspect ui changes'),
  () => agent('inspect test changes'),
])
for (const finding of findings) {
  await agent(\`verify \${finding}\`)
}
return findings
`

describe('WorkflowPermissionRequest approval options', () => {
  test('matches the official named-workflow approval surface', () => {
    const options = buildWorkflowPermissionOptionSpecs({
      sourceLabel: 'ship-check',
      hasNamedWorkflowPermissionUpdates: true,
      canRememberWorkflowSource: false,
      showUsageWarning: true,
      hasScriptSource: true,
      showRawScript: false,
    })

    expect(options.map(option => option.value)).toEqual([
      'yes',
      'yes-always',
      'yes-skip-warning',
      'toggle-script',
      'no',
    ])
    expect(options.find(option => option.value === 'yes')?.label.en).toBe(
      'Yes, run it',
    )
    expect(options.find(option => option.value === 'yes-always')?.label.en).toBe(
      "Yes, and don't ask again for ship-check in this project",
    )
    expect(options.find(option => option.value === 'toggle-script')?.label.en).toBe(
      'View raw script',
    )
    expect(
      options
        .filter(option => option.value.startsWith('yes'))
        .every(option => option.acceptsPromptAmend === true),
    ).toBe(true)
    expect(WORKFLOW_PROMPT_FEEDBACK_CONFIG.type).toBe('accept')
    expect(WORKFLOW_PROMPT_FEEDBACK_CONFIG.placeholder).toContain(
      'workflow prompt',
    )
    expect(options.find(option => option.value === 'toggle-script'))
      .not.toHaveProperty('acceptsPromptAmend')
    expect(options.find(option => option.value === 'no'))
      .not.toHaveProperty('acceptsPromptAmend')
  })

  test('offers source-hash remember for inline workflows, not named allow rules', () => {
    const options = buildWorkflowPermissionOptionSpecs({
      sourceLabel: 'inline script',
      hasNamedWorkflowPermissionUpdates: false,
      canRememberWorkflowSource: true,
      showUsageWarning: false,
      hasScriptSource: true,
      showRawScript: true,
    })

    expect(options.map(option => option.value)).toEqual([
      'yes',
      'yes-source-always',
      'toggle-script',
      'no',
    ])
    expect(
      options.find(option => option.value === 'yes-source-always')?.label.en,
    ).toBe("Yes, and don't ask again for this workflow in this project")
    expect(options.find(option => option.value === 'toggle-script')?.label.en).toBe(
      'View workflow summary',
    )
    expect(options.some(option => option.value === 'yes-always')).toBe(false)
    expect(options.some(option => option.value === 'yes-skip-warning')).toBe(false)
  })

  test('omits raw-script toggle when the workflow source cannot be reviewed', () => {
    const options = buildWorkflowPermissionOptionSpecs({
      sourceLabel: 'missing script',
      hasNamedWorkflowPermissionUpdates: false,
      canRememberWorkflowSource: false,
      showUsageWarning: true,
      hasScriptSource: false,
      showRawScript: false,
    })

    expect(options.map(option => option.value)).toEqual([
      'yes',
      'yes-skip-warning',
      'no',
    ])
  })
})

describe('WorkflowPermissionRequest review display model', () => {
  test('exposes the official approval-card content before launch', () => {
    const review = buildWorkflowPermissionReview({
      script: WORKFLOW_SOURCE,
      args: { target: 'HEAD' },
      timeoutMs: 5000,
      resumeFromRunId: 'wf_run1',
    })

    const display = buildWorkflowPermissionDisplayModel(review, {
      showRawScript: false,
    })

    expect(WORKFLOW_PERMISSION_TITLE.en).toBe(
      'Review dynamic workflow before running',
    )
    expect(WORKFLOW_PERMISSION_QUESTION.en).toBe('Run this dynamic workflow?')
    expect(display.fields).toEqual(
      expect.arrayContaining([
        { label: 'Name', value: 'ship-check' },
        {
          label: 'Purpose',
          value: 'Validate a change before shipping',
        },
        {
          label: 'Use when',
          value: 'Before pushing a multi-file change',
        },
        { label: 'Model', value: 'xhigh' },
        { label: 'Source', value: 'inline: inline script' },
        { label: 'Resume', value: 'wf_run1' },
        { label: 'Timeout', value: '5000 ms' },
      ]),
    )
    expect(display.fields.find(field => field.label === 'Args')).toMatchObject({
      value: expect.stringContaining('"target": "HEAD"'),
      wrap: 'truncate-end',
    })
    expect(display.fields.find(field => field.label === 'Phases')?.lines).toEqual([
      '1. Inspect - Read the diff',
      '2. Verify (deep) - Check findings',
    ])
    expect(display.staticSummary?.intro).toContain('multiple subagents')
    expect(display.staticSummary?.phases[0]).toEqual({
      title: '1. Inspect - Read the diff',
      samplePrompts: ['inspect api changes', 'inspect ui changes'],
      extraAgentCount: 1,
    })
    expect(display.staticSummary?.phases[1]?.title).toBe(
      '2. Verify - Check findings',
    )
    expect(display.staticSummary?.footer).toMatch(
      /^Estimated agents: \d+ - returns a workflow result$/,
    )
    expect(display.usageWarning).toBe(WORKFLOW_USAGE_WARNING_MESSAGE)
    expect(display.usageWarning).toContain('/workflows')
    expect(display.usageWarning).toContain('/config')
  })

  test('switches between script summary and bounded raw script review', () => {
    const longScript = `${WORKFLOW_SOURCE}\n${'log("line")\n'.repeat(600)}`
    const review = buildWorkflowPermissionReview({ script: longScript })

    const summaryDisplay = buildWorkflowPermissionDisplayModel(review, {
      showRawScript: false,
    })
    const rawDisplay = buildWorkflowPermissionDisplayModel(review, {
      showRawScript: true,
    })

    const summaryScript = summaryDisplay.fields.find(
      field => field.label === 'Script',
    )
    const rawScript = rawDisplay.fields.find(field => field.label === 'Script')

    expect(summaryScript?.value).toContain("name: 'ship-check'")
    expect(summaryScript?.value).not.toContain('... [truncated]')
    expect(rawScript?.value).toContain('... [truncated]')
    expect(rawScript?.value?.length).toBeLessThanOrEqual(4000)
    expect(rawScript).toMatchObject({
      tone: 'dim',
      wrap: 'truncate-end',
    })
  })

  test('surfaces parse warnings without hiding the source review', () => {
    const review = buildWorkflowPermissionReview({
      script: 'log("missing meta")',
    })
    const display = buildWorkflowPermissionDisplayModel(review, {
      showRawScript: false,
    })

    expect(display.fields.find(field => field.label === 'Warning')).toMatchObject({
      value: expect.stringContaining('FIRST statement'),
      tone: 'warning',
    })
    expect(display.fields.find(field => field.label === 'Script')?.value).toBe(
      'log("missing meta")',
    )
  })
})
