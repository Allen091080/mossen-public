import { createHash } from 'node:crypto'
import type { MemoryRootOptions } from '../index.js'
import { redactMemoryText } from '../redaction/redact.js'
import type { Proposal } from '../schema/proposal.js'
import { appendProposal, type AppendProposalResult } from '../storage/proposalStore.js'

export type AgentResultHandoffPayload = {
  summary: string
  artifacts: Array<{ label: string; path?: string; url?: string }>
  risks: string[]
  nextActions: string[]
  createdAt: string
}

export type AgentResultHandoffOptions = MemoryRootOptions & {
  jobId: string
  payload: AgentResultHandoffPayload
  confirm?: boolean
  createdAt?: string
}

export type AgentResultHandoffResult = {
  status: 'dry-run' | 'candidate-created' | 'candidate-skipped'
  proposal: Proposal
  appended?: AppendProposalResult
}

export async function createAgentResultMemoryHandoff(
  options: AgentResultHandoffOptions,
): Promise<AgentResultHandoffResult> {
  const proposal = buildAgentResultProposal(options)
  if (!options.confirm) {
    return { status: 'dry-run', proposal }
  }

  const appended = await appendProposal({ ...options, proposal })
  return {
    status: appended.skipped ? 'candidate-skipped' : 'candidate-created',
    proposal,
    appended,
  }
}

export function buildAgentResultProposal(
  options: AgentResultHandoffOptions,
): Proposal {
  const createdAt = options.createdAt ?? new Date().toISOString()
  const payload = redactHandoffPayload(options.payload)
  const summary = compactLine(payload.summary, 500)
  const proposalId = `agent_result_${stableHash([
    options.projectId,
    options.jobId,
    payload.summary,
    payload.createdAt,
  ].join('\n'))}`

  return {
    schemaVersion: 1,
    proposalId,
    type: 'memory_promotion',
    status: 'candidate',
    projectId: options.projectId,
    title: compactLine(`Agent result: ${summary}`, 120),
    rationale: buildRationale(options.jobId, payload),
    evidenceEventIds: [`agent-supervisor:${options.jobId}`],
    createdAt,
    confidence: 0.65,
  }
}

function redactHandoffPayload(
  payload: AgentResultHandoffPayload,
): AgentResultHandoffPayload {
  return {
    summary: redactMemoryText(payload.summary).text,
    artifacts: payload.artifacts.map(artifact => ({
      label: redactMemoryText(artifact.label).text,
      path: artifact.path ? redactMemoryText(artifact.path).text : undefined,
      url: artifact.url ? redactMemoryText(artifact.url).text : undefined,
    })),
    risks: payload.risks.map(risk => redactMemoryText(risk).text),
    nextActions: payload.nextActions.map(action => redactMemoryText(action).text),
    createdAt: payload.createdAt,
  }
}

function buildRationale(
  jobId: string,
  payload: AgentResultHandoffPayload,
): string {
  const lines = [
    `Background job ${jobId} completed with structured result: ${payload.summary}`,
  ]
  if (payload.artifacts.length > 0) {
    lines.push('Artifacts:')
    for (const artifact of payload.artifacts) {
      const target = artifact.url ?? artifact.path
      lines.push(`- ${target ? `${artifact.label}: ${target}` : artifact.label}`)
    }
  }
  if (payload.risks.length > 0) {
    lines.push('Risks:')
    for (const risk of payload.risks) lines.push(`- ${risk}`)
  }
  if (payload.nextActions.length > 0) {
    lines.push('Next actions:')
    for (const action of payload.nextActions) lines.push(`- ${action}`)
  }
  lines.push('This is a candidate proposal only; it is not accepted automatically.')
  return compactLine(lines.join('\n'), 1200)
}

function compactLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 3))}...`
}

function stableHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}
