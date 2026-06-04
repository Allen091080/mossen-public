import { randomUUID } from 'node:crypto'
import type { MemoryRootOptions } from '../index.js'
import { recentArchiveEvents } from '../storage/jsonlArchiveStore.js'
import {
  appendDirtyMarker,
  listDirtyCheckpoints,
  listDirtyMarkers,
  type DirtyMarker,
} from './dirtyQueue.js'

/**
 * W120 M1: archive/dirty reconciliation.
 *
 * The pipeline writes archive event JSONL first, then a dirty marker.
 * If the process crashes between those two writes, the archive holds
 * the event but the worker has nothing to consume — the event is
 * silently never classified, never indexed, never surfaced.
 *
 * `detectArchiveEventsMissingDirty` walks the most recent N archive
 * events and diffs their event ids against every active and consumed
 * dirty marker. Anything in archive but absent from every marker is
 * "orphaned" and needs a dirty marker re-emitted so the worker picks
 * it up.
 *
 * `repairMissingDirtyMarkers` appends a single fresh marker per
 * orphaned (projectId, sessionId) bucket, with `reason:'manual_rebuild'`
 * so jobQueue dedupe still works (marker dirtyId is unique). It does
 * NOT touch archive data, NOT delete anything.
 *
 * Default scanWindow is 200 events: large enough to catch any plausible
 * crash burst, small enough to not turn worker startup into a full
 * archive scan as the project ages. The window is reported in the
 * detect/repair result so trial-report and the smoke can surface it.
 */

export const MEMORY_DEFAULT_RECONCILE_SCAN_WINDOW = 200

export type MissingDirtyEntry = {
  eventId: string
  projectId: string
  sessionId: string
  createdAt: string
}

export type ArchiveDirtyReconcileReport = {
  scanWindow: number
  scannedEvents: number
  coveredEventIds: number
  missing: MissingDirtyEntry[]
}

export type RepairMissingDirtyResult = {
  report: ArchiveDirtyReconcileReport
  appendedMarkers: DirtyMarker[]
}

export async function detectArchiveEventsMissingDirty(
  options: MemoryRootOptions & { scanWindow?: number },
): Promise<ArchiveDirtyReconcileReport> {
  const scanWindow = options.scanWindow ?? MEMORY_DEFAULT_RECONCILE_SCAN_WINDOW
  if (scanWindow <= 0) {
    return { scanWindow: 0, scannedEvents: 0, coveredEventIds: 0, missing: [] }
  }

  const events = await recentArchiveEvents({ ...options, limit: scanWindow }).catch(() => [])

  // Both active and consumed markers count as "covered" — a consumed
  // marker means the worker already processed those event ids and
  // emitting another marker for the same ids would just create duplicate
  // jobs. We still touch listDirtyCheckpoints so that future smoke runs
  // can reason about checkpoint coverage if the contract evolves.
  const [markers] = await Promise.all([
    listDirtyMarkers(options).catch(() => []),
    listDirtyCheckpoints(options).catch(() => []),
  ])
  const coveredEventIds = new Set<string>()
  for (const marker of markers) {
    for (const id of marker.eventIds) coveredEventIds.add(id)
  }


  const missing: MissingDirtyEntry[] = []
  for (const { event } of events) {
    if (event.projectId !== options.projectId) continue
    if (coveredEventIds.has(event.eventId)) continue
    missing.push({
      eventId: event.eventId,
      projectId: event.projectId,
      sessionId: event.sessionId,
      createdAt: event.createdAt,
    })
  }

  return {
    scanWindow,
    scannedEvents: events.length,
    coveredEventIds: coveredEventIds.size,
    missing,
  }
}

export async function repairMissingDirtyMarkers(
  options: MemoryRootOptions & { scanWindow?: number; now?: () => Date },
): Promise<RepairMissingDirtyResult> {
  const report = await detectArchiveEventsMissingDirty(options)
  if (report.missing.length === 0) {
    return { report, appendedMarkers: [] }
  }

  // Group missing event ids by (projectId, sessionId) — DirtyMarker
  // schema requires both, and per-session markers also keep the
  // resulting jobs scoped correctly.
  const bySession = new Map<string, MissingDirtyEntry[]>()
  for (const entry of report.missing) {
    const key = `${entry.projectId}${entry.sessionId}`
    const list = bySession.get(key) ?? []
    list.push(entry)
    bySession.set(key, list)
  }

  const now = (options.now ?? (() => new Date()))().toISOString()
  const appendedMarkers: DirtyMarker[] = []
  for (const entries of bySession.values()) {
    const marker: DirtyMarker = {
      schemaVersion: 1,
      dirtyId: `repair_${randomUUID()}`,
      projectId: entries[0].projectId,
      sessionId: entries[0].sessionId,
      eventIds: entries.map(e => e.eventId),
      reason: 'manual_rebuild',
      createdAt: now,
    }
    appendedMarkers.push(await appendDirtyMarker({ ...options, marker }))
  }

  return { report, appendedMarkers }
}
