// W418 S1 — Capture event channel for TUI toast.
//
// Memory-sidecar capture happens fire-and-forget inside stopHooks; the TUI has
// no way to learn what was just remembered. This module exports a process-wide
// singleton EventEmitter that turnCapture.ts emits to after a non-empty
// ingestAdapterPayloads result, and that the REPL subscribes to in order to
// render a transient toast notification.
//
// Contract:
//   - Strictly best-effort. Listener errors are swallowed; emit failures never
//     propagate back into capture pipeline.
//   - No buffering / no replay. A subscriber that mounts after the event was
//     emitted simply misses it.
//   - Event payload is a snapshot (immutable, JSON-safe). Listeners must not
//     mutate it.
//
// W418 S3 reuses this same channel for /remember (manual writes also emit).
import { EventEmitter } from 'node:events'

export type MemoryCaptureScope =
  | 'session'
  | 'project'
  | 'workspace'
  | 'user'
  | 'team'

export type MemoryCaptureKind = 'auto' | 'manual'

export type MemoryCaptureEvent = {
  /** Best-effort identifier; the JSONL eventId is set inside memory-sidecar
   * after this emit so we surface the adapter sourceEventId instead. */
  sourceEventId: string
  /** W419 — Archive event id assigned by ingestConversationEvent. When present,
   * `/undo` can target this exact entry via tombstoneArchiveEvent.
   * Auto-capture path fills this from IngressEventAck.archiveEventId; manual
   * /remember path fills it from the ingestConversationEvent return value. */
  archiveEventId?: string
  /** Preview text — already truncated by adapter maxTextChars; UI truncates
   * further for display. */
  text: string
  scope: MemoryCaptureScope
  /** 'auto' = via captureTurnForMemorySidecar; 'manual' = via /remember. */
  kind: MemoryCaptureKind
  /** Total accepted entries in the batch this event represents. UI shows "N
   * 条已记忆" when > 1, otherwise drops the count. */
  acceptedCount: number
  projectId: string
  sessionId: string
  createdAt: string
}

type CaptureEventMap = {
  captured: [MemoryCaptureEvent]
}

class MemoryCaptureEventBus extends EventEmitter<CaptureEventMap> {
  constructor() {
    super()
    // High ceiling — multiple TUI re-mounts during a session attach add
    // listeners without strictly removing them on every path.
    this.setMaxListeners(32)
  }
}

let bus: MemoryCaptureEventBus | undefined
// W419 — "latest for undo" pointer. Process-local (not persisted: "刚才那条"
// loses meaning after a restart). Set by emit when archiveEventId is known;
// consumed by /undo command after a successful tombstone.
let latestForUndo: MemoryCaptureEvent | undefined

function getBus(): MemoryCaptureEventBus {
  if (!bus) bus = new MemoryCaptureEventBus()
  return bus
}

export function emitMemoryCaptured(event: MemoryCaptureEvent): void {
  if (event.archiveEventId) {
    latestForUndo = event
  }
  try {
    getBus().emit('captured', event)
  } catch {
    // Capture pipeline must never throw on UI signaling.
  }
}

/** W419 — Read the most-recent captured entry eligible for undo, or undefined
 * if none. Does not consume it; caller is expected to call
 * clearLatestMemoryCaptureForUndo() after a successful tombstone. */
export function getLatestMemoryCaptureForUndo(): MemoryCaptureEvent | undefined {
  return latestForUndo
}

/** W419 — Mark the latest-for-undo as consumed. Called after a successful
 * tombstone so a second /undo says "nothing to undo" instead of repeatedly
 * targeting the now-deleted entry. */
export function clearLatestMemoryCaptureForUndo(): void {
  latestForUndo = undefined
}

export function onMemoryCaptured(
  handler: (event: MemoryCaptureEvent) => void,
): () => void {
  const wrapped = (event: MemoryCaptureEvent): void => {
    try {
      handler(event)
    } catch {
      // Subscriber error must not crash the emitter.
    }
  }
  getBus().on('captured', wrapped)
  return () => {
    getBus().off('captured', wrapped)
  }
}

/** Test helper — drops all subscribers. Not part of the public API. */
export function _resetMemoryCaptureEventsForTesting(): void {
  bus?.removeAllListeners()
  bus = undefined
  latestForUndo = undefined
}
