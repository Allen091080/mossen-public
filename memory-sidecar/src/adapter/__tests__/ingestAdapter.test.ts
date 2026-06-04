// W435a S1 — planAdapterPayloads dry-run semantics.
//
// planAdapterPayloads is the no-IO companion of ingestAdapterPayloads:
// validates + normalizes + de-dupes payloads, returns a counts/events
// summary without writing anything. Perfect for unit testing.
import { describe, expect, test } from 'bun:test'
import { planAdapterPayloads } from '../ingestAdapter.js'
import type { MemoryAdapterPayload } from '../payload.js'

function validPayload(overrides: Partial<MemoryAdapterPayload> = {}): MemoryAdapterPayload {
  return {
    schemaVersion: 1,
    adapter: 'mossen-hook',
    sourceEventId: 'mossen:t-1',
    projectId: 'proj-a',
    sessionId: 'sess-a',
    scope: 'project',
    role: 'user',
    kind: 'message',
    channel: 'conversation',
    text: 'hello world',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('planAdapterPayloads', () => {
  test('empty input -> zero everything', () => {
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [],
    })
    expect(plan.dryRun).toBe(true)
    expect(plan.accepted).toBe(0)
    expect(plan.skipped).toBe(0)
    expect(plan.failed).toBe(0)
    expect(plan.projects).toEqual([])
    expect(plan.events).toEqual([])
  })

  test('single valid payload -> 1 accepted, project bucketed', () => {
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [validPayload()],
    })
    expect(plan.accepted).toBe(1)
    expect(plan.failed).toBe(0)
    expect(plan.projects).toHaveLength(1)
    expect(plan.projects[0]!.projectId).toBe('proj-a')
    expect(plan.projects[0]!.events).toHaveLength(1)
    expect(plan.projects[0]!.events[0]!.sourceEventId).toBe('mossen:t-1')
    expect(plan.projects[0]!.events[0]!.role).toBe('user')
    expect(plan.projects[0]!.events[0]!.textLength).toBe('hello world'.length)
  })

  test('payload missing both projectId and cwd -> invalid_schema', () => {
    const bogus = {
      schemaVersion: 1,
      adapter: 'mossen-hook',
      sourceEventId: 'mossen:t-bogus',
      // no projectId, no cwd
      sessionId: 'sess-a',
      role: 'user',
      text: 'hello',
    } as MemoryAdapterPayload
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [bogus],
    })
    expect(plan.accepted).toBe(0)
    expect(plan.failed).toBe(1)
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0]!.status).toBe('failed')
    expect(plan.events[0]!.reason).toBe('invalid_schema')
  })

  test('duplicate sourceEventId in same project -> second is skipped/duplicate', () => {
    const p1 = validPayload({ sourceEventId: 'dup-id' })
    const p2 = validPayload({ sourceEventId: 'dup-id', text: 'second' })
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [p1, p2],
    })
    expect(plan.accepted).toBe(1)
    expect(plan.skipped).toBe(1)
    const dupEvent = plan.events.find(e => e.reason === 'duplicate_source_event')
    expect(dupEvent).toBeDefined()
    expect(dupEvent!.status).toBe('skipped')
    expect(dupEvent!.sourceEventId).toBe('dup-id')
  })

  test('multiple projects are bucketed separately', () => {
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [
        validPayload({ projectId: 'proj-a', sourceEventId: 'a-1' }),
        validPayload({ projectId: 'proj-b', sourceEventId: 'b-1' }),
        validPayload({ projectId: 'proj-a', sourceEventId: 'a-2' }),
      ],
    })
    expect(plan.accepted).toBe(3)
    expect(plan.projects).toHaveLength(2)
    const projA = plan.projects.find(p => p.projectId === 'proj-a')!
    const projB = plan.projects.find(p => p.projectId === 'proj-b')!
    expect(projA.events).toHaveLength(2)
    expect(projB.events).toHaveLength(1)
  })

  test('control-plane text is filtered as skipped/sidecar_filtered_control_plane', () => {
    // "/memory" matches isControlPlaneMessage. The plan keeps the rejection
    // ack in events[] so callers can see the filter fired.
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [
        validPayload({ sourceEventId: 'normal', text: 'hello there' }),
        validPayload({ sourceEventId: 'slashy', text: '/memory' }),
      ],
    })
    expect(plan.accepted).toBe(1)
    expect(plan.skipped).toBe(1)
    const filtered = plan.events.find(
      e => e.reason === 'sidecar_filtered_control_plane',
    )
    expect(filtered).toBeDefined()
    expect(filtered!.sourceEventId).toBe('slashy')
  })

  test('enabled: false rejects all with adapter_disabled', () => {
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [validPayload()],
      enabled: false,
    })
    expect(plan.accepted).toBe(0)
    expect(plan.skipped).toBe(1)
    expect(plan.events[0]!.reason).toBe('adapter_disabled')
  })

  test('text_too_large fails when text exceeds maxTextChars', () => {
    const plan = planAdapterPayloads({
      rootDir: '/nonexistent-on-purpose',
      payloads: [validPayload({ text: 'x'.repeat(50) })],
      maxTextChars: 10,
    })
    expect(plan.failed).toBe(1)
    expect(plan.events[0]!.reason).toBe('text_too_large')
  })
})
