import type { TaskStatus } from '../../Task.js'

const MAX_ITEMS = 50
const MAX_STRING_CHARS = 2_000
const MAX_RESULT_CHARS = 20_000

export type WorkflowFinalReportEvidenceState =
  | 'verified'
  | 'needs_verification'
  | 'failed'

export type WorkflowFinalReportTimeout = {
  kind?: 'workflow' | 'phase'
  timeoutMs: number
  elapsedMs: number
  activeAgentCount: number
  currentPhase?: string | null
}

export type WorkflowFinalReport = {
  version: 1
  runId: string
  workflowName: string
  status: Extract<TaskStatus, 'completed' | 'failed' | 'killed' | 'paused'>
  evidenceState: WorkflowFinalReportEvidenceState
  summary: string | null
  evidence: string[]
  validationCommands: string[]
  artifacts: string[]
  failures: string[]
  openQuestions: string[]
  reportPath?: string | null
  resultPreview: string | null
  timeout?: WorkflowFinalReportTimeout
  generatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function compact(value: unknown, maxChars = MAX_STRING_CHARS): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text
}

function compactJson(value: unknown, maxChars = MAX_RESULT_CHARS): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return compact(value, maxChars)
  try {
    return compact(JSON.stringify(value, null, 2), maxChars)
  } catch {
    return compact(String(value), maxChars)
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = compact(item)
    if (!text || out.includes(text)) continue
    out.push(text)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function mergeArrays(...values: string[][]): string[] {
  const out: string[] = []
  for (const list of values) {
    for (const value of list) {
      if (out.includes(value)) continue
      out.push(value)
      if (out.length >= MAX_ITEMS) return out
    }
  }
  return out
}

function getNestedRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record?.[key])
}

function verifierFailures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const failures: string[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const accepted = record.accepted
    const weakEvidence = record.weakEvidence
    if (accepted === true && weakEvidence !== true) continue
    const key = compact(record.key, 80) ?? compact(record.summary, 80) ?? 'verification'
    const gaps = asStringArray(record.gaps).length
      ? asStringArray(record.gaps)
      : asStringArray(record.missingChecks)
    const detail = gaps.length ? gaps.join('; ') : compact(record.summary) ?? 'weak evidence'
    failures.push(`${key}: ${detail}`)
    if (failures.length >= MAX_ITEMS) break
  }
  return failures
}

export function buildWorkflowFinalReport(options: {
  runId: string
  workflowName: string
  status: WorkflowFinalReport['status']
  result: unknown
  failures?: readonly string[]
  timeout?: WorkflowFinalReportTimeout
  reportPath?: string | null
  generatedAt?: string
}): WorkflowFinalReport {
  const resultRecord = asRecord(options.result)
  const verification = getNestedRecord(resultRecord, 'verification')
  const summary =
    compact(resultRecord?.summary) ??
    compact(verification?.summary) ??
    compactJson(options.result, 500)
  const explicitEvidence = mergeArrays(
    asStringArray(resultRecord?.evidence),
    asStringArray(verification?.evidence),
  )
  const validationCommands = mergeArrays(
    asStringArray(resultRecord?.validationCommands),
    asStringArray(verification?.commands),
  )
  const artifacts = mergeArrays(
    asStringArray(resultRecord?.artifacts),
    asStringArray(verification?.artifacts),
    options.reportPath ? [options.reportPath] : [],
  )
  const failures = mergeArrays(
    [...(options.failures ?? [])].map(item => compact(item)).filter(
      (item): item is string => item !== null,
    ),
    asStringArray(resultRecord?.residualRisks),
    asStringArray(verification?.failures),
    verifierFailures(resultRecord?.verifications),
  )
  const openQuestions = mergeArrays(
    asStringArray(resultRecord?.openQuestions),
    asStringArray(resultRecord?.missingChecks),
  )
  const evidenceState: WorkflowFinalReportEvidenceState =
    failures.length > 0 || options.status === 'failed' || options.status === 'killed'
      ? 'failed'
      : explicitEvidence.length > 0 || validationCommands.length > 0 || artifacts.length > 0
        ? 'verified'
        : 'needs_verification'
  return {
    version: 1,
    runId: options.runId,
    workflowName: options.workflowName,
    status: options.status,
    evidenceState,
    summary,
    evidence: explicitEvidence,
    validationCommands,
    artifacts,
    failures,
    openQuestions,
    reportPath: options.reportPath ?? null,
    resultPreview: compactJson(options.result),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  }
}
