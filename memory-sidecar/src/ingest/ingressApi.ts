import { readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import { recentArchiveEvents } from '../storage/jsonlArchiveStore.js'
import type { ConversationEvent } from './conversationEvent.js'
import { isConversationEvent } from './conversationEvent.js'
import { ingestConversationEvent, SidecarDisabledError } from './archiveWriter.js'

export type IngressEventAck = {
  sourceEventId?: string
  projectId?: string
  sessionId?: string
  archiveEventId?: string
  dirtyId?: string
  status: 'accepted' | 'skipped' | 'failed'
  reason?: IngressErrorCode | 'duplicate_source_event'
}

export type IngressErrorCode =
  | 'invalid_schema'
  | 'missing_project'
  | 'archive_write_failed'
  | 'adapter_disabled'
  | 'sidecar_disabled'
  | 'payload_too_large'
  | 'text_too_large'
  | 'tool_payload_rejected'
  // W121-A item 9 (L6): adapter normalize boundary detected control-plane
  // payload (slash command, wave instruction packet, terminal-output wrapper,
  // etc.) and dropped it. No archive write, no dead letter — just a counted
  // skip so callers can see the filter fired.
  | 'sidecar_filtered_control_plane'

export type IngressBatchResult = {
  accepted: number
  skipped: number
  failed: number
  events: IngressEventAck[]
}

export type IngestConversationEventsOptions = MemoryRootOptions & {
  events: unknown[]
  // W119 H1: when explicitly false, the entire batch is rejected with
  // status='skipped'/reason='sidecar_disabled' and zero disk writes happen
  // (no archive append, no dirty marker).
  enabled?: boolean
}

export async function ingestConversationEvents(
  options: IngestConversationEventsOptions,
): Promise<IngressBatchResult> {
  // W119 H1: when sidecar is disabled, every event becomes a no-op skip.
  // Important: do NOT call loadSeenSourceEventIds here — that triggers a
  // disk read that materialises archive directory infrastructure.
  if (options.enabled === false) {
    const acks: IngressEventAck[] = options.events.map((value): IngressEventAck => {
      const event = isConversationEvent(value) ? value : undefined
      return {
        sourceEventId: event?.sourceEventId,
        projectId: event?.projectId,
        sessionId: event?.sessionId,
        status: 'skipped',
        reason: 'sidecar_disabled',
      }
    })
    return summarizeAcks(acks)
  }

  const seen = await loadSeenSourceEventIds(options)
  const acks: IngressEventAck[] = []

  for (const value of options.events) {
    if (!isConversationEvent(value)) {
      acks.push({ status: 'failed', reason: 'invalid_schema' })
      continue
    }

    if (value.projectId !== options.projectId) {
      acks.push({
        sourceEventId: value.sourceEventId,
        projectId: value.projectId,
        sessionId: value.sessionId,
        status: 'failed',
        reason: 'missing_project',
      })
      continue
    }

    const sourceKey = makeSourceKey(value)
    if (seen.has(sourceKey)) {
      acks.push({
        sourceEventId: value.sourceEventId,
        projectId: value.projectId,
        sessionId: value.sessionId,
        status: 'skipped',
        reason: 'duplicate_source_event',
      })
      continue
    }

    try {
      const result = await ingestConversationEvent({
        ...options,
        event: value,
      })
      seen.add(sourceKey)
      acks.push({
        sourceEventId: value.sourceEventId,
        projectId: value.projectId,
        sessionId: value.sessionId,
        archiveEventId: result.archiveEvent.eventId,
        dirtyId: result.dirtyMarker?.dirtyId,
        status: 'accepted',
      })
    } catch (err) {
      // W119 H1: if a downstream caller flipped enabled=false on the
      // single-event ingest, surface that as sidecar_disabled rather than
      // archive_write_failed so the caller (and audit trail) sees the gate.
      const isDisabled = err instanceof SidecarDisabledError
      acks.push({
        sourceEventId: value.sourceEventId,
        projectId: value.projectId,
        sessionId: value.sessionId,
        status: isDisabled ? 'skipped' : 'failed',
        reason: isDisabled ? 'sidecar_disabled' : 'archive_write_failed',
      })
    }
  }

  return summarizeAcks(acks)
}

export function parseIngressJsonl(contents: string): unknown[] {
  return contents
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)
}

export async function readIngressEventsFromFile(filePath: string): Promise<unknown[]> {
  return parseIngressJsonl(await readFile(filePath, 'utf8'))
}

async function loadSeenSourceEventIds(options: MemoryRootOptions): Promise<Set<string>> {
  const events = await recentArchiveEvents({
    ...options,
    limit: 100000,
  })
  return new Set(
    events
      .filter(({ event }) => event.source && event.sourceEventId)
      .map(({ event }) =>
        makeSourceKey({
          source: event.source as ConversationEvent['source'],
          sourceEventId: event.sourceEventId ?? event.eventId,
        }),
      ),
  )
}

function summarizeAcks(events: IngressEventAck[]): IngressBatchResult {
  return {
    accepted: events.filter(event => event.status === 'accepted').length,
    skipped: events.filter(event => event.status === 'skipped').length,
    failed: events.filter(event => event.status === 'failed').length,
    events,
  }
}

function makeSourceKey(event: Pick<ConversationEvent, 'source' | 'sourceEventId'>): string {
  return `${event.source}\u001f${event.sourceEventId}`
}
