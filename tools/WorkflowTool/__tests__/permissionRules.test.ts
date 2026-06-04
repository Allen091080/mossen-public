import { describe, expect, test } from 'bun:test'
import { WORKFLOW_TOOL_NAME } from '../constants.js'
import {
  buildNamedWorkflowPermissionUpdates,
  normalizeWorkflowPermissionRuleContent,
} from '../permissionRules.js'

describe('workflow permission rules', () => {
  test('normalizes named workflow rule content', () => {
    expect(normalizeWorkflowPermissionRuleContent(' ship-check ')).toBe(
      'ship-check',
    )
    expect(normalizeWorkflowPermissionRuleContent('   ')).toBeNull()
    expect(normalizeWorkflowPermissionRuleContent(undefined)).toBeNull()
  })

  test('builds local allow updates for a named workflow', () => {
    expect(buildNamedWorkflowPermissionUpdates(' ship-check ')).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: WORKFLOW_TOOL_NAME, ruleContent: 'ship-check' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })

  test('does not build allow updates without a workflow name', () => {
    expect(buildNamedWorkflowPermissionUpdates('')).toEqual([])
    expect(buildNamedWorkflowPermissionUpdates(null)).toEqual([])
  })
})
