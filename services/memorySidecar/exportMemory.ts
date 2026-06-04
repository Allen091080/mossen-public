// W433 — User-facing memory export.
//
// Calls listUserMemory({ kind: 'all' }) and renders the result to a single
// markdown or JSON file written to cwd. This complements (not replaces)
// /memory-sidecar export which copies raw JSONL for forensic/backup; W433
// is for end-user readable export.
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  getDefaultMemorySidecarConfigPath,
  listUserMemory,
  loadMemorySidecarConfig,
  type UserMemorySummary,
} from '../../memory-sidecar/src/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

export type MemoryExportFormat = 'markdown' | 'json'

export type MemoryExportResult =
  | {
      ok: true
      path: string
      totalCount: number
      format: MemoryExportFormat
    }
  | {
      ok: false
      reason: 'sidecar_disabled' | 'config_error' | 'list_failed' | 'write_failed'
      detail?: string
    }

const DEFAULT_EXPORT_LIMIT = 500

function timestampSlug(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function truncateForCell(value: string | undefined, max = 160): string {
  if (!value) return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

export type MemoryExportHeader = {
  projectId: string
  generatedAt: string
  totalCount: number
  limit: number
}

export function formatMemoryExportMarkdown(
  entries: UserMemorySummary[],
  header: MemoryExportHeader,
): string {
  const lines: string[] = []
  lines.push(`# Mossen memory export`)
  lines.push('')
  lines.push(`- Project: \`${header.projectId}\``)
  lines.push(`- Generated: ${header.generatedAt}`)
  lines.push(`- Total entries: ${header.totalCount} (limit ${header.limit})`)
  lines.push('')

  const grouped = new Map<string, UserMemorySummary[]>()
  for (const entry of entries) {
    const bucket = grouped.get(entry.kind) ?? []
    bucket.push(entry)
    grouped.set(entry.kind, bucket)
  }

  // Stable kind order: archive first (most likely to interest user), then
  // observation, profile, proposal.
  const KIND_ORDER = ['archive', 'observation', 'profile', 'proposal'] as const
  for (const kind of KIND_ORDER) {
    const bucket = grouped.get(kind)
    if (!bucket || bucket.length === 0) continue
    lines.push(`## ${kind} (${bucket.length})`)
    lines.push('')
    lines.push('| id | title | createdAt | source |')
    lines.push('| --- | --- | --- | --- |')
    for (const entry of bucket) {
      lines.push(
        `| \`${escapeMarkdownCell(entry.id)}\` | ${escapeMarkdownCell(
          truncateForCell(entry.title),
        )} | ${entry.createdAt ?? ''} | ${entry.source ?? ''} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function formatMemoryExportJson(
  entries: UserMemorySummary[],
  header: MemoryExportHeader,
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      header,
      entries,
    },
    null,
    2,
  )
}

export async function writeMemoryExportFile(options: {
  cwd: string
  projectId: string
  format: MemoryExportFormat
  limit?: number
  now?: Date
}): Promise<MemoryExportResult> {
  const limit = options.limit ?? DEFAULT_EXPORT_LIMIT

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    logForDebugging(
      `[memory-export] config load failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'config_error',
      detail: errorMessage(error),
    }
  }

  if (!config.enabled) {
    return { ok: false, reason: 'sidecar_disabled' }
  }

  let entries: UserMemorySummary[]
  try {
    entries = await listUserMemory({
      rootDir: config.homeDir,
      projectId: options.projectId,
      kind: 'all',
      limit,
    })
  } catch (error) {
    logForDebugging(
      `[memory-export] list failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'list_failed',
      detail: errorMessage(error),
    }
  }

  const header: MemoryExportHeader = {
    projectId: options.projectId,
    generatedAt: new Date().toISOString(),
    totalCount: entries.length,
    limit,
  }

  const ext = options.format === 'json' ? 'json' : 'md'
  const slug = timestampSlug(options.now ?? new Date())
  const path = join(options.cwd, `mossen-memory-export-${slug}.${ext}`)
  const body =
    options.format === 'json'
      ? formatMemoryExportJson(entries, header)
      : formatMemoryExportMarkdown(entries, header)

  try {
    await writeFile(path, body, 'utf8')
  } catch (error) {
    logForDebugging(
      `[memory-export] write failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return {
      ok: false,
      reason: 'write_failed',
      detail: errorMessage(error),
    }
  }

  return {
    ok: true,
    path,
    totalCount: entries.length,
    format: options.format,
  }
}
