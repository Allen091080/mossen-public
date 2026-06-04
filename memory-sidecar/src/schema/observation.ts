import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemorySchemaVersion,
  type MemoryScope,
  type Visibility,
  isMemoryScope,
  isNonEmptyString,
  isOptionalNonEmptyString,
  isRecord,
  isVisibility,
} from './scope'

export const OBSERVATION_TYPES = [
  'decision',
  'preference',
  'instruction_candidate',
  'bugfix',
  'feature',
  'blocker',
  'handoff',
  'fact',
  'workflow_pattern',
  'coding_convention',
  'safety_rule',
  'tool_preference',
  'project_state',
  'open_thread',
  'skill_candidate',
  'team_policy',
] as const

export const OBSERVATION_SOURCES = ['rule', 'llm', 'manual'] as const

export const OBSERVATION_KINDS = [
  'semantic',
  'episodic',
  'procedural',
  'state',
  'policy',
  'candidate',
] as const

export const OBSERVATION_DOMAINS = [
  'code',
  'workflow',
  'model',
  'mcp',
  'skill',
  'plugin',
  'memory',
  'safety',
  'product',
  'team',
  'general',
] as const

export const OBSERVATION_LIFECYCLES = [
  'active',
  'candidate',
  'superseded',
  'stale',
  'disputed',
] as const

export const OBSERVATION_RETRIEVAL_POLICIES = [
  'hint',
  'search_only',
  'never_inject',
  'candidate_only',
] as const

export const OBSERVATION_PROMOTION_STATUSES = [
  'archive_only',
  'candidate',
  'promoted_to_instruction_memory',
  'rejected',
] as const

export type ObservationType = (typeof OBSERVATION_TYPES)[number]
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number]
export type ObservationKind = (typeof OBSERVATION_KINDS)[number]
export type ObservationDomain = (typeof OBSERVATION_DOMAINS)[number]
export type ObservationLifecycle = (typeof OBSERVATION_LIFECYCLES)[number]
export type ObservationRetrievalPolicy =
  (typeof OBSERVATION_RETRIEVAL_POLICIES)[number]
export type ObservationPromotionStatus =
  (typeof OBSERVATION_PROMOTION_STATUSES)[number]

export type Observation = {
  schemaVersion: MemorySchemaVersion
  observationId: string
  scope: MemoryScope
  visibility: Visibility
  projectId?: string
  sessionId?: string
  workspaceId?: string
  teamId?: string
  type: ObservationType
  kind: ObservationKind
  domain: ObservationDomain
  lifecycle: ObservationLifecycle
  retrievalPolicy: ObservationRetrievalPolicy
  title: string
  summary: string
  evidenceIds: string[]
  evidenceEventIds: string[]
  files: string[]
  tags: string[]
  confidence: number
  source: ObservationSource
  promotionStatus: ObservationPromotionStatus
  createdAt: string
  updatedAt?: string
}

const observationTypes = new Set<string>(OBSERVATION_TYPES)
const observationSources = new Set<string>(OBSERVATION_SOURCES)
const observationKinds = new Set<string>(OBSERVATION_KINDS)
const observationDomains = new Set<string>(OBSERVATION_DOMAINS)
const observationLifecycles = new Set<string>(OBSERVATION_LIFECYCLES)
const observationRetrievalPolicies = new Set<string>(
  OBSERVATION_RETRIEVAL_POLICIES,
)
const observationPromotionStatuses = new Set<string>(
  OBSERVATION_PROMOTION_STATUSES,
)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

export function isObservationType(value: unknown): value is ObservationType {
  return typeof value === 'string' && observationTypes.has(value)
}

export function isObservationSource(value: unknown): value is ObservationSource {
  return typeof value === 'string' && observationSources.has(value)
}

export function isObservationKind(value: unknown): value is ObservationKind {
  return typeof value === 'string' && observationKinds.has(value)
}

export function isObservationDomain(value: unknown): value is ObservationDomain {
  return typeof value === 'string' && observationDomains.has(value)
}

export function isObservationLifecycle(
  value: unknown,
): value is ObservationLifecycle {
  return typeof value === 'string' && observationLifecycles.has(value)
}

export function isObservationRetrievalPolicy(
  value: unknown,
): value is ObservationRetrievalPolicy {
  return typeof value === 'string' && observationRetrievalPolicies.has(value)
}

export function isObservationPromotionStatus(
  value: unknown,
): value is ObservationPromotionStatus {
  return typeof value === 'string' && observationPromotionStatuses.has(value)
}

export function normalizeObservation(value: unknown): Observation | undefined {
  if (!isRecord(value)) return undefined

  if (
    value.schemaVersion !== MEMORY_SIDECAR_SCHEMA_VERSION ||
    !isNonEmptyString(value.observationId) ||
    !isMemoryScope(value.scope) ||
    !isVisibility(value.visibility) ||
    !isOptionalNonEmptyString(value.projectId) ||
    !isOptionalNonEmptyString(value.sessionId) ||
    !isOptionalNonEmptyString(value.workspaceId) ||
    !isOptionalNonEmptyString(value.teamId) ||
    !isObservationType(value.type) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.summary) ||
    !isStringArray(value.evidenceEventIds) ||
    !isStringArray(value.files) ||
    !isStringArray(value.tags) ||
    typeof value.confidence !== 'number' ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !isObservationSource(value.source) ||
    !isObservationPromotionStatus(value.promotionStatus) ||
    !isNonEmptyString(value.createdAt) ||
    !isOptionalNonEmptyString(value.updatedAt)
  ) {
    return undefined
  }

  const kind = isObservationKind(value.kind)
    ? value.kind
    : defaultObservationKind(value.type)
  const domain = isObservationDomain(value.domain)
    ? value.domain
    : defaultObservationDomain(value.type, value.tags)
  const lifecycle = isObservationLifecycle(value.lifecycle)
    ? value.lifecycle
    : defaultObservationLifecycle(value.type, value.promotionStatus)
  const retrievalPolicy = isObservationRetrievalPolicy(value.retrievalPolicy)
    ? value.retrievalPolicy
    : defaultObservationRetrievalPolicy(value.type, lifecycle)
  const evidenceIds = isStringArray(value.evidenceIds)
    ? value.evidenceIds
    : value.evidenceEventIds

  return {
    schemaVersion: value.schemaVersion,
    observationId: value.observationId,
    scope: value.scope,
    visibility: value.visibility,
    projectId: value.projectId,
    sessionId: value.sessionId,
    workspaceId: value.workspaceId,
    teamId: value.teamId,
    type: value.type,
    kind,
    domain,
    lifecycle,
    retrievalPolicy,
    title: value.title,
    summary: value.summary,
    evidenceIds,
    evidenceEventIds: value.evidenceEventIds,
    files: value.files,
    tags: value.tags,
    confidence: value.confidence,
    source: value.source,
    promotionStatus: value.promotionStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function isObservation(value: unknown): value is Observation {
  return normalizeObservation(value) !== undefined
}

export function defaultObservationKind(type: ObservationType): ObservationKind {
  if (type === 'workflow_pattern' || type === 'coding_convention' || type === 'tool_preference') {
    return 'procedural'
  }
  if (type === 'safety_rule' || type === 'team_policy') return 'policy'
  if (type === 'instruction_candidate' || type === 'skill_candidate') return 'candidate'
  if (type === 'blocker' || type === 'handoff' || type === 'project_state' || type === 'open_thread') {
    return 'state'
  }
  if (type === 'bugfix' || type === 'feature') return 'episodic'
  return 'semantic'
}

export function defaultObservationDomain(
  type: ObservationType,
  tags: string[] = [],
): ObservationDomain {
  const text = `${type} ${tags.join(' ')}`.toLowerCase()
  if (text.includes('mcp')) return 'mcp'
  if (text.includes('skill')) return 'skill'
  if (text.includes('plugin')) return 'plugin'
  if (text.includes('model')) return 'model'
  if (text.includes('memory')) return 'memory'
  if (type === 'team_policy') return 'team'
  if (type === 'safety_rule' || text.includes('safety')) {
    return 'safety'
  }
  if (type === 'coding_convention' || type === 'bugfix' || type === 'feature') {
    return 'code'
  }
  if (
    type === 'workflow_pattern' ||
    type === 'tool_preference' ||
    type === 'handoff' ||
    type === 'open_thread'
  ) {
    return 'workflow'
  }
  return 'general'
}

export function defaultObservationLifecycle(
  type: ObservationType,
  promotionStatus: ObservationPromotionStatus = 'candidate',
): ObservationLifecycle {
  if (promotionStatus === 'rejected') return 'disputed'
  if (promotionStatus === 'archive_only') return 'stale'
  if (type === 'instruction_candidate' || type === 'skill_candidate' || type === 'open_thread') {
    return 'candidate'
  }
  return 'active'
}

export function defaultObservationRetrievalPolicy(
  type: ObservationType,
  lifecycle: ObservationLifecycle = defaultObservationLifecycle(type),
): ObservationRetrievalPolicy {
  if (lifecycle === 'disputed' || lifecycle === 'superseded') return 'never_inject'
  if (lifecycle === 'candidate' || type === 'skill_candidate' || type === 'instruction_candidate') {
    return 'candidate_only'
  }
  if (lifecycle === 'stale') return 'search_only'
  return 'hint'
}
