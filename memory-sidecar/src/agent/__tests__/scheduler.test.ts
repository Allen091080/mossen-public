// W435d — Memory agent scheduler decision rules.
//
// shouldScheduleMemoryAgent is pure — perfect lock target. Locks every
// reason path (force / dirty_count / dirty_age) plus threshold overrides
// and dirty-marker-based age computation.
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DIRTY_COUNT_THRESHOLD,
  DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD,
  shouldScheduleMemoryAgent,
} from '../scheduler.js'
import type { DirtyMarker } from '../dirtyQueue.js'

function marker(ageMs: number, nowMs: number): DirtyMarker {
  return {
    schemaVersion: 1,
    dirtyId: `d-${ageMs}`,
    projectId: 'p',
    sessionId: 's',
    eventIds: ['e'],
    reason: 'archive_append',
    createdAt: new Date(nowMs - ageMs).toISOString(),
  }
}

describe('shouldScheduleMemoryAgent', () => {
  test('no input -> shouldSchedule false', () => {
    const d = shouldScheduleMemoryAgent()
    expect(d.shouldSchedule).toBe(false)
    expect(d.reasons).toEqual([])
    expect(d.dirtyCount).toBe(0)
    expect(d.maxDirtyAgeMs).toBe(0)
    expect(d.thresholds.dirtyCount).toBe(DEFAULT_DIRTY_COUNT_THRESHOLD)
    expect(d.thresholds.maxDirtyAgeMs).toBe(DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD)
  })

  test('force flag always schedules', () => {
    const d = shouldScheduleMemoryAgent({ force: true })
    expect(d.shouldSchedule).toBe(true)
    expect(d.reasons).toContain('force')
  })

  test('dirty_count at threshold triggers', () => {
    const d = shouldScheduleMemoryAgent({
      dirtyCount: DEFAULT_DIRTY_COUNT_THRESHOLD,
    })
    expect(d.shouldSchedule).toBe(true)
    expect(d.reasons).toContain('dirty_count')
  })

  test('dirty_count below threshold does NOT trigger', () => {
    const d = shouldScheduleMemoryAgent({
      dirtyCount: DEFAULT_DIRTY_COUNT_THRESHOLD - 1,
    })
    expect(d.shouldSchedule).toBe(false)
    expect(d.reasons).not.toContain('dirty_count')
  })

  test('custom dirtyCountThreshold honored', () => {
    const d = shouldScheduleMemoryAgent({
      dirtyCount: 5,
      dirtyCountThreshold: 3,
    })
    expect(d.shouldSchedule).toBe(true)
    expect(d.thresholds.dirtyCount).toBe(3)
  })

  test('dirty_age at threshold triggers', () => {
    const d = shouldScheduleMemoryAgent({
      maxDirtyAgeMs: DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD,
    })
    expect(d.shouldSchedule).toBe(true)
    expect(d.reasons).toContain('dirty_age')
  })

  test('dirty_age below threshold does NOT trigger', () => {
    const d = shouldScheduleMemoryAgent({
      maxDirtyAgeMs: DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD - 1,
    })
    expect(d.shouldSchedule).toBe(false)
    expect(d.reasons).not.toContain('dirty_age')
  })

  test('dirtyMarkers populate dirtyCount when dirtyCount undefined', () => {
    const now = 1_000_000_000_000
    const d = shouldScheduleMemoryAgent({
      dirtyMarkers: [marker(0, now), marker(0, now), marker(0, now)],
      now,
    })
    expect(d.dirtyCount).toBe(3)
  })

  test('dirtyMarkers populate maxDirtyAgeMs when maxDirtyAgeMs undefined', () => {
    const now = 1_000_000_000_000
    const ageMs = 9 * 60 * 1000 // 9 min, under 10-min threshold
    const d = shouldScheduleMemoryAgent({
      dirtyMarkers: [marker(ageMs, now), marker(ageMs - 1000, now)],
      now,
    })
    // max takes the oldest
    expect(d.maxDirtyAgeMs).toBeGreaterThanOrEqual(ageMs)
    expect(d.shouldSchedule).toBe(false)
  })

  test('explicit dirtyCount overrides dirtyMarkers.length', () => {
    const now = 1_000_000_000_000
    const d = shouldScheduleMemoryAgent({
      dirtyCount: 100,
      dirtyMarkers: [marker(0, now)],
      now,
    })
    expect(d.dirtyCount).toBe(100)
  })

  test('reasons accumulate when multiple triggers fire', () => {
    const d = shouldScheduleMemoryAgent({
      force: true,
      dirtyCount: 50,
      maxDirtyAgeMs: DEFAULT_MAX_DIRTY_AGE_MS_THRESHOLD + 1,
    })
    expect(d.shouldSchedule).toBe(true)
    expect(d.reasons).toContain('force')
    expect(d.reasons).toContain('dirty_count')
    expect(d.reasons).toContain('dirty_age')
  })

  test('now as function is invoked', () => {
    let callCount = 0
    shouldScheduleMemoryAgent({
      now: () => {
        callCount += 1
        return 0
      },
    })
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  test('marker with invalid createdAt is ignored (NaN safe)', () => {
    const d = shouldScheduleMemoryAgent({
      dirtyMarkers: [
        {
          schemaVersion: 1,
          dirtyId: 'd-bad',
          projectId: 'p',
          sessionId: 's',
          eventIds: ['e'],
          reason: 'archive_append',
          createdAt: 'not-a-date',
        },
      ],
      now: 1_000_000_000_000,
    })
    expect(d.maxDirtyAgeMs).toBe(0)
  })
})
