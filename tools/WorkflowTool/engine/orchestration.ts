/**
 * Orchestration primitives for the workflow engine: parallel() and pipeline().
 *
 * These provide STRUCTURAL concurrency only — they decide *what runs together*,
 * not *how many subagents run at once*. The actual concurrency cap lives at the
 * agent() boundary in the runtime, so every fan-out path (parallel, pipeline,
 * or a bare Promise.all of agent() calls) is capped uniformly and there is no
 * risk of double-limiting / deadlock.
 *
 * Semantics mirror the public Workflow contract:
 *
 *  - parallel(thunks): BARRIER. Awaits all thunks. A thunk that throws resolves
 *    to `null` in the result array — the call itself never rejects. Callers
 *    `.filter(Boolean)` before using results.
 *
 *  - pipeline(items, ...stages): NO BARRIER. Each item flows through every stage
 *    independently; item A can be in stage 3 while item B is still in stage 1.
 *    A stage that throws drops that item to `null` and skips its remaining
 *    stages. Each stage callback receives (prevResult, originalItem, index).
 */

export type Thunk<T> = () => Promise<T>

/**
 * Run all thunks concurrently and return their results in input order.
 * Failures become `null`; the returned promise never rejects.
 */
export async function parallel<T>(
  thunks: Array<Thunk<T>>,
): Promise<Array<T | null>> {
  if (!Array.isArray(thunks)) {
    throw new TypeError('parallel() expects an array of functions')
  }
  if (thunks.length === 0) return []
  for (const thunk of thunks) {
    if (typeof thunk !== 'function') {
      throw new TypeError(
        'parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)',
      )
    }
  }
  const settled = await Promise.all(
    thunks.map(thunk =>
      Promise.resolve()
        .then(thunk)
        .then(
          value => ({ ok: true as const, value }),
          () => ({ ok: false as const, value: null }),
        ),
    ),
  )
  return settled.map(s => (s.ok ? s.value : null))
}

export type Stage<In, Out> = (
  prev: In,
  originalItem: unknown,
  index: number,
) => Promise<Out>

/**
 * Stream each item through all stages independently with no barrier between
 * stages. Wall-clock equals the slowest single-item chain, not the sum of
 * per-stage maxima. A stage throwing drops that item to `null`.
 */
export async function pipeline(
  items: unknown[],
  ...stages: Array<Stage<unknown, unknown>>
): Promise<Array<unknown | null>> {
  if (!Array.isArray(items)) {
    throw new TypeError('pipeline() expects an array as the first argument')
  }
  if (items.length === 0) return []
  for (const stage of stages) {
    if (typeof stage !== 'function') {
      throw new TypeError(
        'pipeline() stages must be functions: pipeline(items, item => ..., result => ...)',
      )
    }
  }
  const runItem = async (
    item: unknown,
    index: number,
  ): Promise<unknown | null> => {
    let value: unknown = item
    for (const stage of stages) {
      if (value === null) break
      try {
        value = await stage(value, item, index)
      } catch {
        return null
      }
    }
    return value
  }
  return Promise.all(items.map((item, index) => runItem(item, index)))
}
