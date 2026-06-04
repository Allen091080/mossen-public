import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import type { IngressErrorCode } from '../ingest/ingressApi.js'
import { appendJsonlLine } from '../storage/jsonlAppend.js'

export type AdapterDeadLetter = {
  schemaVersion: 1
  sourceEventId?: string
  projectId?: string
  sessionId?: string
  reason: IngressErrorCode | 'duplicate_source_event'
  status: 'skipped' | 'failed'
  textLength?: number
  payloadBytes?: number
  createdAt: string
}

export type AdapterDeadLetterStats = {
  path: string
  count: number
}

export function getAdapterDeadLetterPath(options: MemoryRootOptions): string {
  const rootDir = options.rootDir ?? `${process.env.HOME ?? '.'}/.mossen`
  return `${rootDir}/adapter/dead-letter.jsonl`
}

export async function appendAdapterDeadLetters(
  options: MemoryRootOptions & { letters: AdapterDeadLetter[] },
): Promise<AdapterDeadLetterStats> {
  const path = getAdapterDeadLetterPath(options)
  if (options.letters.length === 0) return adapterDeadLetterStats(options)

  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  for (const letter of options.letters) {
    await appendJsonlLine(path, letter)
  }

  return adapterDeadLetterStats(options)
}

export async function adapterDeadLetterStats(
  options: MemoryRootOptions,
): Promise<AdapterDeadLetterStats> {
  const path = getAdapterDeadLetterPath(options)
  const contents = await readFile(path, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  return {
    path,
    count: contents.split('\n').filter(line => line.trim()).length,
  }
}
