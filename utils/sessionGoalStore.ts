import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  getSessionGoalHistory,
  getSessionGoalState,
  getSessionId,
  isSessionPersistenceDisabled,
  pauseSessionGoalState,
  replaceSessionGoalStateForRestore,
  type MossenGoalState,
} from '../bootstrap/state.js'
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getTranscriptPath } from './sessionStorage.js'
import {
  GOAL_SNAPSHOT_RESTORE_FAILURE_METRIC,
  GOAL_SNAPSHOT_RESTORE_METRIC,
  GOAL_SNAPSHOT_WRITE_METRIC,
  observeSessionGoalMetric,
} from './sessionGoalMetrics.js'

const GOAL_SNAPSHOT_WRITE_DEBOUNCE_MS = 100

type SessionGoalSnapshot = {
  version: 1
  sessionId: string
  updatedAt: string
  goal: MossenGoalState | null
  history: MossenGoalState[]
}

let pendingSnapshot: SessionGoalSnapshot | null = null
let pendingPath: string | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
let cleanupRegistered = false

function getSessionGoalStorePath(): string {
  return join(dirname(getTranscriptPath()), getSessionId(), 'goal.json')
}

function buildSessionGoalSnapshot(): SessionGoalSnapshot {
  return {
    version: 1,
    sessionId: getSessionId(),
    updatedAt: new Date().toISOString(),
    goal: getSessionGoalState(),
    history: [...getSessionGoalHistory()],
  }
}

function parseSessionGoalSnapshot(value: unknown): SessionGoalSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1) return null
  if (typeof record.sessionId !== 'string' || record.sessionId !== getSessionId()) return null
  if (typeof record.updatedAt !== 'string') return null
  const history = Array.isArray(record.history)
    ? record.history.filter(
        (goal): goal is MossenGoalState =>
          !!goal &&
          typeof goal === 'object' &&
          !Array.isArray(goal) &&
          typeof (goal as { id?: unknown }).id === 'string' &&
          typeof (goal as { text?: unknown }).text === 'string',
      )
    : []
  const goal =
    record.goal &&
    typeof record.goal === 'object' &&
    !Array.isArray(record.goal) &&
    typeof (record.goal as { id?: unknown }).id === 'string' &&
    typeof (record.goal as { text?: unknown }).text === 'string'
      ? (record.goal as MossenGoalState)
      : null
  return {
    version: 1,
    sessionId: record.sessionId,
    updatedAt: record.updatedAt,
    goal,
    history,
  }
}

function writeSessionGoalSnapshot(path: string, snapshot: SessionGoalSnapshot): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(tempPath, path)
  observeSessionGoalMetric(GOAL_SNAPSHOT_WRITE_METRIC)
  logMossenEvent('mossen.goal.snapshot.write', {
    active: snapshot.goal?.status === 'active',
    paused: snapshot.goal?.status === 'paused',
    blocked: snapshot.goal?.status === 'blocked',
    budgetLimited: snapshot.goal?.status === 'budget_limited',
    completed: snapshot.goal?.status === 'completed',
    historyCount: snapshot.history.length,
  })
}

function ensureGoalSnapshotCleanupRegistered(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  registerCleanup(async () => {
    flushCurrentSessionGoalSnapshot()
  })
}

export function flushCurrentSessionGoalSnapshot(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!pendingSnapshot || !pendingPath) return
  const snapshot = pendingSnapshot
  const path = pendingPath
  pendingSnapshot = null
  pendingPath = null
  writeSessionGoalSnapshot(path, snapshot)
}

export function persistCurrentSessionGoalSnapshot(
  options: { flush?: boolean } = {},
): void {
  if (isSessionPersistenceDisabled()) return
  ensureGoalSnapshotCleanupRegistered()
  pendingPath = getSessionGoalStorePath()
  pendingSnapshot = buildSessionGoalSnapshot()
  if (options.flush) {
    flushCurrentSessionGoalSnapshot()
    return
  }
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    flushCurrentSessionGoalSnapshot()
  }, GOAL_SNAPSHOT_WRITE_DEBOUNCE_MS)
  writeTimer.unref?.()
}

export function restoreSessionGoalSnapshotFromStore(): boolean {
  if (isSessionPersistenceDisabled()) return false
  flushCurrentSessionGoalSnapshot()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(getSessionGoalStorePath(), 'utf8'))
  } catch (error) {
    observeSessionGoalMetric(GOAL_SNAPSHOT_RESTORE_FAILURE_METRIC)
    logForDebugging(`[goal] failed to restore sidecar goal snapshot: ${String(error)}`)
    return false
  }
  const snapshot = parseSessionGoalSnapshot(parsed)
  if (!snapshot) {
    observeSessionGoalMetric(GOAL_SNAPSHOT_RESTORE_FAILURE_METRIC)
    logForDebugging('[goal] ignored invalid sidecar goal snapshot')
    return false
  }
  replaceSessionGoalStateForRestore(snapshot.goal, snapshot.history)
  if (getSessionGoalState()?.status === 'active') {
    pauseSessionGoalState('resume_requires_explicit_goal_resume')
  }
  observeSessionGoalMetric(GOAL_SNAPSHOT_RESTORE_METRIC)
  return true
}
