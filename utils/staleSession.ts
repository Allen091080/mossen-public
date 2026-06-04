/**
 * Stale-session heuristic.
 *
 * Display-only: surfaces a "session not touched in N days" hint in
 * LogSelector rows. Not a new schema field — derives from the existing
 * `LogOption.modified` value, which is the filesystem mtime of the session
 * log file. Mtime is an approximation of "last activity" (a touch/copy can
 * skew it), but it's the only signal mossen persists today and is good
 * enough for a non-blocking visual hint.
 *
 * Pure: no IO, no React. Safe for tests and non-interactive callers.
 */

/** Threshold (days) before a session is shown as stale. Conservative default. */
export const STALE_SESSION_THRESHOLD_DAYS = 7

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Age in whole days since `modified`. Floors fractional days so a session
 * touched 6.9 days ago reports 6, not 7. `now` defaults to current time and
 * is overridable for deterministic tests.
 */
export function getStaleSessionAgeDays(
  modified: Date,
  now: Date = new Date(),
): number {
  const ageMs = now.getTime() - modified.getTime()
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0
  return Math.floor(ageMs / MS_PER_DAY)
}

/**
 * True iff the session has not been modified for at least
 * STALE_SESSION_THRESHOLD_DAYS whole days.
 */
export function isSessionStale(
  modified: Date,
  now: Date = new Date(),
): boolean {
  return getStaleSessionAgeDays(modified, now) >= STALE_SESSION_THRESHOLD_DAYS
}
