import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { lstat, readdir, rm } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import instances from '../../ink/instances.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { readSupervisorJsonlTolerant, appendSupervisorJsonlLine, buildSupervisorJsonlEnvelope, getNextSupervisorJsonlSeq } from './jsonl.js'
import { isProcessAlive } from './daemon.js'
import { launchAgentSupervisorBackgroundJob, readAgentSupervisorInitialPrompt } from './launch.js'
import {
  getAgentSupervisorConfigHome,
  getAgentSupervisorJobPaths,
} from './paths.js'
import { readAgentSupervisorRoster, removeAgentSupervisorRosterJob, upsertAgentSupervisorRosterJob } from './roster.js'
import { AgentSupervisorJobIdSchema, type AgentSupervisorJobId, type AgentSupervisorJobState, type AgentSupervisorOutputMessage, type AgentSupervisorTranscriptLink } from './schema.js'
import { formatAgentSupervisorResultPayload, readAgentSupervisorResultPayload } from './resultPayload.js'
import { readAgentSupervisorJobState, updateAgentSupervisorJobState } from './state.js'
import {
  agentSupervisorTranscriptExists,
  readAgentSupervisorTranscriptLink,
} from './transcriptLink.js'
import { getAgentSupervisorSelfCommand } from './selfCommand.js'
import {
  cleanupAgentSupervisorWorktree,
  readAgentSupervisorWorktreeMetadata,
} from './worktreeIsolation.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped'])
const DEFAULT_WAIT_POLL_MS = 500
const AGENT_SUPERVISOR_ATTACH_STRIPPED_ENV_KEYS = [
  'MOSSEN_CODE_AGENT_SUPERVISOR_CHILD',
  'MOSSEN_CODE_AGENT_SUPERVISOR_JOB_ID',
  'MOSSEN_CODE_AGENT_SUPERVISOR_TEST_CONTINUATION',
  'MOSSEN_CODE_AGENT_SUPERVISOR_IN_PROCESS_TEST_WORKER',
  'MOSSEN_CODE_AGENT_SUPERVISOR_ATTACH_DRY_RUN',
  'MOSSEN_CODE_AGENT_SUPERVISOR_ATTACH_JOB_ID',
]

type PurgeTarget = {
  kind: 'job-files' | 'transcript' | 'sidechain-transcript' | 'owned-worktree'
  path: string
  exists: boolean
  bytes: number
}

type PurgePlan = {
  jobId: AgentSupervisorJobId
  token: string
  targets: PurgeTarget[]
  worktreeCleanupRequired: boolean
}

type GcPlan = {
  before: string
  token: string
  jobs: PurgePlan[]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseJobId(raw: string): AgentSupervisorJobId {
  return AgentSupervisorJobIdSchema.parse(raw)
}

async function requireJobState(rawJobId: string): Promise<AgentSupervisorJobState> {
  const jobId = parseJobId(rawJobId)
  const state = await readAgentSupervisorJobState(jobId)
  if (!state) {
    throw new Error(`Agent supervisor job not found: ${jobId}`)
  }
  return state
}

export function buildAgentSupervisorAttachEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of AGENT_SUPERVISOR_ATTACH_STRIPPED_ENV_KEYS) {
    delete next[key]
  }
  return next
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : value < 10 ? 1 : 0)}${units[unit]}`
}

async function getPathSize(path: string): Promise<number> {
  let info
  try {
    info = await lstat(path)
  } catch {
    return 0
  }
  if (!info.isDirectory()) return info.size
  let total = info.size
  for (const entry of await readdir(path, { withFileTypes: true })) {
    total += await getPathSize(join(path, entry.name))
  }
  return total
}

function isInsidePath(path: string, parent: string): boolean {
  const child = resolve(path)
  const root = resolve(parent)
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function buildPurgeTarget(
  kind: PurgeTarget['kind'],
  path: string | null | undefined,
): Promise<PurgeTarget | null> {
  if (!path) return null
  let exists = false
  let bytes = 0
  try {
    await lstat(path)
    exists = true
    bytes = await getPathSize(path)
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      (error as { code?: string }).code !== 'ENOENT'
    ) {
      throw error
    }
  }
  return { kind, path, exists, bytes }
}

function buildPlanToken(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8)
}

function assertSafePurgeTarget(target: PurgeTarget): void {
  if (!target.exists) return
  if (target.kind === 'owned-worktree') return
  if (!isInsidePath(target.path, getAgentSupervisorConfigHome())) {
    throw new Error(`Refusing to purge path outside Mossen config home: ${target.path}`)
  }
}

async function buildPurgePlan(state: AgentSupervisorJobState): Promise<PurgePlan> {
  const paths = getAgentSupervisorJobPaths(state.id)
  const [link, worktree] = await Promise.all([
    readAgentSupervisorTranscriptLink(state.id),
    readAgentSupervisorWorktreeMetadata(state.id),
  ])
  const targets = (
    await Promise.all([
      buildPurgeTarget('job-files', paths.dir),
      buildPurgeTarget('transcript', link?.transcriptPath),
      buildPurgeTarget('sidechain-transcript', link?.sidechainTranscriptPath),
      buildPurgeTarget(
        'owned-worktree',
        worktree?.ownedByMossen ? worktree.path : null,
      ),
    ])
  ).filter((target): target is PurgeTarget => Boolean(target))
  for (const target of targets) {
    assertSafePurgeTarget(target)
  }
  const worktreeCleanupRequired = targets.some(
    target => target.kind === 'owned-worktree' && target.exists,
  )
  const token = buildPlanToken({
    jobId: state.id,
    updatedAt: state.updatedAt,
    targets: targets.map(target => ({
      kind: target.kind,
      path: target.path,
      exists: target.exists,
      bytes: target.bytes,
    })),
    worktreeCleanupRequired,
  })
  return { jobId: state.id, token, targets, worktreeCleanupRequired }
}

function formatPurgeTarget(target: PurgeTarget): string {
  const exists = target.exists ? formatBytes(target.bytes) : 'missing'
  const label =
    target.kind === 'job-files'
      ? 'job files'
      : target.kind === 'sidechain-transcript'
        ? 'sidechain transcript'
        : target.kind === 'owned-worktree'
          ? 'owned worktree'
          : 'transcript'
  return `  - ${label}: ${target.path} (${exists})`
}

function formatPurgePlan(plan: PurgePlan, command: string): string {
  const targets =
    plan.targets.length > 0
      ? plan.targets.map(formatPurgeTarget).join('\n')
      : '  - no files found'
  const worktreeNote = plan.worktreeCleanupRequired
    ? '\nOwned worktree cleanup will run through the existing safety gate before purge.'
    : ''
  return `Purge dry-run for ${plan.jobId}\nConfirm token: ${plan.token}\nTargets:\n${targets}${worktreeNote}\nRunning jobs are blocked from purge. Confirm removes only the listed preserved files.\nRun \`${command} --confirm ${plan.token}\` to purge.`
}

async function executePurgePlan(plan: PurgePlan): Promise<string> {
  if (plan.worktreeCleanupRequired) {
    const cleanup = await cleanupAgentSupervisorWorktree(plan.jobId)
    if (!cleanup.cleaned) {
      return `Purge blocked for ${plan.jobId}: worktree cleanup skipped (${cleanup.reason}). Job files and transcripts were preserved.`
    }
  }
  await removeAgentSupervisorRosterJob(plan.jobId)
  for (const target of plan.targets) {
    if (!target.exists || target.kind === 'owned-worktree') continue
    await rm(target.path, { recursive: true, force: true })
  }
  return `Purged ${plan.jobId}. Removed preserved job files and transcripts.`
}

function indentBlock(text: string): string {
  return text
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => `  ${line}`)
    .join('\n')
}

function getWaitExitCode(state: AgentSupervisorJobState): number {
  if (state.status === 'completed') return 0
  if (state.status === 'stopped') return 130
  if (state.status === 'failed') return state.process.exitCode ?? 1
  return 1
}

function formatWaitMessage(
  state: AgentSupervisorJobState,
  resultPayload = state.resultPayload ?? null,
): string {
  const code = state.process.exitCode ?? 'n/a'
  const signal = state.process.signal ?? 'n/a'
  const result = formatAgentSupervisorResultPayload(resultPayload)
  return `Job ${state.id} finished: ${state.status} (exit=${code}, signal=${signal})${result ? `\n${result}` : ''}`
}

async function formatPreservedAgentSupervisorData(
  state: AgentSupervisorJobState,
  options: { includeCleanupHint: boolean },
): Promise<string> {
  const paths = getAgentSupervisorJobPaths(state.id)
  const [size, link, worktree] = await Promise.all([
    getPathSize(paths.dir),
    readAgentSupervisorTranscriptLink(state.id),
    readAgentSupervisorWorktreeMetadata(state.id),
  ])
  const transcript = link?.transcriptPath ?? 'not created yet'
  const worktreePath = worktree?.path ?? state.cwd
  const worktreeState = worktree?.path
    ? worktree.cleanupState
    : `not isolated: ${worktree?.isolationReason ?? 'unknown'}`
  const lines = [
    `Preserved: ${paths.dir} (${formatBytes(size)})`,
    `Transcript: ${transcript}`,
    `Worktree: ${worktreePath} (${worktreeState})`,
  ]
  if (options.includeCleanupHint) {
    lines.push(
      `Use \`mossen rm ${state.id} --cleanup-worktree\` to remove the owned worktree after safety checks.`,
    )
  }
  lines.push(
    `Preview purge: \`mossen rm ${state.id} --purge --dry-run\` shows exactly which preserved job files, transcripts, and owned worktree would be removed before a confirm token is accepted.`,
  )
  return lines.join('\n')
}

export async function formatAgentSupervisorLogs(
  rawJobId: string,
  options: { limit?: number } = {},
): Promise<string> {
  const state = await requireJobState(rawJobId)
  const paths = getAgentSupervisorJobPaths(state.id)
  const { records, malformedLines, partialTrailingLine } =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorOutputMessage>>(
      paths.output,
    )
  const result = formatAgentSupervisorResultPayload(
    state.resultPayload ?? (await readAgentSupervisorResultPayload(state.id)),
  )
  const limit = Math.max(1, options.limit ?? 80)
  const lines = records.slice(-limit).map(record => {
    const prefix = `[${record.seq ?? '?'}] ${record.kind ?? 'unknown'}`
    if (record.kind === 'assistant_text') return `${prefix}: ${record.text ?? ''}`
    if (record.kind === 'tool_call') return `${prefix}: ${record.tool ?? 'tool'} ${record.input ?? ''}`
    if (record.kind === 'tool_result') {
      return `${prefix}: ${record.tool ?? 'tool'} exit=${record.exitCode ?? 'n/a'} ${record.stderrTail ?? record.stdoutTail ?? ''}`
    }
    return `${prefix}: ${JSON.stringify(record)}`
  })
  const header = `Job ${state.id} · ${state.status} · ${state.title}`
  const diagnostics =
    malformedLines > 0 || partialTrailingLine
      ? `\n[diagnostics] malformedLines=${malformedLines} partialTrailingLine=${partialTrailingLine}`
      : ''
  return `${header}${result ? `\n${result}` : ''}\n${lines.length > 0 ? lines.join('\n') : '(no output yet)'}${diagnostics}`
}

async function appendControl(
  jobId: AgentSupervisorJobId,
  kind: 'stop' | 'interrupt',
  reason?: string,
): Promise<number> {
  const paths = getAgentSupervisorJobPaths(jobId)
  const seq = await getNextSupervisorJsonlSeq(paths.control)
  await appendSupervisorJsonlLine(paths.control, {
    ...buildSupervisorJsonlEnvelope({
      seq,
      kind,
      source: 'cli_input',
    }),
    ...(kind === 'stop' ? { reason: reason ?? 'user_requested' } : {}),
  })
  return seq
}

async function markStopped(
  state: AgentSupervisorJobState,
  signal: string | null,
): Promise<AgentSupervisorJobState> {
  const now = new Date().toISOString()
  const next = await updateAgentSupervisorJobState(state.id, current => {
    if (!current) throw new Error(`Missing supervisor job state: ${state.id}`)
    return {
      ...current,
      updatedAt: now,
      status: 'stopped',
      process: {
        ...current.process,
        alive: false,
        lastExitedAt: now,
        signal,
      },
    }
  })
  await upsertAgentSupervisorRosterJob(next)
  return next
}

export async function stopAgentSupervisorJob(
  rawJobId: string,
): Promise<string> {
  const state = await requireJobState(rawJobId)
  await appendControl(state.id, 'stop', 'user_requested')
  const paths = getAgentSupervisorJobPaths(state.id)
  const eventSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: eventSeq,
      kind: 'stop_requested',
      source: 'supervisor',
    }),
  })
  if (
    state.process.pid &&
    state.process.pid !== process.pid &&
    isProcessAlive(state.process.pid)
  ) {
    process.kill(state.process.pid, 'SIGTERM')
    await sleep(250)
    if (isProcessAlive(state.process.pid)) {
      return `Stop requested for ${state.id}; process ${state.process.pid} is still alive.`
    }
    await markStopped(state, 'SIGTERM')
    return `Stopped ${state.id}.`
  }
  await markStopped(state, null)
  return `Stopped ${state.id}.`
}

export async function killAgentSupervisorJob(rawJobId: string): Promise<string> {
  const state = await requireJobState(rawJobId)
  await appendControl(state.id, 'interrupt')
  if (
    state.process.pid &&
    state.process.pid !== process.pid &&
    isProcessAlive(state.process.pid)
  ) {
    process.kill(state.process.pid, 'SIGKILL')
    await sleep(250)
  }
  await markStopped(state, 'SIGKILL')
  return `Killed ${state.id}.`
}

export async function removeAgentSupervisorJob(
  rawJobId: string,
  options: { cleanupWorktree?: boolean } = {},
): Promise<string> {
  const state = await requireJobState(rawJobId)
  await removeAgentSupervisorRosterJob(state.id)
  if (!options.cleanupWorktree) {
    const preserved = await formatPreservedAgentSupervisorData(state, {
      includeCleanupHint: true,
    })
    return `Removed ${state.id} from Agent View. Job files and transcripts were preserved.\n${preserved}`
  }
  const cleanup = await cleanupAgentSupervisorWorktree(state.id)
  const preserved = await formatPreservedAgentSupervisorData(state, {
    includeCleanupHint: !cleanup.cleaned,
  })
  if (cleanup.cleaned) {
    return `Removed ${state.id} from Agent View and cleaned its owned worktree. Job files and transcripts were preserved.\n${preserved}`
  }
  const status =
    cleanup.gitStatusSummary && cleanup.reason === 'worktree_dirty'
      ? `\nGit status:\n${indentBlock(cleanup.gitStatusSummary)}`
      : ''
  return `Removed ${state.id} from Agent View. Job files and transcripts were preserved. Worktree cleanup skipped: ${cleanup.reason}.${status}\n${preserved}`
}

export async function purgeAgentSupervisorJob(
  rawJobId: string,
  options: { dryRun?: boolean; confirm?: string } = {},
): Promise<string> {
  const state = await requireJobState(rawJobId)
  const command = `mossen rm ${state.id} --purge`
  if (!TERMINAL_STATUSES.has(state.status)) {
    return `Purge blocked for ${state.id}: job is ${state.status}. Stop or wait for it to finish before purging preserved files.`
  }
  const plan = await buildPurgePlan(state)
  if (options.dryRun || !options.confirm) {
    return formatPurgePlan(plan, command)
  }
  if (options.confirm !== plan.token) {
    return `Purge blocked for ${state.id}: confirm token mismatch. Run \`${command} --dry-run\` to generate a fresh token.`
  }
  return await executePurgePlan(plan)
}

function parseGcBeforeDate(rawBefore: string): string {
  const time = Date.parse(rawBefore)
  if (Number.isNaN(time)) {
    throw new Error('--before must be an ISO date or timestamp.')
  }
  return new Date(time).toISOString()
}

async function buildGcPlan(rawBefore: string): Promise<GcPlan> {
  const before = parseGcBeforeDate(rawBefore)
  const roster = await readAgentSupervisorRoster()
  const jobs: PurgePlan[] = []
  for (const item of roster.jobs) {
    const state = await readAgentSupervisorJobState(item.id)
    if (!state) continue
    if (!TERMINAL_STATUSES.has(state.status)) continue
    if (Date.parse(state.updatedAt) >= Date.parse(before)) continue
    jobs.push(await buildPurgePlan(state))
  }
  const token = buildPlanToken({
    before,
    jobs: jobs.map(job => ({ id: job.jobId, token: job.token })),
  })
  return { before, token, jobs }
}

function formatGcPlan(plan: GcPlan): string {
  const jobs =
    plan.jobs.length > 0
      ? plan.jobs
          .map(job => {
            const bytes = job.targets.reduce((sum, target) => sum + target.bytes, 0)
            return `  - ${job.jobId}: ${formatBytes(bytes)} (${job.targets.length} targets)`
          })
          .join('\n')
      : '  - no terminal jobs older than the cutoff'
  return `Agent View GC dry-run\nBefore: ${plan.before}\nConfirm token: ${plan.token}\nJobs:\n${jobs}\nRun \`mossen agents --gc --before ${plan.before} --confirm ${plan.token}\` to purge.`
}

export async function gcAgentSupervisorJobs(
  options: { before: string; dryRun?: boolean; confirm?: string },
): Promise<string> {
  const plan = await buildGcPlan(options.before)
  if (options.dryRun || !options.confirm) {
    return formatGcPlan(plan)
  }
  if (options.confirm !== plan.token) {
    return `Agent View GC blocked: confirm token mismatch. Run \`mossen agents --gc --before ${plan.before} --dry-run\` to generate a fresh token.`
  }
  if (plan.jobs.length === 0) {
    return `Agent View GC complete. No terminal jobs older than ${plan.before}.`
  }
  const messages: string[] = []
  for (const job of plan.jobs) {
    messages.push(await executePurgePlan(job))
  }
  return [`Agent View GC complete.`, ...messages].join('\n')
}

export async function respawnAgentSupervisorJob(
  rawJobId: string,
  options: { testMode?: boolean } = {},
): Promise<{ id: AgentSupervisorJobId; message: string }> {
  const state = await requireJobState(rawJobId)
  const prompt = await readAgentSupervisorInitialPrompt(
    getAgentSupervisorJobPaths(state.id),
  )
  if (!prompt.trim()) {
    throw new Error(`Cannot respawn ${state.id}: original input queue is empty.`)
  }
  const result = await launchAgentSupervisorBackgroundJob({
    prompt,
    cwd: state.cwd,
    model: state.model,
    permissionMode: state.permissionMode,
    effort: state.effort,
    agent: state.agent,
    settings: state.settings,
    addDirs: state.addDirs,
    mcpConfig: state.mcpConfig,
    pluginDirs: state.pluginDirs,
    strictMcpConfig: state.strictMcpConfig,
    fallbackModel: state.fallbackModel,
    allowDangerouslySkipPermissions: state.allowDangerouslySkipPermissions,
    dangerouslySkipPermissions: state.dangerouslySkipPermissions,
    testMode: options.testMode,
  })
  return {
    id: result.id,
    message: `Respawned ${state.id} as ${result.id}.`,
  }
}

export async function respawnAllAgentSupervisorJobs(
  options: { testMode?: boolean } = {},
): Promise<string[]> {
  const roster = await readAgentSupervisorRoster()
  const candidates = roster.jobs.filter(job => TERMINAL_STATUSES.has(job.status))
  const messages: string[] = []
  for (const job of candidates) {
    const result = await respawnAgentSupervisorJob(job.id, options)
    messages.push(result.message)
  }
  return messages
}

export async function waitAgentSupervisorJob(
  rawJobId: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ state: AgentSupervisorJobState; message: string; exitCode: number }> {
  const startedAt = Date.now()
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0)
  const pollMs = Math.max(50, options.pollMs ?? DEFAULT_WAIT_POLL_MS)
  let state = await requireJobState(rawJobId)
  while (!TERMINAL_STATUSES.has(state.status)) {
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      return {
        state,
        message: `Timed out waiting for ${state.id}: still ${state.status}.`,
        exitCode: 124,
      }
    }
    await sleep(pollMs)
    state = await requireJobState(state.id)
  }
  return {
    state,
    message: formatWaitMessage(
      state,
      state.resultPayload ?? (await readAgentSupervisorResultPayload(state.id)),
    ),
    exitCode: getWaitExitCode(state),
  }
}

export async function waitAllAgentSupervisorJobs(
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ messages: string[]; exitCode: number }> {
  const roster = await readAgentSupervisorRoster()
  if (roster.jobs.length === 0) {
    return { messages: ['No Agent View supervisor jobs to wait for.'], exitCode: 0 }
  }
  const messages: string[] = []
  let exitCode = 0
  for (const job of roster.jobs) {
    const result = await waitAgentSupervisorJob(job.id, options)
    messages.push(result.message)
    if (result.exitCode !== 0 && exitCode === 0) {
      exitCode = result.exitCode
    }
  }
  return { messages, exitCode }
}

export async function attachAgentSupervisorJob(
  rawJobId: string,
  options: { restoreRawMode?: boolean } = {},
): Promise<number> {
  const state = await requireJobState(rawJobId)
  const link = await readAgentSupervisorTranscriptLink(state.id)
  const sessionId = link?.sessionId ?? state.sessionId
  if (!sessionId) {
    process.stderr.write(
      getLocalizedText({
        en: `Job ${state.id} has no attachable session yet. Use \`mossen logs ${state.id}\` for output; full attach requires a session-backed job.\n`,
        zh: `任务 ${state.id} 还没有可接入的会话。可先用 \`mossen logs ${state.id}\` 查看输出；完整接入需要 session-backed job。\n`,
      }),
    )
    return 1
  }
  if (link && !(await agentSupervisorTranscriptExists(link)) && !isJobProcessAlive(state)) {
    process.stderr.write(
      getLocalizedText({
        en: `Job ${state.id} has session ${sessionId}, but the transcript is not available yet. Use \`mossen logs ${state.id}\` for captured output.\n`,
        zh: `任务 ${state.id} 有会话 ${sessionId}，但 transcript 还不可用。可先用 \`mossen logs ${state.id}\` 查看已捕获输出。\n`,
      }),
    )
    return 1
  }
  const { command, argsPrefix } = getAgentSupervisorSelfCommand()
  const { args } = buildAgentSupervisorAttachInvocation(state, link)
  if (isEnvTruthy(process.env.MOSSEN_CODE_AGENT_SUPERVISOR_ATTACH_DRY_RUN)) {
    process.stdout.write(`Attach command: ${[...argsPrefix, ...args].join(' ')}\n`)
    return 0
  }
  process.stdout.write(
    getLocalizedText({
      en: `Attached to job ${state.id} (session ${sessionId}). Press Esc or exit the resumed session to detach.\n`,
      zh: `已接入任务 ${state.id}（会话 ${sessionId}）。按 Esc 或退出恢复会话即可 detach。\n`,
    }),
  )
  const inkInstance = instances.get(process.stdout)
  let didInkHandoff = false
  const wasRawMode = Boolean(process.stdin.isRaw)
  if (inkInstance) {
    // Child sessions are full terminal TUIs. Pause the parent Ink renderer and
    // repaint from scratch after the child exits; otherwise the restored Agent
    // View can be drawn over the child session's last frame.
    inkInstance.enterAlternateScreen()
    didInkHandoff = true
  } else if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode?.(false)
    } catch {
      // Best-effort before handing the terminal to the resumed session.
    }
  }
  const wasStdinPaused = process.stdin.isPaused()
  process.stdin.pause()
  let exitCode = 1
  try {
    const child = spawn(command, [...argsPrefix, ...args], {
      cwd: state.cwd,
      stdio: 'inherit',
      env: {
        ...buildAgentSupervisorAttachEnv(),
        MOSSEN_CODE_AGENT_SUPERVISOR_ATTACH_JOB_ID: state.id,
      },
    })
    if (didInkHandoff && process.stdin.isPaused()) {
      process.stdin.resume()
    }
    exitCode = await new Promise<number>(resolve => {
      child.on('exit', code => resolve(code ?? 0))
      child.on('error', () => resolve(1))
    })
  } finally {
    if (didInkHandoff) {
      inkInstance?.exitAlternateScreen()
      if (!wasStdinPaused) process.stdin.resume()
    } else if (process.stdin.isTTY) {
      try {
        if (wasRawMode || options.restoreRawMode) process.stdin.setRawMode?.(true)
      } catch {
        // Best-effort after the resumed session returns control.
      }
      process.stdin.resume()
    } else if (!wasStdinPaused) {
      process.stdin.resume()
    }
  }
  const latest = await readAgentSupervisorJobState(state.id)
  const stillRunning =
    latest &&
    (!TERMINAL_STATUSES.has(latest.status) || isJobProcessAlive(latest))
  const status = latest?.status ?? state.status
  process.stdout.write(
    stillRunning
      ? getLocalizedText({
          en: `Detached from job ${state.id}. The job is still running in the background.\n`,
          zh: `已从任务 ${state.id} detach。该任务仍在后台运行。\n`,
        })
      : getLocalizedText({
          en: `Detached from job ${state.id}. Current status: ${status}.\n`,
          zh: `已从任务 ${state.id} detach。当前状态：${status}。\n`,
        }),
  )
  return exitCode
}

function isJobProcessAlive(state: AgentSupervisorJobState): boolean {
  return Boolean(
    state.process.pid &&
      state.process.pid !== process.pid &&
      isProcessAlive(state.process.pid),
  )
}

export function buildAgentSupervisorAttachInvocation(
  state: AgentSupervisorJobState,
  link: AgentSupervisorTranscriptLink | null,
): { args: string[]; sessionId: string } {
  const sessionId = link?.sessionId ?? state.sessionId
  if (!sessionId) {
    throw new Error(`Job ${state.id} has no attachable session.`)
  }
  return {
    args: ['--resume', sessionId],
    sessionId,
  }
}
