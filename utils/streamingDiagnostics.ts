/**
 * W142-B — lightweight streaming responsiveness diagnostics.
 *
 * Default OFF. Only fires when MOSSEN_CODE_STREAMING_DIAG is truthy.
 *
 * Records:
 *  - per-stream delta count + total bytes
 *  - clock time from first delta to clear
 *  - rolling tally of setStreamingText calls and displayed-messages render
 *    path (sync vs deferred) over the REPL lifetime
 *
 * The module never throws and never writes to user-facing stdout — it
 * appends one line per stream cycle to the existing debug log only when
 * the env flag is set. Removing or disabling it has zero behavioural
 * effect on the streaming pipeline.
 *
 * This is measurement-only. It does NOT batch, throttle, or mutate the
 * streaming text in any way.
 */
import memoize from 'lodash-es/memoize.js'

import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'

export const isStreamingDiagEnabled = memoize((): boolean => {
  return isEnvTruthy(process.env.MOSSEN_CODE_STREAMING_DIAG)
})

type StreamWindow = {
  startedAt: number
  deltaCount: number
  byteCount: number
  lastDeltaAt: number
}

let active: StreamWindow | null = null
let totalDeltas = 0
let totalBytes = 0
let totalCycles = 0
let syncRenderPathCount = 0
let deferredRenderPathCount = 0

export function recordStreamingDelta(deltaSize: number): void {
  if (!isStreamingDiagEnabled()) return
  const now = Date.now()
  if (!active) {
    active = { startedAt: now, deltaCount: 0, byteCount: 0, lastDeltaAt: now }
  }
  active.deltaCount += 1
  active.byteCount += Math.max(0, deltaSize | 0)
  active.lastDeltaAt = now
  totalDeltas += 1
  totalBytes += Math.max(0, deltaSize | 0)
}

export function recordStreamingClear(reason: 'message-arrival' | 'cancel' | 'unknown' = 'unknown'): void {
  if (!isStreamingDiagEnabled()) return
  if (!active) return
  const w = active
  active = null
  totalCycles += 1
  const wallMs = Math.max(0, w.lastDeltaAt - w.startedAt)
  const ratePerSec = wallMs > 0 ? Math.round((w.deltaCount / wallMs) * 1000) : w.deltaCount
  logForDebugging(
    `[streamingDiag] cycle reason=${reason} deltas=${w.deltaCount} bytes=${w.byteCount} wallMs=${wallMs} rate~${ratePerSec}/s ` +
    `lifetime cycles=${totalCycles} totalDeltas=${totalDeltas} totalBytes=${totalBytes} ` +
    `renderPath sync=${syncRenderPathCount} deferred=${deferredRenderPathCount}`,
  )
}

export function recordDisplayedMessagesPath(path: 'sync' | 'deferred'): void {
  if (!isStreamingDiagEnabled()) return
  if (path === 'sync') syncRenderPathCount += 1
  else deferredRenderPathCount += 1
}
