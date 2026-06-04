import { readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import type { ConversationEvent } from '../ingest/conversationEvent.js'
import {
  ingestConversationEvents,
  type IngressBatchResult,
  type IngressEventAck,
} from '../ingest/ingressApi.js'
import { normalizeAdapterPayload, parseAdapterPayloads } from './payload.js'
import {
  appendAdapterDeadLetters,
  type AdapterDeadLetter,
  type AdapterDeadLetterStats,
} from './deadLetterStore.js'
// W121-A item 9 (L6): reuse the same control-plane filter as the in-process
// turn-capture path so external adapter callers cannot bypass it. NOTE: this
// is intentionally only at the adapter normalize boundary — do NOT apply
// inside ingestConversationEvents itself. CLI `ingest --file` users must be
// able to replay raw archived events that look like control plane.
import { isControlPlaneMessage } from '../../../services/memorySidecar/captureFilters.js'

export type AdapterIngestOptions = Omit<MemoryRootOptions, 'projectId'> & {
  payloads: unknown[]
  defaultProjectId?: string
  now?: () => string
  enabled?: boolean
  maxPayloadBytes?: number
  maxTextChars?: number
  rejectToolPayloads?: boolean
  deadLetter?: boolean
}

export type AdapterIngestResult = {
  dryRun?: false
  accepted: number
  skipped: number
  failed: number
  projects: Array<{
    projectId: string
    result: IngressBatchResult
  }>
  events: IngressEventAck[]
  deadLetter?: AdapterDeadLetterStats
}

export type AdapterIngestPlan = {
  dryRun: true
  accepted: number
  skipped: number
  failed: number
  projects: Array<{
    projectId: string
    events: Array<{
      sourceEventId: string
      sessionId: string
      scope: ConversationEvent['scope']
      role: ConversationEvent['role']
      kind: ConversationEvent['kind']
      textLength: number
    }>
  }>
  events: IngressEventAck[]
}

export async function ingestAdapterPayloads(
  options: AdapterIngestOptions,
): Promise<AdapterIngestResult> {
  const { invalidAcks, rejectedAcks, byProject } = normalizeAdapterBatch(options)

  const projects: AdapterIngestResult['projects'] = []
  const events: IngressEventAck[] = [...invalidAcks, ...rejectedAcks]
  for (const [projectId, projectEvents] of byProject) {
    const result = await ingestConversationEvents({
      ...options,
      projectId,
      events: projectEvents,
    })
    projects.push({ projectId, result })
    events.push(...result.events)
  }

  const result: AdapterIngestResult = {
    dryRun: false,
    accepted: events.filter(event => event.status === 'accepted').length,
    skipped: events.filter(event => event.status === 'skipped').length,
    failed: events.filter(event => event.status === 'failed').length,
    projects,
    events,
  }

  // W119 H1: when adapter is disabled, do NOT write dead-letters. The whole
  // point of disable is "no disk writes". A dead-letter for an
  // adapter_disabled / sidecar_disabled rejection is itself a disk write
  // that defeats the gate, AND the file path lives outside the per-project
  // memory dir.
  if (options.enabled === false) {
    return result
  }

  if (options.deadLetter !== false) {
    const letters = makeDeadLetters(events, options.now)
    if (letters.length) {
      result.deadLetter = await appendAdapterDeadLetters({
        ...options,
        projectId: options.defaultProjectId ?? 'adapter',
        letters,
      })
    }
  }

  return result
}

export function planAdapterPayloads(options: AdapterIngestOptions): AdapterIngestPlan {
  const { invalidAcks, rejectedAcks, byProject } = normalizeAdapterBatch(options)
  const duplicateAcks: IngressEventAck[] = []
  const seen = new Set<string>()
  const projects = [...byProject].map(([projectId, events]) => {
    const plannedEvents: AdapterIngestPlan['projects'][number]['events'] = []
    for (const event of events) {
      const key = `${projectId}\u001f${event.source}\u001f${event.sourceEventId}`
      if (seen.has(key)) {
        duplicateAcks.push({
          sourceEventId: event.sourceEventId,
          projectId: event.projectId,
          sessionId: event.sessionId,
          status: 'skipped',
          reason: 'duplicate_source_event',
        })
        continue
      }
      seen.add(key)
      plannedEvents.push({
        sourceEventId: event.sourceEventId,
        sessionId: event.sessionId,
        scope: event.scope,
        role: event.role,
        kind: event.kind,
        textLength: event.text.length,
      })
    }
    return { projectId, events: plannedEvents }
  })

  return {
    dryRun: true,
    accepted: projects.reduce((sum, project) => sum + project.events.length, 0),
    skipped: [
      ...rejectedAcks,
      ...duplicateAcks,
    ].filter(event => event.status === 'skipped').length,
    failed: [
      ...invalidAcks,
      ...rejectedAcks,
    ].filter(event => event.status === 'failed').length,
    projects,
    events: [...invalidAcks, ...rejectedAcks, ...duplicateAcks],
  }
}

export async function readAdapterPayloadsFromFile(filePath: string): Promise<unknown[]> {
  return parseAdapterPayloads(await readFile(filePath, 'utf8'))
}

function sourceEventIdFromUnknown(value: unknown): string | undefined {
  return isRecord(value) && typeof value.sourceEventId === 'string'
    ? value.sourceEventId
    : undefined
}

function normalizeAdapterBatch(options: AdapterIngestOptions): {
  invalidAcks: IngressEventAck[]
  rejectedAcks: IngressEventAck[]
  byProject: Map<string, ConversationEvent[]>
} {
  const normalized: Array<ConversationEvent | undefined> = options.payloads.map(payload => {
    const event = normalizeAdapterPayload(payload, { now: options.now })
    if (event || !options.defaultProjectId) return event

    return normalizeAdapterPayload(
      {
        ...(isRecord(payload) ? payload : {}),
        projectId: options.defaultProjectId,
      },
      { now: options.now },
    )
  })

  const invalidAcks: IngressEventAck[] = normalized
    .map((event, index) => event ? undefined : invalidSchemaAck(options.payloads[index]))
    .filter((ack): ack is IngressEventAck => Boolean(ack))

  const byProject = new Map<string, ConversationEvent[]>()
  const rejectedAcks: IngressEventAck[] = []
  for (const event of normalized) {
    if (!event) continue
    const rejection = rejectEvent(event, options)
    if (rejection) {
      rejectedAcks.push(rejection)
      continue
    }
    // W121-A item 9 (L6): control-plane payloads (slash commands, wave
    // packets, terminal-output wrappers, …) become a counted skip — no
    // archive write, no dead letter. Counted into result.skipped so callers
    // can see the filter fired.
    if (isControlPlaneMessage(event.text ?? '')) {
      rejectedAcks.push({
        sourceEventId: event.sourceEventId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        status: 'skipped',
        reason: 'sidecar_filtered_control_plane',
      })
      continue
    }
    const existing = byProject.get(event.projectId) ?? []
    existing.push(event)
    byProject.set(event.projectId, existing)
  }

  return { invalidAcks, rejectedAcks, byProject }
}

function invalidSchemaAck(value: unknown): IngressEventAck {
  const sourceEventId = sourceEventIdFromUnknown(value)
  return sourceEventId
    ? { sourceEventId, status: 'failed', reason: 'invalid_schema' }
    : { status: 'failed', reason: 'invalid_schema' }
}

function rejectEvent(
  event: ConversationEvent,
  options: AdapterIngestOptions,
): IngressEventAck | undefined {
  const base = {
    sourceEventId: event.sourceEventId,
    projectId: event.projectId,
    sessionId: event.sessionId,
  }

  if (options.enabled === false) {
    return { ...base, status: 'skipped', reason: 'adapter_disabled' }
  }

  const maxTextChars = options.maxTextChars ?? 20000
  if (event.text.length > maxTextChars) {
    return { ...base, status: 'failed', reason: 'text_too_large' }
  }

  const maxPayloadBytes = options.maxPayloadBytes ?? 1024 * 1024
  const payloadBytes = event.metadata?.payloadBytes
  if (typeof payloadBytes === 'number' && payloadBytes > maxPayloadBytes) {
    return { ...base, status: 'failed', reason: 'payload_too_large' }
  }

  if (options.rejectToolPayloads !== false && event.metadata?.channel === 'tool') {
    return { ...base, status: 'skipped', reason: 'tool_payload_rejected' }
  }

  return undefined
}

function makeDeadLetters(
  events: IngressEventAck[],
  now: AdapterIngestOptions['now'],
): AdapterDeadLetter[] {
  const createdAt = now?.() ?? new Date().toISOString()
  return events
    .filter(event => event.status !== 'accepted')
    // W121-A item 9 (L6): control-plane filter is a clean skip, not an error.
    // Don't pollute dead-letter with normal filter hits.
    .filter(event => event.reason !== 'sidecar_filtered_control_plane')
    .map((event): AdapterDeadLetter => ({
      schemaVersion: 1,
      sourceEventId: event.sourceEventId,
      projectId: event.projectId,
      sessionId: event.sessionId,
      reason: event.reason ?? 'invalid_schema',
      status: event.status === 'skipped' ? 'skipped' : 'failed',
      createdAt,
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
