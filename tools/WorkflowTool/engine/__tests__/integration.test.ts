/**
 * End-to-end engine integration: run a real workflow SCRIPT through the
 * sandbox + runtime with a fake agent runner. This exercises the exact path
 * the WorkflowTool uses in production (extractMeta → createWorkflowRuntime →
 * runSandbox) minus the live LLM, proving phase / parallel / pipeline / agent /
 * schema / budget all compose correctly.
 */

import { describe, expect, test } from 'bun:test'
import { createLimiter } from '../concurrency.js'
import { createBudget } from '../budget.js'
import { createJournal } from '../journal.js'
import { createWorkflowRuntime, type RunOneAgent } from '../runtime.js'
import { runSandbox } from '../sandbox.js'
import { extractMeta } from '../meta.js'
import type { WorkflowProgressEvent } from '../types.js'

type DemoWorkflowResult = {
  found: unknown[]
  verified: unknown[]
  summary: unknown
  spent: unknown
}

type PhaseEvent = Extract<WorkflowProgressEvent, { kind: 'phase' }>
type AgentStartEvent = Extract<WorkflowProgressEvent, { kind: 'agent_start' }>

function runWorkflow(
  source: string,
  runOneAgent: RunOneAgent,
  opts: { total?: number | null; args?: unknown } = {},
) {
  const events: WorkflowProgressEvent[] = []
  const budget = createBudget(opts.total ?? null)
  const runtime = createWorkflowRuntime({
    limiter: createLimiter(4),
    budget,
    progress: e => events.push(e),
    args: opts.args,
    runOneAgent,
    journal: createJournal('test-run'),
  })
  // Validate meta the way the tool does, then execute the body.
  extractMeta(source)
  return runSandbox({
    source,
    scope: runtime.scope,
    timeoutMs: 5000,
  }).then(result => ({ result, events, budget, runtime }))
}

// A fake agent: echoes the prompt for text calls; for schema calls it returns
// an already-validated object (mirroring what the real agentRunner returns).
const fakeAgent: RunOneAgent = async (prompt, opts) => {
  if (opts.schema) {
    return { value: { n: prompt.length }, tokens: 5, ok: true }
  }
  return { value: `ran:${prompt}`, tokens: 3, ok: true }
}

describe('engine integration', () => {
  test('runs a multi-phase workflow with parallel + pipeline + schema', async () => {
    const source = `
export const meta = {
  name: 'demo',
  description: 'parallel find then pipeline verify',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}
phase('Find')
log('searching')
const found = await parallel([
  () => agent('find alpha', { label: 'a' }),
  () => agent('find beta', { label: 'b' }),
])
phase('Verify')
const verified = await pipeline(
  found.filter(Boolean),
  async (x) => agent('verify ' + x),
)
const summary = await agent('summarize', {
  schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
})
return { found, verified, summary, spent: budget.spent() }
`
    const { result, events, runtime } = await runWorkflow(source, fakeAgent)
    const r = result as DemoWorkflowResult
    expect(r.found).toEqual(['ran:find alpha', 'ran:find beta'])
    expect(r.verified).toEqual([
      'ran:verify ran:find alpha',
      'ran:verify ran:find beta',
    ])
    expect(r.summary).toEqual({ n: 'summarize'.length })
    expect(typeof r.spent).toBe('number')
    expect(runtime.agentCount()).toBe(5) // 2 find + 2 verify + 1 summary

    // Phases were emitted in order; agent events carried their phase.
    const phases = events
      .filter((e): e is PhaseEvent => e.kind === 'phase')
      .map(e => e.title)
    expect(phases).toEqual(['Find', 'Verify'])
    const summaryStart = events.find(
      (e): e is AgentStartEvent =>
        e.kind === 'agent_start' && e.label === 'summarize',
    )
    expect(summaryStart).toBeDefined()
    expect(summaryStart!.phase).toBe('Verify')
  })

  test('passes args through to the script', async () => {
    const source = `
export const meta = { name: 'echo-args', description: 'returns args' }
return args.value * 2
`
    const { result } = await runWorkflow(source, fakeAgent, {
      args: { value: 21 },
    })
    expect(result).toBe(42)
  })

  test('budget ceiling aborts the run with a clear error', async () => {
    const source = `
export const meta = { name: 'greedy', description: 'spends past the budget' }
const out = []
for (let i = 0; i < 100; i++) {
  out.push(await agent('task ' + i))
}
return out.length
`
    // Each agent spends 3 tokens; total 30 → exhausts after ~10 agents.
    await expect(runWorkflow(source, fakeAgent, { total: 30 })).rejects.toThrow(
      /budget/i,
    )
  })

  test('a failing agent inside parallel becomes null (barrier still resolves)', async () => {
    const flaky: RunOneAgent = async prompt => {
      if (prompt.includes('boom')) throw new Error('agent failed')
      return { value: `ok:${prompt}`, tokens: 1, ok: true }
    }
    const source = `
export const meta = { name: 'resilient', description: 'tolerates a failure' }
const out = await parallel([
  () => agent('good one'),
  () => agent('boom'),
  () => agent('good two'),
])
return out
`
    const { result } = await runWorkflow(source, flaky)
    expect(result).toEqual(['ok:good one', null, 'ok:good two'])
  })

  test('rejects a workflow whose script uses a forbidden API', async () => {
    const source = `
export const meta = { name: 'naughty', description: 'tries to use require' }
const fs = require('fs')
return 1
`
    await expect(runWorkflow(source, fakeAgent)).rejects.toThrow(/require/)
  })

  test('rejects nondeterministic Date.now in a script', async () => {
    const source = `
export const meta = { name: 'clock', description: 'uses Date.now' }
return Date.now()
`
    await expect(runWorkflow(source, fakeAgent)).rejects.toThrow(/determinism/)
  })

  test('rejects remote agent isolation in this build', async () => {
    const source = `
export const meta = { name: 'remote-agent', description: 'requests remote isolation' }
return agent('run elsewhere', { isolation: 'remote' })
`
    await expect(runWorkflow(source, fakeAgent)).rejects.toThrow(
      "agent({isolation:'remote'}) is not available in this build",
    )
  })
})
