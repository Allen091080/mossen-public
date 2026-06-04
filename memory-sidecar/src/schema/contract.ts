import { isMemoryAdapterPayload } from '../adapter/payload.js'
import { isConversationEvent, isConversationEventMetadata } from '../ingest/conversationEvent.js'
import { isArchiveEvent, isArchiveEventRedaction } from './archiveEvent.js'
import { isObservation } from './observation.js'
import { isProfileSnapshot } from './profile.js'
import { isProposal } from './proposal.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION, isMemoryOwner, isRecord } from './scope.js'

export const MEMORY_CONTRACT_FREEZE = 'W90-C' as const

export const MEMORY_CONTRACT_NAMES = [
  'adapterPayload',
  'conversationEvent',
  'archiveEvent',
  'observation',
  'profile',
  'proposal',
] as const

export type MemoryContractName = (typeof MEMORY_CONTRACT_NAMES)[number]

export type MemoryContractValidationResult = {
  valid: boolean
  errors: string[]
}

export type MemoryContractFieldSpec = {
  schemaVersion: typeof MEMORY_SIDECAR_SCHEMA_VERSION
  allowedFields: readonly string[]
  requiredFields: readonly string[]
}

export const ADAPTER_PAYLOAD_CONTRACT_FIELDS = [
  'schemaVersion',
  'adapter',
  'payloadBytes',
  'sourceEventId',
  'projectId',
  'sessionId',
  'turnId',
  'scope',
  'cwd',
  'role',
  'kind',
  'channel',
  'text',
  'createdAt',
  'model',
  'permissionMode',
] as const

export const CONVERSATION_EVENT_CONTRACT_FIELDS = [
  'schemaVersion',
  'source',
  'sourceEventId',
  'projectId',
  'sessionId',
  'turnId',
  'scope',
  'role',
  'kind',
  'text',
  'createdAt',
  'metadata',
] as const

export const CONVERSATION_EVENT_METADATA_CONTRACT_FIELDS = [
  'cwd',
  'model',
  'permissionMode',
  'channel',
  'payloadBytes',
] as const

export const ARCHIVE_EVENT_CONTRACT_FIELDS = [
  'schemaVersion',
  'eventId',
  'source',
  'sourceEventId',
  'scope',
  'visibility',
  'owner',
  'projectId',
  'sessionId',
  'turnId',
  'role',
  'kind',
  'text',
  'textHash',
  'tokenEstimate',
  'model',
  'permissionMode',
  'cwd',
  'createdAt',
  'redaction',
] as const

export const ARCHIVE_EVENT_REDACTION_CONTRACT_FIELDS = [
  'applied',
  'version',
  'notes',
] as const

export const MEMORY_OWNER_CONTRACT_FIELDS = [
  'userId',
  'teamId',
  'workspaceId',
  'projectId',
  'sessionId',
] as const

export const OBSERVATION_CONTRACT_FIELDS = [
  'schemaVersion',
  'observationId',
  'scope',
  'visibility',
  'projectId',
  'sessionId',
  'workspaceId',
  'teamId',
  'type',
  'kind',
  'domain',
  'lifecycle',
  'retrievalPolicy',
  'title',
  'summary',
  'evidenceIds',
  'evidenceEventIds',
  'files',
  'tags',
  'confidence',
  'source',
  'promotionStatus',
  'createdAt',
  'updatedAt',
] as const

export const PROFILE_CONTRACT_FIELDS = [
  'schemaVersion',
  'projectId',
  'scope',
  'generatedAt',
  'sourceJobId',
  'preferences',
  'habits',
  'constraints',
  'projectFacts',
  'confidence',
] as const

export const PROPOSAL_CONTRACT_FIELDS = [
  'schemaVersion',
  'proposalId',
  'type',
  'status',
  'projectId',
  'title',
  'rationale',
  'evidenceEventIds',
  'createdAt',
  'updatedAt',
  'reviewedAt',
  'decisionReason',
  'confidence',
] as const

export const MEMORY_CONTRACT_FIELD_SPECS = {
  adapterPayload: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: ADAPTER_PAYLOAD_CONTRACT_FIELDS,
    requiredFields: ['schemaVersion', 'adapter', 'sessionId', 'role', 'text'],
  },
  conversationEvent: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: CONVERSATION_EVENT_CONTRACT_FIELDS,
    requiredFields: [
      'schemaVersion',
      'source',
      'sourceEventId',
      'projectId',
      'sessionId',
      'role',
      'kind',
      'text',
      'createdAt',
    ],
  },
  archiveEvent: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: ARCHIVE_EVENT_CONTRACT_FIELDS,
    requiredFields: [
      'schemaVersion',
      'eventId',
      'scope',
      'visibility',
      'owner',
      'projectId',
      'sessionId',
      'role',
      'kind',
      'text',
      'textHash',
      'createdAt',
      'redaction',
    ],
  },
  observation: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: OBSERVATION_CONTRACT_FIELDS,
    requiredFields: [
      'schemaVersion',
      'observationId',
      'scope',
      'visibility',
      'type',
      'kind',
      'domain',
      'lifecycle',
      'retrievalPolicy',
      'title',
      'summary',
      'evidenceIds',
      'evidenceEventIds',
      'files',
      'tags',
      'confidence',
      'source',
      'promotionStatus',
      'createdAt',
    ],
  },
  profile: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: PROFILE_CONTRACT_FIELDS,
    requiredFields: PROFILE_CONTRACT_FIELDS,
  },
  proposal: {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    allowedFields: PROPOSAL_CONTRACT_FIELDS,
    requiredFields: [
      'schemaVersion',
      'proposalId',
      'type',
      'status',
      'projectId',
      'title',
      'rationale',
      'evidenceEventIds',
      'createdAt',
      'confidence',
    ],
  },
} satisfies Record<MemoryContractName, MemoryContractFieldSpec>

export function validateMemoryContractRecord(
  contract: MemoryContractName,
  value: unknown,
): MemoryContractValidationResult {
  const errors: string[] = []
  const spec = MEMORY_CONTRACT_FIELD_SPECS[contract]

  if (!isRecord(value)) {
    return { valid: false, errors: [`${contract}: expected object`] }
  }

  collectTopLevelFieldErrors(contract, value, spec, errors)
  collectNestedFieldErrors(contract, value, errors)

  if (!baseContractGuard(contract, value)) {
    errors.push(`${contract}: failed schema guard`)
  }

  return { valid: errors.length === 0, errors }
}

export function assertMemoryContractRecord(
  contract: MemoryContractName,
  value: unknown,
): void {
  const result = validateMemoryContractRecord(contract, value)
  if (!result.valid) {
    throw new Error(result.errors.join('; '))
  }
}

function collectTopLevelFieldErrors(
  contract: MemoryContractName,
  value: Record<string, unknown>,
  spec: MemoryContractFieldSpec,
  errors: string[],
): void {
  if (value.schemaVersion !== spec.schemaVersion) {
    errors.push(`${contract}: schemaVersion must be ${spec.schemaVersion}`)
  }

  const allowed = new Set<string>(spec.allowedFields)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${contract}: unknown field ${key}`)
    }
  }

  for (const field of spec.requiredFields) {
    if (!(field in value)) {
      errors.push(`${contract}: missing required field ${field}`)
    }
  }
}

function collectNestedFieldErrors(
  contract: MemoryContractName,
  value: Record<string, unknown>,
  errors: string[],
): void {
  if (contract === 'conversationEvent' && value.metadata !== undefined) {
    collectNestedObjectErrors(
      'conversationEvent.metadata',
      value.metadata,
      CONVERSATION_EVENT_METADATA_CONTRACT_FIELDS,
      errors,
    )
    if (!isConversationEventMetadata(value.metadata)) {
      errors.push('conversationEvent.metadata: failed schema guard')
    }
  }

  if (contract === 'archiveEvent') {
    collectNestedObjectErrors(
      'archiveEvent.owner',
      value.owner,
      MEMORY_OWNER_CONTRACT_FIELDS,
      errors,
    )
    collectNestedObjectErrors(
      'archiveEvent.redaction',
      value.redaction,
      ARCHIVE_EVENT_REDACTION_CONTRACT_FIELDS,
      errors,
    )
    if (!isMemoryOwner(value.owner)) {
      errors.push('archiveEvent.owner: failed schema guard')
    }
    if (!isArchiveEventRedaction(value.redaction)) {
      errors.push('archiveEvent.redaction: failed schema guard')
    }
  }
}

function collectNestedObjectErrors(
  label: string,
  value: unknown,
  allowedFields: readonly string[],
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${label}: expected object`)
    return
  }

  const allowed = new Set<string>(allowedFields)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${label}: unknown field ${key}`)
    }
  }
}

function baseContractGuard(
  contract: MemoryContractName,
  value: unknown,
): boolean {
  switch (contract) {
    case 'adapterPayload':
      return isMemoryAdapterPayload(value)
    case 'conversationEvent':
      return isConversationEvent(value)
    case 'archiveEvent':
      return isArchiveEvent(value)
    case 'observation':
      return isObservation(value)
    case 'profile':
      return isProfileSnapshot(value)
    case 'proposal':
      return isProposal(value)
    default:
      return false
  }
}
