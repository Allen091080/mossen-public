/**
 * WorkflowRuntime — the engine surface injected into a workflow script.
 *
 * It wires the building blocks together and exposes exactly the globals a
 * workflow body may call: agent / parallel / pipeline / phase / log / workflow,
 * plus the `args` and `budget` values. The actual subagent execution is
 * delegated to an injected `runOneAgent` so the runtime stays unit-testable
 * (the WorkflowTool supplies the real runAgent-backed implementation).
 *
 * Responsibilities centralised here:
 *  - concurrency cap (every agent() acquires a limiter slot, so all fan-out
 *    paths — parallel, pipeline, or a bare Promise.all — are capped uniformly)
 *  - token budget enforcement (assertBudget before each spawn; record after)
 *  - a hard ceiling on total agents per run (runaway-loop backstop)
 *  - resume journal lookup/record
 *  - progress events (phase / log / agent_start / agent_end)
 */

import { assertBudget, type Budget } from './budget.js'
import type { Limiter } from './concurrency.js'
import { hashCall, type Journal } from './journal.js'
import { parallel as parallelPrim, pipeline as pipelinePrim } from './orchestration.js'
import type {
  AgentCallOptions,
  WorkflowAgentControlAction,
  AgentRunResult,
  ProgressSink,
} from './types.js'

/** Lifetime cap on agent() calls — a backstop far above any real workflow. */
export const MAX_AGENTS_PER_RUN = 1000

export class WorkflowAgentCapError extends Error {
  constructor(cap: number) {
    super(`Workflow exceeded the ${cap}-agent lifetime cap (runaway loop?).`)
    this.name = 'WorkflowAgentCapError'
  }
}

export type RunOneAgent = (
  prompt: string,
  opts: AgentCallOptions,
  meta: { agentNumber: number; phase: string | null; label: string },
) => Promise<AgentRunResult>

export type RunNestedWorkflow = (
  nameOrRef: string | { scriptPath: string },
  args: unknown,
) => Promise<unknown>

export type WorkflowRuntimeConfig = {
  limiter: Limiter
  budget: Budget
  progress: ProgressSink
  args: unknown
  runOneAgent: RunOneAgent
  journal?: Journal
  runNestedWorkflow?: RunNestedWorkflow
  shouldSkipAgent?: (
    agentNumber: number,
    meta: { phase: string | null; label: string },
  ) => boolean
  getAgentControl?: (
    agentNumber: number,
    meta: { phase: string | null; label: string },
  ) => WorkflowAgentControlAction | null
  maxAgents?: number
}

export type WorkflowRuntime = {
  /** The object spread into the sandbox as injected globals. */
  scope: Record<string, unknown>
  /** Total agent() calls issued so far. */
  agentCount(): number
}

/** Derive a short display label from a prompt when none was supplied. */
export function deriveLabel(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  const trimmed = firstLine.slice(0, 48)
  return trimmed.length < firstLine.length ? `${trimmed}…` : trimmed || 'agent'
}

export function createWorkflowRuntime(
  config: WorkflowRuntimeConfig,
): WorkflowRuntime {
  const {
    limiter,
    budget,
    progress,
    args,
    runOneAgent,
    journal,
    runNestedWorkflow,
    shouldSkipAgent,
    getAgentControl,
    maxAgents = MAX_AGENTS_PER_RUN,
  } = config

  let currentPhase: string | null = null
  let agentCounter = 0
  let callIndex = 0

  async function agent(
    prompt: string,
    opts: AgentCallOptions = {},
  ): Promise<unknown> {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new TypeError('agent(prompt) requires a non-empty string prompt.')
    }
    assertBudget(budget)
    if (agentCounter >= maxAgents) {
      throw new WorkflowAgentCapError(maxAgents)
    }

    const index = callIndex++
    const phase = opts.phase ?? currentPhase
    const label = opts.label ?? deriveLabel(prompt)
    const hash = hashCall(prompt, opts)
    if (opts.isolation === 'remote') {
      throw new Error("agent({isolation:'remote'}) is not available in this build")
    }

    const startedHit = journal?.startedHit(index, hash)

    // Resume: replay a cached result if this call matches the prior run.
    const cached = journal?.lookup(index, hash)
    if (cached) {
      agentCounter++
      progress({ kind: 'agent_start', label, phase, agentNumber: agentCounter })
      progress({
        kind: 'agent_end',
        label,
        phase,
        agentNumber: agentCounter,
        ok: cached.ok,
        tokens: cached.tokens,
      })
      return cached.ok ? cached.value : null
    }

    agentCounter++
    const agentNumber = agentCounter
    if (startedHit) {
      progress({
        kind: 'log',
        message: `workflow journal started hit respawn: agent #${startedHit.agentNumber} ${startedHit.label}`,
      })
    }
    for (;;) {
      journal?.start(index, hash, { label, phase, agentNumber, opts })
      progress({ kind: 'agent_start', label, phase, agentNumber })

      let result: AgentRunResult
      let skipped = false
      try {
        result = await limiter.run(() => {
          const control =
            getAgentControl?.(agentNumber, { phase, label }) ??
            (shouldSkipAgent?.(agentNumber, { phase, label }) ? 'skip' : null)
          if (control === 'skip') {
            skipped = true
            return Promise.resolve({
              value: null,
              tokens: 0,
              ok: false,
              status: 'skipped' as const,
            })
          }
          // A queued retry request means "run it now"; a running retry request
          // is handled by the per-agent abort controller in agentRunner.
          return runOneAgent(prompt, opts, { agentNumber, phase, label })
        })
      } catch (err) {
        progress({
          kind: 'agent_end',
          label,
          phase,
          agentNumber,
          ok: false,
          tokens: 0,
        })
        throw err
      }

      if (result.status === 'retry_requested') {
        progress({
          kind: 'log',
          message: `retrying agent #${agentNumber}: ${label}`,
        })
        continue
      }

      budget.add(result.tokens)
      journal?.record(index, hash, result)
      const status =
        result.status ?? (skipped ? 'skipped' : result.ok ? 'completed' : 'failed')
      progress({
        kind: 'agent_end',
        label,
        phase,
        agentNumber,
        ok: result.ok,
        status,
        tokens: result.tokens,
      })
      return result.ok ? result.value : null
    }
  }

  function phase(title: string): void {
    if (typeof title !== 'string' || !title.trim()) {
      throw new TypeError('phase(title) requires a non-empty string.')
    }
    currentPhase = title
    progress({ kind: 'phase', title })
  }

  function log(message: string): void {
    progress({ kind: 'log', message: String(message) })
  }

  async function workflow(
    nameOrRef: string | { scriptPath: string },
    nestedArgs?: unknown,
  ): Promise<unknown> {
    if (!runNestedWorkflow) {
      throw new Error(
        'Nested workflow() is not available in this context (one level of nesting only).',
      )
    }
    return runNestedWorkflow(nameOrRef, nestedArgs)
  }

  return {
    scope: {
      agent,
      parallel: parallelPrim,
      pipeline: pipelinePrim,
      phase,
      log,
      workflow,
      args,
      budget,
    },
    agentCount: () => agentCounter,
  }
}
