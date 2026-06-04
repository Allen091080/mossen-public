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
 *  - progress events (phase / log / agent_queued / agent_start / agent_end)
 */

import { assertBudget, type Budget } from './budget.js'
import type { Limiter } from './concurrency.js'
import { hashCall, type Journal } from './journal.js'
import {
  parallel as parallelPrim,
  pipeline as pipelinePrim,
  type Stage,
  type Thunk,
} from './orchestration.js'
import type {
  AgentCallOptions,
  WorkflowAgentControlAction,
  AgentRunResult,
  ProgressSink,
  WorkflowPhaseInput,
  WorkflowPhaseMeta,
} from './types.js'

/** Lifetime cap on agent() calls — a backstop far above any real workflow. */
export const MAX_AGENTS_PER_RUN = 1000
export const DEFAULT_WORKFLOW_AGENT_MAX_ATTEMPTS = 3

export class WorkflowAgentCapError extends Error {
  constructor(cap: number) {
    super(
      `Workflow agent() call cap reached (${cap}). This usually means a loop using budget.remaining() never terminates because no token budget was set — remaining() returns Infinity when budget.total is null. Add a hard iteration cap to the loop, or pass a token budget.`,
    )
    this.name = 'WorkflowAgentCapError'
  }
}

type RetryableAgentStatus = 'retry_requested' | 'stalled'

function retryableStatusReason(status: RetryableAgentStatus): string {
  return status === 'stalled'
    ? 'stalled (no progress)'
    : 'retry requested by user'
}

export function formatWorkflowAgentStallRetryLog(params: {
  label: string
  stallTimeoutMs: number
  attempt: number
  maxAttempts: number
}): string {
  const seconds = Math.max(0, Math.round(params.stallTimeoutMs / 1000))
  const suffix =
    params.attempt + 1 >= params.maxAttempts ? ' on the last attempt' : ''
  return `[stall] agent "${params.label}" after ${seconds}s — retrying (${params.attempt}/${params.maxAttempts})${suffix}`
}

export function formatWorkflowAgentAbandonedMessage(params: {
  attempts: readonly RetryableAgentStatus[]
  maxAttempts: number
  stallTimeoutMs?: number
}): string {
  if (params.attempts.every(status => status === 'retry_requested')) {
    return `agent abandoned: user requested retry on all ${params.maxAttempts} attempts`
  }
  if (params.attempts.every(status => status === 'stalled')) {
    return `agent stalled on all ${params.maxAttempts} attempts (no progress for ${params.stallTimeoutMs ?? 0}ms each)`
  }
  const lastStatus = params.attempts.at(-1) ?? 'retry_requested'
  return `agent abandoned after ${params.maxAttempts} attempts (${retryableStatusReason(lastStatus)})`
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
  phases?: WorkflowPhaseMeta[]
  defaultModel?: string
  signal?: AbortSignal
  journal?: Journal
  runNestedWorkflow?: RunNestedWorkflow
  forcedPhase?: string
  ignorePhaseChanges?: boolean
  logPrefix?: string
  shouldSkipAgent?: (
    agentNumber: number,
    meta: { phase: string | null; label: string },
  ) => boolean
  getAgentControl?: (
    agentNumber: number,
    meta: { phase: string | null; label: string },
  ) => WorkflowAgentControlAction | null
  waitForResume?: (
    agentNumber: number,
    meta: { phase: string | null; label: string },
  ) => Promise<void>
  maxAgents?: number
  maxAgentAttempts?: number
}

export type WorkflowRuntime = {
  /** The object spread into the sandbox as injected globals. */
  scope: Record<string, unknown>
  /** Total agent() calls issued so far. */
  agentCount(): number
  /** Total tool calls made by live agent runs. */
  toolCallCount(): number
  /** Non-fatal branch failures captured by parallel/pipeline/nested workflows. */
  failures(): string[]
  recordFailure(message: string): void
}

type WorkflowTimers = {
  wait(ms: number): Promise<void>
  sleep(ms: number): Promise<void>
  setTimeout<T = void>(ms: number, value?: T): Promise<T>
}

export type ResolvedWorkflowPhase = {
  title: string
  detail?: string
  model?: string
}

/** Derive a short display label from a prompt when none was supplied. */
export function deriveLabel(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  const trimmed = firstLine.slice(0, 48)
  return trimmed.length < firstLine.length ? `${trimmed}…` : trimmed || 'agent'
}

export function resolvePhase(
  input: WorkflowPhaseInput,
  phases: readonly WorkflowPhaseMeta[] = [],
): ResolvedWorkflowPhase {
  const fromMeta = (title: string) =>
    phases.find(phase => phase.title.trim() === title)

  if (typeof input === 'string') {
    const title = input.trim()
    if (!title) {
      throw new TypeError('phase(title) requires a non-empty string or phase object.')
    }
    return { ...fromMeta(title), title }
  }

  if (typeof input !== 'object' || input == null) {
    throw new TypeError('phase(title) requires a non-empty string or phase object.')
  }

  if (typeof input.title !== 'string') {
    throw new TypeError('phase(title) requires a non-empty string or phase object.')
  }
  const title = input.title.trim()
  if (!title) {
    throw new TypeError('phase(title) requires a non-empty string or phase object.')
  }
  return { ...fromMeta(title), ...input, title }
}

function coerceTimerDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError('timers.wait(ms) requires a non-negative finite delay.')
  }
  return ms
}

function createWorkflowTimers(signal?: AbortSignal): WorkflowTimers {
  const delay = <T>(ms: number, value?: T): Promise<T> => {
    const delayMs = coerceTimerDelay(ms)
    if (signal?.aborted) {
      return Promise.reject(new Error('Workflow aborted.'))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve(value as T)
      }, delayMs)
      const abort = () => {
        clearTimeout(timer)
        cleanup()
        reject(new Error('Workflow aborted.'))
      }
      const cleanup = () => signal?.removeEventListener('abort', abort)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
  return Object.freeze({
    wait: (ms: number) => delay<void>(ms),
    sleep: (ms: number) => delay<void>(ms),
    setTimeout: delay,
  })
}

function formatLogPart(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

function formatFailureReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
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
    phases = [],
    defaultModel,
    signal,
    journal,
    runNestedWorkflow,
    forcedPhase,
    ignorePhaseChanges = false,
    logPrefix = '',
    shouldSkipAgent,
    getAgentControl,
    waitForResume,
    maxAgents = MAX_AGENTS_PER_RUN,
    maxAgentAttempts = DEFAULT_WORKFLOW_AGENT_MAX_ATTEMPTS,
  } = config

  let currentPhase: ResolvedWorkflowPhase | null = null
  let agentCounter = 0
  let toolCallCounter = 0
  let callIndex = 0
  const retryAttemptLimit = Math.max(1, Math.floor(maxAgentAttempts))
  const failures: string[] = []

  function recordFailure(message: string): void {
    failures.push(message)
  }

  function logFailure(message: string): void {
    recordFailure(message)
    progress({ kind: 'log', message })
  }

  async function parallel<T>(
    thunks: Array<Thunk<T>>,
  ): Promise<Array<T | null>> {
    return parallelPrim(
      thunks.map((thunk, index) => async () => {
        try {
          return await thunk()
        } catch (err) {
          logFailure(`parallel[${index}] failed: ${formatFailureReason(err)}`)
          throw err
        }
      }),
    )
  }

  async function pipeline(
    items: unknown[],
    ...stages: Array<Stage<unknown, unknown>>
  ): Promise<Array<unknown | null>> {
    return pipelinePrim(
      items,
      ...stages.map(stage => async (prev, originalItem, index) => {
        try {
          return await stage(prev, originalItem, index)
        } catch (err) {
          logFailure(`pipeline[${index}] failed: ${formatFailureReason(err)}`)
          throw err
        }
      }),
    )
  }

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
    const phaseInfo =
      forcedPhase !== undefined
        ? { title: forcedPhase }
        : opts.phase !== undefined
          ? resolvePhase(opts.phase, phases)
          : currentPhase
    const phase = phaseInfo?.title ?? null
    const label = opts.label ?? deriveLabel(prompt)
    const effectiveModel = opts.model ?? phaseInfo?.model ?? defaultModel
    const effectiveOpts: AgentCallOptions = {
      ...opts,
      ...(forcedPhase !== undefined && phase !== null
        ? { phase }
        : opts.phase !== undefined && phase !== null
          ? { phase }
          : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
    }
    const hash = hashCall(prompt, effectiveOpts)

    const startedHit = journal?.startedHit(index, hash)

    // Resume: replay a cached result if this call matches the prior run.
    const cached = journal?.lookup(index, hash)
    if (cached) {
      agentCounter++
      const agentNumber = agentCounter
      progress({
        kind: 'agent_end',
        label,
        phase,
        agentNumber,
        ok: cached.ok,
        status: cached.ok ? 'cached' : 'failed',
        tokens: cached.tokens,
        toolCalls: 0,
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
    const retryableAttempts: RetryableAgentStatus[] = []
    for (;;) {
      journal?.start(index, hash, {
        label,
        phase,
        agentNumber,
        opts: effectiveOpts,
      })
      progress({ kind: 'agent_queued', label, phase, agentNumber })

      let result: AgentRunResult
      let skipped = false
      try {
        await waitForResume?.(agentNumber, { phase, label })
        result = await limiter.run(async () => {
          await waitForResume?.(agentNumber, { phase, label })
          const control =
            getAgentControl?.(agentNumber, { phase, label }) ??
            (shouldSkipAgent?.(agentNumber, { phase, label }) ? 'skip' : null)
          if (control === 'skip') {
            skipped = true
            return Promise.resolve({
              value: null,
              tokens: 0,
              toolCalls: 0,
              ok: false,
              status: 'skipped' as const,
            })
          }
          progress({ kind: 'agent_start', label, phase, agentNumber })
          // A queued retry request means "run it now"; a running retry request
          // is handled by the per-agent abort controller in agentRunner.
          return runOneAgent(prompt, effectiveOpts, { agentNumber, phase, label })
        })
      } catch (err) {
        progress({
          kind: 'agent_end',
          label,
          phase,
          agentNumber,
          ok: false,
          tokens: 0,
          toolCalls: 0,
        })
        throw err
      }

      if (
        result.status === 'retry_requested' ||
        result.status === 'stalled'
      ) {
        retryableAttempts.push(result.status)
        if (retryableAttempts.length >= retryAttemptLimit) {
          progress({
            kind: 'agent_end',
            label,
            phase,
            agentNumber,
            ok: false,
            status: 'failed',
            tokens: result.tokens,
            toolCalls: result.toolCalls ?? 0,
          })
          throw new Error(
            formatWorkflowAgentAbandonedMessage({
              attempts: retryableAttempts,
              maxAttempts: retryAttemptLimit,
              stallTimeoutMs: result.stallTimeoutMs,
            }),
          )
        }
        progress({
          kind: 'log',
          message:
            result.status === 'stalled'
              ? formatWorkflowAgentStallRetryLog({
                  label,
                  stallTimeoutMs: result.stallTimeoutMs ?? 0,
                  attempt: retryableAttempts.length,
                  maxAttempts: retryAttemptLimit,
                })
              : `retrying agent #${agentNumber}: ${label}`,
        })
        continue
      }

      budget.add(result.tokens)
      toolCallCounter += result.toolCalls ?? 0
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
        toolCalls: result.toolCalls ?? 0,
      })
      return result.ok ? result.value : null
    }
  }

  function phase(title: WorkflowPhaseInput): void {
    if (ignorePhaseChanges) return
    const resolved = resolvePhase(title, phases)
    currentPhase = resolved
    progress({ kind: 'phase', title: resolved.title })
  }

  function log(message: unknown): void {
    progress({ kind: 'log', message: `${logPrefix}${String(message)}` })
  }

  const console = Object.freeze({
    log: (...values: unknown[]) => log(values.map(formatLogPart).join(' ')),
    info: (...values: unknown[]) => log(values.map(formatLogPart).join(' ')),
    debug: (...values: unknown[]) => log(values.map(formatLogPart).join(' ')),
    warn: (...values: unknown[]) =>
      log(`[warn] ${values.map(formatLogPart).join(' ')}`),
    error: (...values: unknown[]) =>
      log(`[error] ${values.map(formatLogPart).join(' ')}`),
  })

  async function workflow(
    nameOrRef: string | { scriptPath: string },
    nestedArgs?: unknown,
  ): Promise<unknown> {
    if (!runNestedWorkflow) {
      throw new Error(
        'workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.',
      )
    }
    return runNestedWorkflow(nameOrRef, nestedArgs)
  }

  return {
    scope: {
      agent,
      parallel,
      pipeline,
      phase,
      log,
      workflow,
      timers: createWorkflowTimers(signal),
      console,
      args,
      budget,
    },
    agentCount: () => agentCounter,
    toolCallCount: () => toolCallCounter,
    failures: () => [...failures],
    recordFailure,
  }
}
