import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type { Observation } from '../schema/observation.js'
import {
  defaultObservationDomain,
  defaultObservationKind,
  defaultObservationLifecycle,
  defaultObservationRetrievalPolicy,
  isObservationDomain,
  isObservationKind,
  isObservationLifecycle,
  isObservationRetrievalPolicy,
  isObservationType,
} from '../schema/observation.js'
import type { MemoryScope, Visibility } from '../schema/scope.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION, isMemoryScope } from '../schema/scope.js'
import {
  createLlmProvider,
  type LlmProvider,
  type LlmProviderConfig,
} from '../llm/provider.js'

export type LlmClassifierOptions = {
  provider?: LlmProvider
  providerConfig?: LlmProviderConfig
  defaultScope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  createdAt?: string
  candidateObservations?: Observation[]
}

export type LlmClassificationResult =
  | {
      status: 'skipped'
      reason: string
      providerKind: LlmProvider['kind']
      observations: []
    }
  | {
      status: 'failed'
      reason: string
      providerKind: LlmProvider['kind']
      observations: []
    }
  | {
      status: 'completed'
      providerKind: LlmProvider['kind']
      observations: Observation[]
    }

type LlmObservationDraft = {
  type?: unknown
  kind?: unknown
  domain?: unknown
  lifecycle?: unknown
  retrievalPolicy?: unknown
  title?: unknown
  summary?: unknown
  evidenceIds?: unknown
  evidenceEventIds?: unknown
  files?: unknown
  tags?: unknown
  confidence?: unknown
  scope?: unknown
}

export async function classifyArchiveEventsWithLlm(
  events: ArchiveEvent[],
  options: LlmClassifierOptions = {},
): Promise<LlmClassificationResult> {
  const provider = options.provider ?? createLlmProvider(options.providerConfig)
  const completion = await provider.complete({
    operation: 'classify-observations',
    input: {
      events: events.map(event => ({
        eventId: event.eventId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        role: event.role,
        kind: event.kind,
        text: event.text,
        createdAt: event.createdAt,
      })),
      ruleCandidates: (options.candidateObservations ?? []).map(observation => ({
        observationId: observation.observationId,
        type: observation.type,
        kind: observation.kind,
        domain: observation.domain,
        lifecycle: observation.lifecycle,
        retrievalPolicy: observation.retrievalPolicy,
        title: observation.title,
        summary: observation.summary,
        evidenceEventIds: observation.evidenceEventIds,
        scope: observation.scope,
        tags: observation.tags,
        confidence: observation.confidence,
      })),
      defaultScope: options.defaultScope ?? 'project',
    },
    systemPrompt:
      'Return confirmed memory observations only. Do not perform side effects. Use ruleCandidates as noisy hints: merge duplicates, drop false positives, correct scope, and keep only observations that should be useful for future retrieval. Prefer fields type,kind,domain,lifecycle,retrievalPolicy,title,summary,evidenceEventIds,scope,tags,confidence. Valid kind values: semantic, episodic, procedural, state, policy, candidate. Valid lifecycle values: active, candidate, superseded, stale, disputed. Valid retrievalPolicy values: hint, search_only, never_inject, candidate_only.',
  })

  if (completion.status === 'skipped') {
    return {
      status: 'skipped',
      reason: completion.reason,
      providerKind: provider.kind,
      observations: [],
    }
  }

  if (completion.status === 'failed') {
    return {
      status: 'failed',
      reason: completion.reason,
      providerKind: provider.kind,
      observations: [],
    }
  }

  return {
    status: 'completed',
    providerKind: provider.kind,
    observations: normalizeLlmObservations(
      completion.json ?? parseJsonOrUndefined(completion.text),
      events,
      options,
    ),
  }
}

function normalizeLlmObservations(
  value: unknown,
  events: ArchiveEvent[],
  options: LlmClassifierOptions,
): Observation[] {
  const drafts = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.observations)
      ? value.observations
      : []
  const eventById = new Map(events.map(event => [event.eventId, event]))
  const observations: Observation[] = []
  const seen = new Set<string>()

  for (const rawDraft of drafts) {
    if (!isRecord(rawDraft)) continue

    const draft = rawDraft as LlmObservationDraft
    if (!isObservationType(draft.type)) continue
    if (typeof draft.title !== 'string' || !draft.title.trim()) continue
    if (typeof draft.summary !== 'string' || !draft.summary.trim()) continue

    const evidenceEventIds = stringArray(draft.evidenceEventIds).filter(eventId =>
      eventById.has(eventId),
    )
    if (evidenceEventIds.length === 0) continue

    const firstEvent = eventById.get(evidenceEventIds[0])
    if (!firstEvent) continue

    const scope = isMemoryScope(draft.scope)
      ? draft.scope
      : options.defaultScope ?? firstEvent.scope
    const kind = isObservationKind(draft.kind)
      ? draft.kind
      : defaultObservationKind(draft.type)
    const domain = isObservationDomain(draft.domain)
      ? draft.domain
      : defaultObservationDomain(draft.type, stringArray(draft.tags))
    const lifecycle = isObservationLifecycle(draft.lifecycle)
      ? draft.lifecycle
      : defaultObservationLifecycle(draft.type)
    const retrievalPolicy = isObservationRetrievalPolicy(draft.retrievalPolicy)
      ? draft.retrievalPolicy
      : defaultObservationRetrievalPolicy(draft.type, lifecycle)
    const dedupeKey = `${draft.type}:${scope}:${evidenceEventIds.join(',')}:${draft.summary}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    observations.push({
      schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
      observationId: makeLlmObservationId(dedupeKey),
      scope,
      visibility: visibilityForScope(scope),
      projectId: firstEvent.projectId,
      sessionId: firstEvent.sessionId,
      type: draft.type,
      kind,
      domain,
      lifecycle,
      retrievalPolicy,
      title: compact(draft.title, 120),
      summary: compact(draft.summary, 500),
      evidenceIds: stringArray(draft.evidenceIds).length
        ? stringArray(draft.evidenceIds)
        : evidenceEventIds,
      evidenceEventIds,
      files: stringArray(draft.files).slice(0, 20),
      tags: ['llm:classifier', ...stringArray(draft.tags)].slice(0, 20),
      confidence: clampConfidence(draft.confidence),
      source: 'llm',
      promotionStatus: 'candidate',
      createdAt: options.createdAt ?? latestCreatedAt(events),
    })
  }

  return observations
}

function makeLlmObservationId(raw: string): string {
  return `obs_llm_${stableHash(raw)}`
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function latestCreatedAt(events: ArchiveEvent[]): string {
  return events
    .map(event => event.createdAt)
    .sort()
    .at(-1) ?? '1970-01-01T00:00:00.000Z'
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function visibilityForScope(scope: MemoryScope): Visibility {
  if (scope === 'team') return 'team'
  if (scope === 'workspace') return 'workspace'
  if (scope === 'project') return 'project'
  return 'private'
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}

function stableHash(raw: string): string {
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(index)
  }
  return Math.abs(hash).toString(36)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
