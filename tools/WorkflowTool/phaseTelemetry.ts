import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import type { SdkWorkflowProgress } from '../../types/tools.js'

type WorkflowProgressRecord = Record<string, unknown>

type WorkflowAgentProgressRecord = WorkflowProgressRecord & {
  type: 'workflow_agent'
  index: number
}

export type WorkflowPhaseCompletionMetric = {
  phaseIndex: number
  phaseTitle: string
  phaseTokens: number
  phaseToolCalls: number
  phaseAgentDurationMs: number
  phaseAgentCount: number
  phaseErrorCount: number
  phaseSkipCount: number
}

export type WorkflowTelemetrySource =
  | 'built-in'
  | 'project'
  | 'user'
  | 'plugin'
  | 'scriptPath'
  | 'inline'
  | string

function asRecord(value: unknown): WorkflowProgressRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as WorkflowProgressRecord)
    : null
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function positiveIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const index = Math.floor(value)
  return index > 0 ? index : null
}

function latestWorkflowAgentRows(
  progress: readonly SdkWorkflowProgress[],
): WorkflowAgentProgressRecord[] {
  const byAgent = new Map<number, WorkflowAgentProgressRecord>()
  for (const item of progress) {
    const record = asRecord(item)
    if (!record || record.type !== 'workflow_agent') continue
    const index = positiveIndex(record.index)
    if (index === null) continue
    byAgent.set(index, { ...record, type: 'workflow_agent', index })
  }
  return [...byAgent.values()].sort((a, b) => a.index - b.index)
}

function phaseTitleFrom(
  agent: WorkflowAgentProgressRecord,
  phaseTitles: ReadonlyMap<number, string>,
): string | null {
  if (typeof agent.phaseTitle === 'string' && agent.phaseTitle.trim()) {
    return agent.phaseTitle.trim()
  }
  const phaseIndex = positiveIndex(agent.phaseIndex)
  return phaseIndex === null ? null : phaseTitles.get(phaseIndex) ?? null
}

function isSkippedAgent(agent: WorkflowAgentProgressRecord): boolean {
  return (
    agent.state === 'skipped' ||
    agent.error === 'skipped by user'
  )
}

function isErroredAgent(agent: WorkflowAgentProgressRecord): boolean {
  return (
    agent.state === 'failed' ||
    agent.state === 'error' ||
    (typeof agent.error === 'string' && agent.error.length > 0)
  )
}

export function collectWorkflowPhaseCompletionMetrics(
  progress: readonly SdkWorkflowProgress[],
): WorkflowPhaseCompletionMetric[] {
  const phaseTitles = new Map<number, string>()
  for (const item of progress) {
    const record = asRecord(item)
    if (!record || record.type !== 'workflow_phase') continue
    const index = positiveIndex(record.index)
    if (index === null) continue
    if (typeof record.title === 'string' && record.title.trim()) {
      phaseTitles.set(index, record.title.trim())
    }
  }

  const byPhase = new Map<number, WorkflowPhaseCompletionMetric>()
  for (const agent of latestWorkflowAgentRows(progress)) {
    const phaseIndex = positiveIndex(agent.phaseIndex)
    if (phaseIndex === null) continue
    const phaseTitle = phaseTitleFrom(agent, phaseTitles)
    if (!phaseTitle) continue

    let metric = byPhase.get(phaseIndex)
    if (!metric) {
      metric = {
        phaseIndex,
        phaseTitle,
        phaseTokens: 0,
        phaseToolCalls: 0,
        phaseAgentDurationMs: 0,
        phaseAgentCount: 0,
        phaseErrorCount: 0,
        phaseSkipCount: 0,
      }
      byPhase.set(phaseIndex, metric)
    }

    metric.phaseTokens += finiteNumber(agent.tokens)
    metric.phaseToolCalls += finiteNumber(agent.toolCalls)
    metric.phaseAgentDurationMs += finiteNumber(agent.durationMs)
    metric.phaseAgentCount += 1
    if (isSkippedAgent(agent)) metric.phaseSkipCount += 1
    else if (isErroredAgent(agent)) metric.phaseErrorCount += 1
  }

  return [...byPhase.values()].sort((a, b) => a.phaseIndex - b.phaseIndex)
}

function safeAnalyticsString(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function workflowSourceForTelemetry(
  source: string | null | undefined,
): WorkflowTelemetrySource {
  if (source === 'bundled') return 'built-in'
  return source?.trim() || 'inline'
}

export function logWorkflowLaunchMetric(params: {
  invocationMode: string
  workflowSource: string
  workflowName: string
  workflowDescription: string
  phaseCount: number
  hasArgs: boolean
  isResume: boolean
  scriptSizeChars: number
}): void {
  logMossenEvent('mossen.workflow.launched', {
    invocation_mode: safeAnalyticsString(params.invocationMode),
    workflow_source: safeAnalyticsString(params.workflowSource),
    workflow_name: safeAnalyticsString(params.workflowName),
    workflow_description: safeAnalyticsString(params.workflowDescription),
    phase_count: params.phaseCount,
    has_args: params.hasArgs,
    is_resume: params.isResume,
    script_size_chars: params.scriptSizeChars,
  })
}

export function logWorkflowCompletionMetric(params: {
  workflowRunId: string
  workflowSource: string
  workflowName: string
  workflowDescription: string
  status: 'completed' | 'failed' | 'killed' | string
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  durationMs: number
}): void {
  logMossenEvent('mossen.workflow.completed', {
    workflow_run_id: safeAnalyticsString(params.workflowRunId),
    workflow_source: safeAnalyticsString(params.workflowSource),
    workflow_name: safeAnalyticsString(params.workflowName),
    workflow_description: safeAnalyticsString(params.workflowDescription),
    status: safeAnalyticsString(params.status),
    agent_count: params.agentCount,
    total_tokens: params.totalTokens,
    total_tool_calls: params.totalToolCalls,
    duration_ms: params.durationMs,
  })
}

export function logWorkflowPhaseCompletionMetrics(params: {
  workflowRunId: string
  workflowSource: string
  workflowName: string
  progress: readonly SdkWorkflowProgress[]
}): void {
  for (const metric of collectWorkflowPhaseCompletionMetrics(params.progress)) {
    logMossenEvent('mossen.workflow.phaseCompleted', {
      workflow_run_id: safeAnalyticsString(params.workflowRunId),
      workflow_source: safeAnalyticsString(params.workflowSource),
      workflow_name: safeAnalyticsString(params.workflowName),
      phase_index: metric.phaseIndex,
      phase_title: safeAnalyticsString(metric.phaseTitle),
      phase_tokens: metric.phaseTokens,
      phase_tool_calls: metric.phaseToolCalls,
      phase_agent_duration_ms: metric.phaseAgentDurationMs,
      phase_agent_count: metric.phaseAgentCount,
      phase_error_count: metric.phaseErrorCount,
      phase_skip_count: metric.phaseSkipCount,
    })
  }
}
