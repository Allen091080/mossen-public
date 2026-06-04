import type { DirtyMarker } from './dirtyQueue.js'

export const DEFAULT_DIRTY_COUNT_THRESHOLD = 10
export const DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD = 10 * 60 * 1000

export type MemoryAgentScheduleInput = {
  dirtyCount?: number
  maxDirtyAgeMs?: number
  dirtyMarkers?: DirtyMarker[]
  force?: boolean
  dirtyCountThreshold?: number
  maxDirtyAgeMsThreshold?: number
  now?: number | (() => number)
}

export type MemoryAgentScheduleDecision = {
  shouldSchedule: boolean
  dirtyCount: number
  maxDirtyAgeMs: number
  reasons: Array<'force' | 'dirty_count' | 'dirty_age'>
  thresholds: {
    dirtyCount: number
    maxDirtyAgeMs: number
  }
}

export function shouldScheduleMemoryAgent(
  input: MemoryAgentScheduleInput = {},
): MemoryAgentScheduleDecision {
  const nowMs = typeof input.now === 'function' ? input.now() : input.now ?? Date.now()
  const dirtyCount = input.dirtyCount ?? input.dirtyMarkers?.length ?? 0
  const maxDirtyAgeMs = input.maxDirtyAgeMs ?? maxDirtyMarkerAgeMs(input.dirtyMarkers ?? [], nowMs)
  const dirtyCountThreshold =
    input.dirtyCountThreshold ?? DEFAULT_DIRTY_COUNT_THRESHOLD
  const maxDirtyAgeMsThreshold =
    input.maxDirtyAgeMsThreshold ?? DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD
  const reasons: MemoryAgentScheduleDecision['reasons'] = []

  if (input.force) reasons.push('force')
  if (dirtyCount >= dirtyCountThreshold) reasons.push('dirty_count')
  if (maxDirtyAgeMs >= maxDirtyAgeMsThreshold) reasons.push('dirty_age')

  return {
    shouldSchedule: reasons.length > 0,
    dirtyCount,
    maxDirtyAgeMs,
    reasons,
    thresholds: {
      dirtyCount: dirtyCountThreshold,
      maxDirtyAgeMs: maxDirtyAgeMsThreshold,
    },
  }
}

function maxDirtyMarkerAgeMs(markers: DirtyMarker[], nowMs: number): number {
  let maxAgeMs = 0
  for (const marker of markers) {
    const createdMs = Date.parse(marker.createdAt)
    if (!Number.isFinite(createdMs)) continue
    maxAgeMs = Math.max(maxAgeMs, Math.max(0, nowMs - createdMs))
  }
  return maxAgeMs
}
