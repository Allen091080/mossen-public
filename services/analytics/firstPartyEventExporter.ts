import axios from 'axios'
import { randomUUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import {
  getHostedOAuthTokens,
  hasProfileScope,
  isHostedSubscriber,
} from '../../utils/auth.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { getHostedPlatformUrls } from '../../utils/customBackend.js'
import { logForDebugging } from '../../utils/debug.js'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage, toError } from '../../utils/errors.js'
import { getAuthHeaders } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { getUserType } from '../../utils/userType.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getMossenUserAgent } from '../../utils/userAgent.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { isOAuthTokenExpired } from '../oauth/client.js'
import { EventQueue } from './eventQueue.js'
import { EventStorage } from './eventStorage.js'
import { RetryScheduler } from './retryScheduler.js'

/**
 * 1P event logging without OpenTelemetry.
 *
 * Replacement for `FirstPartyEventLoggingExporter` (which implements OTel
 * `LogRecordExporter`). This class composes the Y-1 helper classes
 * (EventQueue / EventStorage / RetryScheduler) and keeps the existing network
 * logic (auth, killswitch, 401 fallback, batching, error context, previous-
 * batch retry).
 *
 * Input is `FirstPartyEventLoggingEvent` (already transformed). The transform
 * from OTel-shaped attributes to events lives in firstPartyEventLogger.ts and
 * will be inlined into the enqueue path in Y-4.
 *
 * Pure addition for OTel removal Y-2; wired up by Y-3/Y-4.
 */

export const EXPERIMENT_ASSIGNMENT_WIRE_EVENT_TYPE =
  `${'Growth'}bookExperimentEvent` as const

export type FirstPartyEventLoggingEvent = {
  event_type:
    | 'MossenCodeInternalEvent'
    | typeof EXPERIMENT_ASSIGNMENT_WIRE_EVENT_TYPE
  event_data: unknown
}

type FirstPartyEventLoggingPayload = {
  events: FirstPartyEventLoggingEvent[]
}

const FILE_PREFIX = '1p_failed_events.'

function getStorageDir(): string {
  return `${getMossenConfigHomeDir()}/telemetry`
}

export class FirstPartyEventExporter {
  // Per-process unique id; used to namespace failed-event files so concurrent
  // mossen processes don't stomp on each other's batches.
  private readonly batchUuid = randomUUID()
  private readonly endpoint: string
  private readonly timeout: number
  private readonly maxBatchSize: number
  private readonly skipAuth: boolean
  private readonly batchDelayMs: number
  private readonly maxAttempts: number
  private readonly isKilled: () => boolean
  private readonly queue: EventQueue<FirstPartyEventLoggingEvent>
  private readonly storage: EventStorage<FirstPartyEventLoggingEvent>
  private readonly retryScheduler: RetryScheduler
  private attempts = 0
  private isRetrying = false
  private isShutdownFlag = false
  private lastExportErrorContext: string | undefined

  constructor(
    options: {
      timeout?: number
      maxBatchSize?: number
      maxQueueSize?: number
      scheduledDelayMillis?: number
      skipAuth?: boolean
      batchDelayMs?: number
      baseBackoffDelayMs?: number
      maxBackoffDelayMs?: number
      maxAttempts?: number
      path?: string
      baseUrl?: string
      isKilled?: () => boolean
      schedule?: (fn: () => Promise<void>, delayMs: number) => () => void
    } = {},
  ) {
    const baseUrl = options.baseUrl || getHostedPlatformUrls().remoteBaseUrl
    this.endpoint = `${baseUrl}${options.path || '/api/event_logging/batch'}`
    this.timeout = options.timeout || 10000
    this.maxBatchSize = options.maxBatchSize || 200
    this.skipAuth = options.skipAuth ?? false
    this.batchDelayMs = options.batchDelayMs || 100
    this.maxAttempts = options.maxAttempts ?? 8
    this.isKilled = options.isKilled ?? (() => false)

    this.storage = new EventStorage<FirstPartyEventLoggingEvent>({
      storageDir: getStorageDir,
      filePrefix: FILE_PREFIX,
    })

    this.retryScheduler = new RetryScheduler({
      baseBackoffDelayMs: options.baseBackoffDelayMs || 500,
      maxBackoffDelayMs: options.maxBackoffDelayMs || 30000,
      schedule: options.schedule,
    })

    this.queue = new EventQueue<FirstPartyEventLoggingEvent>({
      maxQueueSize: options.maxQueueSize || 8192,
      maxBatchSize: this.maxBatchSize,
      scheduledDelayMillis: options.scheduledDelayMillis || 10000,
      flushHandler: batch => this.exportBatch(batch),
      onError: err => logError(err as Error),
    })

    // Retry any failed events from previous runs of this session (background)
    void this.retryPreviousBatches()
  }

  /** Add one transformed event to the in-memory queue. */
  enqueue(event: FirstPartyEventLoggingEvent): void {
    if (this.isShutdownFlag) return
    this.queue.enqueue(event)
  }

  /** Drain queue + wait for in-flight retry (testing/shutdown convenience). */
  async forceFlush(): Promise<void> {
    await this.queue.forceFlush()
  }

  async shutdown(): Promise<void> {
    if (this.isShutdownFlag) return
    this.isShutdownFlag = true
    this.retryScheduler.cancel()
    await this.queue.shutdown()
    if (getUserType() === 'internal') {
      logForDebugging('1P event exporter (new): shutdown complete')
    }
  }

  // Expose for testing
  async getQueuedEventCount(): Promise<number> {
    return (await this.storage.loadBatch(this.currentBatchKey())).length
  }

  // ------------------------------------------------------------------
  // Flush handler — called by EventQueue on batch full / timer fire
  // ------------------------------------------------------------------

  private currentBatchKey(): string {
    return `${getSessionId()}.${this.batchUuid}`
  }

  private async exportBatch(events: FirstPartyEventLoggingEvent[]): Promise<void> {
    if (this.isShutdownFlag || events.length === 0) return

    if (this.attempts >= this.maxAttempts) {
      logError(
        new Error(
          `1P event exporter: dropped ${events.length} events — max attempts (${this.maxAttempts}) reached`,
        ),
      )
      return
    }

    const failedEvents = await this.sendEventsInBatches(events)
    this.attempts++

    if (failedEvents.length > 0) {
      await this.queueFailedEvents(failedEvents)
      this.scheduleBackoffRetry()
      return
    }

    // Success — reset backoff, then drain any disk queue
    this.resetBackoff()
    if ((await this.getQueuedEventCount()) > 0 && !this.isRetrying) {
      void this.retryFailedEvents()
    }
  }

  // ------------------------------------------------------------------
  // Network + auth (lifted from FirstPartyEventLoggingExporter)
  // ------------------------------------------------------------------

  private async sendEventsInBatches(
    events: FirstPartyEventLoggingEvent[],
  ): Promise<FirstPartyEventLoggingEvent[]> {
    const batches: FirstPartyEventLoggingEvent[][] = []
    for (let i = 0; i < events.length; i += this.maxBatchSize) {
      batches.push(events.slice(i, i + this.maxBatchSize))
    }

    if (getUserType() === 'internal') {
      logForDebugging(
        `1P event exporter (new): exporting ${events.length} events in ${batches.length} batch(es)`,
      )
    }

    const failed: FirstPartyEventLoggingEvent[] = []
    let lastErrorContext: string | undefined
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!
      try {
        await this.sendBatchWithAuth({ events: batch })
      } catch (error) {
        lastErrorContext = getAxiosErrorContext(error)
        for (let j = i; j < batches.length; j++) failed.push(...batches[j]!)
        if (getUserType() === 'internal') {
          const skipped = batches.length - 1 - i
          logForDebugging(
            `1P event exporter (new): batch ${i + 1}/${batches.length} failed (${lastErrorContext}); short-circuiting ${skipped} remaining`,
          )
        }
        break
      }
      if (i < batches.length - 1 && this.batchDelayMs > 0) {
        await sleep(this.batchDelayMs)
      }
    }

    if (failed.length > 0 && lastErrorContext) {
      this.lastExportErrorContext = lastErrorContext
    }
    return failed
  }

  private async sendBatchWithAuth(
    payload: FirstPartyEventLoggingPayload,
  ): Promise<void> {
    if (this.isKilled()) {
      throw new Error('firstParty sink killswitch active')
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getMossenUserAgent(),
      'x-service-name': 'mossen-code',
    }

    const hasTrust =
      checkHasTrustDialogAccepted() || getIsNonInteractiveSession()
    let shouldSkipAuth = this.skipAuth || !hasTrust
    if (!shouldSkipAuth && isHostedSubscriber()) {
      const tokens = getHostedOAuthTokens()
      if (!hasProfileScope()) {
        shouldSkipAuth = true
      } else if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
        shouldSkipAuth = true
        if (getUserType() === 'internal') {
          logForDebugging(
            '1P event exporter (new): OAuth token expired, skipping auth',
          )
        }
      }
    }

    const authResult = shouldSkipAuth
      ? { headers: {}, error: 'trust not established or OAuth expired' }
      : getAuthHeaders()
    const useAuth = !authResult.error
    const headers = useAuth
      ? { ...baseHeaders, ...authResult.headers }
      : baseHeaders

    try {
      const response = await axios.post(this.endpoint, payload, {
        timeout: this.timeout,
        headers,
      })
      this.logSuccess(payload.events.length, useAuth, response.data)
      return
    } catch (error) {
      // 401 → retry without auth
      if (
        useAuth &&
        axios.isAxiosError(error) &&
        error.response?.status === 401
      ) {
        if (getUserType() === 'internal') {
          logForDebugging(
            '1P event exporter (new): 401 retry without auth',
          )
        }
        const response = await axios.post(this.endpoint, payload, {
          timeout: this.timeout,
          headers: baseHeaders,
        })
        this.logSuccess(payload.events.length, false, response.data)
        return
      }
      throw error
    }
  }

  private logSuccess(
    eventCount: number,
    withAuth: boolean,
    responseData: unknown,
  ): void {
    if (getUserType() === 'internal') {
      logForDebugging(
        `1P event exporter (new): ${eventCount} events sent${withAuth ? ' (auth)' : ' (no auth)'}`,
      )
      logForDebugging(`API Response: ${jsonStringify(responseData, null, 2)}`)
    }
  }

  // ------------------------------------------------------------------
  // Disk-backed retry (uses EventStorage + RetryScheduler from Y-1)
  // ------------------------------------------------------------------

  private async queueFailedEvents(
    events: FirstPartyEventLoggingEvent[],
  ): Promise<void> {
    await this.storage.appendBatch(this.currentBatchKey(), events)
    const context = this.lastExportErrorContext
      ? ` (${this.lastExportErrorContext})`
      : ''
    logError(
      new Error(
        `1P event exporter (new): ${events.length} events failed to export${context}`,
      ),
    )
  }

  private scheduleBackoffRetry(): void {
    if (this.retryScheduler.hasPendingRetry() || this.isRetrying || this.isShutdownFlag) {
      return
    }
    if (getUserType() === 'internal') {
      logForDebugging(
        `1P event exporter (new): scheduling backoff retry (attempt ${this.attempts}, delay ${this.retryScheduler.computeDelay(this.attempts)}ms)`,
      )
    }
    this.retryScheduler.scheduleRetry(
      () => this.retryFailedEvents(),
      this.attempts,
    )
  }

  private async retryFailedEvents(): Promise<void> {
    const key = this.currentBatchKey()

    while (!this.isShutdownFlag) {
      const events = await this.storage.loadBatch(key)
      if (events.length === 0) break

      if (this.attempts >= this.maxAttempts) {
        if (getUserType() === 'internal') {
          logForDebugging(
            `1P event exporter (new): max attempts (${this.maxAttempts}) reached, dropping ${events.length} events`,
          )
        }
        await this.storage.deleteBatch(key)
        this.resetBackoff()
        return
      }

      this.isRetrying = true
      // Clear before retry so concurrent appends after success aren't lost
      await this.storage.deleteBatch(key)
      const failed = await this.sendEventsInBatches(events)
      this.attempts++
      this.isRetrying = false

      if (failed.length > 0) {
        await this.storage.saveBatch(key, failed)
        this.scheduleBackoffRetry()
        return
      }

      this.resetBackoff()
      if (getUserType() === 'internal') {
        logForDebugging('1P event exporter (new): backoff retry succeeded')
      }
    }
  }

  private resetBackoff(): void {
    this.attempts = 0
    this.retryScheduler.cancel()
  }

  // ------------------------------------------------------------------
  // Previous-run batch retry (startup)
  // ------------------------------------------------------------------

  private async retryPreviousBatches(): Promise<void> {
    try {
      const sessionPrefix = `${getSessionId()}.`
      const files = await this.storage.listOldBatchFiles(sessionPrefix, [
        this.batchUuid,
      ])
      for (const filePath of files) {
        void this.retryFileInBackground(filePath)
      }
    } catch (error) {
      logError(error as Error)
    }
  }

  private async retryFileInBackground(filePath: string): Promise<void> {
    if (this.attempts >= this.maxAttempts) {
      // Can't write through storage by absolute path; just delete via fs in
      // the storage module's idiom — re-derive key from file basename.
      const key = filePathToKey(filePath)
      if (key) await this.storage.deleteBatch(key)
      return
    }

    const key = filePathToKey(filePath)
    if (!key) return

    const events = await this.storage.loadBatch(key)
    if (events.length === 0) {
      await this.storage.deleteBatch(key)
      return
    }

    if (getUserType() === 'internal') {
      logForDebugging(
        `1P event exporter (new): retrying ${events.length} events from previous batch ${key}`,
      )
    }

    const failed = await this.sendEventsInBatches(events)
    if (failed.length === 0) {
      await this.storage.deleteBatch(key)
      if (getUserType() === 'internal') {
        logForDebugging('1P event exporter (new): previous batch retry succeeded')
      }
    } else {
      await this.storage.saveBatch(key, failed)
      if (getUserType() === 'internal') {
        logForDebugging(
          `1P event exporter (new): previous batch retry failed, ${failed.length} events remain`,
        )
      }
    }
  }
}

function filePathToKey(filePath: string): string | null {
  const filename = filePath.substring(filePath.lastIndexOf('/') + 1)
  if (!filename.startsWith(FILE_PREFIX) || !filename.endsWith('.json')) {
    return null
  }
  return filename.slice(FILE_PREFIX.length, -'.json'.length)
}

function getAxiosErrorContext(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return errorMessage(toError(error))
  }
  const parts: string[] = []
  const requestId = error.response?.headers?.['request-id']
  if (requestId) parts.push(`request-id=${requestId}`)
  if (error.response?.status) parts.push(`status=${error.response.status}`)
  if (error.code) parts.push(`code=${error.code}`)
  if (error.message) parts.push(error.message)
  return parts.join(', ')
}
