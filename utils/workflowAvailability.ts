import { isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'

export const WORKFLOW_DISABLE_ENV = 'MOSSEN_CODE_DISABLE_WORKFLOWS'
export const WORKFLOW_ENABLE_ENV = 'MOSSEN_CODE_WORKFLOWS'

function getWorkflowEnvOverride(): boolean | undefined {
  if (isEnvTruthy(process.env[WORKFLOW_DISABLE_ENV])) return false
  if (isEnvTruthy(process.env[WORKFLOW_ENABLE_ENV])) return true
  return undefined
}

/**
 * Runtime workflow availability. The build flag still decides whether the code
 * exists in this build; this helper mirrors the user/policy/env switches that
 * can turn the feature on or off at runtime.
 */
export function isWorkflowRuntimeEnabled(
  settings: Pick<SettingsJson, 'disableWorkflows' | 'enableWorkflows'> =
    getInitialSettings(),
): boolean {
  const envOverride = getWorkflowEnvOverride()
  if (envOverride !== undefined) return envOverride
  if (settings.disableWorkflows === true) return false
  if (typeof settings.enableWorkflows === 'boolean') {
    return settings.enableWorkflows
  }
  return true
}

export function isWorkflowKeywordTriggerEnabled(
  settings: Pick<
    SettingsJson,
    'disableWorkflows' | 'enableWorkflows' | 'workflowKeywordTriggerEnabled'
  > = getInitialSettings(),
): boolean {
  return (
    isWorkflowRuntimeEnabled(settings) &&
    settings.workflowKeywordTriggerEnabled !== false
  )
}
