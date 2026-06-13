import { createHash } from 'node:crypto'
import {
  appendObservation,
  appendProposal,
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  projectIdFromCwd,
  redactMemoryText,
  type AppendObservationResult,
  type AppendProposalResult,
  type Observation,
  type Proposal,
} from '../../memory-sidecar/src/index.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../memory-sidecar/src/schema/scope.js'
import { workflowRunToJson, type WorkflowJsonRun } from '../../commands/workflows/workflowProgressTree.js'
import { loadRunMeta } from '../../tools/WorkflowTool/engine/journalStore.js'

const MAX_SUMMARY_CHARS = 1800
const MAX_FIELD_CHARS = 320
const MAX_LIST_ITEMS = 8

export type WorkflowMemoryCandidate = {
  observation: Observation
  proposal: Proposal
  redactionNotes: string[]
}

export type CaptureWorkflowMemoryResult =
  | {
      ok: true
      runId: string
      observation: AppendObservationResult
      proposal: AppendProposalResult
      redactionNotes: string[]
    }
  | {
      ok: false
      runId: string
      reason: 'sidecar_disabled' | 'config_error' | 'run_not_found' | 'low_signal' | 'write_failed'
      error?: string
    }

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function compact(value: unknown, maxChars = MAX_FIELD_CHARS): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

function uniqueBounded(values: Array<string | null | undefined>, max = MAX_LIST_ITEMS): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = compact(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= max) break
  }
  return out
}

function safeResultSummary(run: WorkflowJsonRun): string | null {
  const raw = run.result
  if (!raw) return null
  let value: unknown = raw
  if (typeof raw === 'string' && /^[{[]/.test(raw.trim())) {
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const summary = compact(
      record.summary ??
        record.resultSummary ??
        record.message ??
        record.outcome ??
        record.conclusion,
    )
    if (summary) return summary
  }
  if (typeof value === 'string' && value === raw) {
    const rawSummary = run.resultSummary ? compact(run.resultSummary) : null
    if (rawSummary && rawSummary === compact(raw)) return rawSummary
  }
  return null
}

function lineList(label: string, values: string[]): string[] {
  if (values.length === 0) return []
  return [`${label}:`, ...values.map(value => `- ${value}`)]
}

function sanitizeMemoryText(text: string): { text: string; notes: string[] } {
  const redacted = redactMemoryText(text)
  return {
    text: redacted.text.length > MAX_SUMMARY_CHARS
      ? `${redacted.text.slice(0, MAX_SUMMARY_CHARS - 1)}…`
      : redacted.text,
    notes: redacted.notes,
  }
}

function workflowHasMemorySignal(run: WorkflowJsonRun): boolean {
  return (
    run.status !== 'running' &&
    run.status !== 'paused' &&
    (
      run.phases.length > 0 ||
      run.failures.length > 0 ||
      run.verification.evidence.length > 0 ||
      run.verification.commands.length > 0 ||
      run.resultSummary !== null
    )
  )
}

function workflowMemorySummary(run: WorkflowJsonRun): {
  summary: string
  files: string[]
  redactionNotes: string[]
} {
  const phases = uniqueBounded(
    run.phases.map(phase =>
      [phase.title, phase.detail, phase.model ? `model=${phase.model}` : null]
        .filter(Boolean)
        .join(' | '),
    ),
  )
  const failures = uniqueBounded(run.verification.failures.length > 0
    ? run.verification.failures
    : run.failures)
  const evidence = uniqueBounded(run.verification.evidence)
  const commands = uniqueBounded(run.verification.commands)
  const artifacts = uniqueBounded(run.verification.artifacts)
  const resultSummary = safeResultSummary(run)
  const files = uniqueBounded([
    run.reportPath,
    run.scriptPath,
    ...artifacts.filter(item => item.startsWith('/') || item.startsWith('./') || item.startsWith('../')),
  ], 12)
  const raw = [
    `Workflow: ${run.title ?? run.workflowName} (${run.runId})`,
    `State: ${run.state}; status: ${run.status}; verification: ${run.verification.state}`,
    run.parentGoalId ? `Parent goal: ${run.parentGoalId}` : null,
    run.description ? `Purpose: ${compact(run.description)}` : null,
    run.verification.summary ? `Verification summary: ${compact(run.verification.summary)}` : null,
    resultSummary ? `Result summary: ${resultSummary}` : null,
    ...lineList('Plan phases', phases),
    ...lineList('Validation commands', commands),
    ...lineList('Evidence', evidence),
    ...lineList('Failures', failures),
    ...lineList('Artifacts', artifacts),
  ].filter((line): line is string => line !== null).join('\n')
  const sanitized = sanitizeMemoryText(raw)
  return {
    summary: sanitized.text,
    files,
    redactionNotes: sanitized.notes,
  }
}

export function buildWorkflowMemoryCandidate(options: {
  run: WorkflowJsonRun
  projectId: string
  sessionId?: string
  createdAt?: string
}): WorkflowMemoryCandidate | null {
  if (!workflowHasMemorySignal(options.run)) return null
  const createdAt = options.createdAt ?? new Date().toISOString()
  const evidenceId = `workflow:${options.run.runId}`
  const idSeed = `${options.projectId}:${options.run.runId}:${options.run.status}:${options.run.verification.summary ?? ''}`
  const { summary, files, redactionNotes } = workflowMemorySummary(options.run)
  const title = compact(`Workflow result: ${options.run.title ?? options.run.workflowName}`, 180) ??
    `Workflow result: ${options.run.runId}`
  const observationId = `obs_workflow_${stableHash(idSeed)}`
  const proposalId = `proposal_workflow_${stableHash(idSeed)}`
  const evidenceIds = uniqueBounded([
    evidenceId,
    options.run.parentGoalId ? `goal:${options.run.parentGoalId}` : null,
  ], 4)
  const tags = uniqueBounded([
    'workflow',
    'workflow-result',
    `state:${options.run.state}`,
    `verification:${options.run.verification.state}`,
    options.run.parentGoalId ? `goal:${options.run.parentGoalId}` : null,
    options.run.failures.length > 0 ? 'has-failures' : null,
    options.run.verification.commands.length > 0 ? 'has-validation-commands' : null,
  ], 12)
  const confidence = options.run.verification.evidence.length > 0 ||
    options.run.verification.commands.length > 0
    ? 0.82
    : options.run.failures.length > 0
      ? 0.78
      : 0.66
  const observation: Observation = {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    observationId,
    scope: 'project',
    visibility: 'project',
    projectId: options.projectId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    type: 'workflow_pattern',
    kind: 'procedural',
    domain: 'workflow',
    lifecycle: 'candidate',
    retrievalPolicy: 'candidate_only',
    title,
    summary,
    evidenceIds,
    evidenceEventIds: evidenceIds,
    files,
    tags,
    confidence,
    source: 'rule',
    promotionStatus: 'candidate',
    createdAt,
  }
  const proposal: Proposal = {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    proposalId,
    type: 'workflow',
    status: 'candidate',
    projectId: options.projectId,
    title: compact(`Review workflow memory: ${options.run.title ?? options.run.workflowName}`, 180) ??
      `Review workflow memory: ${options.run.runId}`,
    rationale: summary,
    evidenceEventIds: evidenceIds,
    createdAt,
    confidence,
  }
  return { observation, proposal, redactionNotes }
}

export async function captureWorkflowRunMemoryCandidate(options: {
  runId: string
  cwd: string
  sessionId?: string
}): Promise<CaptureWorkflowMemoryResult> {
  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    return {
      ok: false,
      runId: options.runId,
      reason: 'config_error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (!config.enabled) {
    return { ok: false, runId: options.runId, reason: 'sidecar_disabled' }
  }
  const meta = loadRunMeta(options.runId)
  if (!meta) {
    return { ok: false, runId: options.runId, reason: 'run_not_found' }
  }
  const projectId = projectIdFromCwd(options.cwd)
  const candidate = buildWorkflowMemoryCandidate({
    run: workflowRunToJson(meta),
    projectId,
    sessionId: options.sessionId,
  })
  if (!candidate) {
    return { ok: false, runId: options.runId, reason: 'low_signal' }
  }
  try {
    const observation = await appendObservation({
      rootDir: config.homeDir,
      projectId,
      observation: candidate.observation,
    })
    const proposal = await appendProposal({
      rootDir: config.homeDir,
      projectId,
      proposal: candidate.proposal,
    })
    return {
      ok: true,
      runId: options.runId,
      observation,
      proposal,
      redactionNotes: candidate.redactionNotes,
    }
  } catch (error) {
    return {
      ok: false,
      runId: options.runId,
      reason: 'write_failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
