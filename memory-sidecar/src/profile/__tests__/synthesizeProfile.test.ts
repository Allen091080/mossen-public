// W435e — Profile synthesis tests.
//
// synthesizeProfileSignals + synthesizeProfileSnapshot are pure functions.
// Locks the bucketing of observations into preferences/decisions/
// instructions/blockers/handoffs/facts, the confidence-based ranking, and
// the maxSignalsPerSection cap.
import { describe, expect, test } from 'bun:test'
import {
  synthesizeProfileSignals,
  synthesizeProfileSnapshot,
} from '../synthesizeProfile.js'
import type { Observation, ObservationType } from '../../schema/observation.js'

function obs(
  type: ObservationType,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    schemaVersion: 1,
    observationId: `obs-${Math.random().toString(36).slice(2, 10)}`,
    scope: 'project',
    visibility: 'project',
    projectId: 'p',
    sessionId: 's',
    type,
    kind: 'semantic',
    domain: 'workflow',
    lifecycle: 'active',
    retrievalPolicy: 'hint',
    title: `title-${type}`,
    summary: `summary-${type}`,
    evidenceIds: [],
    evidenceEventIds: ['evt-1'],
    files: [],
    tags: [],
    confidence: 0.5,
    source: 'rule',
    promotionStatus: 'candidate',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('synthesizeProfileSignals', () => {
  test('empty input -> empty buckets but well-formed structure', () => {
    const p = synthesizeProfileSignals({}, { projectId: 'p' })
    expect(p.schemaVersion).toBe(1)
    expect(p.projectId).toBe('p')
    expect(p.preferences).toEqual([])
    expect(p.decisions).toEqual([])
    expect(p.instructions).toEqual([])
    expect(p.blockers).toEqual([])
    expect(p.handoffs).toEqual([])
    expect(p.facts).toEqual([])
  })

  test('preferences observation goes to preferences bucket', () => {
    const p = synthesizeProfileSignals(
      { observations: [obs('preference', { title: 'pref a', confidence: 0.9 })] },
      { projectId: 'p' },
    )
    expect(p.preferences.length).toBe(1)
    expect(p.preferences[0]!.title).toBe('pref a')
    expect(p.preferences[0]!.confidence).toBe(0.9)
  })

  test('decisions bucket aggregates decision/workflow/coding/tool types', () => {
    const p = synthesizeProfileSignals(
      {
        observations: [
          obs('decision'),
          obs('workflow_pattern'),
          obs('coding_convention'),
          obs('tool_preference'),
        ],
      },
      { projectId: 'p' },
    )
    expect(p.decisions.length).toBe(4)
  })

  test('instructions bucket aggregates instruction/safety/policy types', () => {
    const p = synthesizeProfileSignals(
      {
        observations: [
          obs('instruction_candidate'),
          obs('safety_rule'),
          obs('team_policy'),
        ],
      },
      { projectId: 'p' },
    )
    expect(p.instructions.length).toBe(3)
  })

  test('blockers + handoffs + facts buckets', () => {
    const p = synthesizeProfileSignals(
      {
        observations: [
          obs('blocker'),
          obs('open_thread'),
          obs('handoff'),
          obs('project_state'),
          obs('fact'),
          obs('bugfix'),
          obs('feature'),
          obs('skill_candidate'),
        ],
      },
      { projectId: 'p' },
    )
    expect(p.blockers.length).toBe(2)
    expect(p.handoffs.length).toBe(2)
    expect(p.facts.length).toBe(4)
  })

  test('confidence ranks within a bucket (higher first)', () => {
    const p = synthesizeProfileSignals(
      {
        observations: [
          obs('preference', { title: 'low', confidence: 0.2 }),
          obs('preference', { title: 'high', confidence: 0.9 }),
          obs('preference', { title: 'mid', confidence: 0.5 }),
        ],
      },
      { projectId: 'p' },
    )
    expect(p.preferences.map(s => s.title)).toEqual(['high', 'mid', 'low'])
  })

  test('maxSignalsPerSection caps each bucket', () => {
    const observations = Array.from({ length: 25 }, (_, i) =>
      obs('preference', { title: `pref-${i}`, confidence: 1 - i / 100 }),
    )
    const p = synthesizeProfileSignals(
      { observations },
      { projectId: 'p', maxSignalsPerSection: 3 },
    )
    expect(p.preferences.length).toBe(3)
  })

  test('projectId falls back to observations[0].projectId when not provided', () => {
    const p = synthesizeProfileSignals(
      { observations: [obs('preference', { projectId: 'p-inferred' })] },
      {},
    )
    expect(p.projectId).toBe('p-inferred')
  })

  test('generatedAt set to latest createdAt across observations + events', () => {
    const p = synthesizeProfileSignals(
      {
        observations: [
          obs('preference', { createdAt: '2026-05-19T10:00:00.000Z' }),
          obs('preference', { createdAt: '2026-05-19T11:00:00.000Z' }),
        ],
      },
      { projectId: 'p' },
    )
    expect(p.generatedAt).toBe('2026-05-19T11:00:00.000Z')
  })
})

describe('synthesizeProfileSnapshot', () => {
  test('maps signals into ProfileSnapshot string arrays', () => {
    const snapshot = synthesizeProfileSnapshot(
      {
        observations: [
          obs('preference', { summary: 'use pnpm' }),
          obs('decision', { summary: 'use bun' }),
          obs('safety_rule', { summary: 'no secrets in code' }),
        ],
      },
      { projectId: 'p', sourceJobId: 'job-1' },
    )
    expect(snapshot.projectId).toBe('p')
    expect(snapshot.sourceJobId).toBe('job-1')
    expect(snapshot.preferences).toContain('use pnpm')
    expect(snapshot.projectFacts).toContain('use bun')
    expect(snapshot.constraints).toContain('no secrets in code')
    expect(snapshot.confidence).toBeGreaterThan(0)
    expect(snapshot.confidence).toBeLessThanOrEqual(1)
  })

  test('default scope is project; overridable', () => {
    const a = synthesizeProfileSnapshot(
      { observations: [obs('preference')] },
      { projectId: 'p', sourceJobId: 'j' },
    )
    expect(a.scope).toBe('project')

    const b = synthesizeProfileSnapshot(
      { observations: [obs('preference')] },
      { projectId: 'p', sourceJobId: 'j', scope: 'user' },
    )
    expect(b.scope).toBe('user')
  })
})
