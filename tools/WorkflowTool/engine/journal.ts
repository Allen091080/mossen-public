/**
 * Resume journal for the workflow engine.
 *
 * A workflow is deterministic by construction (no Date.now / Math.random), so a
 * re-run with the same script + args issues the same sequence of agent() calls.
 * The journal records each completed agent() call by its sequential index plus
 * a hash of (prompt, opts). On resume, a call whose index + hash match a
 * recorded entry returns the cached result instantly; the first changed/new
 * call and everything after it runs live.
 *
 * The journal is a plain serializable object so the WorkflowTool can persist it
 * alongside the session and reload it to resume.
 */

import type { AgentCallOptions, AgentRunResult } from './types.js'

export type JournalStartedEntry = {
  kind: 'started'
  index: number
  hash: string
  label: string
  phase: string | null
  agentNumber: number
  opts: AgentCallOptions
}

export type JournalEntry = {
  index: number
  hash: string
  value: unknown
  tokens: number
  toolCalls?: number
  ok: boolean
  status?: AgentRunResult['status']
}

export type JournalData = {
  runId: string
  entries: JournalEntry[]
  started?: JournalStartedEntry[]
}

/** Stable-ish hash of a string (FNV-1a, 32-bit, hex). */
export function hashCall(prompt: string, opts: unknown): string {
  const input = `${prompt}\u0000${stableStringify(opts)}`
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** JSON.stringify with sorted keys so opts hash is order-independent. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const walk = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      if (seen.has(v as object)) return null
      seen.add(v as object)
      if (Array.isArray(v)) return v.map(walk)
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k])
      }
      return out
    }
    return v
  }
  try {
    return JSON.stringify(walk(value)) ?? 'null'
  } catch {
    return 'null'
  }
}

export type Journal = {
  /** Look up a cached result for the next call if it matches; else null. */
  lookup(index: number, hash: string): AgentRunResult | null
  /** Record that a live agent has started, before its result is available. */
  start(
    index: number,
    hash: string,
    entry: Omit<JournalStartedEntry, 'kind' | 'index' | 'hash'>,
  ): void
  /** Find a prior started-but-not-completed call that should be respawned. */
  startedHit(index: number, hash: string): JournalStartedEntry | null
  /** Record a completed call's result at its index. */
  record(index: number, hash: string, result: AgentRunResult): void
  /** Serialize for persistence. */
  toData(): JournalData
  /** Number of cached entries replayed so far this run. */
  hits(): number
  /** Number of prior started-only entries observed so far this run. */
  startedHits(): number
}

/**
 * Create a journal. Pass `prior` (loaded from disk) to replay a previous run;
 * omit it for a fresh run.
 *
 * The cache is only valid as a contiguous prefix: once a call's hash diverges
 * from the prior run, that entry and all later ones are invalidated, matching
 * "longest unchanged prefix" resume semantics.
 */
export function createJournal(
  runId: string,
  prior?: JournalData | null,
  onRecord?: (entry: JournalEntry) => void,
  onStart?: (entry: JournalStartedEntry) => void,
): Journal {
  const priorEntries = prior?.entries ?? []
  const priorStarted = prior?.started ?? []
  const completedKeys = new Set(priorEntries.map(e => `${e.index}\0${e.hash}`))
  const recorded: JournalEntry[] = []
  const started: JournalStartedEntry[] = []
  let invalidatedFrom = Infinity
  let hits = 0
  let startedHits = 0

  return {
    lookup(index, hash) {
      if (index >= invalidatedFrom) return null
      const entry = priorEntries.find(e => e.index === index)
      if (!entry || entry.hash !== hash) {
        // Divergence: invalidate this and every later cached entry.
        invalidatedFrom = Math.min(invalidatedFrom, index)
        return null
      }
      hits++
      return {
        value: entry.value,
        tokens: entry.tokens,
        ...(typeof entry.toolCalls === 'number'
          ? { toolCalls: entry.toolCalls }
          : {}),
        ok: entry.ok,
        ...(entry.status ? { status: entry.status } : {}),
      }
    },
    start(index, hash, entry) {
      const startedEntry: JournalStartedEntry = {
        kind: 'started',
        index,
        hash,
        ...entry,
      }
      started.push(startedEntry)
      onStart?.(startedEntry)
    },
    startedHit(index, hash) {
      if (index >= invalidatedFrom) return null
      const key = `${index}\0${hash}`
      if (completedKeys.has(key)) return null
      const entry = priorStarted.find(e => e.index === index && e.hash === hash)
      if (!entry) return null
      startedHits++
      return entry
    },
    record(index, hash, result) {
      const entry: JournalEntry = {
        index,
        hash,
        value: result.value,
        tokens: result.tokens,
        ...(typeof result.toolCalls === 'number'
          ? { toolCalls: result.toolCalls }
          : {}),
        ok: result.ok,
        ...(result.status ? { status: result.status } : {}),
      }
      recorded.push(entry)
      // Optional sink (e.g. append to disk) so resume survives across separate
      // tool invocations. Kept injected so the core stays filesystem-free.
      onRecord?.(entry)
    },
    toData() {
      return { runId, entries: recorded.slice(), started: started.slice() }
    },
    hits: () => hits,
    startedHits: () => startedHits,
  }
}
