import { describe, expect, test } from 'bun:test'
import { createLimiter } from '../concurrency.js'
import { createBudget, BudgetExceededError } from '../budget.js'
import { createJournal } from '../journal.js'
import {
  createWorkflowRuntime,
  deriveLabel,
  WorkflowAgentCapError,
  type RunOneAgent,
  type RunNestedWorkflow,
} from '../runtime.js'
import type {
  WorkflowAgentControlAction,
  WorkflowProgressEvent,
} from '../types.js'

type AgentStartEvent = Extract<WorkflowProgressEvent, { kind: 'agent_start' }>
type AgentEndEvent = Extract<WorkflowProgressEvent, { kind: 'agent_end' }>

function harness(
  runOneAgent: RunOneAgent,
  opts: {
    total?: number | null
    journal?: ReturnType<typeof createJournal>
    maxAgents?: number
    args?: unknown
    runNestedWorkflow?: RunNestedWorkflow
    shouldSkipAgent?: (agentNumber: number) => boolean
    getAgentControl?: (agentNumber: number) => WorkflowAgentControlAction | null
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
    journal: opts.journal,
    maxAgents: opts.maxAgents,
    runNestedWorkflow: opts.runNestedWorkflow,
    ...(opts.shouldSkipAgent
      ? { shouldSkipAgent: opts.shouldSkipAgent }
      : {}),
    ...(opts.getAgentControl ? { getAgentControl: opts.getAgentControl } : {}),
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

  test('emits agent_start then agent_end', async () => {
    const { rt, events } = harness(okAgent())
    const agent = rt.scope.agent as (p: string, o?: object) => Promise<unknown>
    await agent('task', { label: 'my-label', phase: 'Scan' })
    const kinds = events.map(e => e.kind)
    expect(kinds).toEqual(['agent_start', 'agent_end'])
    expect((events[0] as AgentStartEvent).label).toBe('my-label')
    expect((events[0] as AgentStartEvent).phase).toBe('Scan')
    expect((events[1] as AgentEndEvent).ok).toBe(true)
    expect((events[1] as AgentEndEvent).tokens).toBe(10)
  })

  test('returns null when the agent result is not ok', async () => {
    const { rt } = harness(async () => ({ value: 'x', tokens: 5, ok: false }))
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    expect(await agent('task')).toBeNull()
  })

  test('throws once the budget is exhausted', async () => {
    const { rt } = harness(okAgent('x', 60), { total: 100 })
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
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
    expect((events[1] as AgentEndEvent).status).toBe('skipped')
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
      'agent_start',
      'log',
      'agent_start',
      'agent_end',
    ])
    expect((events.at(-1) as AgentEndEvent).status).toBe('completed')
  })
})

describe('runtime.phase / log', () => {
  test('phase sets the default phase for later agents and emits an event', async () => {
    const { rt, events } = harness(okAgent())
    const phase = rt.scope.phase as (t: string) => void
    const agent = rt.scope.agent as (p: string) => Promise<unknown>
    phase('Build')
    await agent('compile')
    expect(events[0]).toEqual({ kind: 'phase', title: 'Build' })
    expect((events[1] as AgentStartEvent).phase).toBe('Build')
  })

  test('log emits a log event', () => {
    const { rt, events } = harness(okAgent())
    const log = rt.scope.log as (m: string) => void
    log('progress note')
    expect(events).toEqual([{ kind: 'log', message: 'progress note' }])
  })
})

describe('runtime.workflow', () => {
  test('throws when nested workflows are unavailable', async () => {
    const { rt } = harness(okAgent())
    const workflow = rt.scope.workflow as (n: string) => Promise<unknown>
    await expect(workflow('child')).rejects.toThrow(/nesting/)
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
})

describe('deriveLabel', () => {
  test('uses the first line, truncated', () => {
    expect(deriveLabel('short task')).toBe('short task')
    expect(deriveLabel('line one\nline two')).toBe('line one')
    expect(deriveLabel('x'.repeat(60))).toBe('x'.repeat(48) + '…')
  })
})
