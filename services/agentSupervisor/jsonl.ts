import { chmod, mkdir, open, readFile, stat } from 'fs/promises'
import { dirname } from 'path'
import { AGENT_SUPERVISOR_DIR_MODE, AGENT_SUPERVISOR_FILE_MODE } from './paths.js'
import {
  AGENT_SUPERVISOR_SCHEMA_VERSION,
  type AgentSupervisorJsonlEnvelope,
  type AgentSupervisorJsonlSource,
} from './schema.js'

const DEFAULT_MAX_JSONL_READ_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_JSONL_RECORD_BYTES = 64 * 1024

export type SupervisorJsonlReadResult<T> = {
  records: T[]
  malformedLines: number
  partialTrailingLine: boolean
}

export type SupervisorJsonlAppendOptions = {
  fsync?: boolean
  maxRecordBytes?: number
}

export type SupervisorJsonlReadOptions = {
  maxReadBytes?: number
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

async function chmodFileBestEffort(path: string): Promise<void> {
  try {
    await chmod(path, AGENT_SUPERVISOR_FILE_MODE)
  } catch {
    // chmod can fail on unusual filesystems. The open mode still requests 0600.
  }
}

export function buildSupervisorJsonlEnvelope(
  options: {
    seq: number
    kind: string
    source: AgentSupervisorJsonlSource
    ts?: string
  },
): AgentSupervisorJsonlEnvelope {
  return {
    ts: options.ts ?? new Date().toISOString(),
    seq: options.seq,
    kind: options.kind,
    source: options.source,
    v: AGENT_SUPERVISOR_SCHEMA_VERSION,
  }
}

export async function appendSupervisorJsonlLine(
  path: string,
  record: unknown,
  options: SupervisorJsonlAppendOptions = {},
): Promise<{ byteLength: number }> {
  await mkdir(dirname(path), {
    recursive: true,
    mode: AGENT_SUPERVISOR_DIR_MODE,
  })
  const line = `${JSON.stringify(record)}\n`
  const byteLength = Buffer.byteLength(line)
  const maxRecordBytes =
    options.maxRecordBytes ?? DEFAULT_MAX_JSONL_RECORD_BYTES
  if (byteLength > maxRecordBytes) {
    throw new Error(
      `Agent supervisor JSONL record too large: ${byteLength} > ${maxRecordBytes}`,
    )
  }

  const handle = await open(path, 'a', AGENT_SUPERVISOR_FILE_MODE)
  try {
    await handle.writeFile(line, 'utf8')
    if (options.fsync ?? true) {
      await handle.sync()
    }
  } finally {
    await handle.close()
  }
  await chmodFileBestEffort(path)
  return { byteLength }
}

async function readJsonlTail(
  path: string,
  maxReadBytes: number,
): Promise<string | null> {
  try {
    const info = await stat(path)
    if (info.size <= maxReadBytes) {
      return await readFile(path, 'utf8')
    }
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.allocUnsafe(maxReadBytes)
      const offset = info.size - maxReadBytes
      const { bytesRead } = await handle.read(
        buffer,
        0,
        maxReadBytes,
        offset,
      )
      let text = buffer.subarray(0, bytesRead).toString('utf8')
      const firstNewline = text.indexOf('\n')
      if (firstNewline !== -1) {
        text = text.slice(firstNewline + 1)
      }
      return text
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (isENOENT(error)) return null
    throw error
  }
}

export async function readSupervisorJsonlTolerant<T = unknown>(
  path: string,
  options: SupervisorJsonlReadOptions = {},
): Promise<SupervisorJsonlReadResult<T>> {
  const raw = await readJsonlTail(
    path,
    options.maxReadBytes ?? DEFAULT_MAX_JSONL_READ_BYTES,
  )
  if (raw === null || raw.length === 0) {
    return { records: [], malformedLines: 0, partialTrailingLine: false }
  }

  const hasTrailingNewline = raw.endsWith('\n')
  const lines = raw.split('\n')
  let partialTrailingLine = false
  if (!hasTrailingNewline && lines.length > 0) {
    lines.pop()
    partialTrailingLine = true
  }

  const records: T[] = []
  let malformedLines = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(JSON.parse(trimmed) as T)
    } catch {
      malformedLines += 1
    }
  }
  return { records, malformedLines, partialTrailingLine }
}

export async function getNextSupervisorJsonlSeq(path: string): Promise<number> {
  const { records } =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorJsonlEnvelope>>(path)
  let maxSeq = 0
  for (const record of records) {
    if (typeof record.seq === 'number' && Number.isInteger(record.seq)) {
      maxSeq = Math.max(maxSeq, record.seq)
    }
  }
  return maxSeq + 1
}
