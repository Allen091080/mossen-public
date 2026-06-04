import { createHash } from 'node:crypto'
import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemoryScope,
  isNonEmptyString,
  isOptionalNonEmptyString,
  isRecord,
} from '../schema/scope.js'
import type { ConversationEvent, ConversationEventKind, ConversationEventRole } from '../ingest/conversationEvent.js'
import { isConversationEvent } from '../ingest/conversationEvent.js'

export const MEMORY_ADAPTER_PAYLOAD_ADAPTERS = [
  'mossen-hook',
  'external-hook',
  'manual',
] as const

export type MemoryAdapterPayloadAdapter =
  (typeof MEMORY_ADAPTER_PAYLOAD_ADAPTERS)[number]

export type MemoryAdapterPayload = {
  schemaVersion: 1
  adapter: MemoryAdapterPayloadAdapter
  payloadBytes?: number
  sourceEventId?: string
  projectId?: string
  sessionId: string
  turnId?: string
  scope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  cwd?: string
  role: ConversationEventRole
  kind?: ConversationEventKind
  channel?: 'conversation' | 'tool' | 'system'
  text: string
  createdAt?: string
  model?: string
  permissionMode?: string
}

export type NormalizeAdapterPayloadOptions = {
  now?: () => string
}

const adapters = new Set<string>(MEMORY_ADAPTER_PAYLOAD_ADAPTERS)

export function isMemoryAdapterPayload(value: unknown): value is MemoryAdapterPayload {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    typeof value.adapter === 'string' &&
    adapters.has(value.adapter) &&
    (value.payloadBytes === undefined ||
      (typeof value.payloadBytes === 'number' &&
        Number.isInteger(value.payloadBytes) &&
        value.payloadBytes >= 0)) &&
    isOptionalNonEmptyString(value.sourceEventId) &&
    isOptionalNonEmptyString(value.projectId) &&
    isNonEmptyString(value.sessionId) &&
    isOptionalNonEmptyString(value.turnId) &&
    (value.scope === undefined || isAdapterMemoryScope(value.scope)) &&
    isOptionalNonEmptyString(value.cwd) &&
    isAdapterRole(value.role) &&
    (value.kind === undefined || isAdapterKind(value.kind)) &&
    (value.channel === undefined || isAdapterChannel(value.channel)) &&
    typeof value.text === 'string' &&
    (value.createdAt === undefined || isNonEmptyString(value.createdAt)) &&
    isOptionalNonEmptyString(value.model) &&
    isOptionalNonEmptyString(value.permissionMode) &&
    Boolean(value.projectId || value.cwd)
  )
}

export function normalizeAdapterPayload(
  value: unknown,
  options: NormalizeAdapterPayloadOptions = {},
): ConversationEvent | undefined {
  if (isConversationEvent(value)) return value
  if (!isMemoryAdapterPayload(value)) return undefined

  const projectId = value.projectId ?? projectIdFromCwd(value.cwd ?? '')
  const createdAt = value.createdAt ?? options.now?.() ?? new Date().toISOString()
  const sourceEventId = value.sourceEventId ?? makeAdapterSourceEventId(value)

  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    source: value.adapter === 'mossen-hook' ? 'mossen' : 'hook',
    sourceEventId,
    projectId,
    sessionId: value.sessionId,
    turnId: value.turnId,
    scope: value.scope,
    role: value.role,
    kind: value.kind ?? 'message',
    text: value.text,
    createdAt,
    metadata: {
      cwd: value.cwd,
      model: value.model,
      permissionMode: value.permissionMode,
      channel: value.channel ?? 'conversation',
      payloadBytes: value.payloadBytes,
    },
  }
}

export function parseAdapterPayloads(contents: string): unknown[] {
  const trimmed = contents.trim()
  if (!trimmed) return []

  const parsed = parseJson(trimmed)
  if (parsed !== undefined) {
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  return trimmed
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)
}

export function projectIdFromCwd(cwd: string): string {
  const normalized = cwd.trim()
  const sanitized = normalized.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length > 0 && sanitized.length <= 200) return sanitized
  if (sanitized.length > 200) {
    return `${sanitized.slice(0, 200)}-${stableHash(normalized).slice(0, 10)}`
  }
  return `cwd-${stableHash(normalized).slice(0, 16)}`
}

function makeAdapterSourceEventId(payload: MemoryAdapterPayload): string {
  return `adapter_${stableHash([
    payload.adapter,
    payload.cwd ?? payload.projectId ?? '',
    payload.sessionId,
    payload.turnId ?? '',
    payload.scope ?? '',
    payload.channel ?? '',
    payload.role,
    payload.text,
  ].join('\u001f')).slice(0, 24)}`
}

function stableHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function parseJson(contents: string): unknown | undefined {
  try {
    return JSON.parse(contents) as unknown
  } catch {
    return undefined
  }
}

function isAdapterRole(value: unknown): value is ConversationEventRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isAdapterKind(value: unknown): value is ConversationEventKind {
  return value === 'message' ||
    value === 'summary' ||
    value === 'compact_boundary' ||
    value === 'handoff'
}

function isAdapterChannel(
  value: unknown,
): value is 'conversation' | 'tool' | 'system' {
  return value === 'conversation' || value === 'tool' || value === 'system'
}

function isAdapterMemoryScope(
  value: unknown,
): value is Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'> {
  return value === 'session' || value === 'project' || value === 'user' || value === 'team'
}
