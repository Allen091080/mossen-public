/**
 * W48 — Pending compact request buffer.
 *
 * Single-slot buffer for stream-json compact_conversation control requests.
 * The control_request handler enqueues here; the query loop safe point
 * dequeues and executes. No execution happens outside the query loop.
 *
 * Invariants:
 * - Single slot: enqueue returns false if a request is already pending.
 * - No ToolUseContext / CacheSafeParams construction here.
 * - No compactConversation calls here.
 */

export type PendingCompactRequest = {
  requestId: string
  mode: 'manual'
  dryRun: boolean
  customInstructions?: string
  enqueuedAt: number
}

let pendingRequest: PendingCompactRequest | null = null

/** Timeout for queued compact requests (ms). */
export const COMPACT_REQUEST_TIMEOUT_MS = 60_000

/**
 * Enqueue a compact request. Returns false if a request is already pending.
 */
export function enqueuePendingCompactRequest(
  req: Omit<PendingCompactRequest, 'enqueuedAt'>,
): { ok: true } | { ok: false; reason: string } {
  if (pendingRequest !== null) {
    return {
      ok: false,
      reason: 'another compact request is already pending',
    }
  }
  pendingRequest = { ...req, enqueuedAt: Date.now() }
  return { ok: true }
}

/**
 * Dequeue the pending request. Returns null if none pending.
 * Checks for timeout — if timed out, returns null and the caller
 * should emit a compact_completed(failed) event.
 */
export function dequeuePendingCompactRequest(): PendingCompactRequest | null {
  if (pendingRequest === null) return null
  if (Date.now() - pendingRequest.enqueuedAt > COMPACT_REQUEST_TIMEOUT_MS) {
    const timedOut = pendingRequest
    pendingRequest = null
    return timedOut // caller checks timeout via hasCompactRequestTimedOut
  }
  const req = pendingRequest
  pendingRequest = null
  return req
}

/**
 * Peek at the pending request without dequeuing.
 */
export function getPendingCompactRequest(): PendingCompactRequest | null {
  return pendingRequest
}

/**
 * Check whether a pending request exists.
 */
export function hasPendingCompactRequest(): boolean {
  return pendingRequest !== null
}

/**
 * Check whether the pending request has timed out.
 */
export function hasCompactRequestTimedOut(): boolean {
  if (pendingRequest === null) return false
  return Date.now() - pendingRequest.enqueuedAt > COMPACT_REQUEST_TIMEOUT_MS
}

/**
 * Clear the pending request unconditionally.
 */
export function clearPendingCompactRequest(): void {
  pendingRequest = null
}
