import { formatDuration, formatNumber } from '../../utils/format.js'

export type WorkflowProgressAgentSummaryInput = {
  status?: string
  tokens?: number
  toolCalls?: number
  startedAt?: number
  durationMs?: number
}

export type WorkflowProgressRunSummaryInput = {
  status?: string
  paused?: boolean
  startTime?: number
  endTime?: number
  durationMs?: number
  totalPausedMs?: number
  agentCount?: number
  tokensSpent?: number
  totalToolCalls?: number
}

export type WorkflowMetricSummary = {
  agentCount: number
  tokens: number
  toolCalls: number
  elapsedMs: number
}

export type WorkflowPhaseMetricSummary = WorkflowMetricSummary & {
  title: string
  statusSummary: string
}

export function workflowFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function workflowAgentElapsedMs(
  agent: WorkflowProgressAgentSummaryInput,
  now = Date.now(),
): number {
  if (typeof agent.durationMs === 'number') return Math.max(0, agent.durationMs)
  const startedAt = workflowFiniteNumber(agent.startedAt)
  if (!startedAt) return 0
  return Math.max(0, now - startedAt)
}

export function workflowTaskElapsedMs(
  task: WorkflowProgressRunSummaryInput,
  now = Date.now(),
): number {
  if (
    task.status !== 'running' &&
    task.status !== 'paused' &&
    typeof task.durationMs === 'number'
  ) {
    return Math.max(0, task.durationMs)
  }
  const start = workflowFiniteNumber(task.startTime)
  if (!start) return 0
  const end =
    task.status === 'running' || task.status === 'paused'
      ? now
      : workflowFiniteNumber(task.endTime) || now
  return Math.max(0, end - start - workflowFiniteNumber(task.totalPausedMs))
}

export function workflowSumAgents(
  agents: readonly WorkflowProgressAgentSummaryInput[],
  field: 'tokens' | 'toolCalls',
): number {
  return agents.reduce(
    (sum, agent) => sum + workflowFiniteNumber(agent[field]),
    0,
  )
}

export function workflowSumAgentElapsedMs(
  agents: readonly WorkflowProgressAgentSummaryInput[],
  now = Date.now(),
): number {
  return agents.reduce((sum, agent) => sum + workflowAgentElapsedMs(agent, now), 0)
}

export function workflowStatusSummary(
  agents: readonly WorkflowProgressAgentSummaryInput[],
): string {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const status = agent.status ?? 'unknown'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
}

export function buildWorkflowRunMetricSummary(
  run: WorkflowProgressRunSummaryInput,
  agents: readonly WorkflowProgressAgentSummaryInput[],
  now = Date.now(),
): WorkflowMetricSummary {
  return {
    agentCount: workflowFiniteNumber(run.agentCount) || agents.length,
    tokens:
      run.tokensSpent !== undefined
        ? workflowFiniteNumber(run.tokensSpent)
        : workflowSumAgents(agents, 'tokens'),
    toolCalls:
      run.totalToolCalls !== undefined
        ? workflowFiniteNumber(run.totalToolCalls)
        : workflowSumAgents(agents, 'toolCalls'),
    elapsedMs: workflowTaskElapsedMs(run, now),
  }
}

export function buildWorkflowPhaseMetricSummary(
  title: string,
  agents: readonly WorkflowProgressAgentSummaryInput[],
  now = Date.now(),
): WorkflowPhaseMetricSummary {
  return {
    title,
    agentCount: agents.length,
    statusSummary: workflowStatusSummary(agents),
    tokens: workflowSumAgents(agents, 'tokens'),
    toolCalls: workflowSumAgents(agents, 'toolCalls'),
    elapsedMs: workflowSumAgentElapsedMs(agents, now),
  }
}

export function formatWorkflowMetricSummary(
  summary: WorkflowMetricSummary,
  options: { approximateTokens?: boolean } = {},
): string {
  const tokenPrefix = options.approximateTokens ? '~' : ''
  const parts = [
    `${formatNumber(summary.agentCount)} agents`,
    `${tokenPrefix}${formatNumber(summary.tokens)} tok`,
    `${formatNumber(summary.toolCalls)} tools`,
  ]
  if (summary.elapsedMs > 0) {
    parts.push(formatDuration(summary.elapsedMs, { mostSignificantOnly: true }))
  }
  return parts.join(' · ')
}

export function formatWorkflowPhaseMetricSummary(
  summary: WorkflowPhaseMetricSummary,
): string {
  const parts = [
    `${summary.agentCount} agent(s)`,
    summary.statusSummary,
    `${formatNumber(summary.tokens)} tok`,
    `${formatNumber(summary.toolCalls)} tools`,
  ].filter(Boolean)
  if (summary.elapsedMs > 0) {
    parts.push(formatDuration(summary.elapsedMs, { mostSignificantOnly: true }))
  }
  return `${summary.title} · ${parts.join(' · ')}`
}
