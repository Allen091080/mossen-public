import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type { Observation } from '../schema/observation.js'
import type { Proposal, ProposalStatus, ProposalType } from '../schema/proposal.js'

export type ProposalKind =
  | 'instruction_memory'
  | 'project_decision'
  | 'handoff'
  | 'blocker'
  | 'skill_candidate'
  | 'team_policy'

export type ProposalCandidate = {
  proposalId: string
  kind: ProposalKind
  title: string
  summary: string
  evidenceEventIds: string[]
  confidence: number
  createdAt: string
}

export type ProposalUserSummaryItem = {
  proposalId: string
  type: ProposalType
  status: ProposalStatus
  title: string
  rationale: string
  evidenceEventIds: string[]
  confidence: number
  createdAt: string
  actionLabel: string
}

export type ProposalUserSummary = {
  total: number
  candidateCount: number
  acceptedCount: number
  rejectedCount: number
  byType: Record<ProposalType, number>
  topCandidates: ProposalUserSummaryItem[]
  text: string
}

export type DetectProposalsOptions = {
  projectId: string
  createdAt?: string
  minConfidence?: number
  maxProposals?: number
}

export type DetectProposalCandidatesOptions = Omit<DetectProposalsOptions, 'projectId'>

export function detectProposalCandidates(
  input: {
    observations?: Observation[]
    events?: ArchiveEvent[]
  },
  options: DetectProposalCandidatesOptions = {},
): ProposalCandidate[] {
  const minConfidence = options.minConfidence ?? 0.55
  const maxProposals = options.maxProposals ?? 20
  const createdAt = options.createdAt ?? latestCreatedAt(input.observations ?? [], input.events ?? [])
  const fromObservations = observationProposals(input.observations ?? [], createdAt)
  const fromEvents = eventProposals(input.events ?? [], createdAt)
  const seen = new Set<string>()

  return [...fromObservations, ...fromEvents]
    .filter(proposal => proposal.confidence >= minConfidence)
    .sort(compareProposal)
    .filter(proposal => {
      const key = `${proposal.kind}:${proposal.evidenceEventIds.join(',')}:${proposal.summary}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, maxProposals)
}

export function detectProposals(
  input: {
    observations?: Observation[]
    events?: ArchiveEvent[]
  },
  options: DetectProposalsOptions,
): Proposal[] {
  return detectProposalCandidates(input, options).map(candidate => ({
    schemaVersion: 1,
    proposalId: candidate.proposalId,
    type: proposalTypeForKind(candidate.kind),
    status: 'candidate',
    projectId: options.projectId,
    title: candidate.title,
    rationale: candidate.summary,
    evidenceEventIds: candidate.evidenceEventIds,
    createdAt: candidate.createdAt,
    confidence: candidate.confidence,
  }))
}

export function summarizeProposalCandidates(
  proposals: Proposal[],
  options: {
    maxItems?: number
  } = {},
): ProposalUserSummary {
  const maxItems = options.maxItems ?? 5
  const sorted = [...proposals].sort(compareUserProposal)
  const byType = emptyProposalTypeCounts()
  let candidateCount = 0
  let acceptedCount = 0
  let rejectedCount = 0

  for (const proposal of sorted) {
    byType[proposal.type] += 1
    if (proposal.status === 'candidate') candidateCount += 1
    if (proposal.status === 'accepted') acceptedCount += 1
    if (proposal.status === 'rejected') rejectedCount += 1
  }

  const topCandidates = sorted
    .filter(proposal => proposal.status === 'candidate')
    .slice(0, maxItems)
    .map(proposal => ({
      proposalId: proposal.proposalId,
      type: proposal.type,
      status: proposal.status,
      title: proposal.title,
      rationale: proposal.rationale,
      evidenceEventIds: [...proposal.evidenceEventIds].sort(),
      confidence: proposal.confidence,
      createdAt: proposal.createdAt,
      actionLabel: actionLabelForProposal(proposal),
    }))

  return {
    total: proposals.length,
    candidateCount,
    acceptedCount,
    rejectedCount,
    byType,
    topCandidates,
    text: proposalSummaryText(topCandidates, candidateCount),
  }
}

function observationProposals(
  observations: Observation[],
  createdAt: string,
): ProposalCandidate[] {
  return [...observations].sort(compareObservation).flatMap(observation => {
    if (
      observation.retrievalPolicy === 'never_inject' ||
      observation.lifecycle === 'disputed' ||
      observation.lifecycle === 'superseded'
    ) {
      return []
    }

    // B: User intent negative filter — skip intent declarations
    if (isUserIntentDeclaration(observation.title + ' ' + observation.summary)) {
      return []
    }

    const kind = proposalKindForObservation(observation)
    if (!kind) return []

    // A: Build structured title instead of raw truncation
    const title = buildProposalTitle(kind, observation)
    // A: Build structured rationale instead of raw summary
    const rationale = buildProposalRationale(kind, observation)

    // C: Adjust confidence based on actionability factors
    const confidence = adjustProposalConfidence(observation)

    return [
      makeProposal({
        kind,
        title,
        summary: rationale,
        evidenceEventIds: observation.evidenceEventIds,
        confidence,
        createdAt,
      }),
    ]
  })
}

function eventProposals(
  events: ArchiveEvent[],
  createdAt: string,
): ProposalCandidate[] {
  return [...events]
    .sort(compareEvent)
    .filter(event => event.role === 'user' && isInstructionLike(event.text))
    .map(event =>
      makeProposal({
        kind: 'instruction_memory',
        title: `Instruction candidate: ${compact(event.text, 80)}`,
        summary: compact(event.text, 260),
        evidenceEventIds: [event.eventId],
        confidence: 0.58,
        createdAt,
      }),
    )
}

function proposalKindForObservation(observation: Observation): ProposalKind | undefined {
  if (
    observation.type === 'instruction_candidate' ||
    observation.type === 'preference' ||
    observation.type === 'safety_rule'
  ) {
    return 'instruction_memory'
  }
  if (
    observation.type === 'decision' ||
    observation.type === 'workflow_pattern' ||
    observation.type === 'coding_convention' ||
    observation.type === 'tool_preference'
  ) return 'project_decision'
  if (
    observation.type === 'handoff' ||
    observation.type === 'project_state' ||
    observation.type === 'open_thread'
  ) return 'handoff'
  if (observation.type === 'blocker') return 'blocker'
  if (observation.type === 'skill_candidate') return 'skill_candidate'
  if (observation.type === 'team_policy') return 'team_policy'
  return undefined
}

function proposalTypeForKind(kind: ProposalKind): ProposalType {
  if (kind === 'instruction_memory') return 'memory_promotion'
  if (kind === 'project_decision' || kind === 'skill_candidate') return 'workflow'
  if (kind === 'handoff') return 'profile'
  return 'safety'
}

function actionLabelForProposal(proposal: Proposal): string {
  if (proposal.type === 'memory_promotion') return 'Review memory promotion'
  if (proposal.type === 'workflow') return 'Review workflow suggestion'
  if (proposal.type === 'profile') return 'Review profile update'
  if (proposal.type === 'safety') return 'Review safety note'
  if (proposal.type === 'skill') return 'Review skill candidate'
  if (proposal.type === 'plugin') return 'Review plugin suggestion'
  return 'Review model hint'
}

function proposalSummaryText(
  items: ProposalUserSummaryItem[],
  candidateCount: number,
): string {
  if (candidateCount === 0) return 'No proposal candidates need review.'
  const lines = items.map(item =>
    `- ${item.title} (${item.type}, confidence ${item.confidence.toFixed(2)})`,
  )
  const suffix = candidateCount > items.length
    ? `\n...and ${candidateCount - items.length} more candidate(s).`
    : ''
  return `Proposal candidates needing review:\n${lines.join('\n')}${suffix}`
}

function emptyProposalTypeCounts(): Record<ProposalType, number> {
  return {
    skill: 0,
    workflow: 0,
    plugin: 0,
    memory_promotion: 0,
    safety: 0,
    profile: 0,
    model_hint: 0,
  }
}

function compareUserProposal(left: Proposal, right: Proposal): number {
  const status = proposalStatusPriority(right) - proposalStatusPriority(left)
  if (status !== 0) return status

  const confidence = right.confidence - left.confidence
  if (confidence !== 0) return confidence

  const createdAt = right.createdAt.localeCompare(left.createdAt)
  if (createdAt !== 0) return createdAt

  return left.proposalId.localeCompare(right.proposalId)
}

function proposalStatusPriority(proposal: Proposal): number {
  if (proposal.status === 'candidate') return 3
  if (proposal.status === 'accepted') return 2
  if (proposal.status === 'rejected') return 1
  return 0
}

function makeProposal(
  proposal: Omit<ProposalCandidate, 'proposalId'>,
): ProposalCandidate {
  const evidenceEventIds = [...proposal.evidenceEventIds].sort()
  const raw = `${proposal.kind}:${evidenceEventIds.join(',')}:${proposal.summary}`

  return {
    ...proposal,
    proposalId: `proposal_${stableHash(raw)}`,
    evidenceEventIds,
  }
}

function isInstructionLike(text: string): boolean {
  return /记住|以后|默认|不要|必须|请始终|always|never|default/iu.test(text)
}

function compareProposal(left: ProposalCandidate, right: ProposalCandidate): number {
  const confidence = right.confidence - left.confidence
  if (confidence !== 0) return confidence
  return left.proposalId.localeCompare(right.proposalId)
}

function compareObservation(left: Observation, right: Observation): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.observationId.localeCompare(right.observationId)
  )
}

function compareEvent(left: ArchiveEvent, right: ArchiveEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId)
}

function latestCreatedAt(
  observations: Observation[],
  events: ArchiveEvent[],
): string {
  return [
    ...observations.map(observation => observation.createdAt),
    ...events.map(event => event.createdAt),
  ].sort().at(-1) ?? '1970-01-01T00:00:00.000Z'
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}

function stableHash(raw: string): string {
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(index)
  }
  return Math.abs(hash).toString(36)
}

// --- W100: Proposal quality helpers ---

const USER_INTENT_PATTERNS = [
  /[我要我想].{0,4}(通过|用|让|做|验证|实现|开发|完成)/u,
  /Allen.{0,6}(要|需|将|打算)/u,
  /目标是要/u,
  /现在启动/u,
  /用户希望/u,
  /^(Goal|Target|Objective)[:：]/iu,
]

function isUserIntentDeclaration(text: string): boolean {
  return USER_INTENT_PATTERNS.some(pattern => pattern.test(text))
}

function buildProposalTitle(
  kind: ProposalKind,
  observation: Observation,
): string {
  const topic = extractTopic(observation.summary)
  switch (kind) {
    case 'project_decision':
      return `Preserve decision: ${topic}`
    case 'handoff':
      return `Track project state: ${topic}`
    case 'blocker':
      return `Resolve blocker: ${topic}`
    case 'instruction_memory':
      return `Retain instruction: ${topic}`
    case 'skill_candidate':
      return `Evaluate skill: ${topic}`
    case 'team_policy':
      return `Codify policy: ${topic}`
    default:
      return topic
  }
}

function buildProposalRationale(
  kind: ProposalKind,
  observation: Observation,
): string {
  const evidenceCount = observation.evidenceEventIds.length
  const scopeLabel = observation.scope === 'project' ? 'project-scoped' : observation.scope
  const summary = compact(observation.summary, 200)

  const actionabilityHint = kind === 'project_decision'
    ? 'Actionable: this decision should be preserved for future context.'
    : kind === 'handoff'
      ? 'Reference: project state tracking for continuity.'
      : kind === 'instruction_memory'
        ? 'Directive: user instruction worth retaining.'
        : 'Worth reviewing for long-term memory.'

  return `${summary} (${evidenceCount} evidence, ${scopeLabel}) ${actionabilityHint}`
}

function extractTopic(text: string): string {
  const compacted = text.replace(/\s+/g, ' ').trim()
  if (compacted.length <= 60) return compacted
  // Try to extract first clause
  const clauseMatch = compacted.match(/^(.{20,55}?)[，,。.；;！!？?：:]/u)
  if (clauseMatch) return clauseMatch[1].trim()
  return compact(compacted, 60)
}

function adjustProposalConfidence(observation: Observation): number {
  let confidence = observation.confidence

  // Short text penalty
  const textLength = (observation.title + ' ' + observation.summary).length
  if (textLength < 50) {
    confidence *= 0.75
  } else if (textLength < 100) {
    confidence *= 0.85
  }

  // Single evidence penalty
  if (observation.evidenceEventIds.length <= 1) {
    confidence *= 0.9
  }

  // Cap short-text proposals
  if (textLength < 100) {
    confidence = Math.min(confidence, 0.65)
  }

  return Number(confidence.toFixed(3))
}
