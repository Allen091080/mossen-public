import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemoryOwner,
  type MemorySchemaVersion,
  type MemoryScope,
  type Visibility,
  isMemoryOwner,
  isMemoryScope,
  isNonEmptyString,
  isOptionalNonEmptyString,
  isRecord,
  isVisibility,
} from './scope'

export const ARCHIVE_EVENT_ROLES = ['user', 'assistant', 'system'] as const
export const ARCHIVE_EVENT_KINDS = [
  'message',
  'summary',
  'compact_boundary',
  'handoff',
] as const

export type ArchiveEventRole = (typeof ARCHIVE_EVENT_ROLES)[number]
export type ArchiveEventKind = (typeof ARCHIVE_EVENT_KINDS)[number]

export type ArchiveEventRedaction = {
  applied: boolean
  version: number
  notes?: string[]
}

export type ArchiveEvent = {
  schemaVersion: MemorySchemaVersion
  eventId: string
  source?: string
  sourceEventId?: string
  scope: MemoryScope
  visibility: Visibility
  owner: MemoryOwner
  projectId: string
  sessionId: string
  turnId?: string
  role: ArchiveEventRole
  kind: ArchiveEventKind
  text: string
  textHash: string
  tokenEstimate?: number
  model?: string
  permissionMode?: string
  cwd?: string
  createdAt: string
  redaction: ArchiveEventRedaction
}

const archiveEventRoles = new Set<string>(ARCHIVE_EVENT_ROLES)
const archiveEventKinds = new Set<string>(ARCHIVE_EVENT_KINDS)

export function isArchiveEventRole(value: unknown): value is ArchiveEventRole {
  return typeof value === 'string' && archiveEventRoles.has(value)
}

export function isArchiveEventKind(value: unknown): value is ArchiveEventKind {
  return typeof value === 'string' && archiveEventKinds.has(value)
}

export function isArchiveEventRedaction(value: unknown): value is ArchiveEventRedaction {
  if (!isRecord(value)) {
    return false
  }

  const notes = value.notes
  return (
    typeof value.applied === 'boolean' &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    (notes === undefined || (Array.isArray(notes) && notes.every(isNonEmptyString)))
  )
}

export function isArchiveEvent(value: unknown): value is ArchiveEvent {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    isNonEmptyString(value.eventId) &&
    isOptionalNonEmptyString(value.source) &&
    isOptionalNonEmptyString(value.sourceEventId) &&
    isMemoryScope(value.scope) &&
    isVisibility(value.visibility) &&
    isMemoryOwner(value.owner) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.sessionId) &&
    isOptionalNonEmptyString(value.turnId) &&
    isArchiveEventRole(value.role) &&
    isArchiveEventKind(value.kind) &&
    typeof value.text === 'string' &&
    isNonEmptyString(value.textHash) &&
    (value.tokenEstimate === undefined ||
      (typeof value.tokenEstimate === 'number' &&
        Number.isInteger(value.tokenEstimate) &&
        value.tokenEstimate >= 0)) &&
    isOptionalNonEmptyString(value.model) &&
    isOptionalNonEmptyString(value.permissionMode) &&
    isOptionalNonEmptyString(value.cwd) &&
    isNonEmptyString(value.createdAt) &&
    isArchiveEventRedaction(value.redaction)
  )
}
