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
import type { WorkflowFinalReport } from '../finalReport.js'

const JOURNAL_FILE = 'journal.jsonl'
const SCRIPT_FILE = 'script.js'
const META_FILE = 'run.json'
const LOG_FILE = 'progress.log'
const REPORT_FILE = 'report.md'
const FINAL_REPORT_FILE = 'final-report.json'
const CHECKPOINT_FILE = 'checkpoint.json'
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
  allowedTools?: string[]
  allowedRoots?: string[]
  allowedHosts?: string[]
  createdAt: string
  status: Extract<TaskStatus, 'running' | 'paused' | 'completed' | 'failed' | 'killed'>
  agentCount?: number
  totalToolCalls?: number
  tokensSpent?: number
  failures?: string[]
  timeoutMs?: number
  timedOut?: boolean
  timeoutKind?: 'workflow' | 'phase'
  timeoutLimitMs?: number
  timeoutElapsedMs?: number
  timeoutActiveAgentCount?: number
  timeoutPhase?: string | null
  maxAgents?: number
  maxParallel?: number
  maxNestedWorkflows?: number
  phaseTimeoutMs?: number
  durationMs?: number
  result?: string
  error?: string
  finalReportPath?: string
}

export type WorkflowCheckpointResumeSafety = {
  canResume: boolean
  blockedReason: string | null
  nextAction: 'resume' | 'wait' | 'relaunch' | 'inspect'
}

export type WorkflowCheckpoint = {
  version: 1
  runId: string
  workflowName: string
  status: WorkflowRunMeta['status']
  createdAt: string
  generatedAt: string
  scriptPath: string
  scriptExists: boolean
  journalPath: string
  journalExists: boolean
  reportPath: string
  finalReportPath: string
  finalReportExists: boolean
  counts: {
    started: number
    completed: number
    pendingStarted: number
    failures: number
  }
  lastStartedIndex: number | null
  lastCompletedIndex: number | null
  pendingStartedAgents: Array<{
    index: number
    agentNumber: number
    label: string
    phase: string | null
    lastProgressAt?: number
  }>
  resumeSafety: WorkflowCheckpointResumeSafety
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

function runMetaPath(runId: string): string {
  return join(runDir(runId), META_FILE)
}

function journalPath(runId: string): string {
  return join(runDir(runId), JOURNAL_FILE)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readRunMetaRaw(runId: string): WorkflowRunMeta | null {
  try {
    const path = runMetaPath(runId)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as WorkflowRunMeta
  } catch {
    return null
  }
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
    writeFileSync(runMetaPath(runId), JSON.stringify(meta, null, 2), 'utf8')
    writeWorkflowCheckpointForMeta(meta)
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
    appendFileSync(journalPath(runId), `${JSON.stringify(entry)}\n`, 'utf8')
    const meta = readRunMetaRaw(runId)
    if (meta) writeWorkflowCheckpointForMeta(meta)
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
    const path = runMetaPath(runId)
    const prior = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as WorkflowRunMeta)
      : null
    if (!prior) return
    const next = { ...prior, ...patch }
    writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
    writeWorkflowCheckpointForMeta(next)
  } catch {
    // ignore
  }
}

/** Load a prior run's journal entries for resume. Returns null if none. */
export function loadJournal(runId: string): JournalData | null {
  try {
    const path = journalPath(runId)
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
    const path = runMetaPath(runId)
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

/** Absolute path to a run's machine-readable final report. */
export function workflowFinalReportPath(runId: string): string {
  return join(runDir(runId), FINAL_REPORT_FILE)
}

/** Absolute path to a run's recovery checkpoint summary. */
export function workflowCheckpointPath(runId: string): string {
  return join(runDir(runId), CHECKPOINT_FILE)
}

/** Persist a bounded machine-readable final report for goal/workflow evidence. */
export function saveWorkflowFinalReport(
  runId: string,
  report: WorkflowFinalReport,
): string | null {
  try {
    const dir = runDir(runId)
    ensureDir(dir)
    const path = join(dir, FINAL_REPORT_FILE)
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8')
    return path
  } catch {
    return null
  }
}

/** Read a run's machine-readable final report, if present. */
export function loadWorkflowFinalReport(
  runId: string,
): WorkflowFinalReport | null {
  try {
    const path = workflowFinalReportPath(runId)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as WorkflowFinalReport
  } catch {
    return null
  }
}

function maxIndex(values: Array<number | undefined>): number | null {
  const numbers = values.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value),
  )
  return numbers.length ? Math.max(...numbers) : null
}

function resumeSafetyForCheckpoint(params: {
  status: WorkflowRunMeta['status']
  scriptExists: boolean
}): WorkflowCheckpointResumeSafety {
  if (params.status === 'running') {
    return {
      canResume: false,
      blockedReason: 'run is still marked running',
      nextAction: 'wait',
    }
  }
  if (params.status === 'completed') {
    return {
      canResume: false,
      blockedReason: 'run already completed',
      nextAction: 'inspect',
    }
  }
  if (params.status === 'failed') {
    return {
      canResume: false,
      blockedReason: 'run failed; relaunch without resumeFromRunId',
      nextAction: 'relaunch',
    }
  }
  if (!params.scriptExists) {
    return {
      canResume: false,
      blockedReason: 'checkpoint script snapshot is missing',
      nextAction: 'inspect',
    }
  }
  return {
    canResume: true,
    blockedReason: null,
    nextAction: 'resume',
  }
}

function buildWorkflowCheckpointFromMeta(
  meta: WorkflowRunMeta,
): WorkflowCheckpoint {
  const journal = loadJournal(meta.runId)
  const entries = journal?.entries ?? []
  const started = journal?.started ?? []
  const completedKeys = new Set(entries.map(entry => `${entry.index}\0${entry.hash}`))
  const pendingStartedAgents = started
    .filter(entry => !completedKeys.has(`${entry.index}\0${entry.hash}`))
    .map(entry => ({
      index: entry.index,
      agentNumber: entry.agentNumber,
      label: entry.label,
      phase: entry.phase,
      ...(typeof entry.lastProgressAt === 'number'
        ? { lastProgressAt: entry.lastProgressAt }
        : {}),
    }))
  const scriptPath = meta.scriptPath ?? runScriptPath(meta.runId)
  const finalReportPath = meta.finalReportPath ?? workflowFinalReportPath(meta.runId)
  const scriptExists = existsSync(scriptPath)
  return {
    version: 1,
    runId: meta.runId,
    workflowName: meta.workflowName,
    status: meta.status,
    createdAt: meta.createdAt,
    generatedAt: new Date().toISOString(),
    scriptPath,
    scriptExists,
    journalPath: journalPath(meta.runId),
    journalExists: existsSync(journalPath(meta.runId)),
    reportPath: workflowReportPath(meta.runId),
    finalReportPath,
    finalReportExists: existsSync(finalReportPath),
    counts: {
      started: started.length,
      completed: entries.length,
      pendingStarted: pendingStartedAgents.length,
      failures: meta.failures?.length ?? 0,
    },
    lastStartedIndex: maxIndex(started.map(entry => entry.index)),
    lastCompletedIndex: maxIndex(entries.map(entry => entry.index)),
    pendingStartedAgents,
    resumeSafety: resumeSafetyForCheckpoint({
      status: meta.status,
      scriptExists,
    }),
  }
}

function writeWorkflowCheckpointForMeta(
  meta: WorkflowRunMeta,
): WorkflowCheckpoint | null {
  try {
    const checkpoint = buildWorkflowCheckpointFromMeta(meta)
    const path = workflowCheckpointPath(meta.runId)
    ensureDir(runDir(meta.runId))
    writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf8')
    return checkpoint
  } catch {
    return null
  }
}

/** Refresh and persist the checkpoint from current run metadata + journal. */
export function refreshWorkflowCheckpoint(
  runId: string,
): WorkflowCheckpoint | null {
  const meta = loadRunMeta(runId)
  if (!meta) return null
  return writeWorkflowCheckpointForMeta(meta)
}

/** Read the persisted checkpoint artifact without mutating run state. */
export function loadWorkflowCheckpoint(runId: string): WorkflowCheckpoint | null {
  try {
    const path = workflowCheckpointPath(runId)
    if (!existsSync(path)) return null
    const payload = JSON.parse(readFileSync(path, 'utf8')) as WorkflowCheckpoint
    return payload.version === 1 ? payload : null
  } catch {
    return null
  }
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
    writeWorkflowCheckpointForMeta(normalized)
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
