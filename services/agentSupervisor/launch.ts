import { spawn } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { statSync } from 'fs'
import { stat } from 'fs/promises'
import { resolve } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { saveProjectConfigForPath } from '../../utils/config.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { createAttachServer } from './attachServer.js'
import {
  appendSupervisorJsonlLine,
  buildSupervisorJsonlEnvelope,
  getNextSupervisorJsonlSeq,
  readSupervisorJsonlTolerant,
} from './jsonl.js'
import {
  getAgentSupervisorJobPaths,
  type AgentSupervisorJobPaths,
} from './paths.js'
import { spawnPty, type PtySession } from './ptyBun.js'
import { upsertAgentSupervisorRosterJob } from './roster.js'
import {
  createInitialAgentSupervisorJobState,
  AgentSupervisorJobIdSchema,
  type AgentSupervisorInputMessage,
  type AgentSupervisorJobId,
  type AgentSupervisorJobState,
} from './schema.js'
import {
  readAgentSupervisorJobState,
  updateAgentSupervisorJobState,
  writeAgentSupervisorJobState,
} from './state.js'
import {
  getAgentSupervisorTranscriptPathForCwd,
  writeAgentSupervisorTranscriptLink,
} from './transcriptLink.js'
import {
  deriveAgentSupervisorRowSummary,
  refreshAgentSupervisorRowSummary,
} from './summary.js'
import { createAgentSupervisorResultPayload } from './resultPayload.js'
import { getAgentSupervisorSelfCommand } from './selfCommand.js'
import {
  prepareAgentSupervisorWorktree,
  writeNonIsolatedAgentSupervisorWorktree,
} from './worktreeIsolation.js'

const MIN_BACKGROUND_PROMPT_LENGTH = 3

// Persistent supervisor worker loop tunables. The worker process stays alive
// for the lifetime of the PTY mossen TUI, polling input.jsonl + control.jsonl
// at this cadence to deliver queued prompts and detect stop requests. The
// poll is cheap (small JSONL tails) and only runs in the worker.
const SUPERVISOR_INPUT_POLL_MS = 400
// Delay between PTY spawn and writing the initial prompt as keystrokes. Lets
// the mossen TUI finish its first render so the prompt characters land in
// the input box (not in any pre-render trust dialog).
const SUPERVISOR_INITIAL_PROMPT_DELAY_MS = 1500

// node-pty's onexit callback passes a POSIX signal integer (0 = clean exit).
// The job state schema stores `signal` as a nullable display string. Map the
// common signals to their canonical names so downstream UIs (peek snapshot,
// detail dialog) show "SIGHUP" instead of opaque numbers.
const PTY_EXIT_SIGNAL_NAMES: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM',
}

function ptyExitSignalName(signal: number): string | null {
  if (!signal) return null
  return PTY_EXIT_SIGNAL_NAMES[signal] ?? `SIG_${signal}`
}

function getAgentSupervisorPtyChildCommand(): {
  command: string
  argsPrefix: string[]
} {
  const harnessCommand =
    process.env.MOSSEN_CODE_AGENT_SUPERVISOR_PTY_CHILD_COMMAND
  if (process.env.MOSSEN_HARNESS === '1' && harnessCommand) {
    let argsPrefix: string[] = []
    const rawArgs =
      process.env.MOSSEN_CODE_AGENT_SUPERVISOR_PTY_CHILD_ARGS_JSON
    if (rawArgs) {
      try {
        const parsed = JSON.parse(rawArgs) as unknown
        if (
          Array.isArray(parsed) &&
          parsed.every(item => typeof item === 'string')
        ) {
          argsPrefix = parsed
        }
      } catch {
        argsPrefix = []
      }
    }
    return { command: harnessCommand, argsPrefix }
  }

  return getAgentSupervisorSelfCommand()
}

export type LaunchAgentSupervisorBackgroundJobOptions = {
  prompt: string
  cwd?: string
  model?: string | null
  permissionMode?: string | null
  effort?: string | null
  agent?: string | null
  settings?: string | null
  addDirs?: string[]
  mcpConfig?: string[]
  pluginDirs?: string[]
  strictMcpConfig?: boolean
  fallbackModel?: string | null
  allowDangerouslySkipPermissions?: boolean
  dangerouslySkipPermissions?: boolean
  testMode?: boolean
  sessionId?: string | null
  parentWorkflowId?: string | null
  parentGoalId?: string | null
  forceWorktreeIsolation?: boolean
}

export type LaunchAgentSupervisorBackgroundJobResult = {
  id: AgentSupervisorJobId
  state: AgentSupervisorJobState
}

function createJobId(): AgentSupervisorJobId {
  return `j${randomBytes(6).toString('hex')}` as AgentSupervisorJobId
}

function previewPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim()
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177)}...`
}

function getFsErrorCode(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}

function formatAgentSupervisorCwdError(options: {
  cwd: string
  reason: 'unavailable' | 'not_directory'
  code?: string | null
}): string {
  const suffix = options.code ? ` (${options.code})` : ''
  if (options.reason === 'not_directory') {
    return getLocalizedText({
      en: `Agent View cwd is not a directory: ${options.cwd}${suffix}. Choose an existing directory or pass --cwd <path>.`,
      zh: `Agent View cwd 不是目录:${options.cwd}${suffix}。请选择存在的目录，或传入 --cwd <path>。`,
    })
  }
  return getLocalizedText({
    en: `Agent View cwd is unavailable: ${options.cwd}${suffix}. Choose an existing directory or pass --cwd <path>.`,
    zh: `Agent View cwd 不可用:${options.cwd}${suffix}。请选择存在的目录，或传入 --cwd <path>。`,
  })
}

async function resolveAgentSupervisorLaunchCwd(cwd: string): Promise<string> {
  const resolved = resolve(cwd)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolved)
  } catch (error) {
    throw new Error(
      formatAgentSupervisorCwdError({
        cwd: resolved,
        reason: 'unavailable',
        code: getFsErrorCode(error),
      }),
    )
  }
  if (!info.isDirectory()) {
    throw new Error(
      formatAgentSupervisorCwdError({
        cwd: resolved,
        reason: 'not_directory',
      }),
    )
  }
  return resolved
}

function getAgentSupervisorWorkerCwdError(cwd: string): string | null {
  const resolved = resolve(cwd)
  try {
    const info = statSync(resolved)
    return info.isDirectory()
      ? null
      : formatAgentSupervisorCwdError({
          cwd: resolved,
          reason: 'not_directory',
        })
  } catch (error) {
    return formatAgentSupervisorCwdError({
      cwd: resolved,
      reason: 'unavailable',
      code: getFsErrorCode(error),
    })
  }
}

function markAgentSupervisorWorktreeTrusted(cwd: string): void {
  try {
    saveProjectConfigForPath(cwd, current => ({
      ...current,
      hasTrustDialogAccepted: true,
    }))
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Config accessed before allowed.'
    ) {
      // Some static/runtime smokes import the supervisor launcher before the
      // CLI has enabled config access. Real CLI launches run after config
      // initialization, so only skip this early-eval trust convenience guard.
      return
    }
    throw error
  }
}

export async function readAgentSupervisorInitialPrompt(
  paths: AgentSupervisorJobPaths,
): Promise<string> {
  const { records } =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorInputMessage>>(
      paths.input,
    )
  const first = records.find(record => record.kind === 'user_message')
  return typeof first?.content === 'string' ? first.content : ''
}

export async function readAgentSupervisorLatestPrompt(
  paths: AgentSupervisorJobPaths,
): Promise<string> {
  return (await readAgentSupervisorLatestPromptEntry(paths))?.prompt ?? ''
}

export async function readAgentSupervisorLatestPromptEntry(
  paths: AgentSupervisorJobPaths,
): Promise<{ prompt: string; seq: number } | null> {
  const { records } =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorInputMessage>>(
      paths.input,
    )
  const latest = [...records]
    .reverse()
    .find(record => record.kind === 'user_message' || record.kind === 'choice')
  if (latest?.kind === 'user_message' && typeof latest.content === 'string') {
    return { prompt: latest.content, seq: latest.seq ?? 0 }
  }
  if (latest?.kind === 'choice' && typeof latest.choiceKey === 'string') {
    return {
      prompt: `Selected option: ${latest.choiceKey}`,
      seq: latest.seq ?? 0,
    }
  }
  return null
}

async function updateJob(
  id: AgentSupervisorJobId,
  updater: (state: AgentSupervisorJobState) => AgentSupervisorJobState,
): Promise<AgentSupervisorJobState> {
  const next = await updateAgentSupervisorJobState(id, current => {
    if (!current) throw new Error(`Missing supervisor job state: ${id}`)
    return updater(current)
  })
  await upsertAgentSupervisorRosterJob(next)
  return next
}

async function readSupervisorStopRequest(
  paths: AgentSupervisorJobPaths,
): Promise<boolean> {
  const { records } = await readSupervisorJsonlTolerant<{ kind?: string }>(
    paths.control,
  )
  return records.some(
    record => record.kind === 'stop' || record.kind === 'shutdown',
  )
}

async function markAgentSupervisorWorkerLaunchFailed(
  id: AgentSupervisorJobId,
  message: string,
): Promise<void> {
  const paths = getAgentSupervisorJobPaths(id)
  const failedAt = new Date().toISOString()
  const outputSeq = await getNextSupervisorJsonlSeq(paths.output)
  await appendSupervisorJsonlLine(paths.output, {
    ...buildSupervisorJsonlEnvelope({
      seq: outputSeq,
      kind: 'tool_result',
      source: 'job',
    }),
    tool: 'supervisor',
    exitCode: 1,
    stderrTail: message,
  })
  const eventSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: eventSeq,
      kind: 'exited',
      source: 'job',
    }),
    exitCode: 1,
    signal: null,
  })
  await updateJob(id, current => ({
    ...current,
    updatedAt: failedAt,
    status: 'failed',
    summary: message,
    process: {
      ...current.process,
      alive: false,
      lastExitedAt: failedAt,
      exitCode: 1,
      signal: null,
    },
    counters: {
      ...current.counters,
      eventSeqHigh: Math.max(current.counters.eventSeqHigh, eventSeq),
      outputSeqHigh: Math.max(current.counters.outputSeqHigh, outputSeq),
    },
  }))
  await refreshAgentSupervisorRowSummary(id, { force: true })
}

export function startAgentSupervisorJobWorkerProcess(
  id: AgentSupervisorJobId,
  options: { cwd: string; testMode?: boolean },
): void {
  if (
    options.testMode &&
    process.env.MOSSEN_CODE_AGENT_SUPERVISOR_IN_PROCESS_TEST_WORKER === '1'
  ) {
    void runAgentSupervisorJobWorker(id, { testMode: true })
    return
  }
  const cwdError = getAgentSupervisorWorkerCwdError(options.cwd)
  if (cwdError) {
    void markAgentSupervisorWorkerLaunchFailed(id, cwdError)
    return
  }
  const { command, argsPrefix } = getAgentSupervisorSelfCommand()
  const args = [...argsPrefix, '--supervisor-job', id]
  if (options.testMode) {
    args.push('--supervisor-test-job')
  }
  let child: ReturnType<typeof spawn>
  try {
    // Redirect worker stdout/stderr to per-job log files. The worker is
    // otherwise detached with stdio:'ignore', so any uncaught throw (e.g.
    // node-pty failing to load, FFI dlopen mismatch, mossen TUI crash) goes
    // silently to /dev/null and the dashboard sees a "working" job whose
    // socket never came up. With these logs the next crash is grep-able.
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const jobDir = path.dirname(getAgentSupervisorJobPaths(id).state)
    fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 })
    const stdoutFd = fs.openSync(path.join(jobDir, 'worker.stdout.log'), 'a', 0o600)
    const stderrFd = fs.openSync(path.join(jobDir, 'worker.stderr.log'), 'a', 0o600)
    child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      env: {
        ...process.env,
        MOSSEN_CODE_AGENT_SUPERVISOR_JOB_ID: id,
      },
    })
    // Close parent's copies of the file descriptors; the child has its own.
    fs.closeSync(stdoutFd)
    fs.closeSync(stderrFd)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : getLocalizedText({
            en: 'Agent View worker failed to start.',
            zh: 'Agent View worker 启动失败。',
          })
    void markAgentSupervisorWorkerLaunchFailed(id, message)
    return
  }
  child.unref()
}

export async function launchAgentSupervisorBackgroundJob(
  options: LaunchAgentSupervisorBackgroundJobOptions,
): Promise<LaunchAgentSupervisorBackgroundJobResult> {
  const prompt = options.prompt.trim()
  if (prompt.length < MIN_BACKGROUND_PROMPT_LENGTH) {
    throw new Error('Background job prompt is too short.')
  }

  const requestedCwd = await resolveAgentSupervisorLaunchCwd(
    options.cwd ?? getCwd(),
  )
  const id = createJobId()
  const paths = getAgentSupervisorJobPaths(id)
  const sessionId = options.sessionId ?? (options.testMode ? null : randomUUID())
  const worktree =
    options.testMode && !options.forceWorktreeIsolation
      ? {
          cwd: requestedCwd,
          metadata: await writeNonIsolatedAgentSupervisorWorktree(
            id,
            'test_mode',
          ),
          isolated: false,
        }
      : await prepareAgentSupervisorWorktree(id, requestedCwd)
  if (worktree.isolated) {
    markAgentSupervisorWorktreeTrusted(worktree.cwd)
  }
  const cwd = worktree.cwd
  const transcriptPath = sessionId
    ? getAgentSupervisorTranscriptPathForCwd(cwd, sessionId)
    : null
  const state = createInitialAgentSupervisorJobState({
    id,
    title: previewPrompt(prompt),
    cwd,
    promptPreview: previewPrompt(prompt),
    model: options.model ?? null,
    permissionMode: options.permissionMode ?? null,
    effort: options.effort ?? null,
    agent: options.agent ?? null,
    settings: options.settings ?? null,
    addDirs: options.addDirs ?? [],
    mcpConfig: options.mcpConfig ?? [],
    pluginDirs: options.pluginDirs ?? [],
    strictMcpConfig: options.strictMcpConfig ?? false,
    fallbackModel: options.fallbackModel ?? null,
    allowDangerouslySkipPermissions:
      options.allowDangerouslySkipPermissions ?? false,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
    sessionId,
    parentWorkflowId: options.parentWorkflowId ?? null,
    parentGoalId: options.parentGoalId ?? null,
  })
  await writeAgentSupervisorJobState(state)
  if (sessionId) {
    await writeAgentSupervisorTranscriptLink({
      schemaVersion: 1,
      jobId: id,
      sessionId,
      transcriptPath,
      sidechainTranscriptPath: null,
      updatedAt: new Date().toISOString(),
    })
  }
  await upsertAgentSupervisorRosterJob(state)
  await appendSupervisorJsonlLine(paths.input, {
    ...buildSupervisorJsonlEnvelope({
      seq: 1,
      kind: 'user_message',
      source: 'cli_input',
    }),
    content: prompt,
  })

  startAgentSupervisorJobWorkerProcess(id, {
    cwd: state.cwd,
    testMode: options.testMode,
  })
  return { id, state }
}

// Process exactly one Agent View supervisor turn (started event + output
// recording + final state update). Used both by the persistent loop inside
// runAgentSupervisorJobWorker and by the in-process deterministic test worker
// that only processes the initial prompt.
async function processSupervisorJobTurn(
  jobId: AgentSupervisorJobId,
  paths: AgentSupervisorJobPaths,
  promptEntry: { prompt: string; seq: number },
  options: { testMode?: boolean },
): Promise<void> {
  const state = await readAgentSupervisorJobState(jobId)
  if (!state) {
    throw new Error(`Missing supervisor job state: ${jobId}`)
  }
  const prompt = promptEntry.prompt
  const startedAt = new Date().toISOString()
  const startedSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: startedSeq,
      kind: 'started',
      source: 'job',
      ts: startedAt,
    }),
    pid: process.pid,
    sessionId: state.sessionId,
  })
  await updateJob(jobId, current => ({
    ...current,
    updatedAt: startedAt,
    status: 'working',
    process: {
      ...current.process,
      pid: process.pid,
      alive: true,
      lastStartedAt: startedAt,
      expectedCmdlineSubstring: `--supervisor-job ${jobId}`,
    },
    counters: {
      ...current.counters,
      eventSeqHigh: Math.max(current.counters.eventSeqHigh, startedSeq),
    },
  }))

  if (options.testMode) {
    const outputSeq = await getNextSupervisorJsonlSeq(paths.output)
    await appendSupervisorJsonlLine(paths.output, {
      ...buildSupervisorJsonlEnvelope({
        seq: outputSeq,
        kind: 'assistant_text',
        source: 'job',
      }),
      text: `deterministic supervisor job completed: ${prompt}`,
    })
    const completionSummary =
      (await deriveAgentSupervisorRowSummary(jobId)).summary ??
      'Deterministic supervisor job completed.'
    const completionPayload = createAgentSupervisorResultPayload(
      completionSummary,
    )
    const resultSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: resultSeq,
        kind: 'result_payload',
        source: 'job',
      }),
      payload: completionPayload,
    })
    const doneSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: doneSeq,
        kind: 'assistant_done',
        source: 'job',
      }),
      summary: completionSummary,
    })
    const exitedSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: exitedSeq,
        kind: 'exited',
        source: 'job',
      }),
      exitCode: 0,
      signal: null,
    })
    const completedAt = new Date().toISOString()
    await updateJob(jobId, current => ({
      ...current,
      updatedAt: completedAt,
      status: 'completed',
      summary: completionSummary,
      resultPayload: completionPayload,
      process: {
        ...current.process,
        // testMode workers are single-turn and exit after the initial
        // prompt to match the legacy supervisor fixture contract
        // (status=completed + process.alive=false + exitCode=0).
        alive: false,
        lastExitedAt: completedAt,
        exitCode: 0,
        signal: null,
      },
      counters: {
        ...current.counters,
        eventSeqHigh: Math.max(current.counters.eventSeqHigh, exitedSeq),
        outputSeqHigh: Math.max(current.counters.outputSeqHigh, outputSeq),
      },
    }))
    await refreshAgentSupervisorRowSummary(jobId, { force: true })
    return
  }

  const { command, argsPrefix } = getAgentSupervisorSelfCommand()
  const args = [...argsPrefix, '-p', prompt]
  if (state.sessionId) {
    if (state.process.lastExitedAt || state.counters.inputSeqHigh > 1) {
      args.push('--resume', state.sessionId)
    } else {
      args.push('--session-id', state.sessionId)
    }
  }
  if (state.model) args.push('--model', state.model)
  if (state.permissionMode) args.push('--permission-mode', state.permissionMode)
  if (state.effort) args.push('--effort', state.effort)
  if (state.agent) args.push('--agent', state.agent)
  if (state.settings) args.push('--settings', state.settings)
  for (const dir of state.addDirs) {
    args.push('--add-dir', dir)
  }
  for (const config of state.mcpConfig) {
    args.push('--mcp-config', config)
  }
  for (const pluginDir of state.pluginDirs) {
    args.push('--plugin-dir', pluginDir)
  }
  if (state.strictMcpConfig) {
    args.push('--strict-mcp-config')
  }
  if (state.fallbackModel) {
    args.push('--fallback-model', state.fallbackModel)
  }
  if (state.allowDangerouslySkipPermissions) {
    args.push('--allow-dangerously-skip-permissions')
  }
  if (state.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  const child = spawn(command, args, {
    cwd: state.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MOSSEN_CODE_AGENT_SUPERVISOR_CHILD: jobId,
    },
  })

  let outputSeq = (await getNextSupervisorJsonlSeq(paths.output)) - 1
  child.stdout?.on('data', chunk => {
    outputSeq += 1
    void appendSupervisorJsonlLine(paths.output, {
      ...buildSupervisorJsonlEnvelope({
        seq: outputSeq,
        kind: 'assistant_text',
        source: 'job',
      }),
      text: String(chunk),
    })
  })
  child.stderr?.on('data', chunk => {
    outputSeq += 1
    void appendSupervisorJsonlLine(paths.output, {
      ...buildSupervisorJsonlEnvelope({
        seq: outputSeq,
        kind: 'tool_result',
        source: 'job',
      }),
      tool: 'stderr',
      exitCode: null,
      stderrTail: String(chunk).slice(-2000),
    })
  })

  const exit = await new Promise<{ code: number | null; signal: string | null }>(
    resolve => {
      child.on('exit', (code, signal) => resolve({ code, signal }))
      child.on('error', () => resolve({ code: 1, signal: null }))
    },
  )
  const doneAt = new Date().toISOString()
  const success = exit.code === 0 && exit.signal === null
  const finalSummary =
    (await deriveAgentSupervisorRowSummary(jobId)).summary ??
    (success ? 'Background job completed.' : 'Background job failed.')
  const resultPayload = success
    ? createAgentSupervisorResultPayload(finalSummary, doneAt)
    : null
  if (resultPayload) {
    const resultSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: resultSeq,
        kind: 'result_payload',
        source: 'job',
      }),
      payload: resultPayload,
    })
    const doneSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: doneSeq,
        kind: 'assistant_done',
        source: 'job',
      }),
      summary: finalSummary,
    })
  }
  const exitedSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: exitedSeq,
      kind: 'exited',
      source: 'job',
    }),
    exitCode: exit.code,
    signal: exit.signal,
  })
  await updateJob(jobId, current => ({
    ...current,
    updatedAt: doneAt,
    status: success ? 'completed' : 'failed',
    summary: finalSummary,
    resultPayload: resultPayload ?? current.resultPayload ?? null,
    process: {
      ...current.process,
      // Persistent worker stays alive—only the per-turn grandchild exited.
      // The loop's exit path is the only place that flips alive=false.
      alive: true,
      lastExitedAt: doneAt,
      exitCode: exit.code,
      signal: exit.signal,
    },
    counters: {
      ...current.counters,
      eventSeqHigh: Math.max(current.counters.eventSeqHigh, exitedSeq),
      outputSeqHigh: outputSeq,
    },
  }))
  await refreshAgentSupervisorRowSummary(jobId, { force: true })
}

export async function runAgentSupervisorJobWorker(
  rawJobId: string,
  options: { testMode?: boolean } = {},
): Promise<void> {
  const jobId = AgentSupervisorJobIdSchema.parse(rawJobId)
  const paths = getAgentSupervisorJobPaths(jobId)
  const state = await readAgentSupervisorJobState(jobId)
  if (!state) {
    throw new Error(`Missing supervisor job state: ${jobId}`)
  }

  // testMode workers (deterministic supervisor smoke + W283 management
  // lifecycle tests) keep the legacy "process the initial prompt, then
  // exit" contract. They never run a persistent loop because:
  //   - in-process test workers share their driver's event loop and would
  //     block it,
  //   - subprocess test workers are checked for status=completed +
  //     process.alive=false by fixtures (see scripts/wave_w283*).
  // Only real, production-mode workers stay alive across turns.
  if (options.testMode) {
    const initial = await readAgentSupervisorLatestPromptEntry(paths)
    if (initial) {
      await processSupervisorJobTurn(jobId, paths, initial, options)
    }
    return
  }

  // Production workers run a single persistent mossen TUI inside a PTY for
  // the entire life of the job. The dashboard attaches/detaches to this PTY
  // via the per-job Unix socket; programmatic prompts (from /agents queueing
  // into input.jsonl) get typed into the TUI as keystrokes; control.jsonl
  // stop/shutdown signals tear it all down. The worker exits when the PTY
  // child exits — no idle timeout because the user, not a timer, decides
  // when an attached session is done.
  await runAgentSupervisorPtyWorker(jobId, paths, state)
}

async function runAgentSupervisorPtyWorker(
  jobId: AgentSupervisorJobId,
  paths: AgentSupervisorJobPaths,
  initialState: AgentSupervisorJobState,
): Promise<void> {
  // Catch any silent crash inside the worker process — node-pty load fails,
  // FFI mismatch, etc. — and route it to a per-job stderr log + mark the
  // job failed in state.json so the dashboard stops believing it's alive.
  const crashHandler = (label: string) => (err: unknown) => {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    try {
      console.error(`[supervisor-worker ${jobId}] ${label}:`, message)
    } catch {
      // stderr unavailable.
    }
    void markAgentSupervisorWorkerLaunchFailed(jobId, `${label}: ${message}`)
  }
  process.on('uncaughtException', crashHandler('uncaughtException'))
  process.on('unhandledRejection', crashHandler('unhandledRejection'))

  const { command, argsPrefix } = getAgentSupervisorPtyChildCommand()
  // Plain mossen TUI invocation — no --supervisor-job, no -p. The PTY-spawned
  // mossen renders interactively into the PTY just like a real terminal
  // session, accepts keystrokes from the attached dashboard, and writes its
  // own session/transcript files via the standard flow.
  const ptyArgs: string[] = [...argsPrefix]
  if (initialState.sessionId) {
    // Reuse the session so transcript/history match across reattaches when
    // /agents queues additional turns later.
    ptyArgs.push('--session-id', initialState.sessionId)
  }
  if (initialState.model) ptyArgs.push('--model', initialState.model)
  if (initialState.permissionMode) {
    ptyArgs.push('--permission-mode', initialState.permissionMode)
  }
  if (initialState.effort) ptyArgs.push('--effort', initialState.effort)
  if (initialState.agent) ptyArgs.push('--agent', initialState.agent)
  if (initialState.settings) ptyArgs.push('--settings', initialState.settings)
  for (const dir of initialState.addDirs) {
    ptyArgs.push('--add-dir', dir)
  }
  for (const config of initialState.mcpConfig) {
    ptyArgs.push('--mcp-config', config)
  }
  for (const pluginDir of initialState.pluginDirs) {
    ptyArgs.push('--plugin-dir', pluginDir)
  }
  if (initialState.strictMcpConfig) ptyArgs.push('--strict-mcp-config')
  if (initialState.fallbackModel) {
    ptyArgs.push('--fallback-model', initialState.fallbackModel)
  }
  if (initialState.allowDangerouslySkipPermissions) {
    ptyArgs.push('--allow-dangerously-skip-permissions')
  }
  if (initialState.dangerouslySkipPermissions) {
    ptyArgs.push('--dangerously-skip-permissions')
  }

  let pty: PtySession
  try {
    pty = spawnPty(command, ptyArgs, {
      cwd: initialState.cwd,
      cols: 120,
      rows: 36,
      env: {
        ...process.env,
        MOSSEN_CODE_AGENT_SUPERVISOR_CHILD: jobId,
        // The PTY child writes into output.jsonl-style files only if the
        // worker code asks it to. For now the mossen TUI is the source of
        // truth and just renders into the PTY; ensure no inherited
        // supervisor flag accidentally makes it run as another worker.
        MOSSEN_CODE_AGENT_SUPERVISOR_JOB_ID: '',
      },
      // W409: fan-out PTY master bytes to an on-disk transcript so a
      // re-attach can recover history after the in-memory ring buffer
      // is gone (e.g. worker SIGKILL / OOM that destroys the ring).
      transcriptPath: paths.transcript,
    })
  } catch (spawnError) {
    const message =
      spawnError instanceof Error
        ? spawnError.message
        : getLocalizedText({
            en: 'Failed to spawn mossen TUI in PTY.',
            zh: '在 PTY 中启动 mossen TUI 失败。',
          })
    await markAgentSupervisorWorkerLaunchFailed(jobId, message)
    return
  }

  // Record start: events.jsonl + state.
  const startedAt = new Date().toISOString()
  const startedSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: startedSeq,
      kind: 'started',
      source: 'job',
      ts: startedAt,
    }),
    pid: pty.pid,
    sessionId: initialState.sessionId,
  })
  await updateJob(jobId, current => ({
    ...current,
    updatedAt: startedAt,
    status: 'working',
    process: {
      ...current.process,
      pid: pty.pid,
      alive: true,
      lastStartedAt: startedAt,
      expectedCmdlineSubstring: `--supervisor-job ${jobId}`,
    },
    counters: {
      ...current.counters,
      eventSeqHigh: Math.max(current.counters.eventSeqHigh, startedSeq),
    },
  }))

  let server: Awaited<ReturnType<typeof createAttachServer>> | null = null
  try {
    server = await createAttachServer({
      socketPath: paths.attachSocket,
      pty,
      // W409: cold-path replay source for new dashboard attachments when
      // the PTY's in-memory ring is empty (e.g. fresh worker after a
      // crash, or attach right after spawnPty before any bytes arrived).
      transcriptPath: paths.transcript,
    })
  } catch (serverError) {
    // Socket setup failure shouldn't kill the PTY — log to events and
    // continue without attach support. The dashboard fallback (detail
    // dialog) still works off events/output JSONLs.
    const message =
      serverError instanceof Error
        ? serverError.message
        : String(serverError)
    const errSeq = await getNextSupervisorJsonlSeq(paths.events)
    await appendSupervisorJsonlLine(paths.events, {
      ...buildSupervisorJsonlEnvelope({
        seq: errSeq,
        kind: 'activity',
        source: 'supervisor',
      }),
      detail: `attach server failed: ${message}`,
    })
  }

  // Inject initial prompt as keystrokes once the TUI has rendered.
  let consumedInputSeq = 0
  try {
    const initial = await readAgentSupervisorLatestPromptEntry(paths)
    if (initial) {
      consumedInputSeq = initial.seq
      setTimeout(() => {
        if (!pty.isAlive()) return
        // \r is what readline sees as Enter inside an interactive shell. The
        // TUI's input box submits on Enter just like a real keyboard press.
        try {
          pty.write(initial.prompt)
          pty.write('\r')
        } catch {
          // PTY may have exited between scheduling and firing.
        }
      }, SUPERVISOR_INITIAL_PROMPT_DELAY_MS)
    }
  } catch {
    // Reading input.jsonl is best-effort here; the user can still type into
    // the attached PTY directly.
  }

  // Poll input.jsonl + control.jsonl. New input.jsonl entries are typed
  // into the PTY; control.jsonl stop/shutdown kills it.
  let cleanupResolved = false
  const pollTimer: ReturnType<typeof setInterval> = setInterval(() => {
    void (async () => {
      if (cleanupResolved) return
      try {
        if (await readSupervisorStopRequest(paths)) {
          // Graceful kill — gives mossen a chance to drain its event loop.
          // The PTY's onExit will fire and drive cleanup below.
          pty.kill('SIGHUP')
          return
        }
        const next = await readAgentSupervisorLatestPromptEntry(paths)
        if (next && next.seq > consumedInputSeq) {
          consumedInputSeq = next.seq
          if (pty.isAlive()) {
            try {
              pty.write(next.prompt)
              pty.write('\r')
            } catch {
              // PTY died mid-write. onExit will clean up.
            }
          }
        }
      } catch {
        // Polling errors are non-fatal — we'll try again next tick.
      }
    })()
  }, SUPERVISOR_INPUT_POLL_MS)

  // Forward host signals to the PTY so `kill <worker_pid>` cleans up the
  // child too. The detached worker won't receive these via terminal but
  // operators may send them directly.
  const sigHandler = (): void => {
    try {
      pty.kill('SIGHUP')
    } catch {
      // PTY already dead.
    }
  }
  process.on('SIGTERM', sigHandler)
  process.on('SIGINT', sigHandler)

  // Wait for PTY exit, then record final state.
  await new Promise<void>(resolveFn => {
    pty.onExit(info => {
      void (async () => {
        if (cleanupResolved) return
        cleanupResolved = true
        clearInterval(pollTimer)
        process.off('SIGTERM', sigHandler)
        process.off('SIGINT', sigHandler)
        const exitedAt = new Date().toISOString()
        // signal=0 from native onexit means "exited normally"; we surface
        // that as a null signal in the JSONL/state schema.
        const signalName = ptyExitSignalName(info.signal)
        const stopRequested = await readSupervisorStopRequest(paths).catch(() => false)
        const success = info.exitCode === 0 && signalName === null
        const status: AgentSupervisorJobState['status'] = stopRequested
          ? 'stopped'
          : success
            ? 'completed'
            : 'failed'
        const finalSummary =
          (await deriveAgentSupervisorRowSummary(jobId).catch(() => ({ summary: null }))).summary ??
          (success
            ? getLocalizedText({
                en: 'Agent View session ended.',
                zh: 'Agent View 会话结束。',
              })
            : getLocalizedText({
                en: `Agent View session exited (code=${info.exitCode}, signal=${signalName ?? 'none'}).`,
                zh: `Agent View 会话退出 (code=${info.exitCode}, signal=${signalName ?? '无'})。`,
              }))
        try {
          const exitedSeq = await getNextSupervisorJsonlSeq(paths.events)
          await appendSupervisorJsonlLine(paths.events, {
            ...buildSupervisorJsonlEnvelope({
              seq: exitedSeq,
              kind: 'exited',
              source: 'job',
              ts: exitedAt,
            }),
            exitCode: info.exitCode,
            signal: signalName,
          })
          await updateJob(jobId, current => ({
            ...current,
            updatedAt: exitedAt,
            status,
            summary: finalSummary,
            process: {
              ...current.process,
              alive: false,
              lastExitedAt: exitedAt,
              exitCode: info.exitCode,
              signal: signalName,
            },
            counters: {
              ...current.counters,
              eventSeqHigh: Math.max(current.counters.eventSeqHigh, exitedSeq),
            },
          }))
          await refreshAgentSupervisorRowSummary(jobId, { force: true })
        } catch {
          // Final state write failures are logged best-effort; the worker
          // process is about to exit anyway.
        }
        if (server) {
          server.notifyExit(info.exitCode)
          await server.close().catch(() => {
            // Socket teardown errors are non-fatal.
          })
        }
        resolveFn()
      })()
    })
  })
}
