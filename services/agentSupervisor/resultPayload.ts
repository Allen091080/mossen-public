import { readSupervisorJsonlTolerant } from './jsonl.js'
import { getAgentSupervisorJobPaths } from './paths.js'
import {
  AgentSupervisorJobIdSchema,
  type AgentSupervisorEventMessage,
  type AgentSupervisorJobId,
  type AgentSupervisorResultPayload,
} from './schema.js'

export function createAgentSupervisorResultPayload(
  summary: string,
  createdAt = new Date().toISOString(),
): AgentSupervisorResultPayload {
  return {
    summary,
    artifacts: [],
    risks: [],
    nextActions: [],
    createdAt,
  }
}

export function latestAgentSupervisorResultPayload(
  events: Partial<AgentSupervisorEventMessage>[],
): AgentSupervisorResultPayload | null {
  for (const event of events.slice().reverse()) {
    if (event.kind === 'result_payload' && event.payload) {
      return event.payload
    }
  }
  return null
}

export async function readAgentSupervisorResultPayload(
  rawJobId: string,
): Promise<AgentSupervisorResultPayload | null> {
  const jobId: AgentSupervisorJobId = AgentSupervisorJobIdSchema.parse(rawJobId)
  const paths = getAgentSupervisorJobPaths(jobId)
  const events =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorEventMessage>>(
      paths.events,
    )
  return latestAgentSupervisorResultPayload(events.records)
}

export function formatAgentSupervisorResultPayload(
  payload: AgentSupervisorResultPayload | null | undefined,
): string | null {
  if (!payload) return null
  const lines = [`Result: ${payload.summary}`]
  if (payload.artifacts.length > 0) {
    lines.push('Artifacts:')
    for (const artifact of payload.artifacts) {
      const target = artifact.url ?? artifact.path
      lines.push(`  - ${target ? `${artifact.label}: ${target}` : artifact.label}`)
    }
  }
  if (payload.risks.length > 0) {
    lines.push('Risks:')
    for (const risk of payload.risks) lines.push(`  - ${risk}`)
  }
  if (payload.nextActions.length > 0) {
    lines.push('Next actions:')
    for (const action of payload.nextActions) lines.push(`  - ${action}`)
  }
  return lines.join('\n')
}
