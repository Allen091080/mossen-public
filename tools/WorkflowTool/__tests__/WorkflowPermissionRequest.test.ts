import { describe, expect, test } from 'bun:test'
import { buildWorkflowPermissionOptionSpecs } from '../WorkflowPermissionRequest.js'

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
