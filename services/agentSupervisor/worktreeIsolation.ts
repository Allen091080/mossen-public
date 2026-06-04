import { createHash } from 'crypto'
import { hostname } from 'os'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  AGENT_SUPERVISOR_FILE_MODE,
  ensureAgentSupervisorJobDir,
  getAgentSupervisorJobPaths,
  getAgentSupervisorWorktreesDir,
} from './paths.js'
import {
  AGENT_SUPERVISOR_SCHEMA_VERSION,
  AgentSupervisorWorktreeSchema,
  type AgentSupervisorJobId,
  type AgentSupervisorWorktree,
} from './schema.js'
import { atomicWriteSupervisorJsonFile } from './state.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

const WORKTREE_OWNER = 'mossen-agent-supervisor'
const OWNERSHIP_MARKER_FILENAME = '.mossen-ownership'
type AgentWorktreeBaseRefMode = 'head' | 'remote-default'
type AgentWorktreeBgIsolationMode = 'isolated' | 'none'

export type AgentSupervisorWorktreePreparation = {
  cwd: string
  metadata: AgentSupervisorWorktree
  isolated: boolean
}

function isNoGitRepositoryResult(result: {
  code: number
  stderr: string
}): boolean {
  return (
    result.code !== 0 &&
    /not a git repository|not a gitdir|outside repository/i.test(result.stderr)
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return await execFileNoThrowWithCwd('git', args, {
    cwd,
    timeout: 30_000,
    preserveOutputOnError: true,
  })
}

export function computeAgentSupervisorWorktreeOwnershipHash(
  markerBody: string,
): string {
  return `sha256:${createHash('sha256').update(markerBody).digest('hex')}`
}

export function buildAgentSupervisorWorktreeOwnershipMarker(options: {
  jobId: AgentSupervisorJobId
  createdAt: string
  creatorPid: number
  creatorHostname: string
}): { body: string; marker: string; hash: string } {
  const body =
    `mossen-worktree-ownership v1\n` +
    `jobId: ${options.jobId}\n` +
    `createdAt: ${options.createdAt}\n` +
    `creatorPid: ${options.creatorPid}\n` +
    `creatorHostname: ${options.creatorHostname}\n`
  const hash = computeAgentSupervisorWorktreeOwnershipHash(body)
  return {
    body,
    marker: `${body}hash: ${hash}\n`,
    hash,
  }
}

function buildNonIsolatedWorktreeMetadata(options: {
  jobId: AgentSupervisorJobId
  reason: string
}): AgentSupervisorWorktree {
  return {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    jobId: options.jobId,
    ownedByMossen: false,
    path: null,
    owner: null,
    baseRepo: null,
    baseRepoCommit: null,
    baseBranch: null,
    baseRef: null,
    baseRefMode: null,
    baseRefFallbackReason: null,
    createdAt: null,
    creatorPid: null,
    creatorVersion: null,
    creatorHostname: null,
    ownershipMarkerPath: null,
    ownershipMarkerHash: null,
    cleanupState: 'none',
    cleanupEligible: false,
    dirty: null,
    isolationReason: options.reason,
  }
}

function getAgentWorktreeBaseRefMode(): AgentWorktreeBaseRefMode {
  const raw =
    process.env.MOSSEN_CODE_WORKTREE_BASE_REF ??
    getInitialSettings().worktree?.baseRef
  return raw === 'remote-default' ? 'remote-default' : 'head'
}

export function getAgentWorktreeBgIsolationMode(): AgentWorktreeBgIsolationMode {
  const raw =
    process.env.MOSSEN_CODE_WORKTREE_BG_ISOLATION ??
    getInitialSettings().worktree?.bgIsolation
  return raw === 'none' ? 'none' : 'isolated'
}

async function resolveAgentWorktreeBaseRef(
  baseRepo: string,
  currentHeadCommit: string,
): Promise<{
  mode: AgentWorktreeBaseRefMode
  ref: string
  fallbackReason: string | null
}> {
  const mode = getAgentWorktreeBaseRefMode()
  if (mode === 'head') {
    return { mode, ref: currentHeadCommit, fallbackReason: null }
  }

  const originHead = await git(baseRepo, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  const originHeadRef = originHead.stdout.trim()
  if (originHead.code === 0 && originHeadRef) {
    return { mode, ref: originHeadRef, fallbackReason: null }
  }

  for (const candidate of ['origin/main', 'origin/master']) {
    const candidateResult = await git(baseRepo, [
      'rev-parse',
      '--verify',
      candidate,
    ])
    if (candidateResult.code === 0 && candidateResult.stdout.trim()) {
      return {
        mode,
        ref: candidate,
        fallbackReason: 'origin_head_unavailable',
      }
    }
  }

  return {
    mode,
    ref: currentHeadCommit,
    fallbackReason: 'remote_default_unavailable',
  }
}

async function writeAgentSupervisorWorktreeMetadata(
  metadata: AgentSupervisorWorktree,
): Promise<void> {
  await ensureAgentSupervisorJobDir(metadata.jobId)
  await atomicWriteSupervisorJsonFile(
    getAgentSupervisorJobPaths(metadata.jobId).worktree,
    AgentSupervisorWorktreeSchema.parse(metadata),
  )
}

export async function readAgentSupervisorWorktreeMetadata(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorWorktree | null> {
  try {
    const raw = await readFile(getAgentSupervisorJobPaths(jobId).worktree, 'utf8')
    const parsed = AgentSupervisorWorktreeSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

export async function writeNonIsolatedAgentSupervisorWorktree(
  jobId: AgentSupervisorJobId,
  reason: string,
): Promise<AgentSupervisorWorktree> {
  const metadata = buildNonIsolatedWorktreeMetadata({ jobId, reason })
  await writeAgentSupervisorWorktreeMetadata(metadata)
  return metadata
}

export async function prepareAgentSupervisorWorktree(
  jobId: AgentSupervisorJobId,
  cwd: string,
): Promise<AgentSupervisorWorktreePreparation> {
  if (getAgentWorktreeBgIsolationMode() === 'none') {
    const metadata = await writeNonIsolatedAgentSupervisorWorktree(
      jobId,
      'worktree_bg_isolation_none',
    )
    return { cwd, metadata, isolated: false }
  }

  const rootResult = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (isNoGitRepositoryResult(rootResult)) {
    const metadata = await writeNonIsolatedAgentSupervisorWorktree(
      jobId,
      'not_git_repo',
    )
    return { cwd, metadata, isolated: false }
  }
  if (rootResult.code !== 0) {
    const metadata = await writeNonIsolatedAgentSupervisorWorktree(
      jobId,
      'git_root_unavailable',
    )
    return { cwd, metadata, isolated: false }
  }

  const baseRepo = rootResult.stdout.trim()
  const headCommitResult = await git(baseRepo, ['rev-parse', 'HEAD'])
  if (headCommitResult.code !== 0) {
    const metadata = await writeNonIsolatedAgentSupervisorWorktree(
      jobId,
      'git_head_unavailable',
    )
    return { cwd, metadata, isolated: false }
  }
  const branchResult = await git(baseRepo, ['branch', '--show-current'])
  const createdAt = nowIso()
  const creatorHostname = hostname()
  const currentHeadCommit = headCommitResult.stdout.trim()
  const baseRef = await resolveAgentWorktreeBaseRef(baseRepo, currentHeadCommit)
  const baseCommitResult = await git(baseRepo, ['rev-parse', baseRef.ref])
  const baseRepoCommit =
    baseCommitResult.code === 0 && baseCommitResult.stdout.trim()
      ? baseCommitResult.stdout.trim()
      : currentHeadCommit
  const baseRefFallbackReason =
    baseCommitResult.code === 0 && baseCommitResult.stdout.trim()
      ? baseRef.fallbackReason
      : 'base_ref_rev_parse_failed'
  const baseBranch = branchResult.stdout.trim() || 'HEAD'
  const worktreesDir = getAgentSupervisorWorktreesDir()
  await mkdir(worktreesDir, { recursive: true, mode: 0o700 })
  const worktreePath = join(worktreesDir, jobId)

  const addResult = await git(baseRepo, [
    'worktree',
    'add',
    '--detach',
    worktreePath,
    baseRepoCommit,
  ])
  if (addResult.code !== 0) {
    const metadata = await writeNonIsolatedAgentSupervisorWorktree(
      jobId,
      'git_worktree_add_failed',
    )
    return { cwd, metadata, isolated: false }
  }

  const excludePath = await git(worktreePath, [
    'rev-parse',
    '--git-path',
    'info/exclude',
  ])
  if (excludePath.code === 0 && excludePath.stdout.trim()) {
    await appendFile(excludePath.stdout.trim(), `\n${OWNERSHIP_MARKER_FILENAME}\n`, {
      encoding: 'utf8',
    })
  }

  const markerPath = join(worktreePath, OWNERSHIP_MARKER_FILENAME)
  const marker = buildAgentSupervisorWorktreeOwnershipMarker({
    jobId,
    createdAt,
    creatorPid: process.pid,
    creatorHostname,
  })
  await writeFile(markerPath, marker.marker, {
    encoding: 'utf8',
    mode: AGENT_SUPERVISOR_FILE_MODE,
  })
  const metadata: AgentSupervisorWorktree = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    jobId,
    ownedByMossen: true,
    path: worktreePath,
    owner: WORKTREE_OWNER,
    baseRepo,
    baseRepoCommit,
    baseBranch,
    baseRef: baseRef.ref,
    baseRefMode: baseRef.mode,
    baseRefFallbackReason,
    createdAt,
    creatorPid: process.pid,
    creatorVersion: 'mossen-agent-supervisor',
    creatorHostname,
    ownershipMarkerPath: markerPath,
    ownershipMarkerHash: marker.hash,
    cleanupState: 'eligible',
    cleanupEligible: true,
    dirty: false,
    isolationReason: null,
  }
  await writeAgentSupervisorWorktreeMetadata(metadata)
  return { cwd: worktreePath, metadata, isolated: true }
}

function verifyOwnershipMarker(
  metadata: AgentSupervisorWorktree,
  marker: string,
): boolean {
  const lines = marker.split('\n')
  const hashLine = lines.find(line => line.startsWith('hash: '))
  if (!hashLine) return false
  const hash = hashLine.slice('hash: '.length).trim()
  const body = marker.slice(0, marker.lastIndexOf('hash: '))
  return (
    hash === metadata.ownershipMarkerHash &&
    computeAgentSupervisorWorktreeOwnershipHash(body) === hash &&
    body.includes(`jobId: ${metadata.jobId}\n`)
  )
}

async function markWorktreeCleanupState(
  metadata: AgentSupervisorWorktree,
  options: { cleanupState: AgentSupervisorWorktree['cleanupState']; dirty: boolean | null },
): Promise<AgentSupervisorWorktree> {
  const next: AgentSupervisorWorktree = {
    ...metadata,
    cleanupState: options.cleanupState,
    dirty: options.dirty,
  }
  await writeAgentSupervisorWorktreeMetadata(next)
  return next
}

export async function cleanupAgentSupervisorWorktree(
  jobId: AgentSupervisorJobId,
): Promise<{
  cleaned: boolean
  metadata: AgentSupervisorWorktree | null
  reason: string
  gitStatusSummary?: string
}> {
  const metadata = await readAgentSupervisorWorktreeMetadata(jobId)
  if (!metadata || !metadata.cleanupEligible || !metadata.path) {
    return { cleaned: false, metadata, reason: 'not_cleanup_eligible' }
  }
  if (
    !metadata.ownedByMossen ||
    metadata.owner !== WORKTREE_OWNER ||
    !metadata.ownershipMarkerPath ||
    !metadata.ownershipMarkerHash ||
    !metadata.baseRepo
  ) {
    return { cleaned: false, metadata, reason: 'ownership_metadata_incomplete' }
  }

  let marker: string
  try {
    marker = await readFile(metadata.ownershipMarkerPath, 'utf8')
  } catch {
    return { cleaned: false, metadata, reason: 'ownership_marker_missing' }
  }
  if (!verifyOwnershipMarker(metadata, marker)) {
    return { cleaned: false, metadata, reason: 'ownership_marker_mismatch' }
  }

  const status = await git(metadata.path, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ])
  if (status.code !== 0) {
    const next = await markWorktreeCleanupState(metadata, {
      cleanupState: 'blocked_dirty',
      dirty: null,
    })
    return { cleaned: false, metadata: next, reason: 'status_failed' }
  }
  if (status.stdout.trim().length > 0) {
    const next = await markWorktreeCleanupState(metadata, {
      cleanupState: 'blocked_dirty',
      dirty: true,
    })
    const lines = status.stdout.trim().split('\n')
    const visible = lines.slice(0, 20)
    const gitStatusSummary =
      lines.length > visible.length
        ? `${visible.join('\n')}\n... ${lines.length - visible.length} more`
        : visible.join('\n')
    return {
      cleaned: false,
      metadata: next,
      reason: 'worktree_dirty',
      gitStatusSummary,
    }
  }

  const remove = await git(metadata.baseRepo, ['worktree', 'remove', metadata.path])
  if (remove.code !== 0) {
    const next = await markWorktreeCleanupState(metadata, {
      cleanupState: 'blocked_dirty',
      dirty: false,
    })
    return { cleaned: false, metadata: next, reason: 'git_worktree_remove_failed' }
  }
  const next = await markWorktreeCleanupState(metadata, {
    cleanupState: 'cleaned',
    dirty: false,
  })
  return { cleaned: true, metadata: next, reason: 'cleaned' }
}
