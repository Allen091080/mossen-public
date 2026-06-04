import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { isArchiveEvent, type ArchiveEvent } from '../schema/archiveEvent'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import { appendJsonlLine } from './jsonlAppend'

export type AppendArchiveEventOptions = MemoryRootOptions & {
  event: ArchiveEvent
}

export type ArchiveEventWithLocation = {
  event: ArchiveEvent
  jsonlPath: string
  byteOffset: number
  byteLength: number
}

export type CorruptArchiveLine = {
  jsonlPath: string
  lineNumber: number
  byteOffset: number
  byteLength: number
  rawLine: string
  reason: string
}

export type TolerantArchiveReadResult = {
  events: ArchiveEventWithLocation[]
  corruptLines: CorruptArchiveLine[]
}

export type ReadArchiveEventsOptions = MemoryRootOptions & {
  sessionId: string
}

export type RecentArchiveEventsOptions = MemoryRootOptions & {
  sessionId?: string
  limit?: number
}

export function getArchiveSessionPath(options: MemoryRootOptions & { sessionId: string }): string {
  return `${getProjectMemoryDir(options)}/archive/sessions/${safePathSegment(options.sessionId)}.jsonl`
}

export function getArchiveSessionCompressedPath(
  options: MemoryRootOptions & { sessionId: string },
): string {
  return `${getArchiveSessionPath(options)}.gz`
}

export type ArchiveSessionReadPath = {
  path: string
  kind: 'source' | 'gzip' | 'missing'
}

export async function getArchiveSessionReadPath(
  options: MemoryRootOptions & { sessionId: string },
): Promise<ArchiveSessionReadPath> {
  const jsonlPath = getArchiveSessionPath(options)
  try {
    const info = await stat(jsonlPath)
    if (info.isFile()) return { path: jsonlPath, kind: 'source' }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const gzPath = getArchiveSessionCompressedPath(options)
  try {
    const info = await stat(gzPath)
    if (info.isFile()) return { path: gzPath, kind: 'gzip' }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { path: jsonlPath, kind: 'missing' }
}

export async function appendArchiveEvent(
  options: AppendArchiveEventOptions,
): Promise<ArchiveEventWithLocation> {
  const { event } = options
  if (event.projectId !== options.projectId) {
    throw new Error('event.projectId must match append projectId')
  }
  if (!event.sessionId) {
    throw new Error('event.sessionId is required')
  }

  const jsonlPath = getArchiveSessionPath({ ...options, sessionId: event.sessionId })
  await mkdir(`${getProjectMemoryDir(options)}/archive/sessions`, { recursive: true })

  const { byteOffset, byteLength } = await appendJsonlLine(jsonlPath, event)
  return { event, jsonlPath, byteOffset, byteLength }
}

export async function readArchiveEvents(
  options: ReadArchiveEventsOptions,
): Promise<ArchiveEventWithLocation[]> {
  return (await readArchiveEventsTolerant(options)).events
}

export async function readArchiveEventsTolerant(
  options: ReadArchiveEventsOptions,
): Promise<TolerantArchiveReadResult> {
  const jsonlPath = getArchiveSessionPath(options)
  const readPath = await getArchiveSessionReadPath(options)
  if (readPath.kind === 'missing') {
    return parseArchiveJsonl('', jsonlPath)
  }

  if (readPath.kind === 'source') {
    const contents = await readFile(readPath.path, 'utf8').catch(error => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    return parseArchiveJsonl(contents, readPath.path)
  }

  const gzPath = readPath.path
  const gz = await readFile(gzPath).catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!gz) return parseArchiveJsonl('', jsonlPath)

  try {
    const contents = gunzipSync(gz).toString('utf8')
    return parseArchiveJsonl(contents, gzPath)
  } catch (error) {
    return {
      events: [],
      corruptLines: [{
        jsonlPath: gzPath,
        lineNumber: 0,
        byteOffset: 0,
        byteLength: gz.length,
        rawLine: '',
        reason: `gzip fallback failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }],
    }
  }
}

export function parseArchiveJsonl(contents: string, jsonlPath: string): TolerantArchiveReadResult {
  const events: ArchiveEventWithLocation[] = []
  const corruptLines: CorruptArchiveLine[] = []
  let byteOffset = 0
  let lineNumber = 1

  for (const rawRecord of splitJsonlRecords(contents)) {
    const line = rawRecord.endsWith('\n') ? rawRecord.slice(0, -1).replace(/\r$/, '') : rawRecord
    const byteLength = Buffer.byteLength(rawRecord)
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line) as unknown
        if (!isArchiveEvent(parsed)) {
          corruptLines.push({
            jsonlPath,
            lineNumber,
            byteOffset,
            byteLength,
            rawLine: line,
            reason: 'line is valid JSON but not a supported ArchiveEvent',
          })
        } else {
          events.push({ event: parsed, jsonlPath, byteOffset, byteLength })
        }
      } catch (error) {
        corruptLines.push({
          jsonlPath,
          lineNumber,
          byteOffset,
          byteLength,
          rawLine: line,
          reason: error instanceof Error ? error.message : 'invalid JSON',
        })
      }
    }
    byteOffset += byteLength
    lineNumber += 1
  }

  return { events, corruptLines }
}

export async function recentArchiveEvents(
  options: RecentArchiveEventsOptions,
): Promise<ArchiveEventWithLocation[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  if (options.sessionId) {
    const events = await readArchiveEvents({ ...options, sessionId: options.sessionId })
    return events.slice(-limit).reverse()
  }

  const sessionsDir = `${getProjectMemoryDir(options)}/archive/sessions`
  const sessionFiles = await Promise.all(
    (await listArchiveSessionFilesWithGzipFallback(sessionsDir))
      .map(async file => ({
        file,
        modifiedMs: Number((await statArchiveSessionCandidate({
          ...options,
          sessionId: basename(file, '.jsonl'),
        })).mtimeMs),
      })),
  )

  const recentFiles = sessionFiles
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, Math.max(1, limit))

  const allEvents = (
    await Promise.all(
      recentFiles.map(({ file }) =>
        readArchiveEvents({
          ...options,
          sessionId: basename(file, '.jsonl'),
        }),
      ),
    )
  ).flat()

  return allEvents
    .sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt))
    .slice(0, limit)
}

export type ArchiveStats = {
  totalEvents: number
  sessionCount: number
  latestEventAt: string | null
}

export async function getArchiveStats(
  options: MemoryRootOptions,
): Promise<ArchiveStats> {
  const sessionsDir = `${getProjectMemoryDir(options)}/archive/sessions`
  const jsonlFiles = await listArchiveSessionFilesWithGzipFallback(sessionsDir)
  let totalEvents = 0
  let latestEventAt: string | null = null

  for (const file of jsonlFiles) {
    const events = await readArchiveEvents({
      ...options,
      sessionId: basename(file, '.jsonl'),
    })
    totalEvents += events.length
    for (const { event } of events) {
      if (!latestEventAt || event.createdAt > latestEventAt) {
        latestEventAt = event.createdAt
      }
    }
  }

  return { totalEvents, sessionCount: jsonlFiles.length, latestEventAt }
}

export async function listArchiveSessionFilesWithGzipFallback(
  sessionsDir: string,
): Promise<string[]> {
  const files = await readdir(sessionsDir).catch(error => {
    if (error?.code === 'ENOENT') return [] as string[]
    throw error
  })

  const sourceFiles = new Set(files.filter(file => file.endsWith('.jsonl')))
  const candidates = new Set<string>(sourceFiles)
  for (const file of files) {
    if (!file.endsWith('.jsonl.gz')) continue
    const sourceName = file.slice(0, -'.gz'.length)
    if (!sourceFiles.has(sourceName)) {
      candidates.add(sourceName)
    }
  }
  const existing = await Promise.all(
    [...candidates].map(async file => {
      const sourcePath = `${sessionsDir}/${file}`
      const gzPath = `${sourcePath}.gz`
      try {
        const source = await stat(sourcePath)
        return source.isFile() ? file : undefined
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      try {
        const gz = await stat(gzPath)
        return gz.isFile() ? file : undefined
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      return undefined
    }),
  )
  return existing.filter((file): file is string => Boolean(file)).sort()
}

async function statArchiveSessionCandidate(
  options: MemoryRootOptions & { sessionId: string },
): Promise<Awaited<ReturnType<typeof stat>>> {
  const readPath = await getArchiveSessionReadPath(options)
  if (readPath.kind === 'missing') {
    return stat(getArchiveSessionPath(options))
  }
  return stat(readPath.path)
}

export type JsonlFallbackSearchResult = {
  event: ArchiveEvent
  eventId: string
  source: 'archive'
  scope: ArchiveEvent['scope']
  score: number
  tokenEstimate: number
  textPreview: string
  createdAt: string
}

/**
 * Read-only JSONL fallback search.
 *
 * Scans archive JSONL files for events matching the query using lightweight
 * text scoring. Does NOT write to SQLite or modify any files. Used when the
 * SQLite index is empty or missing but JSONL data exists on disk.
 */
export async function searchArchiveJsonlFallback(
  options: MemoryRootOptions & {
    query: string
    limit?: number
  },
): Promise<JsonlFallbackSearchResult[]> {
  const limit = options.limit ?? 10
  if (limit <= 0) return []

  const query = options.query.trim()
  if (!query) return []

  const events = await recentArchiveEvents({
    ...options,
    limit: 200,
  })

  const scored: JsonlFallbackSearchResult[] = []
  for (const { event } of events) {
    const score = jsonlScoreText(event.text, query)
    if (score <= 0) continue

    // Ensure textPreview includes the query match region, not just the start
    const textPreview = makePreview(event.text, query)
    scored.push({
      event,
      eventId: event.eventId,
      source: 'archive',
      scope: event.scope,
      score,
      tokenEstimate: event.tokenEstimate ?? Math.max(1, Math.ceil(event.text.length / 4)),
      textPreview,
      createdAt: event.createdAt,
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

function jsonlScoreText(text: string, query: string): number {
  const lower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  // Exact full-query substring match: highest priority
  if (lower.includes(queryLower)) {
    return 1.0
  }

  const terms = queryLower.split(/\s+/).filter(Boolean)
  if (!terms.length) return 0

  // All terms must match (AND semantics)
  const allMatch = terms.every(term => lower.includes(term))
  if (!allMatch) return 0

  return 0.5
}

/**
 * Create a preview of text that includes the query match region.
 * If the text is short enough, return it as-is. Otherwise, center the
 * preview around the first occurrence of the query.
 */
function makePreview(text: string, query: string, maxLen = 280): string {
  if (text.length <= maxLen) return text

  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  const idx = textLower.indexOf(queryLower)
  if (idx < 0) {
    // Fallback: first terms match
    const terms = queryLower.split(/\s+/).filter(Boolean)
    const termIdx = terms.reduce((best, term) => {
      const ti = textLower.indexOf(term)
      return ti >= 0 && (best < 0 || ti < best) ? ti : best
    }, -1)
    if (termIdx >= 0) {
      return centeredPreview(text, termIdx, maxLen)
    }
    return `${text.slice(0, maxLen - 3)}...`
  }

  return centeredPreview(text, idx, maxLen)
}

function centeredPreview(text: string, matchStart: number, maxLen: number): string {
  // Center around the match, with some leading context
  const contextBefore = Math.min(40, matchStart)
  let start = matchStart - contextBefore
  const end = Math.min(text.length, start + maxLen - 3)
  start = Math.max(0, end - (maxLen - 3))
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function safePathSegment(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`unsafe path segment: ${value}`)
  }
  return value
}

function splitJsonlRecords(contents: string): string[] {
  if (!contents) return []

  const records: string[] = []
  let start = 0
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === '\n') {
      records.push(contents.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < contents.length) {
    records.push(contents.slice(start))
  }
  return records
}
