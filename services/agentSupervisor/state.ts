import {
  chmod,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from 'fs/promises'
import { dirname } from 'path'
import { randomBytes } from 'crypto'
import {
  AGENT_SUPERVISOR_FILE_MODE,
  ensureAgentSupervisorJobDir,
  getAgentSupervisorJobPaths,
} from './paths.js'
import {
  AgentSupervisorJobStateSchema,
  type AgentSupervisorJobId,
  type AgentSupervisorJobState,
} from './schema.js'

const LOCK_RETRY_DELAYS_MS = [15, 30, 60, 120]
const LOCK_STALE_MS = 30_000

export class AgentSupervisorStateCorruptError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message)
    this.name = 'AgentSupervisorStateCorruptError'
  }
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function chmodFileBestEffort(path: string): Promise<void> {
  try {
    await chmod(path, AGENT_SUPERVISOR_FILE_MODE)
  } catch {
    // chmod can fail on unusual filesystems. The open mode still requests 0600.
  }
}

async function fsyncDirectoryBestEffort(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch {
    // Some platforms/filesystems do not allow fsync on directories.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function atomicWriteSupervisorJsonFile(
  path: string,
  data: unknown,
): Promise<void> {
  const body = `${JSON.stringify(data, null, 2)}\n`
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  let renamed = false
  const handle = await open(tmpPath, 'w', AGENT_SUPERVISOR_FILE_MODE)
  try {
    await handle.writeFile(body, 'utf8')
    await handle.sync()
    await handle.close()
    await chmodFileBestEffort(tmpPath)
    await rename(tmpPath, path)
    renamed = true
    await fsyncDirectoryBestEffort(dirname(path))
  } finally {
    if (!renamed) {
      await handle.close().catch(() => undefined)
      await rm(tmpPath, { force: true }).catch(() => undefined)
    }
  }
}

export async function withAgentSupervisorJobLock<T>(
  jobId: AgentSupervisorJobId,
  fn: () => Promise<T>,
): Promise<T> {
  const paths = await ensureAgentSupervisorJobDir(jobId)
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined

  for (let attempt = 0; attempt <= LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      lockHandle = await open(paths.seqLock, 'wx', AGENT_SUPERVISOR_FILE_MODE)
      await lockHandle.writeFile(
        JSON.stringify({
          pid: process.pid,
          ts: new Date().toISOString(),
        }) + '\n',
        'utf8',
      )
      await lockHandle.sync()
      break
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: string }).code
          : undefined
      if (code !== 'EEXIST') throw error

      const stale = await readFile(paths.seqLock, 'utf8')
        .then(raw => {
          const parsed = JSON.parse(raw) as { ts?: string }
          return parsed.ts
            ? Date.now() - Date.parse(parsed.ts) > LOCK_STALE_MS
            : false
        })
        .catch(() => true)
      if (stale) {
        await unlink(paths.seqLock).catch(() => undefined)
        continue
      }
      const delay = LOCK_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        throw new Error(`Agent supervisor job lock is busy: ${jobId}`)
      }
      await sleep(delay)
    }
  }

  if (!lockHandle) {
    throw new Error(`Agent supervisor job lock unavailable: ${jobId}`)
  }

  try {
    return await fn()
  } finally {
    await lockHandle.close().catch(() => undefined)
    await unlink(paths.seqLock).catch(() => undefined)
  }
}

export async function readAgentSupervisorJobState(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorJobState | null> {
  const paths = getAgentSupervisorJobPaths(jobId)
  let raw: string
  try {
    raw = await readFile(paths.state, 'utf8')
  } catch (error) {
    if (isENOENT(error)) return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new AgentSupervisorStateCorruptError(
      error instanceof Error ? error.message : String(error),
      paths.state,
    )
  }
  const result = AgentSupervisorJobStateSchema.safeParse(parsed)
  if (!result.success) {
    throw new AgentSupervisorStateCorruptError(result.error.message, paths.state)
  }
  return result.data
}

export async function writeAgentSupervisorJobState(
  state: AgentSupervisorJobState,
): Promise<void> {
  const parsed = AgentSupervisorJobStateSchema.parse(state)
  await ensureAgentSupervisorJobDir(parsed.id)
  await withAgentSupervisorJobLock(parsed.id, async () => {
    await atomicWriteSupervisorJsonFile(
      getAgentSupervisorJobPaths(parsed.id).state,
      parsed,
    )
  })
}

export async function updateAgentSupervisorJobState(
  jobId: AgentSupervisorJobId,
  updater: (
    state: AgentSupervisorJobState | null,
  ) => AgentSupervisorJobState | Promise<AgentSupervisorJobState>,
): Promise<AgentSupervisorJobState> {
  let nextState: AgentSupervisorJobState | undefined
  await withAgentSupervisorJobLock(jobId, async () => {
    const current = await readAgentSupervisorJobState(jobId)
    nextState = await updater(current)
    nextState = AgentSupervisorJobStateSchema.parse(nextState)
    await atomicWriteSupervisorJsonFile(
      getAgentSupervisorJobPaths(jobId).state,
      nextState,
    )
  })
  return nextState!
}
