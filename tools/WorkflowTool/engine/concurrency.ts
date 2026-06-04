/**
 * Concurrency limiter for the workflow engine.
 *
 * The engine runs many agent() calls fanned out via parallel()/pipeline().
 * To avoid spawning an unbounded number of subagents at once we cap the number
 * of concurrently-running thunks. Excess calls queue and run as slots free up.
 *
 * The cap mirrors the public Workflow contract: min(16, cpu cores - 2), with a
 * floor of 1 so single-core / constrained environments still make progress.
 */

import { cpus } from 'os'

/** Compute the default concurrency cap for this machine. */
export function defaultConcurrency(): number {
  let cores = 4
  try {
    cores = cpus().length
  } catch {
    // os.cpus() can throw in unusual sandboxes; fall back to a safe default.
    cores = 4
  }
  return Math.max(1, Math.min(16, cores - 2))
}

export type Limiter = {
  /** Run `thunk` as soon as a concurrency slot is free; resolve with its result. */
  run<T>(thunk: () => Promise<T>): Promise<T>
  /** Number of thunks currently executing. */
  active(): number
  /** Number of thunks waiting for a slot. */
  pending(): number
  /** The configured maximum concurrency. */
  readonly max: number
}

/**
 * Create a concurrency limiter that runs at most `max` thunks simultaneously.
 *
 * Ordering: queued thunks start in FIFO order as slots free. A thunk that
 * throws still releases its slot (the rejection propagates to its own caller).
 */
export function createLimiter(max: number = defaultConcurrency()): Limiter {
  const cap = Math.max(1, Math.floor(max))
  let active = 0
  const queue: Array<() => void> = []

  const release = () => {
    active--
    const next = queue.shift()
    if (next) next()
  }

  function run<T>(thunk: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++
        // Defend against synchronous throws inside the thunk by routing through
        // Promise.resolve().then so `release` always runs exactly once.
        Promise.resolve()
          .then(thunk)
          .then(
            value => {
              release()
              resolve(value)
            },
            err => {
              release()
              reject(err)
            },
          )
      }
      if (active < cap) {
        start()
      } else {
        queue.push(start)
      }
    })
  }

  return {
    run,
    active: () => active,
    pending: () => queue.length,
    max: cap,
  }
}
