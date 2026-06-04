import { existsSync } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { Database } from 'bun:sqlite'
import type { ArchiveEvent } from '../schema/archiveEvent'
import type { MemoryScope } from '../schema/scope'
import type { MemoryRootOptions, ScopeFilter } from '../index'
import { assertScopeFilter, estimateTokens, getProjectMemoryDir } from '../index'
import {
  listArchiveSessionFilesWithGzipFallback,
  readArchiveEvents,
  type ArchiveEventWithLocation,
} from './jsonlArchiveStore'

export type MemoryIndex = {
  db: Database
  dbPath: string
  ftsAvailable: boolean
}

export type InitializeMemoryIndexOptions = MemoryRootOptions & {
  dbPath?: string
  // W119 H1: when true, return null if the on-disk db doesn't exist instead
  // of creating it. Read paths use this so /memory-sidecar disable + a recall
  // doesn't materialise a fresh memory.db on disk.
  existingOnly?: boolean
}

export type ArchiveIndexSearchOptions = InitializeMemoryIndexOptions & {
  query: string
  scopeFilter: ScopeFilter
  limit?: number
}

export type ArchiveIndexSearchResult = {
  event: ArchiveEvent
  eventId: string
  source: 'archive'
  scope: MemoryScope
  score: number
  tokenEstimate: number
  textPreview: string
  createdAt: string
  jsonlPath: string
  // W143.1: which underlying retrieval layer produced this row.
  // Optional and informational only — `searchArchiveEvents` does NOT
  // populate this directly (it only knows about SQLite). The composite
  // `searchArchiveMultiProject` in retrieval/context.ts attaches the
  // value when it merges SQLite + JSONL fallback results, so the
  // /memory-sidecar recall --debug output can report counts per layer.
  retrievalLayer?: 'sqlite' | 'jsonl-fallback'
}

export async function initializeMemoryIndex(
  options: InitializeMemoryIndexOptions,
): Promise<MemoryIndex | null> {
  const memoryDir = getProjectMemoryDir(options)
  const dbPath = options.dbPath ?? `${memoryDir}/memory.db`
  if (options.existingOnly) {
    if (!existsSync(dbPath)) return null
    const db = new Database(dbPath, { readwrite: true, create: false })
    return { db, dbPath, ftsAvailable: hasFtsTable(db) }
  }
  await mkdir(memoryDir, { recursive: true })
  const db = new Database(dbPath, { create: true })

  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_events (
      event_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      visibility TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      token_estimate INTEGER,
      text_preview TEXT,
      jsonl_path TEXT NOT NULL,
      byte_offset INTEGER,
      byte_length INTEGER,
      model TEXT,
      permission_mode TEXT,
      event_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_archive_events_scope
      ON archive_events (scope, project_id, session_id, created_at);
  `)

  let ftsAvailable = true
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS archive_events_fts
      USING fts5(event_id UNINDEXED, text);
    `)
  } catch {
    ftsAvailable = false
  }

  return { db, dbPath, ftsAvailable }
}

function hasFtsTable(db: Database): boolean {
  try {
    const row = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='archive_events_fts'",
      )
      .get()
    return Boolean(row)
  } catch {
    return false
  }
}

export async function indexArchiveEvents(
  indexOrOptions: MemoryIndex | InitializeMemoryIndexOptions,
  entries: ArchiveEventWithLocation[] | ArchiveEvent[],
): Promise<{ indexed: number; ftsAvailable: boolean }> {
  const resolved = isMemoryIndex(indexOrOptions)
    ? indexOrOptions
    : await initializeMemoryIndex(indexOrOptions)
  if (!resolved) {
    // existingOnly was true and the db doesn't exist — nothing to index
    return { indexed: 0, ftsAvailable: false }
  }
  const index = resolved

  const insertArchive = index.db.prepare(`
    INSERT OR REPLACE INTO archive_events (
      event_id,
      schema_version,
      project_id,
      session_id,
      scope,
      visibility,
      role,
      kind,
      created_at,
      text_hash,
      token_estimate,
      text_preview,
      jsonl_path,
      byte_offset,
      byte_length,
      model,
      permission_mode,
      event_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const deleteFts = index.ftsAvailable
    ? index.db.prepare('DELETE FROM archive_events_fts WHERE event_id = ?')
    : undefined
  const insertFts = index.ftsAvailable
    ? index.db.prepare('INSERT INTO archive_events_fts (event_id, text) VALUES (?, ?)')
    : undefined

  const transaction = index.db.transaction((normalized: ArchiveEventWithLocation[]) => {
    for (const entry of normalized) {
      const event = entry.event
      insertArchive.run(
        event.eventId,
        event.schemaVersion,
        event.projectId,
        event.sessionId,
        event.scope,
        event.visibility,
        event.role,
        event.kind,
        event.createdAt,
        event.textHash,
        event.tokenEstimate ?? estimateTokens(event.text),
        previewText(event.text),
        entry.jsonlPath,
        entry.byteOffset,
        entry.byteLength,
        event.model ?? null,
        event.permissionMode ?? null,
        JSON.stringify(event),
      )
      deleteFts?.run(event.eventId)
      insertFts?.run(event.eventId, event.text)
    }
  })

  const normalized = entries.map(normalizeArchiveEntry)
  transaction(normalized)
  return { indexed: normalized.length, ftsAvailable: index.ftsAvailable }
}

export async function searchArchiveEvents(
  options: ArchiveIndexSearchOptions,
): Promise<ArchiveIndexSearchResult[]> {
  assertScopeFilter(options.scopeFilter)
  const limit = options.limit ?? 10
  if (limit <= 0) return []

  // W119 H1: read paths must not auto-create memory.db. If the db doesn't
  // exist (e.g. sidecar disabled / never indexed), return empty rather than
  // materialising an empty database file on disk.
  const index = await initializeMemoryIndex({ ...options, existingOnly: true })
  if (!index) return []
  const params = scopeParams(options.scopeFilter, 'e')
  const query = options.query.trim()
  const rows = index.ftsAvailable && query
    ? searchWithFts(index, query, params, limit)
    : searchWithLike(index, query, scopeParams(options.scopeFilter), limit)
  const fallbackRows = rows.length || !query
    ? rows
    : searchWithLike(index, query, scopeParams(options.scopeFilter), limit)
  const termFallbackRows = fallbackRows.length || !query
    ? fallbackRows
    : searchWithLikeTerms(index, query, scopeParams(options.scopeFilter), limit)

  return termFallbackRows.map(rowToArchiveSearchResult)
}

export async function getArchiveEventsById(
  options: InitializeMemoryIndexOptions & {
    eventIds: string[]
    scopeFilter: ScopeFilter
  },
): Promise<ArchiveIndexSearchResult[]> {
  assertScopeFilter(options.scopeFilter)
  if (!options.eventIds.length) return []

  // W119 H1: read path; do not auto-create the db.
  const index = await initializeMemoryIndex({ ...options, existingOnly: true })
  if (!index) return []
  const params = scopeParams(options.scopeFilter)
  const placeholders = options.eventIds.map(() => '?').join(', ')
  const rows = index.db
    .query(`
      SELECT
        event_id,
        event_json,
        scope,
        token_estimate,
        text_preview,
        created_at,
        jsonl_path,
        1.0 AS score
      FROM archive_events
      WHERE event_id IN (${placeholders})
        ${params.where}
      ORDER BY created_at DESC
    `)
    .all(...options.eventIds, ...params.values) as ArchiveEventRow[]

  return rows.map(rowToArchiveSearchResult)
}

export async function rebuildArchiveIndex(
  options: InitializeMemoryIndexOptions,
): Promise<{ indexed: number; dbPath: string; ftsAvailable: boolean }> {
  const memoryDir = getProjectMemoryDir(options)
  const dbPath = options.dbPath ?? `${memoryDir}/memory.db`
  await unlink(dbPath).catch(error => {
    if (error?.code !== 'ENOENT') throw error
  })

  const index = await initializeMemoryIndex({ ...options, dbPath })
  if (!index) {
    // Write path; existingOnly is not set here so this should never happen.
    throw new Error('initializeMemoryIndex returned null on write path')
  }
  const sessionsDir = `${memoryDir}/archive/sessions`
  const files = await listArchiveSessionFilesWithGzipFallback(sessionsDir)

  const entries = (
    await Promise.all(
      files
        .map(file =>
          readArchiveEvents({
            ...options,
            sessionId: basename(file, '.jsonl'),
          }),
        ),
    )
  ).flat()

  const { indexed } = await indexArchiveEvents(index, entries)
  return { indexed, dbPath, ftsAvailable: index.ftsAvailable }
}

type ArchiveEventRow = {
  event_id: string
  event_json: string
  scope: MemoryScope
  score: number
  token_estimate: number | null
  text_preview: string | null
  created_at: string
  jsonl_path: string
}

function searchWithFts(
  index: MemoryIndex,
  query: string,
  params: ReturnType<typeof scopeParams>,
  limit: number,
): ArchiveEventRow[] {
  try {
    return index.db
      .query(`
        SELECT
          e.event_id,
          e.event_json,
          e.scope,
          e.token_estimate,
          e.text_preview,
          e.created_at,
          e.jsonl_path,
          bm25(archive_events_fts) * -1 AS score
        FROM archive_events_fts
        JOIN archive_events e ON e.event_id = archive_events_fts.event_id
        WHERE archive_events_fts MATCH ?
          ${params.where}
        ORDER BY score DESC, e.created_at DESC
        LIMIT ?
      `)
      .all(query, ...params.values, limit) as ArchiveEventRow[]
  } catch {
    return searchWithLike(index, query, scopeParamsFromAliased(params), limit)
  }
}

function searchWithLike(
  index: MemoryIndex,
  query: string,
  params: ReturnType<typeof scopeParams>,
  limit: number,
): ArchiveEventRow[] {
  const like = `%${escapeLike(query)}%`
  const lowerQuery = query.toLowerCase()
  const waveBoost = /^w\d{2,3}[a-z]?$/.test(lowerQuery) ? 0.3 : 0
  return index.db
    .query(`
      SELECT
        event_id,
        event_json,
        scope,
        token_estimate,
        text_preview,
        created_at,
        jsonl_path,
        CASE WHEN ? = '' THEN 0.1 ELSE ${0.25 + waveBoost} END AS score
      FROM archive_events
      WHERE (? = '' OR event_json LIKE ? ESCAPE '\\')
        ${params.where}
      ORDER BY score DESC, created_at DESC
      LIMIT ?
    `)
    .all(query, query, like, ...params.values, limit) as ArchiveEventRow[]
}

function searchWithLikeTerms(
  index: MemoryIndex,
  query: string,
  params: ReturnType<typeof scopeParams>,
  limit: number,
): ArchiveEventRow[] {
  const terms = tokenizeSearchQuery(query)
  if (!terms.length) return []

  const whereTerms = terms
    .map(() => "event_json LIKE ? ESCAPE '\\'")
    .join(' AND ')
  const likes = terms.map(term => `%${escapeLike(term)}%`)

  // Check if any term is a wave ID for boost
  const lowerTerms = terms.map(t => t.toLowerCase())
  const hasWaveId = lowerTerms.some(t => /^w\d{2,3}[a-z]?$/.test(t))
  const baseScore = hasWaveId ? 0.5 : 0.2

  return index.db
    .query(`
      SELECT
        event_id,
        event_json,
        scope,
        token_estimate,
        text_preview,
        created_at,
        jsonl_path,
        ${baseScore} AS score
      FROM archive_events
      WHERE ${whereTerms}
        ${params.where}
      ORDER BY score DESC, created_at DESC
      LIMIT ?
    `)
    .all(...likes, ...params.values, limit) as ArchiveEventRow[]
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function scopeParams(scopeFilter: ScopeFilter, alias?: string): { where: string; values: string[] } {
  const prefix = alias ? `${alias}.` : ''
  const where = [`${prefix}scope = ?`]
  const values: string[] = [scopeFilter.scope]

  if (scopeFilter.projectId) {
    where.push(`${prefix}project_id = ?`)
    values.push(scopeFilter.projectId)
  }
  if (scopeFilter.sessionId) {
    where.push(`${prefix}session_id = ?`)
    values.push(scopeFilter.sessionId)
  }

  return { where: ` AND ${where.join(' AND ')}`, values }
}

function scopeParamsFromAliased(params: ReturnType<typeof scopeParams>): ReturnType<typeof scopeParams> {
  return {
    where: params.where.replaceAll('e.', ''),
    values: params.values,
  }
}

function normalizeArchiveEntry(entry: ArchiveEventWithLocation | ArchiveEvent): ArchiveEventWithLocation {
  if ('event' in entry) return entry
  return {
    event: entry,
    jsonlPath: '',
    byteOffset: 0,
    byteLength: Buffer.byteLength(`${JSON.stringify(entry)}\n`),
  }
}

function rowToArchiveSearchResult(row: ArchiveEventRow): ArchiveIndexSearchResult {
  const event = JSON.parse(row.event_json) as ArchiveEvent
  return {
    event,
    eventId: row.event_id,
    source: 'archive',
    scope: row.scope,
    score: row.score,
    tokenEstimate: row.token_estimate ?? estimateTokens(event.text),
    textPreview: row.text_preview ?? previewText(event.text),
    createdAt: row.created_at,
    jsonlPath: row.jsonl_path,
  }
}

function previewText(text: string): string {
  return text.length <= 280 ? text : `${text.slice(0, 277)}...`
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function isMemoryIndex(value: MemoryIndex | InitializeMemoryIndexOptions): value is MemoryIndex {
  return 'db' in value
}
