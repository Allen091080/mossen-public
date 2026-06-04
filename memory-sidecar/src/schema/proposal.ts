import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemorySchemaVersion,
  isNonEmptyString,
  isRecord,
} from './scope'

export const PROPOSAL_TYPES = [
  'skill',
  'workflow',
  'plugin',
  'memory_promotion',
  'safety',
  'profile',
  'model_hint',
] as const

export const PROPOSAL_STATUSES = [
  'candidate',
  'accepted',
  'rejected',
  'superseded',
] as const

export type ProposalType = (typeof PROPOSAL_TYPES)[number]
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export type Proposal = {
  schemaVersion: MemorySchemaVersion
  proposalId: string
  type: ProposalType
  status: ProposalStatus
  projectId: string
  title: string
  rationale: string
  evidenceEventIds: string[]
  createdAt: string
  updatedAt?: string
  reviewedAt?: string
  decisionReason?: string
  confidence: number
}

const proposalTypes = new Set<string>(PROPOSAL_TYPES)
const proposalStatuses = new Set<string>(PROPOSAL_STATUSES)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1

export function isProposalType(value: unknown): value is ProposalType {
  return typeof value === 'string' && proposalTypes.has(value)
}

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === 'string' && proposalStatuses.has(value)
}

export function isProposal(value: unknown): value is Proposal {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    isNonEmptyString(value.proposalId) &&
    isProposalType(value.type) &&
    isProposalStatus(value.status) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.rationale) &&
    isStringArray(value.evidenceEventIds) &&
    isNonEmptyString(value.createdAt) &&
    (value.updatedAt === undefined || isNonEmptyString(value.updatedAt)) &&
    (value.reviewedAt === undefined || isNonEmptyString(value.reviewedAt)) &&
    (value.decisionReason === undefined || typeof value.decisionReason === 'string') &&
    isConfidence(value.confidence)
  )
}
