import { createHash } from 'node:crypto'
import type { MemoryRootOptions } from '../index.js'
import { estimateTokens, visibilityForScope } from '../index.js'
import { redactMemoryText, getMemoryRedactionVersion } from '../redaction/redact.js'
import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type { MemoryScope } from '../schema/scope.js'
import { appendArchiveEvent, type ArchiveEventWithLocation } from '../storage/jsonlArchiveStore.js'
import type { ConversationEvent } from './conversationEvent.js'
import { isConversationEvent } from './conversationEvent.js'
import { appendDirtyMarker, type DirtyMarker } from '../agent/dirtyQueue.js'

export type IngestConversationEventOptions = MemoryRootOptions & {
  event: ConversationEvent
  scope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  markDirty?: boolean
  // W119 H1: when explicitly false, the ingest is treated as disabled and
  // throws a SidecarDisabledError; callers must catch and translate to
  // status='skipped'/'sidecar_disabled'. Default undefined preserves
  // existing behaviour for tests and bypass paths.
  enabled?: boolean
}

export class SidecarDisabledError extends Error {
  constructor(message = 'memory-sidecar is disabled') {
    super(message)
    this.name = 'SidecarDisabledError'
  }
}

export type IngestConversationEventResult = {
  archiveEvent: ArchiveEvent
  archiveLocation: ArchiveEventWithLocation
  dirtyMarker?: DirtyMarker
}

export async function ingestConversationEvent(
  options: IngestConversationEventOptions,
): Promise<IngestConversationEventResult> {
  if (options.enabled === false) {
    throw new SidecarDisabledError()
  }
  if (!isConversationEvent(options.event)) {
    throw new Error('event must match ConversationEvent schema')
  }
  if (options.event.projectId !== options.projectId) {
    throw new Error('conversation event projectId must match ingest projectId')
  }

  const scope = options.scope ?? options.event.scope ?? 'project'
  const redacted = redactMemoryText(options.event.text)
  const archiveEvent: ArchiveEvent = {
    schemaVersion: 1,
    eventId: makeArchiveEventId(options.event),
    source: options.event.source,
    sourceEventId: options.event.sourceEventId,
    scope,
    visibility: visibilityForScope(scope),
    owner: {
      projectId: options.event.projectId,
      sessionId: options.event.sessionId,
    },
    projectId: options.event.projectId,
    sessionId: options.event.sessionId,
    turnId: options.event.turnId,
    role: options.event.role,
    kind: options.event.kind,
    text: redacted.text,
    textHash: hashText(redacted.text),
    tokenEstimate: estimateTokens(redacted.text),
    model: options.event.metadata?.model,
    permissionMode: options.event.metadata?.permissionMode,
    cwd: options.event.metadata?.cwd,
    createdAt: options.event.createdAt,
    redaction: {
      applied: redacted.applied,
      version: getMemoryRedactionVersion(),
      notes: redacted.notes,
    },
  }

  const archiveLocation = await appendArchiveEvent({
    ...options,
    event: archiveEvent,
  })

  const dirtyMarker = options.markDirty === false
    ? undefined
    : await appendDirtyMarker({
      ...options,
      marker: {
        schemaVersion: 1,
        dirtyId: `dirty_${archiveEvent.eventId}`,
        projectId: archiveEvent.projectId,
        sessionId: archiveEvent.sessionId,
        eventIds: [archiveEvent.eventId],
        reason: 'archive_append',
        createdAt: new Date().toISOString(),
      },
    })

  return { archiveEvent, archiveLocation, dirtyMarker }
}

function makeArchiveEventId(event: ConversationEvent): string {
  return `evt_${hashText([
    event.source,
    event.sourceEventId,
    event.projectId,
    event.sessionId,
    event.createdAt,
  ].join('\u001f')).slice(0, 24)}`
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
