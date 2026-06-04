import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemorySchemaVersion,
  type MemoryScope,
  isNonEmptyString,
  isOptionalNonEmptyString,
  isRecord,
} from '../schema/scope.js'

export const CONVERSATION_EVENT_SOURCES = [
  'mossen',
  'external-cli',
  'manual-fixture',
  'hook',
  'jsonl-import',
] as const

export const CONVERSATION_EVENT_ROLES = ['user', 'assistant', 'system'] as const

export const CONVERSATION_EVENT_KINDS = [
  'message',
  'summary',
  'compact_boundary',
  'handoff',
] as const

export type ConversationEventSource = (typeof CONVERSATION_EVENT_SOURCES)[number]
export type ConversationEventRole = (typeof CONVERSATION_EVENT_ROLES)[number]
export type ConversationEventKind = (typeof CONVERSATION_EVENT_KINDS)[number]

export type ConversationEventMetadata = {
  cwd?: string
  model?: string
  permissionMode?: string
  channel?: 'conversation' | 'tool' | 'system'
  payloadBytes?: number
}

export type ConversationEvent = {
  schemaVersion: MemorySchemaVersion
  source: ConversationEventSource
  sourceEventId: string
  projectId: string
  sessionId: string
  turnId?: string
  scope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  role: ConversationEventRole
  kind: ConversationEventKind
  text: string
  createdAt: string
  metadata?: ConversationEventMetadata
}

const sources = new Set<string>(CONVERSATION_EVENT_SOURCES)
const roles = new Set<string>(CONVERSATION_EVENT_ROLES)
const kinds = new Set<string>(CONVERSATION_EVENT_KINDS)

export function isConversationEvent(value: unknown): value is ConversationEvent {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    typeof value.source === 'string' &&
    sources.has(value.source) &&
    isNonEmptyString(value.sourceEventId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.sessionId) &&
    isOptionalNonEmptyString(value.turnId) &&
    (value.scope === undefined || isAdapterMemoryScope(value.scope)) &&
    typeof value.role === 'string' &&
    roles.has(value.role) &&
    typeof value.kind === 'string' &&
    kinds.has(value.kind) &&
    typeof value.text === 'string' &&
    isNonEmptyString(value.createdAt) &&
    (value.metadata === undefined || isConversationEventMetadata(value.metadata))
  )
}

function isAdapterMemoryScope(
  value: unknown,
): value is Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'> {
  return value === 'session' || value === 'project' || value === 'user' || value === 'team'
}

export function isConversationEventMetadata(
  value: unknown,
): value is ConversationEventMetadata {
  if (!isRecord(value)) return false
  return (
    isOptionalNonEmptyString(value.cwd) &&
    isOptionalNonEmptyString(value.model) &&
    isOptionalNonEmptyString(value.permissionMode) &&
    (value.channel === undefined ||
      value.channel === 'conversation' ||
      value.channel === 'tool' ||
      value.channel === 'system') &&
    (value.payloadBytes === undefined ||
      (typeof value.payloadBytes === 'number' &&
        Number.isInteger(value.payloadBytes) &&
        value.payloadBytes >= 0))
  )
}
