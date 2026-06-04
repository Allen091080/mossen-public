import { createHash, randomBytes } from 'crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeSync,
} from 'fs'
import { diffLines } from 'diff'
import { dirname, resolve } from 'path'

type ProjectMemoryOperation =
  | 'preview_init'
  | 'apply_init'
  | 'preview_memory_update'
  | 'apply_memory_update'

type ProjectMemoryStatus = 'blocked' | 'preview' | 'applied' | 'failed'

export type StreamJsonProjectMemoryOperationRequest = {
  operation?: ProjectMemoryOperation
  path?: string
  content?: string
  dryRun?: boolean
  confirm?: boolean
  confirmToken?: string
  previousHash?: string
}

export type StreamJsonProjectMemoryOperationResponse = {
  status: ProjectMemoryStatus
  reason?: string
  summary?: string
  path?: string
  previousHash?: string
  token?: string
  expiresAt?: string
  diff?: string
  diffTruncated?: boolean
  wouldCreate?: string[]
  wouldModify?: string[]
  backupCreated?: boolean
}

type PendingProjectMemoryOperation = {
  operation: 'preview_init' | 'preview_memory_update'
  projectRoot: string
  relativePath: 'MOSSEN.md'
  targetPath: string
  content: string
  previousHash: string
  expiresAt: number
}

type SafeTargetState =
  | {
      ok: true
      exists: true
      content: string
      hash: string
      mode: number
    }
  | {
      ok: true
      exists: false
      content: ''
      hash: 'absent'
      mode: number
    }
  | {
      ok: false
      reason: string
    }

const PROJECT_MEMORY_TOKEN_TTL_MS = 10 * 60 * 1000
const PROJECT_MEMORY_MAX_CHARS = 40_000
const PROJECT_MEMORY_DIFF_MAX_CHARS = 24_000
const DEFAULT_PROJECT_MEMORY_MODE = 0o644
const pendingProjectMemoryOperations = new Map<
  string,
  PendingProjectMemoryOperation
>()

function isENOENT(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
  )
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function pruneExpiredTokens(now = Date.now()): void {
  for (const [token, pending] of pendingProjectMemoryOperations) {
    if (pending.expiresAt <= now) {
      pendingProjectMemoryOperations.delete(token)
    }
  }
}

function normalizeProjectRoot(projectRoot: string): string | { error: string } {
  try {
    const realRoot = realpathSync.native(resolve(projectRoot))
    if (!statSync(realRoot).isDirectory()) {
      return { error: 'project root must be an existing directory' }
    }
    return realRoot
  } catch {
    return { error: 'project root could not be resolved' }
  }
}

function normalizeTargetPath(
  projectRoot: string,
  requestedPath: string | undefined,
): { relativePath: 'MOSSEN.md'; targetPath: string } | { error: string } {
  const rawPath = requestedPath === undefined || requestedPath === ''
    ? 'MOSSEN.md'
    : requestedPath
  const normalized = rawPath === './MOSSEN.md' ? 'MOSSEN.md' : rawPath
  if (normalized !== 'MOSSEN.md') {
    return {
      error:
        'project_memory_operation only supports the project-root MOSSEN.md target in this build',
    }
  }
  const targetPath = resolve(projectRoot, normalized)
  if (dirname(targetPath) !== projectRoot) {
    return { error: 'project memory target must stay inside the project root' }
  }
  return { relativePath: 'MOSSEN.md', targetPath }
}

function readSafeTarget(targetPath: string): SafeTargetState {
  try {
    const stats = lstatSync(targetPath)
    if (stats.isSymbolicLink()) {
      return {
        ok: false,
        reason: 'project memory target must not be a symlink',
      }
    }
    if (!stats.isFile()) {
      return {
        ok: false,
        reason: 'project memory target must be a regular file',
      }
    }
    const content = readFileSync(targetPath, 'utf8')
    return {
      ok: true,
      exists: true,
      content,
      hash: sha256Text(content),
      mode: stats.mode & 0o777,
    }
  } catch (e) {
    if (isENOENT(e)) {
      return {
        ok: true,
        exists: false,
        content: '',
        hash: 'absent',
        mode: DEFAULT_PROJECT_MEMORY_MODE,
      }
    }
    return { ok: false, reason: 'project memory target could not be read' }
  }
}

function normalizeContent(content: unknown): string | { error: string } {
  if (typeof content !== 'string') {
    return { error: 'project_memory_operation requires string content' }
  }
  if (content.includes('\0')) {
    return { error: 'project memory content must not contain NUL bytes' }
  }
  if (content.length > PROJECT_MEMORY_MAX_CHARS) {
    return {
      error: `project memory content exceeds ${PROJECT_MEMORY_MAX_CHARS} characters`,
    }
  }
  return content
}

function buildDiff(
  before: string,
  after: string,
  relativePath: string,
): { text: string; truncated: boolean } {
  const lines = [`--- a/${relativePath}`, `+++ b/${relativePath}`, '@@']
  for (const change of diffLines(before, after)) {
    const prefix = change.added ? '+' : change.removed ? '-' : ' '
    const parts = change.value.split('\n')
    for (let i = 0; i < parts.length; i += 1) {
      if (i === parts.length - 1 && parts[i] === '') continue
      lines.push(`${prefix}${parts[i]}`)
    }
  }
  const text = `${lines.join('\n')}\n`
  if (text.length <= PROJECT_MEMORY_DIFF_MAX_CHARS) {
    return { text, truncated: false }
  }
  return {
    text:
      text.slice(0, PROJECT_MEMORY_DIFF_MAX_CHARS) +
      '\n... diff truncated; content hash guard still covers the full file ...\n',
    truncated: true,
  }
}

function mintProjectMemoryToken(
  pending: PendingProjectMemoryOperation,
): string {
  pruneExpiredTokens()
  const token = randomBytes(4).toString('hex')
  pendingProjectMemoryOperations.set(token, pending)
  return token
}

function createBackupIfPresent(
  targetPath: string,
  token: string,
  state: SafeTargetState & { ok: true },
): boolean {
  if (!state.exists) return false
  copyFileSync(targetPath, `${targetPath}.w177c-${token}.bak`)
  return true
}

function atomicWriteText(
  targetPath: string,
  content: string,
  mode: number,
  token: string,
): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.w177c-${token}.tmp`
  const fd = openSync(tempPath, 'w', mode)
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(tempPath, mode)
  renameSync(tempPath, targetPath)
}

function isConfirmRequest(
  request: StreamJsonProjectMemoryOperationRequest,
): boolean {
  return (
    request.confirm === true ||
    request.operation === 'apply_init' ||
    request.operation === 'apply_memory_update'
  )
}

function expectedApplyOperation(
  previewOperation: PendingProjectMemoryOperation['operation'],
): ProjectMemoryOperation {
  return previewOperation === 'preview_init'
    ? 'apply_init'
    : 'apply_memory_update'
}

function handleConfirm(
  request: StreamJsonProjectMemoryOperationRequest,
): StreamJsonProjectMemoryOperationResponse {
  const token = request.confirmToken?.trim()
  if (!token || !/^[0-9a-f]{8}$/i.test(token)) {
    return {
      status: 'failed',
      reason: 'project_memory_operation confirm requires an 8-hex confirmToken',
    }
  }
  const pending = pendingProjectMemoryOperations.get(token)
  pendingProjectMemoryOperations.delete(token)
  if (!pending) {
    return {
      status: 'failed',
      reason:
        'project_memory_operation confirm token is unknown or expired; run preview again',
    }
  }
  const applyOperation = expectedApplyOperation(pending.operation)
  if (request.operation && request.operation !== applyOperation) {
    return {
      status: 'failed',
      path: pending.relativePath,
      previousHash: pending.previousHash,
      reason: `confirm token was minted for ${applyOperation}`,
    }
  }
  if (request.previousHash && request.previousHash !== pending.previousHash) {
    return {
      status: 'failed',
      path: pending.relativePath,
      previousHash: pending.previousHash,
      reason: 'previousHash does not match the previewed project memory file',
    }
  }
  const current = readSafeTarget(pending.targetPath)
  if (current.ok === false) {
    return {
      status: 'failed',
      path: pending.relativePath,
      previousHash: pending.previousHash,
      reason: current.reason,
    }
  }
  if (current.hash !== pending.previousHash) {
    return {
      status: 'failed',
      path: pending.relativePath,
      previousHash: pending.previousHash,
      reason:
        'project memory file changed after preview; run preview again before confirming',
    }
  }
  const backupCreated = createBackupIfPresent(
    pending.targetPath,
    token,
    current,
  )
  try {
    atomicWriteText(pending.targetPath, pending.content, current.mode, token)
  } catch {
    return {
      status: 'failed',
      path: pending.relativePath,
      previousHash: pending.previousHash,
      backupCreated,
      reason: 'project memory write failed; original file backup was preserved when present',
    }
  }
  return {
    status: 'applied',
    path: pending.relativePath,
    previousHash: pending.previousHash,
    backupCreated,
    summary: `Applied project memory ${applyOperation} to ${pending.relativePath}`,
  }
}

export function handleStreamJsonProjectMemoryOperationRequest(
  request: StreamJsonProjectMemoryOperationRequest,
  options: { projectRoot: string },
): StreamJsonProjectMemoryOperationResponse {
  pruneExpiredTokens()

  if (isConfirmRequest(request)) {
    return handleConfirm(request)
  }

  const operation = request.operation
  if (
    operation !== 'preview_init' &&
    operation !== 'preview_memory_update'
  ) {
    return {
      status: 'failed',
      reason:
        'project_memory_operation requires operation preview_init or preview_memory_update before confirm',
    }
  }
  const projectRoot = normalizeProjectRoot(options.projectRoot)
  if (typeof projectRoot !== 'string') {
    return { status: 'failed', reason: projectRoot.error }
  }
  const target = normalizeTargetPath(projectRoot, request.path)
  if ('error' in target) {
    return { status: 'failed', reason: target.error }
  }
  const content = normalizeContent(request.content)
  if (typeof content !== 'string') {
    return { status: 'failed', path: target.relativePath, reason: content.error }
  }
  const current = readSafeTarget(target.targetPath)
  if (current.ok === false) {
    return { status: 'failed', path: target.relativePath, reason: current.reason }
  }
  if (operation === 'preview_init' && current.exists) {
    return {
      status: 'failed',
      path: target.relativePath,
      previousHash: current.hash,
      reason: 'project memory file already exists; use preview_memory_update',
    }
  }
  if (operation === 'preview_memory_update' && !current.exists) {
    return {
      status: 'failed',
      path: target.relativePath,
      previousHash: current.hash,
      reason: 'project memory file does not exist; use preview_init',
    }
  }
  if (request.previousHash && request.previousHash !== current.hash) {
    return {
      status: 'failed',
      path: target.relativePath,
      previousHash: current.hash,
      reason: 'previousHash does not match the current project memory file',
    }
  }

  const diff = buildDiff(current.content, content, target.relativePath)
  const expiresAt = Date.now() + PROJECT_MEMORY_TOKEN_TTL_MS
  const token = mintProjectMemoryToken({
    operation,
    projectRoot,
    relativePath: target.relativePath,
    targetPath: target.targetPath,
    content,
    previousHash: current.hash,
    expiresAt,
  })
  return {
    status: 'preview',
    path: target.relativePath,
    previousHash: current.hash,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    diff: diff.text,
    diffTruncated: diff.truncated,
    ...(current.exists
      ? { wouldModify: [target.relativePath] }
      : { wouldCreate: [target.relativePath] }),
    summary: `Preview accepted for ${operation}; confirm with ${expectedApplyOperation(operation)} and confirmToken before it expires`,
  }
}
