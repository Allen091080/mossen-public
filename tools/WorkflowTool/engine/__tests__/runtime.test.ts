import { describe, expect, test } from 'bun:test'
import { createLimiter } from '../concurrency.js'
import { createBudget, BudgetExceededError } from '../budget.js'
import { createJournal, hashCall } from '../journal.js'
import {
  createWorkflowRuntime,
  deriveLabel,
  resolvePhase,
  WorkflowAgentCapError,
  type RunOneAgent,
  type RunNestedWorkflow,
} from '../runtime.js'
import type {
  WorkflowAgentControlAction,
  WorkflowPhaseMeta,
  WorkflowProgressEvent,
} from '../types.js'

type AgentStartEvent = Extract<WorkflowProgressEvent, { kind: 'agent_start' }>
type AgentQueuedEvent = Extract<WorkflowProgressEvent, { kind: 'agent_queued' }>
type AgentEndEvent = Extract<WorkflowProgressEvent, { kind: 'agent_end' }>

function harness(
  runOneAgent: RunOneAgent,
  opts: {
    total?: number | null
    journal?: ReturnType<typeof createJournal>
    maxAgents?: number
    args?: unknown
    phases?: WorkflowPhaseMeta[]
    defaultModel?: string
    signal?: AbortSignal
    runNestedWorkflow?: RunNestedWorkflow
    forcedPhase?: string
    ignorePhaseChanges?: boolean
    logPrefix?: string
    shouldSkipAgent?: (agentNumber: number) => boolean
    getAgentControl?: (agentNumber: number) => WorkflowAgentControlAction | null
    waitForResume?: (
      agentNumber: number,
      meta: { phase: string | null; label: string },
    ) => Promise<void>
  } = {},
) {
  const events: WorkflowProgressEvent[] = []
  const budget = createBudget(opts.total ?? null)
  const rt = createWorkflowRuntime({
    limiter: createLimiter(2),
    budget,
    progress: e => events.push(e),
    args: opts.args,
    runOneAgent,
    phases: opts.phases,
    defaultModel: opts.defaultModel,
    signal: opts.signal,
    journal: opts.journal,
    maxAgents: opts.maxAgents,
    runNestedWorkflow: opts.runNestedWorkflow,
    forcedPhase: opts.forcedPhase,
    ignorePhaseChanges: opts.ignorePhaseChanges,
    logPrefix: opts.logPrefix,
    ...(opts.shouldSkipAgent
      ? { shouldSkipAgent: opts.shouldSkipAgent }
      : {}),
    ...(opts.getAgentControl ? { getAgentControl: opts.getAgentControl } : {}),
    ...(opts.waitForResume ? { waitForResume: opts.waitForResume } : {}),
  })
  return { rt, events, budget }
}

const okAgent =
  (text = 'done', tokens = 10): RunOneAgent =>
  async () => ({ value: text, tokens, ok: true })

describe('runtime.agent', () => {
  test('returns the agent value and charges the budget', async () => {
    const { rt, budget } = harness(okAgent('hello', 25))
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>
    const out = await agent('do a thing')
    expect(out).toBe('hello')
    expect(budget.spent()).toBe(25)
    expect(rt.agentCount()).toBe(1)
  })

  test('emits agent_queued, agent_start, then agent_end', async () => {
    const { rt, events } = harness(okAgent())
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>
    await agent('task', { label: 'my-label', phase: 'Scan' })
    const kinds = events.map(e => e.kind)
    expect(kinds).toEqual(['agent_queued', 'agent_start', 'agent_end'])
    expect((events[0] as AgentQueuedEvent).label).toBe('my-label')
    expect((events[0] as AgentQueuedEvent).phase).toBe('Scan')
    expect((events[1] as AgentStartEvent).label).toBe('my-label')
    expect((events[1] as AgentStartEvent).phase).toBe('Scan')
    expect((events[2] as AgentEndEvent).ok).toBe(true)
    expect((events[2] as AgentEndEvent).tokens).toBe(10)
  })

  test('tracks live tool calls separately from agent count', async () => {
    const { rt, events } = harness(async () => ({
      value: 'ok',
      tokens: 12,
      toolCalls: 3,
      ok: true,
    }))
    const agent = rt.scope.agent as (p: string) => Promise<unknown>

    expect(await agent('task')).toBe('ok')
    expect(rt.agentCount()).toBe(1)
    expect(rt.toolCallCount()).toBe(3)
    expect((events.at(-1) as AgentEndEvent).toolCalls).toBe(3)
  })

  test('returns null when the agent result is not ok', async () => {
    const { rt } = harness(async () => ({ value: 'x', tokens: 5, ok: false }))
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>
    expect(await agent('task')).toBeNull()
  })

  test('throws once the budget is exhausted', async () => {
    const { rt } = harness(okAgent('x', 60), { total: 100 })
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>
    await agent('one') // spends 60
    await agent('two') // spends 60 → now at 120 ≥ 100
    await expect(agent('three')).rejects.toThrow(BudgetExceededError)
  })

  test('enforces the per-run agent cap', async () => {
    const { rt } = harness(okAgent(), { maxAgents: 2 })
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    await agent('a')
    await agent('b')
    await expect(agent('c')).rejects.toThrow(WorkflowAgentCapError)
    await expect(agent('d')).rejects.toThrow(
      'Workflow agent() call cap reached (2). This usually means a loop using budget.remaining() never terminates because no token budget was set',
    )
  })

  test('rejects an empty prompt', async () => {
    const { rt } = harness(okAgent())
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    await expect(agent('')).rejects.toThrow(TypeError)
  })

  test('caps concurrency across a parallel fan-out', async () => {
    let active = 0
    let peak = 0
    const slow: RunOneAgent = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 8))
      active--
      return { value: 1, tokens: 1, ok: true }
    }
    const { rt } = harness(slow) // limiter cap = 2
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    const parallel = rt.scope.parallel as (t: Array<() => Promise<unknown>>) => Promise<unknown[]>
    await parallel(Array.from({ length: 6 }, (_, i) => () => agent(`t${i}`)))
    expect(peak).toBeLessThanOrEqual(2)
  })

  test('records swallowed parallel and pipeline branch failures', async () => {
    const { rt, events } = harness(async () => {
      throw new Error('agent exploded')
    })
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    const parallel = rt.scope.parallel as (
      thunks: Array<() => Promise<unknown>>,
    ) => Promise<Array<unknown | null>>
    const pipeline = rt.scope.pipeline as (
      items: unknown[],
      ...stages: Array<(prev: unknown, item: unknown, i: number) => Promise<unknown>>
    ) => Promise<Array<unknown | null>>

    expect(await parallel([() => agent('boom')])).toEqual([null])
    expect(
      await pipeline([1], async () => {
        throw new Error('stage exploded')
      }),
    ).toEqual([null])

    expect(rt.failures()).toEqual([
      'parallel[0] failed: agent exploded',
      'pipeline[0] failed: stage exploded',
    ])
    expect(
      events
        .filter((e): e is Extract<WorkflowProgressEvent, { kind: 'log' }> =>
          e.kind === 'log',
        )
        .map(e => e.message),
    ).toEqual([
      'parallel[0] failed: agent exploded',
      'pipeline[0] failed: stage exploded',
    ])
  })

  test('skips an agent before execution when a control request exists', async () => {
    let calls = 0
    const { rt, events, budget } = harness(
      async () => {
        calls++
        return { value: 'live', tokens: 20, ok: true }
      },
      { shouldSkipAgent: agentNumber => agentNumber === 1 },
    )
    const agent = rt.scope.agent as (p: string) => Promise<unknown>

    expect(await agent('task')).toBeNull()
    expect(calls).toBe(0)
    expect(budget.spent()).toBe(0)
    expect(events.map(e => e.kind)).toEqual(['agent_queued', 'agent_end'])
    expect((events[0] as AgentQueuedEvent).agentNumber).toBe(1)
    expect((events[1] as AgentEndEvent).status).toBe('skipped')
  })

  test('waits for a paused workflow before starting a queued agent', async () => {
    let paused = true
    let releasePause!: () => void
    const waitForResume = () =>
      paused
        ? new Promise<void>(resolve => {
            releasePause = () => {
              paused = false
              resolve()
            }
          })
        : Promise.resolve()
    const { rt, events } = harness(okAgent('live'), { waitForResume })
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>

    const pending = agent('task', { label: 'paused-agent' })
    await Promise.resolve()
    await Promise.resolve()

    expect(events.map(e => e.kind)).toEqual(['agent_queued'])
    expect((events[0] as AgentQueuedEvent).label).toBe('paused-agent')

    releasePause()
    expect(await pending).toBe('live')
    expect(events.map(e => e.kind)).toEqual([
      'agent_queued',
      'agent_start',
      'agent_end',
    ])
  })

  test('delegates remote isolation to the injected agent runner', async () => {
    let seenIsolation: unknown
    const { rt, events } = harness(async (_prompt, opts) => {
      seenIsolation = opts.isolation
      return { value: 'remote-live', tokens: 1, ok: true }
    })
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>

    await expect(agent('task', { isolation: 'remote' })).resolves.toBe(
      'remote-live',
    )
    expect(seenIsolation).toBe('remote')
    expect(events.map(e => e.kind)).toEqual([
      'agent_queued',
      'agent_start',
      'agent_end',
    ])
  })

  test('retries the same agent when the runner reports retry_requested', async () => {
    let calls = 0
    const { rt, events, budget } = harness(async () => {
      calls++
      if (calls === 1) {
        return {
          value: null,
          tokens: 0,
          ok: false,
          status: 'retry_requested',
        }
      }
      return { value: 'second try', tokens: 11, ok: true }
    })
    const agent = rt.scope.agent as (p: string) => Promise<unknown>

    expect(await agent('task')).toBe('second try')
    expect(calls).toBe(2)
    expect(rt.agentCount()).toBe(1)
    expect(budget.spent()).toBe(11)
    expect(events.map(e => e.kind)).toEqual([
      'agent_queued',
      'agent_start',
      'log',
      'agent_queued',
      'agent_start',
      'agent_end',
    ])
    expect((events.at(-1) as AgentEndEvent).status).toBe('completed')
  })
})

describe('runtime.phase / log', () => {
  test('resolvePhase accepts a title or phase object and merges meta defaults', () => {
    const phases = [
      { title: 'Build', detail: 'compile', model: 'phase-model' },
    ]

    expect(resolvePhase('Build', phases)).toEqual({
      title: 'Build',
      detail: 'compile',
      model: 'phase-model',
    })
    expect(
      resolvePhase({ title: 'Build', model: 'override-model' }, phases),
    ).toEqual({
      title: 'Build',
      detail: 'compile',
      model: 'override-model',
    })
  })

  test('phase sets the default phase for later agents and emits an event', async () => {
    const { rt, events } = harness(okAgent())
    const phase = rt.scope.phase as (t: string) => void
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    phase('Build')
    await agent('compile')
    expect(events[0]).toEqual({ kind: 'phase', title: 'Build' })
    expect(events.map(e => e.kind)).toEqual(['phase', 'agent_queued', 'agent_start', 'agent_end'])
    expect((events[1] as AgentQueuedEvent).phase).toBe('Build')
    expect((events[2] as AgentStartEvent).phase).toBe('Build')
  })

  test('phase object model becomes the default for later agents', async () => {
    const seen: unknown[] = []
    const { rt, events } = harness(
      async (_prompt, opts) => {
        seen.push(opts)
        return { value: 'ok', tokens: 1, ok: true }
      },
      {
        phases: [
          { title: 'Review', detail: 'scan risks', model: 'phase-model' },
        ],
      },
    )
    const phase = rt.scope.phase as (t: WorkflowPhaseMeta) => void
    const agent = rt.scope.agent as (p: string) => Promise<unknown>

    phase({ title: 'Review' })
    await agent('scan')

    expect(events[0]).toEqual({ kind: 'phase', title: 'Review' })
    expect(seen[0]).toMatchObject({ model: 'phase-model' })
  })

  test('workflow default model applies unless phase or agent overrides it', async () => {
    const models: unknown[] = []
    const { rt } = harness(
      async (_prompt, opts) => {
        models.push(opts.model)
        return { value: 'ok', tokens: 1, ok: true }
      },
      {
        defaultModel: 'workflow-model',
        phases: [{ title: 'Review', model: 'phase-model' }],
      },
    )
    const phase = rt.scope.phase as (t: string) => void
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>

    await agent('uses workflow default')
    phase('Review')
    await agent('uses phase default')
    await agent('uses explicit model', { model: 'agent-model' })

    expect(models).toEqual(['workflow-model', 'phase-model', 'agent-model'])
  })

  test('timers expose abort-aware promise delays without global setTimeout', async () => {
    const { rt } = harness(okAgent())
    const timers = rt.scope.timers as {
      wait(ms: number): Promise<void>
      setTimeout<T>(ms: number, value: T): Promise<T>
    }

    await expect(timers.wait(1)).resolves.toBeUndefined()
    await expect(timers.setTimeout(1, 'done')).resolves.toBe('done')
  })

  test('timers reject when the workflow is aborted', async () => {
    const ctrl = new AbortController()
    const { rt } = harness(okAgent(), { signal: ctrl.signal })
    const timers = rt.scope.timers as { wait(ms: number): Promise<void> }

    const pending = timers.wait(1000)
    ctrl.abort()
    await expect(pending).rejects.toThrow(/aborted/)
  })

  test('log emits a log event', () => {
    const { rt, events } = harness(okAgent())
    const log = rt.scope.log as (m: string) => void
    log('progress note')
    expect(events).toEqual([{ kind: 'log', message: 'progress note' }])
  })

  test('forced phase overrides child phase changes and agent phase options', async () => {
    const seen: Array<{
      opts: unknown
      meta: { phase: string | null; label: string }
    }> = []
    const { rt, events } = harness(
      async (_prompt, opts, meta) => {
        seen.push({ opts, meta })
        return { value: 'ok', tokens: 1, ok: true }
      },
      {
        forcedPhase: '▶ child',
        ignorePhaseChanges: true,
      },
    )
    const phase = rt.scope.phase as (t: string) => void
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>

    phase('Inner')
    await agent('child task', { label: 'child-agent', phase: 'Other' })

    expect(events.map(e => e.kind)).toEqual([
      'agent_queued',
      'agent_start',
      'agent_end',
    ])
    expect((events[0] as AgentQueuedEvent).phase).toBe('▶ child')
    expect(seen[0]?.meta.phase).toBe('▶ child')
    expect(seen[0]?.opts).toMatchObject({ phase: '▶ child' })
  })

  test('logPrefix applies to log and console progress output', () => {
    const { rt, events } = harness(okAgent(), { logPrefix: '[child] ' })
    const log = rt.scope.log as (m: string) => void
    const childConsole = rt.scope.console as {
      warn(...values: unknown[]): void
      error(...values: unknown[]): void
    }

    log('hello')
    childConsole.warn('careful', { n: 1 })
    childConsole.error('bad', undefined)

    expect(events).toEqual([
      { kind: 'log', message: '[child] hello' },
      { kind: 'log', message: '[child] [warn] careful {"n":1}' },
      { kind: 'log', message: '[child] [error] bad undefined' },
    ])
  })
})

describe('runtime.workflow', () => {
  test('throws when nested workflows are unavailable', async () => {
    const { rt } = harness(okAgent())
    const workflow = rt.scope.workflow as (n: string) => Promise<unknown>
    await expect(workflow('child')).rejects.toThrow(
      'workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.',
    )
  })

  test('delegates nested workflow calls when provided', async () => {
    const calls: Array<{ nameOrRef: unknown; args: unknown }> = []
    const { rt } = harness(okAgent(), {
      runNestedWorkflow: async (nameOrRef, args) => {
        calls.push({ nameOrRef, args })
        return { ok: true }
      },
    })
    const workflow = rt.scope.workflow as (
      n: string,
      args?: unknown,
    ) => Promise<unknown>
    await expect(workflow('child', { topic: 'x' })).resolves.toEqual({
      ok: true,
    })
    expect(calls).toEqual([{ nameOrRef: 'child', args: { topic: 'x' } }])
  })
})

describe('runtime journal (resume)', () => {
  test('replays cached results without calling runOneAgent again', async () => {
    let calls = 0
    const counting: RunOneAgent = async () => {
      calls++
      return { value: `r${calls}`, tokens: 7, ok: true }
    }
    // First run: record into a fresh journal.
    const j1 = createJournal('run-1')
    const h1 = harness(counting, { journal: j1 })
    const a1 = h1.rt.scope.agent as (p: string) => Promise<unknown>
    expect(await a1('alpha')).toBe('r1')
    expect(await a1('beta')).toBe('r2')
    expect(calls).toBe(2)

    // Second run: replay from the prior journal data — identical calls cached.
    const j2 = createJournal('run-2', j1.toData())
    const h2 = harness(counting, { journal: j2 })
    const a2 = h2.rt.scope.agent as (p: string) => Promise<unknown>
    expect(await a2('alpha')).toBe('r1') // cached, not re-run
    expect(await a2('beta')).toBe('r2') // cached
    expect(calls).toBe(2) // unchanged → no live runs
    expect(j2.hits()).toBe(2)
    expect(h2.events.map(e => e.kind)).toEqual(['agent_end', 'agent_end'])
    expect((h2.events[0] as AgentEndEvent).status).toBe('cached')
    expect((h2.events[1] as AgentEndEvent).status).toBe('cached')
  })

  test('diverging call invalidates the cache from that point on', async () => {
    let calls = 0
    const counting: RunOneAgent = async () => {
      calls++
      return { value: `r${calls}`, tokens: 1, ok: true }
    }
    const j1 = createJournal('run-1')
    const h1 = harness(counting, { journal: j1 })
    const a1 = h1.rt.scope.agent as (p: string) => Promise<unknown>
    await a1('same')
    await a1('old')
    expect(calls).toBe(2)

    const j2 = createJournal('run-2', j1.toData())
    const h2 = harness(counting, { journal: j2 })
    const a2 = h2.rt.scope.agent as (p: string) => Promise<unknown>
    expect(await a2('same')).toBe('r1') // cached
    await a2('new') // diverges → live run (calls=3)
    expect(calls).toBe(3)
    expect(j2.hits()).toBe(1)
  })

  test('started-only prior entries respawn instead of replaying a cache hit', async () => {
    let calls = 0
    const counting: RunOneAgent = async () => {
      calls++
      return { value: `live-${calls}`, tokens: 2, ok: true }
    }
    const prior = {
      runId: 'run-1',
      entries: [],
      started: [
        {
          kind: 'started' as const,
          index: 0,
          hash: hashCall('alpha', {}),
          label: 'alpha',
          phase: null,
          agentNumber: 1,
          opts: {},
        },
      ],
    }
    const journal = createJournal('run-2', prior)
    const { rt, events } = harness(counting, { journal })
    const agent = rt.scope.agent as (p: string) => Promise<unknown>

    expect(await agent('alpha')).toBe('live-1')
    expect(calls).toBe(1)
    expect(journal.hits()).toBe(0)
    expect(journal.startedHits()).toBe(1)
    expect(events[0]).toEqual({
      kind: 'log',
      message: 'workflow journal started hit respawn: agent #1 alpha',
    })
    expect(events[1]).toMatchObject({ kind: 'agent_queued', agentNumber: 1 })
    expect(events[2]).toMatchObject({ kind: 'agent_start', agentNumber: 1 })
  })
})

describe('deriveLabel', () => {
  test('uses the first line, truncated', () => {
    expect(deriveLabel('short task')).toBe('short task')
    expect(deriveLabel('line one\nline two')).toBe('line one')
    expect(deriveLabel('x'.repeat(60))).toBe('x'.repeat(48) + '…')
  })
})
