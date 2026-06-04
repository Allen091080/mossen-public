// W435a S1 — ingestConversationEvent early-return guards + SidecarDisabledError.
//
// Tests only the guard paths that return BEFORE any disk IO:
//   - enabled: false  -> throw SidecarDisabledError
//   - event !match ConversationEvent schema -> throw "event must match..."
//   - event.projectId != options.projectId -> throw "projectId must match..."
//
// Real ingest (which writes JSONL + dirty marker) needs tmp dir fixtures
// and is deferred to W435a2.
import { describe, expect, test } from 'bun:test'
import {
  ingestConversationEvent,
  SidecarDisabledError,
} from '../archiveWriter.js'

function makeValidEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    source: 'mossen',
    sourceEventId: 'mossen:test-1',
    projectId: 'proj-a',
    sessionId: 'sess-a',
    scope: 'project',
    role: 'user',
    kind: 'message',
    text: 'hello',
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  } as never
}

describe('SidecarDisabledError', () => {
  test('is an Error subclass', () => {
    const err = new SidecarDisabledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SidecarDisabledError')
  })

  test('default message', () => {
    expect(new SidecarDisabledError().message).toBe('memory-sidecar is disabled')
  })

  test('custom message', () => {
    expect(new SidecarDisabledError('custom reason').message).toBe('custom reason')
  })
})

describe('ingestConversationEvent early-return guards', () => {
  test('enabled: false throws SidecarDisabledError before any IO', async () => {
    await expect(
      ingestConversationEvent({
        rootDir: '/nonexistent-on-purpose',
        projectId: 'proj-a',
        enabled: false,
        event: makeValidEvent(),
      }),
    ).rejects.toBeInstanceOf(SidecarDisabledError)
  })

  test('invalid event schema throws "must match ConversationEvent schema"', async () => {
    // Missing required fields — fails isConversationEvent guard.
    await expect(
      ingestConversationEvent({
        rootDir: '/nonexistent-on-purpose',
        projectId: 'proj-a',
        event: { schemaVersion: 1, source: 'mossen' } as never,
      }),
    ).rejects.toThrow(/event must match ConversationEvent schema/)
  })

  test('event.projectId mismatch with options.projectId throws', async () => {
    await expect(
      ingestConversationEvent({
        rootDir: '/nonexistent-on-purpose',
        projectId: 'proj-a',
        event: makeValidEvent({ projectId: 'proj-different' }),
      }),
    ).rejects.toThrow(/projectId must match/)
  })

  test('enabled: false takes precedence over schema/projectId checks', async () => {
    // Even with a malformed event, enabled:false wins because it's the first
    // check in the function. This locks the ordering — flipping the checks
    // would surface invalid_schema instead of sidecar_disabled, changing the
    // ack semantics seen by callers.
    await expect(
      ingestConversationEvent({
        rootDir: '/nonexistent-on-purpose',
        projectId: 'proj-a',
        enabled: false,
        event: { hello: 'not an event' } as never,
      }),
    ).rejects.toBeInstanceOf(SidecarDisabledError)
  })
})
