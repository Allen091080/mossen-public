import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

export function normalizeWorkflowPermissionRuleContent(
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null
  const workflowName = value.trim()
  return workflowName.length ? workflowName : null
}

export function buildNamedWorkflowPermissionUpdates(
  workflowName: unknown,
): PermissionUpdate[] {
  const ruleContent = normalizeWorkflowPermissionRuleContent(workflowName)
  if (!ruleContent) return []
  return [
    {
      type: 'addRules',
      rules: [{ toolName: WORKFLOW_TOOL_NAME, ruleContent }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ]
}
