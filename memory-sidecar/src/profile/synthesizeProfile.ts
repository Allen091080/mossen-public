import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type { Observation, ObservationType } from '../schema/observation.js'
import type { ProfileSnapshot } from '../schema/profile.js'
import type { MemoryScope } from '../schema/scope.js'

export type ProfileSignal = {
  type: ObservationType | 'archive'
  title: string
  summary: string
  evidenceEventIds: string[]
  confidence: number
}

export type SynthesizedProfile = {
  schemaVersion: 1
  projectId?: string
  sessionId?: string
  generatedAt: string
  preferences: ProfileSignal[]
  decisions: ProfileSignal[]
  instructions: ProfileSignal[]
  blockers: ProfileSignal[]
  handoffs: ProfileSignal[]
  facts: ProfileSignal[]
}

export type SynthesizeProfileSignalsOptions = {
  projectId: string
  sessionId?: string
  generatedAt?: string
  maxSignalsPerSection?: number
}

export type SynthesizeProfileOptions = SynthesizeProfileSignalsOptions & {
  scope?: MemoryScope
  sourceJobId: string
}

export function synthesizeProfileSignals(
  input: {
    observations?: Observation[]
    events?: ArchiveEvent[]
  },
  options: Partial<SynthesizeProfileSignalsOptions> = {},
): SynthesizedProfile {
  const observations = [...(input.observations ?? [])].sort(compareObservation)
  const events = [...(input.events ?? [])].sort(compareEvent)
  const maxSignals = options.maxSignalsPerSection ?? 10

  return {
    schemaVersion: 1,
    projectId: options.projectId ?? observations[0]?.projectId ?? events[0]?.projectId,
    sessionId: options.sessionId ?? observations[0]?.sessionId ?? events[0]?.sessionId,
    generatedAt: options.generatedAt ?? latestCreatedAt(observations, events),
    preferences: topSignals(observations, ['preference'], maxSignals),
    decisions: topSignals(observations, [
      'decision',
      'workflow_pattern',
      'coding_convention',
      'tool_preference',
    ], maxSignals),
    instructions: [
      ...topSignals(observations, [
        'instruction_candidate',
        'safety_rule',
        'team_policy',
      ], maxSignals),
      ...archiveInstructionSignals(events, maxSignals),
    ].slice(0, maxSignals),
    blockers: topSignals(observations, ['blocker', 'open_thread'], maxSignals),
    handoffs: topSignals(observations, ['handoff', 'project_state'], maxSignals),
    facts: topSignals(observations, [
      'fact',
      'bugfix',
      'feature',
      'skill_candidate',
    ], maxSignals),
  }
}

export function synthesizeProfileSnapshot(
  input: {
    observations?: Observation[]
    events?: ArchiveEvent[]
  },
  options: SynthesizeProfileOptions,
): ProfileSnapshot {
  const signals = synthesizeProfileSignals(input, options)

  return {
    schemaVersion: 1,
    projectId: options.projectId,
    scope: options.scope ?? 'project',
    generatedAt: signals.generatedAt,
    sourceJobId: options.sourceJobId,
    preferences: signals.preferences.map(signal => signal.summary),
    habits: signals.handoffs.map(signal => signal.summary),
    constraints: [
      ...signals.instructions.map(signal => signal.summary),
      ...signals.blockers.map(signal => signal.summary),
    ],
    projectFacts: [
      ...signals.decisions.map(signal => signal.summary),
      ...signals.facts.map(signal => signal.summary),
    ],
    confidence: aggregateConfidence([
      ...signals.preferences,
      ...signals.decisions,
      ...signals.instructions,
      ...signals.blockers,
      ...signals.handoffs,
      ...signals.facts,
    ]),
  }
}

function topSignals(
  observations: Observation[],
  types: ObservationType[],
  maxSignals: number,
): ProfileSignal[] {
  return observations
    .filter(observation => types.includes(observation.type))
    .sort((left, right) => {
      const confidence = right.confidence - left.confidence
      if (confidence !== 0) return confidence
      return compareObservation(left, right)
    })
    .slice(0, maxSignals)
    .map(observation => ({
      type: observation.type,
      title: observation.title,
      summary: observation.summary,
      evidenceEventIds: [...observation.evidenceEventIds].sort(),
      confidence: observation.confidence,
    }))
}

function archiveInstructionSignals(
  events: ArchiveEvent[],
  maxSignals: number,
): ProfileSignal[] {
  return events
    .filter(event => event.role === 'user' && isInstructionLike(event.text))
    .slice(0, maxSignals)
    .map(event => ({
      type: 'archive',
      title: `Instruction hint: ${compact(event.text, 80)}`,
      summary: compact(event.text, 240),
      evidenceEventIds: [event.eventId],
      confidence: 0.45,
    }))
}

function isInstructionLike(text: string): boolean {
  return /记住|以后|默认|不要|必须|请始终|always|never|default/iu.test(text)
}

function compareObservation(left: Observation, right: Observation): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.observationId.localeCompare(right.observationId)
  )
}

function compareEvent(left: ArchiveEvent, right: ArchiveEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId)
}

function latestCreatedAt(
  observations: Observation[],
  events: ArchiveEvent[],
): string {
  return [
    ...observations.map(observation => observation.createdAt),
    ...events.map(event => event.createdAt),
  ].sort().at(-1) ?? '1970-01-01T00:00:00.000Z'
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}

function aggregateConfidence(signals: ProfileSignal[]): number {
  if (!signals.length) return 0
  const total = signals.reduce((sum, signal) => sum + signal.confidence, 0)
  return Number((total / signals.length).toFixed(2))
}
