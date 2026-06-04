import { chmod, mkdir } from 'fs/promises'
import { join } from 'path'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'
import { AgentSupervisorJobIdSchema, type AgentSupervisorJobId } from './schema.js'

export const AGENT_SUPERVISOR_DAEMON_DIR = 'daemon'
export const AGENT_SUPERVISOR_JOBS_DIR = 'jobs'
export const AGENT_SUPERVISOR_WORKTREES_DIR = 'worktrees'
export const AGENT_SUPERVISOR_DIR_MODE = 0o700
export const AGENT_SUPERVISOR_FILE_MODE = 0o600

export type AgentSupervisorJobPaths = {
  dir: string
  state: string
  input: string
  control: string
  events: string
  output: string
  transcriptLink: string
  worktree: string
  seq: string
  seqLock: string
  // Unix domain socket served by the persistent worker. The dashboard
  // connects here to attach to the job's mossen TUI running in a PTY.
  attachSocket: string
  // Append-only raw byte log of everything the PTY master emitted (W409).
  // 1 MiB cap with a single rotated copy at `${transcript}.1`, so a re-attach
  // can recover the last ~2 MiB of session output even after the in-memory
  // ring buffer disappears (worker SIGKILL / OOM). Worker fan-outs each
  // PTY chunk to this file synchronously; attachServer's replay path falls
  // back to it when the ring is empty (cold start) or undersized.
  transcript: string
}

export function assertAgentSupervisorJobId(
  id: string,
): asserts id is AgentSupervisorJobId {
  const parsed = AgentSupervisorJobIdSchema.safeParse(id)
  if (!parsed.success) {
    throw new Error(`Invalid agent supervisor job id: ${id}`)
  }
}

export function getAgentSupervisorConfigHome(): string {
  return getMossenConfigHomeDir()
}

export function getAgentSupervisorDaemonDir(configHome = getAgentSupervisorConfigHome()): string {
  return join(configHome, AGENT_SUPERVISOR_DAEMON_DIR)
}

export function getAgentSupervisorJobsDir(configHome = getAgentSupervisorConfigHome()): string {
  return join(configHome, AGENT_SUPERVISOR_JOBS_DIR)
}

export function getAgentSupervisorWorktreesDir(
  configHome = getAgentSupervisorConfigHome(),
): string {
  return join(configHome, AGENT_SUPERVISOR_WORKTREES_DIR)
}

export function getAgentSupervisorRosterPath(
  configHome = getAgentSupervisorConfigHome(),
): string {
  return join(getAgentSupervisorDaemonDir(configHome), 'roster.json')
}

export function getAgentSupervisorLogPath(
  configHome = getAgentSupervisorConfigHome(),
): string {
  return join(getAgentSupervisorDaemonDir(configHome), 'supervisor.log')
}

export function getAgentSupervisorLockPath(
  configHome = getAgentSupervisorConfigHome(),
): string {
  return join(getAgentSupervisorDaemonDir(configHome), 'supervisor.lock')
}

export function getAgentSupervisorJobDir(
  id: string,
  configHome = getAgentSupervisorConfigHome(),
): string {
  assertAgentSupervisorJobId(id)
  return join(getAgentSupervisorJobsDir(configHome), id)
}

export function getAgentSupervisorJobPaths(
  id: string,
  configHome = getAgentSupervisorConfigHome(),
): AgentSupervisorJobPaths {
  const dir = getAgentSupervisorJobDir(id, configHome)
  return {
    dir,
    state: join(dir, 'state.json'),
    input: join(dir, 'input.jsonl'),
    control: join(dir, 'control.jsonl'),
    events: join(dir, 'events.jsonl'),
    output: join(dir, 'output.jsonl'),
    transcriptLink: join(dir, 'transcript-link.json'),
    worktree: join(dir, 'worktree.json'),
    seq: join(dir, 'seq.json'),
    seqLock: join(dir, 'seq.lock'),
    attachSocket: join(dir, 'attach.sock'),
    transcript: join(dir, 'transcript.bin'),
  }
}

async function chmodBestEffort(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode)
  } catch {
    // The directory may live on a filesystem that rejects chmod. Creation mode
    // is still requested above; callers must not fail startup only for chmod.
  }
}

export async function ensureAgentSupervisorBaseDirs(
  configHome = getAgentSupervisorConfigHome(),
): Promise<void> {
  const daemonDir = getAgentSupervisorDaemonDir(configHome)
  const jobsDir = getAgentSupervisorJobsDir(configHome)
  const worktreesDir = getAgentSupervisorWorktreesDir(configHome)
  await mkdir(daemonDir, { recursive: true, mode: AGENT_SUPERVISOR_DIR_MODE })
  await mkdir(jobsDir, { recursive: true, mode: AGENT_SUPERVISOR_DIR_MODE })
  await mkdir(worktreesDir, {
    recursive: true,
    mode: AGENT_SUPERVISOR_DIR_MODE,
  })
  await chmodBestEffort(daemonDir, AGENT_SUPERVISOR_DIR_MODE)
  await chmodBestEffort(jobsDir, AGENT_SUPERVISOR_DIR_MODE)
  await chmodBestEffort(worktreesDir, AGENT_SUPERVISOR_DIR_MODE)
}

export async function ensureAgentSupervisorJobDir(
  id: string,
  configHome = getAgentSupervisorConfigHome(),
): Promise<AgentSupervisorJobPaths> {
  await ensureAgentSupervisorBaseDirs(configHome)
  const paths = getAgentSupervisorJobPaths(id, configHome)
  await mkdir(paths.dir, { recursive: true, mode: AGENT_SUPERVISOR_DIR_MODE })
  await chmodBestEffort(paths.dir, AGENT_SUPERVISOR_DIR_MODE)
  return paths
}
