import { readdir, rename } from 'fs/promises'
import {
  appendSupervisorJsonlLine,
  buildSupervisorJsonlEnvelope,
  getNextSupervisorJsonlSeq,
  readSupervisorJsonlTolerant,
} from './jsonl.js'
import {
  ensureAgentSupervisorBaseDirs,
  ensureAgentSupervisorJobDir,
  getAgentSupervisorJobPaths,
  getAgentSupervisorJobsDir,
} from './paths.js'
import { upsertAgentSupervisorRosterJob } from './roster.js'
import {
  AgentSupervisorJobIdSchema,
  createInitialAgentSupervisorJobState,
  type AgentSupervisorEventMessage,
  type AgentSupervisorJobId,
  type AgentSupervisorJobState,
} from './schema.js'
import {
  AgentSupervisorStateCorruptError,
  readAgentSupervisorJobState,
  updateAgentSupervisorJobState,
  writeAgentSupervisorJobState,
} from './state.js'
import { latestAgentSupervisorResultPayload } from './resultPayload.js'
import { cleanupAgentSupervisorWorktree } from './worktreeIsolation.js'

export type AgentSupervisorRecoveredState = {
  state: AgentSupervisorJobState
  recovered: boolean
  corruptPath?: string
  malformedEventLines: number
  partialTrailingEventLine: boolean
}

function safeTimestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function summarizeRecoveredStatus(
  events: Partial<AgentSupervisorEventMessage>[],
): AgentSupervisorJobState['status'] {
  const last = events.at(-1)
  if (last?.kind === 'assistant_done') return 'completed'
  if (events.some(event => event.kind === 'stop_requested')) return 'stopped'
  if (last?.kind === 'exited') {
    return last.exitCode === 0 ? 'completed' : 'failed'
  }
  if (events.some(event => event.kind === 'needs_input')) return 'needs_input'
  if (events.length > 0) return 'idle'
  return 'failed'
}

function rebuildStateFromEvents(
  jobId: AgentSupervisorJobId,
  events: Partial<AgentSupervisorEventMessage>[],
  errorMessage: string,
): AgentSupervisorJobState {
  const now = new Date().toISOString()
  const started = events.find(event => event.kind === 'started')
  const exited = [...events].reverse().find(event => event.kind === 'exited')
  const done = [...events]
    .reverse()
    .find(event => event.kind === 'assistant_done')
  const question = [...events]
    .reverse()
    .find(event => event.kind === 'needs_input')
  const resultPayload = latestAgentSupervisorResultPayload(events)

  const state = createInitialAgentSupervisorJobState({
    id: jobId,
    title: `Recovered job ${jobId}`,
    cwd: process.cwd(),
    promptPreview: 'Recovered from corrupt supervisor state',
    sessionId:
      started && 'sessionId' in started && typeof started.sessionId === 'string'
        ? started.sessionId
        : null,
    now,
  })
  state.status = summarizeRecoveredStatus(events)
  state.updatedAt = now
  state.summary =
    resultPayload?.summary ??
    (done && 'summary' in done && typeof done.summary === 'string'
      ? done.summary
      : null)
  state.resultPayload = resultPayload
  state.process = {
    pid: started && typeof started.pid === 'number' ? started.pid : null,
    alive: false,
    lastStartedAt:
      started && typeof started.ts === 'string' ? started.ts : null,
    lastExitedAt: exited && typeof exited.ts === 'string' ? exited.ts : null,
    exitCode:
      exited && typeof exited.exitCode === 'number' ? exited.exitCode : null,
    signal: exited && typeof exited.signal === 'string' ? exited.signal : null,
    expectedCmdlineSubstring: null,
  }
  if (
    question &&
    typeof question.ts === 'string' &&
    typeof question.seq === 'number' &&
    typeof question.question === 'string'
  ) {
    state.lastQuestion = {
      ts: question.ts,
      fromEventSeq: question.seq,
      text: question.question,
      options: Array.isArray(question.options) ? question.options : [],
      suggestedReply:
        typeof question.suggestedReply === 'string'
          ? question.suggestedReply
          : null,
    }
  }
  state.counters.eventSeqHigh = events.reduce(
    (max, event) =>
      typeof event.seq === 'number' && Number.isInteger(event.seq)
        ? Math.max(max, event.seq)
        : max,
    0,
  )
  state.errors = [
    {
      ts: now,
      source: 'recovery',
      message: `state.json was corrupt and rebuilt: ${errorMessage}`,
    },
  ]
  return state
}

export async function readAgentSupervisorJobStateOrRecover(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorRecoveredState> {
  try {
    const state = await readAgentSupervisorJobState(jobId)
    if (state) {
      return {
        state,
        recovered: false,
        malformedEventLines: 0,
        partialTrailingEventLine: false,
      }
    }
  } catch (error) {
    if (!(error instanceof AgentSupervisorStateCorruptError)) {
      throw error
    }
    const paths = await ensureAgentSupervisorJobDir(jobId)
    const corruptPath = `${paths.state}.corrupt-${safeTimestampForPath()}`
    await rename(paths.state, corruptPath)
    const eventRead = await readSupervisorJsonlTolerant<
      Partial<AgentSupervisorEventMessage>
    >(paths.events)
    const rebuilt = rebuildStateFromEvents(
      jobId,
      eventRead.records,
      error.message,
    )
    await writeAgentSupervisorJobState(rebuilt)
    return {
      state: rebuilt,
      recovered: true,
      corruptPath,
      malformedEventLines: eventRead.malformedLines,
      partialTrailingEventLine: eventRead.partialTrailingLine,
    }
  }

  const paths = getAgentSupervisorJobPaths(jobId)
  const eventRead = await readSupervisorJsonlTolerant<
    Partial<AgentSupervisorEventMessage>
  >(paths.events)
  const rebuilt = rebuildStateFromEvents(
    jobId,
    eventRead.records,
    'state.json missing',
  )
  await writeAgentSupervisorJobState(rebuilt)
  return {
    state: rebuilt,
    recovered: true,
    malformedEventLines: eventRead.malformedLines,
    partialTrailingEventLine: eventRead.partialTrailingLine,
  }
}

function pidStillAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isStaleNonTerminalState(state: AgentSupervisorJobState): boolean {
  return (
    !state.process.alive &&
    (
      state.status === 'queued' ||
      state.status === 'working' ||
      state.status === 'idle'
    )
  )
}

export type SupervisorReconcileSummary = {
  jobsScanned: number
  jobsMarkedDead: number
  worktreesCleaned: number
  errors: Array<{ jobId: string; message: string }>
}

/**
 * Boot-time housekeeping for the Agent View dashboard.
 *
 * Walks every persisted job under `~/.mossen/jobs/` and reconciles two
 * common forms of stale state left behind by crashed / kill -9'd workers:
 *
 *   1. `state.json.process.alive === true` but the recorded pid no longer
 *      exists on this host. Mark the job failed, append an `exited` event,
 *      and refresh the roster so the dashboard list shows the truth.
 *   2. Owned worktrees (created by `prepareAgentSupervisorWorktree`) whose
 *      job is no longer running. Run `cleanupAgentSupervisorWorktree`,
 *      which already enforces ownership-marker + dirty-tree safety gates,
 *      so live in-flight worktrees with uncommitted changes are preserved.
 *
 * Errors per-job are collected but do not abort the sweep — one corrupt
 * job must not prevent the dashboard from booting.
 */
export async function reconcileDeadSupervisorJobs(): Promise<SupervisorReconcileSummary> {
  const summary: SupervisorReconcileSummary = {
    jobsScanned: 0,
    jobsMarkedDead: 0,
    worktreesCleaned: 0,
    errors: [],
  }
  try {
    await ensureAgentSupervisorBaseDirs()
  } catch (error) {
    summary.errors.push({
      jobId: '(base-dirs)',
      message: error instanceof Error ? error.message : String(error),
    })
    return summary
  }
  let entries: string[]
  try {
    entries = await readdir(getAgentSupervisorJobsDir())
  } catch {
    return summary
  }
  for (const rawId of entries) {
    const parsed = AgentSupervisorJobIdSchema.safeParse(rawId)
    if (!parsed.success) continue
    const jobId = parsed.data
    summary.jobsScanned += 1
    try {
      const state = await readAgentSupervisorJobState(jobId)
      if (!state) continue
      // Detect stale active jobs:
      // 1. state insists the worker is up, but its pid is gone.
      // 2. old pre-PTY/state-migration jobs can say queued/working/idle even
      //    though process.alive is already false. Those rows must not route
      //    Enter into a dead attach socket forever.
      if (
        (state.process.alive && !pidStillAlive(state.process.pid)) ||
        isStaleNonTerminalState(state)
      ) {
        const exitedAt = new Date().toISOString()
        const paths = getAgentSupervisorJobPaths(jobId)
        const signal = state.process.alive
          ? 'reconciled_pid_gone'
          : 'reconciled_inactive_nonterminal'
        try {
          const seq = await getNextSupervisorJsonlSeq(paths.events)
          await appendSupervisorJsonlLine(paths.events, {
            ...buildSupervisorJsonlEnvelope({
              seq,
              kind: 'exited',
              source: 'supervisor',
              ts: exitedAt,
            }),
            exitCode: null,
            signal,
          })
        } catch (error) {
          summary.errors.push({
            jobId,
            message: `events append: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        }
        try {
          const next = await updateAgentSupervisorJobState(jobId, current => {
            if (!current) return current
            return {
              ...current,
              updatedAt: exitedAt,
              status: 'failed',
              process: {
                ...current.process,
                alive: false,
                lastExitedAt: current.process.lastExitedAt ?? exitedAt,
                exitCode: null,
                signal: current.process.signal ?? signal,
              },
              errors: [
                ...current.errors,
                {
                  ts: exitedAt,
                  source: 'recovery',
                  message: `Worker process is no longer alive (${signal}).`,
                },
              ],
            }
          })
          if (next) {
            await upsertAgentSupervisorRosterJob(next)
            summary.jobsMarkedDead += 1
          }
        } catch (error) {
          summary.errors.push({
            jobId,
            message: `state update: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        }
      }
      // Re-read state after potential update so we see the latest alive.
      const refreshed = await readAgentSupervisorJobState(jobId)
      if (!refreshed) continue
      if (refreshed.process.alive) continue // never touch a live worker
      try {
        const result = await cleanupAgentSupervisorWorktree(jobId)
        if (result.cleaned) summary.worktreesCleaned += 1
      } catch (error) {
        summary.errors.push({
          jobId,
          message: `worktree cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      }
    } catch (error) {
      summary.errors.push({
        jobId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return summary
}
