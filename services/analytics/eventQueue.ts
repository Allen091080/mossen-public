/**
 * Generic in-memory event queue with batch flush triggers.
 *
 * Replaces the queueing/batching responsibilities of OpenTelemetry's
 * `BatchLogRecordProcessor` for the 1P analytics pipeline. Holds events
 * in memory until either:
 *   - `maxBatchSize` events accumulate, OR
 *   - `scheduledDelayMillis` elapses since the queue became non-empty
 *
 * The flush handler is responsible for actually sending or persisting the
 * batch — this class only manages the queue, timing, and back-pressure.
 *
 * Pure addition for OTel removal Y-1; wired up by Y-3/Y-4.
 */
export class EventQueue<T> {
  private buffer: T[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private isShutdownFlag = false
  private inFlight: Promise<void> | null = null
  private readonly maxQueueSize: number
  private readonly maxBatchSize: number
  private readonly scheduledDelayMillis: number
  private readonly flushHandler: (batch: T[]) => Promise<void>
  private readonly onError?: (err: unknown) => void

  constructor(opts: {
    maxQueueSize: number
    maxBatchSize: number
    scheduledDelayMillis: number
    flushHandler: (batch: T[]) => Promise<void>
    onError?: (err: unknown) => void
  }) {
    this.maxQueueSize = opts.maxQueueSize
    this.maxBatchSize = opts.maxBatchSize
    this.scheduledDelayMillis = opts.scheduledDelayMillis
    this.flushHandler = opts.flushHandler
    this.onError = opts.onError
  }

  /**
   * Enqueue one event. Drops the event when the queue is shut down or full.
   * Triggers an immediate flush when the buffer reaches `maxBatchSize`.
   * Otherwise schedules a deferred flush after `scheduledDelayMillis`.
   */
  enqueue(event: T): void {
    if (this.isShutdownFlag) return
    if (this.buffer.length >= this.maxQueueSize) return

    this.buffer.push(event)

    if (this.buffer.length >= this.maxBatchSize) {
      this.cancelTimer()
      void this.flushNow()
      return
    }

    this.scheduleTimer()
  }

  /**
   * Drain the buffer immediately. Awaitable so callers can ensure the
   * current batch is handed off to the flush handler before exit.
   */
  async forceFlush(): Promise<void> {
    this.cancelTimer()
    if (this.inFlight) {
      try {
        await this.inFlight
      } catch {
        // Errors propagated through onError already.
      }
    }
    if (this.buffer.length === 0) return
    await this.flushNow()
  }

  /**
   * Stop accepting new events, drain any remaining buffer, and wait for
   * in-flight flushes. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this.isShutdownFlag) {
      if (this.inFlight) {
        try {
          await this.inFlight
        } catch {
          // ignore
        }
      }
      return
    }
    this.isShutdownFlag = true
    await this.forceFlush()
  }

  isShutdown(): boolean {
    return this.isShutdownFlag
  }

  size(): number {
    return this.buffer.length
  }

  private scheduleTimer(): void {
    if (this.timer || this.scheduledDelayMillis <= 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flushNow()
    }, this.scheduledDelayMillis)
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      ;(this.timer as { unref: () => void }).unref()
    }
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async flushNow(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer.splice(0, this.buffer.length)
    const promise = (async () => {
      try {
        await this.flushHandler(batch)
      } catch (err) {
        if (this.onError) {
          this.onError(err)
        }
      }
    })()
    this.inFlight = promise
    try {
      await promise
    } finally {
      if (this.inFlight === promise) {
        this.inFlight = null
      }
    }
  }
}
