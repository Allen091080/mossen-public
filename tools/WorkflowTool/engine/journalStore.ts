/**
 * Disk persistence for the workflow resume journal.
 *
 * A workflow run is deterministic (no Date.now / Math.random), so re-running the
 * same script + args replays the same agent() call sequence. To make resume work
 * ACROSS tool invocations (not just in-memory within one run), each completed
 * agent() call is appended to `<runDir>/journal.jsonl` and the script source is
 * snapshotted to `<runDir>/script.js`. On resume we read the prior entries back
 * and feed them to createJournal() as the `prior` set.
 *
 * Format: one JSON object per line. Result rows keep the original JournalEntry
 * shape; started rows carry `kind:"started"`. Append-only so a crash mid-run
 * still leaves a valid prefix — partial/corrupt trailing lines are skipped on
 * read.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { getSessionId } from '../../../bootstrap/state.js'
import { getProjectsDir } from '../../../utils/sessionStorage.js'
import type { TaskStatus } from '../../../Task.js'
import type {
  JournalData,
  JournalEntry,
  JournalStartedEntry,
} from './journal.js'
import type { WorkflowPhaseMeta } from './types.js'

const JOURNAL_FILE = 'journal.jsonl'
const SCRIPT_FILE = 'script.js'
const META_FILE = 'run.json'
const LOG_FILE = 'progress.log'
const REPORT_FILE = 'report.md'
export const STALE_RUNNING_WORKFLOW_MESSAGE =
  'Workflow run was interrupted because the previous process exited; relaunch the workflow to start fresh.'
const activeWorkflowRunIds = new Set<string>()

/** Persisted run header alongside the journal (for /workflows listing + resume). */
export type WorkflowRunMeta = {
  runId: string
  workflowName: string
  description: string
  title?: string
  phases?: WorkflowPhaseMeta[]
  defaultModel?: string
  args?: unknown
  scriptPath?: string
  transcriptDir?: string
  parentGoalId?: string | null
  createdAt: string
  status: Extract<TaskStatus, 'running' | 'paused' | 'completed' | 'failed' | 'killed'>
  agentCount?: number
  totalToolCalls?: number
  tokensSpent?: number
  failures?: string[]
  durationMs?: number
  result?: string
}

/**
 * Per-run artifact directory. Sits alongside the workflow's subagent
 * transcripts (agentRunner writes those to subagents/workflows/<runId>/), so a
 * run's script + journal + agent transcripts all live under one folder.
 */
/** Directory that holds every workflow run's artifact folder this session. */
function workflowsRoot(): string {
  return join(getProjectsDir(), getSessionId(), 'subagents', 'workflows')
}

function runDir(runId: string): string {
  return join(workflowsRoot(), runId)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Reap stale run dirs once per process, lazily on the first run that persists.
// This is the "clean up old runs at startup" behaviour (A): the first workflow
// after launch sweeps everything older than the retention window, across all
// sessions. Gated implicitly — this module only loads when WORKFLOW_SCRIPTS is
// on — and never blocks the run (best-effort, swallows its own errors).
let reapedThisProcess = false
function reapOnceLazily(): void {
  if (reapedThisProcess) return
  reapedThisProcess = true
  try {
    cleanupOldWorkflowRuns(Date.now())
  } catch {
    // Cleanup is housekeeping, never fatal to the run.
  }
}

/** Snapshot the script + write the initial run header. Best-effort. */
export function initRunArtifacts(
  runId: string,
  source: string,
  meta: WorkflowRunMeta,
): void {
  if (meta.status === 'running') activeWorkflowRunIds.add(runId)
  else activeWorkflowRunIds.delete(runId)
  reapOnceLazily()
  try {
    const dir = runDir(runId)
    ensureDir(dir)
    writeFileSync(join(dir, SCRIPT_FILE), source, 'utf8')
    writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf8')
  } catch {
    // Persistence is a resume convenience, never fatal to the run itself.
  }
}

/** Append one completed journal entry. Best-effort. */
export function appendJournalEntry(runId: string, entry: JournalEntry): void {
  appendJournalLine(runId, entry)
}

/** Append one started journal entry. Best-effort. */
export function appendJournalStartedEntry(
  runId: string,
  entry: JournalStartedEntry,
): void {
  appendJournalLine(runId, entry)
}

function appendJournalLine(
  runId: string,
  entry: JournalEntry | JournalStartedEntry,
): void {
  try {
    const dir = runDir(runId)
    ensureDir(dir)
    appendFileSync(join(dir, JOURNAL_FILE), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // ignore — in-memory journal still drives the current run
  }
}

/** Update the run header at terminal state. Best-effort. */
export function finalizeRunMeta(
  runId: string,
  patch: Partial<WorkflowRunMeta>,
): void {
  if (patch.status && patch.status !== 'running') {
    activeWorkflowRunIds.delete(runId)
  }
  try {
    const dir = runDir(runId)
    const path = join(dir, META_FILE)
    const prior = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as WorkflowRunMeta)
      : null
    if (!prior) return
    writeFileSync(path, JSON.stringify({ ...prior, ...patch }, null, 2), 'utf8')
  } catch {
    // ignore
  }
}

/** Load a prior run's journal entries for resume. Returns null if none. */
export function loadJournal(runId: string): JournalData | null {
  try {
    const path = join(runDir(runId), JOURNAL_FILE)
    if (!existsSync(path)) return null
    const entries: JournalEntry[] = []
    const started: JournalStartedEntry[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as JournalEntry | JournalStartedEntry
        if (typeof parsed.index === 'number' && typeof parsed.hash === 'string') {
          if ('kind' in parsed && parsed.kind === 'started') {
            started.push(parsed)
          } else {
            entries.push(parsed as JournalEntry)
          }
        }
      } catch {
        // skip a torn trailing line from a crash mid-append
      }
    }
    return { runId, entries, ...(started.length ? { started } : {}) }
  } catch {
    return null
  }
}

/** Read a persisted run header (for /workflows listing). */
export function loadRunMeta(runId: string): WorkflowRunMeta | null {
  try {
    const path = join(runDir(runId), META_FILE)
    if (!existsSync(path)) return null
    const meta = JSON.parse(readFileSync(path, 'utf8')) as WorkflowRunMeta
    return normalizeLoadedRunMeta(meta, path)
  } catch {
    return null
  }
}

/** Read the persisted script source for a run (for resume from runId). */
export function loadRunScript(runId: string): string | null {
  try {
    const path = runScriptPath(runId)
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Absolute path to a run's snapshotted workflow script. */
export function runScriptPath(runId: string): string {
  return join(runDir(runId), SCRIPT_FILE)
}

/** Persist the human-readable progress log for a run (for /workflows). */
export function saveRunLog(runId: string, lines: string[]): void {
  try {
    const dir = runDir(runId)
    ensureDir(dir)
    writeFileSync(join(dir, LOG_FILE), lines.join('\n'), 'utf8')
  } catch {
    // ignore — log is a display nicety
  }
}

/** Absolute path to a run's progress log (used as the task-notification file). */
export function runLogPath(runId: string): string {
  return join(runDir(runId), LOG_FILE)
}

/** Absolute path to a run's Markdown report. */
export function workflowReportPath(runId: string): string {
  return join(runDir(runId), REPORT_FILE)
}

/** Read back a run's progress log lines. */
export function loadRunLog(runId: string): string[] {
  try {
    const path = join(runDir(runId), LOG_FILE)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8').split('\n')
  } catch {
    return []
  }
}

/**
 * List every workflow run recorded this session, newest first. Reads each run
 * folder's run.json. Folders without a readable header are skipped. Powers the
 * `/workflows` monitor command.
 */
export function listWorkflowRuns(): WorkflowRunMeta[] {
  try {
    const root = workflowsRoot()
    if (!existsSync(root)) return []
    const runs: WorkflowRunMeta[] = []
    for (const name of readdirSync(root)) {
      const metaPath = join(root, name, META_FILE)
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as WorkflowRunMeta
        runs.push(normalizeLoadedRunMeta(meta, metaPath))
      } catch {
        // skip a torn/partial run.json
      }
    }
    // runId embeds creation order loosely; sort by createdAt when present,
    // falling back to runId string compare. Newest first.
    return runs.sort((a, b) => {
      const ca = a.createdAt || ''
      const cb = b.createdAt || ''
      if (ca && cb && ca !== cb) return cb.localeCompare(ca)
      return b.runId.localeCompare(a.runId)
    })
  } catch {
    return []
  }
}

/** Default retention for persisted workflow run artifacts (7 days). */
export const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Age (ms) of one run dir: prefer run.json createdAt, fall back to dir mtime. */
function runAgeMs(runPath: string, nowMs: number): number {
  const metaPath = join(runPath, META_FILE)
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as WorkflowRunMeta
      if (meta.status === 'running' && activeWorkflowRunIds.has(meta.runId)) {
        return -1
      }
      const t = Date.parse(meta.createdAt)
      if (!Number.isNaN(t)) return nowMs - t
    } catch {
      // torn run.json — fall through to mtime
    }
  }
  try {
    return nowMs - statSync(runPath).mtimeMs
  } catch {
    return -1 // unreadable → leave it alone
  }
}

/**
 * Reap workflow run artifact dirs older than `maxAgeMs`, across ALL sessions
 * (every `<projectsDir>/<session>/subagents/workflows/<runId>/`). Best-effort
 * and synchronous-by-design — called once at startup. `nowMs` is injected so
 * the reap window is testable without touching the clock. Running runs owned by
 * this process are skipped; stale running dirs from a previous process follow
 * the normal retention window. Returns the number of run dirs removed.
 */
export function cleanupOldWorkflowRuns(
  nowMs: number,
  maxAgeMs: number = RUN_RETENTION_MS,
): number {
  let projectsRoot: string
  try {
    projectsRoot = getProjectsDir()
  } catch {
    return 0
  }
  return reapRunsUnder(projectsRoot, nowMs, maxAgeMs)
}

function normalizeLoadedRunMeta(
  meta: WorkflowRunMeta,
  path: string,
): WorkflowRunMeta {
  if (meta.status !== 'running' || activeWorkflowRunIds.has(meta.runId)) {
    return meta
  }
  const failures = meta.failures?.includes(STALE_RUNNING_WORKFLOW_MESSAGE)
    ? meta.failures
    : [...(meta.failures ?? []), STALE_RUNNING_WORKFLOW_MESSAGE]
  const normalized: WorkflowRunMeta = {
    ...meta,
    status: 'failed',
    failures,
  }
  try {
    writeFileSync(path, JSON.stringify(normalized, null, 2), 'utf8')
  } catch {
    // Best-effort display normalization; callers still get the safe status.
  }
  return normalized
}

export function clearActiveWorkflowRunsForTests(): void {
  activeWorkflowRunIds.clear()
}

export function markActiveWorkflowRunForTests(runId: string): void {
  activeWorkflowRunIds.add(runId)
}

/**
 * Pure, path-injectable core of the reap: walk every
 * `<projectsRoot>/<session>/subagents/workflows/<runId>/` and remove dirs older
 * than `maxAgeMs`. Split out from cleanupOldWorkflowRuns (which only resolves
 * the real projects dir) so it can be unit-tested against a temp tree without a
 * configured session layer. Returns the count of run dirs removed.
 */
export function reapRunsUnder(
  projectsRoot: string,
  nowMs: number,
  maxAgeMs: number = RUN_RETENTION_MS,
): number {
  let removed = 0
  if (!existsSync(projectsRoot)) return 0
  for (const session of safeReaddir(projectsRoot)) {
    const wfRoot = join(projectsRoot, session, 'subagents', 'workflows')
    if (!existsSync(wfRoot)) continue
    for (const runId of safeReaddir(wfRoot)) {
      const runPath = join(wfRoot, runId)
      const age = runAgeMs(runPath, nowMs)
      if (age > maxAgeMs) {
        try {
          rmSync(runPath, { recursive: true, force: true })
          removed++
        } catch {
          // leave it for the next startup
        }
      }
    }
  }
  return removed
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
