import { createHash } from 'node:crypto'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

const WORKFLOW_USAGE_CONSENT_PREFIX = 'wf_sha256:'
const TRUSTED_CONSENT_SOURCES = [
  'userSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const

export function workflowUsageConsentHash(source: string): string {
  return `${WORKFLOW_USAGE_CONSENT_PREFIX}${createHash('sha256')
    .update(source, 'utf8')
    .digest('hex')}`
}

function isWorkflowUsageConsentHash(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^${WORKFLOW_USAGE_CONSENT_PREFIX}[a-f0-9]{64}$`).test(value)
  )
}

function settingsConsentHashes(
  settings: Pick<SettingsJson, 'workflowUsageConsentHashes'> | null | undefined,
): string[] {
  return (settings?.workflowUsageConsentHashes ?? []).filter(
    isWorkflowUsageConsentHash,
  )
}

export function hasTrustedWorkflowUsageWarningBypass(): boolean {
  return TRUSTED_CONSENT_SOURCES.some(
    source => getSettingsForSource(source)?.skipWorkflowUsageWarning === true,
  )
}

export function hasRecordedWorkflowUsageConsent(
  consentHash: string | null | undefined,
): boolean {
  if (!isWorkflowUsageConsentHash(consentHash)) return false
  return TRUSTED_CONSENT_SOURCES.some(source =>
    settingsConsentHashes(getSettingsForSource(source)).includes(consentHash),
  )
}

export function workflowNeedsUsageConsentPrompt(
  consentHash: string | null | undefined,
): boolean {
  if (hasTrustedWorkflowUsageWarningBypass()) return false
  return !hasRecordedWorkflowUsageConsent(consentHash)
}

export function recordWorkflowUsageConsent(
  consentHash: string | null | undefined,
): boolean {
  if (!isWorkflowUsageConsentHash(consentHash)) return false
  const current = settingsConsentHashes(getSettingsForSource('localSettings'))
  const next = current.includes(consentHash)
    ? current
    : [...current, consentHash]
  return (
    updateSettingsForSource('localSettings', {
      workflowUsageConsentHashes: next,
    }).error === null
  )
}
