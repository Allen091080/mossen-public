export const MEMORY_SIDECAR_SCHEMA_VERSION = 1 as const

export const MEMORY_SCOPES = [
  'session',
  'project',
  'workspace',
  'user',
  'team',
] as const

export const MEMORY_VISIBILITIES = [
  'private',
  'project',
  'workspace',
  'team',
] as const

export type MemorySchemaVersion = typeof MEMORY_SIDECAR_SCHEMA_VERSION
export type MemoryScope = (typeof MEMORY_SCOPES)[number]
export type Visibility = (typeof MEMORY_VISIBILITIES)[number]

export type MemoryOwner = {
  userId?: string
  teamId?: string
  workspaceId?: string
  projectId?: string
  sessionId?: string
}

export type ScopeRef = {
  scope: MemoryScope
  visibility: Visibility
  owner: MemoryOwner
}

export type ReadableMemoryScope = {
  userId?: string
  teamId?: string
  workspaceId?: string
  projectId?: string
  sessionId?: string
  allowTeam?: boolean
}

const stringSet = <T extends readonly string[]>(values: T): Set<string> =>
  new Set(values)

const memoryScopes = stringSet(MEMORY_SCOPES)
const memoryVisibilities = stringSet(MEMORY_VISIBILITIES)

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value)
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && memoryScopes.has(value)
}

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && memoryVisibilities.has(value)
}

export function isMemoryOwner(value: unknown): value is MemoryOwner {
  if (!isRecord(value)) {
    return false
  }

  return (
    isOptionalNonEmptyString(value.userId) &&
    isOptionalNonEmptyString(value.teamId) &&
    isOptionalNonEmptyString(value.workspaceId) &&
    isOptionalNonEmptyString(value.projectId) &&
    isOptionalNonEmptyString(value.sessionId)
  )
}

export function isScopeRef(value: unknown): value is ScopeRef {
  return (
    isRecord(value) &&
    isMemoryScope(value.scope) &&
    isVisibility(value.visibility) &&
    isMemoryOwner(value.owner)
  )
}

export function canReadScope(
  ref: ScopeRef,
  readable: ReadableMemoryScope,
): boolean {
  switch (ref.scope) {
    case 'session':
      return (
        ref.owner.projectId === readable.projectId &&
        ref.owner.sessionId === readable.sessionId
      )
    case 'project':
      return ref.owner.projectId === readable.projectId
    case 'workspace':
      return ref.owner.workspaceId === readable.workspaceId
    case 'user':
      return ref.owner.userId === readable.userId
    case 'team':
      return readable.allowTeam === true && ref.owner.teamId === readable.teamId
    default:
      return false
  }
}

export function assertReadableScope(
  ref: ScopeRef,
  readable: ReadableMemoryScope,
): void {
  if (!canReadScope(ref, readable)) {
    throw new Error(`memory scope is not readable: ${ref.scope}`)
  }
}

export function safeMemoryPathSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('memory path segment must not be empty')
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '-')
}
