/**
 * Quadratic-backoff retry scheduler with cancellation.
 *
 * Replaces the inline backoff logic in `FirstPartyEventLoggingExporter`
 * (`scheduleBackoffRetry` + `cancelBackoff`). Caller decides what to retry;
 * this class only computes the delay and owns the timer.
 *
 * The optional `schedule` injection lets tests substitute a deterministic
 * timer (matches the existing exporter's pattern).
 *
 * Pure addition for OTel removal Y-1; wired up by Y-2 (new exporter).
 */
export class RetryScheduler {
  private cancelFn: (() => void) | null = null
  private readonly baseBackoffDelayMs: number
  private readonly maxBackoffDelayMs: number
  private readonly schedule: (
    fn: () => Promise<void>,
    delayMs: number,
  ) => () => void

  constructor(opts: {
    baseBackoffDelayMs: number
    maxBackoffDelayMs: number
    schedule?: (fn: () => Promise<void>, delayMs: number) => () => void
  }) {
    this.baseBackoffDelayMs = opts.baseBackoffDelayMs
    this.maxBackoffDelayMs = opts.maxBackoffDelayMs
    this.schedule = opts.schedule || defaultSchedule
  }

  /**
   * Quadratic backoff: base * attempt^2, capped at max.
   * attemptNum is 1-based; delays follow base, 4*base, 9*base, ...
   */
  computeDelay(attemptNum: number): number {
    const raw = this.baseBackoffDelayMs * attemptNum * attemptNum
    return Math.min(raw, this.maxBackoffDelayMs)
  }

  /**
   * Schedule `fn` to run after backoff. Cancels any prior pending retry.
   * Only one retry is in flight at a time — callers retry the latest queue
   * state, not stale work.
   */
  scheduleRetry(fn: () => Promise<void>, attemptNum: number): void {
    this.cancel()
    const delayMs = this.computeDelay(attemptNum)
    this.cancelFn = this.schedule(fn, delayMs)
  }

  /** Cancel any pending retry. Idempotent. */
  cancel(): void {
    if (this.cancelFn) {
      this.cancelFn()
      this.cancelFn = null
    }
  }

  hasPendingRetry(): boolean {
    return this.cancelFn !== null
  }
}

function defaultSchedule(
  fn: () => Promise<void>,
  delayMs: number,
): () => void {
  const timer = setTimeout(() => {
    void fn()
  }, delayMs)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    ;(timer as { unref: () => void }).unref()
  }
  return () => clearTimeout(timer)
}
