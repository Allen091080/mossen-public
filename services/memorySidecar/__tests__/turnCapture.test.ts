// W435a S1 — captureTurnForMemorySidecar early-return guards.
//
// Tests only the guards that return BEFORE loadMemorySidecarConfig touches
// disk:
//   1. subagent  (context.toolUseContext.agentId truthy)
//   2. non-REPL  (querySource that doesn't start with repl_main_thread* and
//                 isn't 'sdk')
//
// "valid querySource passes the guard" cases verify the inverse — those
// continue past the early-return into loadMemorySidecarConfig. The test
// suppresses the rest of the pipeline by checking only that the reason
// is NOT 'subagent' / 'query_source:*'.
//
// Full integration tests require sidecar config + ingest pipeline mocking;
// deferred to W435a2.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  _resetMemorySidecarTurnCaptureForTesting,
  captureTurnForMemorySidecar,
} from '../turnCapture.js'

type Ctx = Parameters<typeof captureTurnForMemorySidecar>[0]

function makeContext(overrides: {
  agentId?: string
  querySource?: string
  messages?: unknown[]
}): Ctx {
  return {
    toolUseContext: {
      agentId: overrides.agentId,
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
      }),
    },
    querySource: overrides.querySource,
    messages: overrides.messages ?? [],
  } as unknown as Ctx
}

beforeAll(() => {
  _resetMemorySidecarTurnCaptureForTesting()
})

afterAll(() => {
  _resetMemorySidecarTurnCaptureForTesting()
})

describe('captureTurnForMemorySidecar early-return guards', () => {
  test('subagent (agentId truthy) -> skipped/subagent', async () => {
    const result = await captureTurnForMemorySidecar(
      makeContext({ agentId: 'sub-agent-1' }),
    )
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('subagent')
    }
  })

  test('subagent guard runs before querySource guard', async () => {
    // Both agentId and a non-REPL querySource — subagent should win.
    const result = await captureTurnForMemorySidecar(
      makeContext({ agentId: 'sub-agent-1', querySource: 'remote_pty' }),
    )
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('subagent')
    }
  })

  test('non-REPL querySource -> skipped/query_source:<source>', async () => {
    const result = await captureTurnForMemorySidecar(
      makeContext({ querySource: 'remote_pty' }),
    )
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('query_source:remote_pty')
    }
  })

  test('repl_main_thread querySource passes the querySource guard', async () => {
    const result = await captureTurnForMemorySidecar(
      makeContext({ querySource: 'repl_main_thread_v2' }),
    )
    // Continues past the early guards; whatever happens next, the reason
    // must NOT be a subagent or query_source skip.
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).not.toBe('subagent')
      expect(result.reason).not.toBe('query_source:repl_main_thread_v2')
    }
  })

  test('sdk querySource passes the querySource guard', async () => {
    const result = await captureTurnForMemorySidecar(
      makeContext({ querySource: 'sdk' }),
    )
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).not.toBe('subagent')
      expect(result.reason).not.toBe('query_source:sdk')
    }
  })

  test('undefined querySource passes the querySource guard', async () => {
    // The condition checks `context.querySource &&`, so undefined falls
    // through immediately.
    const result = await captureTurnForMemorySidecar(makeContext({}))
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).not.toBe('subagent')
      expect(result.reason).not.toMatch(/^query_source:/)
    }
  })
})

describe('_resetMemorySidecarTurnCaptureForTesting', () => {
  test('does not throw and is idempotent', () => {
    expect(() => _resetMemorySidecarTurnCaptureForTesting()).not.toThrow()
    expect(() => _resetMemorySidecarTurnCaptureForTesting()).not.toThrow()
  })
})
