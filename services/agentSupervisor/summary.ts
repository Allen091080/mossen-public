import { open, stat } from 'fs/promises'
import { readSupervisorJsonlTolerant } from './jsonl.js'
import { getAgentSupervisorJobPaths } from './paths.js'
import {
  readAgentSupervisorRoster,
  upsertAgentSupervisorRosterJob,
} from './roster.js'
import {
  AgentSupervisorJobIdSchema,
  type AgentSupervisorEventMessage,
  type AgentSupervisorJobId,
  type AgentSupervisorOutputMessage,
  type AgentSupervisorRoster,
} from './schema.js'
import {
  reconcileAgentSupervisorStaleProcesses,
} from './daemon.js'
import {
  readAgentSupervisorJobState,
  updateAgentSupervisorJobState,
} from './state.js'
import {
  agentSupervisorTranscriptExists,
  readAgentSupervisorTranscriptLink,
} from './transcriptLink.js'

const SUMMARY_TAIL_BYTES = 64 * 1024
const SUMMARY_REFRESH_INTERVAL_MS = 15_000
const SUMMARY_MAX_CHARS = 180
const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g
const PR_URL_PATTERN =
  /https?:\/\/[^\s)]+\/(?:pull|merge_requests|(?:-|repos\/[^/]+\/[^/]+\/pulls))\/(\d+)\b/i
const PR_NUMBER_PATTERN = /\b(?:PR|pull request|merge request)\s*#?(\d+)\b/i

const summaryRefreshCache = new Map<string, number>()

export type AgentSupervisorRowSummary = {
  summary: string | null
  prLabel: string | null
  prUrl: string | null
}

function collapseText(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateSummary(value: string): string {
  const collapsed = collapseText(value)
  if (collapsed.length <= SUMMARY_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

async function readTailUtf8(path: string, maxBytes = SUMMARY_TAIL_BYTES): Promise<string> {
  const info = await stat(path)
  const start = Math.max(0, info.size - maxBytes)
  const length = info.size - start
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    const text = buffer.toString('utf8')
    if (start === 0) return text
    const firstNewline = text.indexOf('\n')
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
  } finally {
    await handle.close()
  }
}

function parseJsonlTail(text: string): unknown[] {
  const records: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // Transcript tail may start or end mid-line; summary derivation is best-effort.
    }
  }
  return records
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    const parts = value
      .map(item => extractText(item))
      .filter((item): item is string => Boolean(item))
    return parts.length > 0 ? parts.join(' ') : null
  }
  const record = value as Record<string, unknown>
  for (const key of ['text', 'summary', 'content', 'message']) {
    const text = extractText(record[key])
    if (text) return text
  }
  return null
}

function extractTranscriptSummary(records: unknown[]): string | null {
  for (const record of records.slice().reverse()) {
    if (!record || typeof record !== 'object') continue
    const typed = record as Record<string, unknown>
    const message = typed.message
    if (message && typeof message === 'object') {
      const role = (message as { role?: unknown }).role
      if (role === 'assistant') {
        const text = extractText((message as Record<string, unknown>).content)
        if (text) return truncateSummary(text)
      }
    }
    if (typed.type === 'assistant') {
      const text = extractText(message ?? typed.content)
      if (text) return truncateSummary(text)
    }
  }
  for (const record of records.slice().reverse()) {
    const text = extractText(record)
    if (text) return truncateSummary(text)
  }
  return null
}

function extractOutputSummary(
  records: Partial<AgentSupervisorOutputMessage>[],
): string | null {
  for (const record of records.slice().reverse()) {
    if (record.kind === 'assistant_text' && record.text) {
      return truncateSummary(record.text)
    }
    if (record.kind === 'tool_result') {
      const tail = record.stderrTail ?? record.stdoutTail
      if (tail) return truncateSummary(tail)
    }
    if (record.kind === 'tool_call' && record.input) {
      return truncateSummary(`${record.tool ?? 'tool'} ${record.input}`)
    }
  }
  return null
}

function extractEventSummary(
  records: Partial<AgentSupervisorEventMessage>[],
): string | null {
  for (const record of records.slice().reverse()) {
    if (record.kind === 'result_payload' && record.payload?.summary) {
      return truncateSummary(record.payload.summary)
    }
    if (record.kind === 'assistant_done' && record.summary) {
      return truncateSummary(record.summary)
    }
    if (record.kind === 'needs_input' && record.question) {
      return truncateSummary(record.question)
    }
    if (record.kind === 'activity' && record.detail) {
      return truncateSummary(record.detail)
    }
  }
  return null
}

export function extractAgentSupervisorPrReference(text: string | null): {
  label: string | null
  url: string | null
} {
  if (!text) return { label: null, url: null }
  const urlMatch = text.match(PR_URL_PATTERN)
  if (urlMatch?.[1]) {
    return { label: `PR #${urlMatch[1]}`, url: urlMatch[0] }
  }
  const numberMatch = text.match(PR_NUMBER_PATTERN)
  if (numberMatch?.[1]) {
    return { label: `PR #${numberMatch[1]}`, url: null }
  }
  return { label: null, url: null }
}

export async function deriveAgentSupervisorRowSummary(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorRowSummary> {
  const paths = getAgentSupervisorJobPaths(jobId)
  const link = await readAgentSupervisorTranscriptLink(jobId)
  let summary: string | null = null
  let prSource: string | null = null

  if (link && (await agentSupervisorTranscriptExists(link)) && link.transcriptPath) {
    const text = await readTailUtf8(link.transcriptPath)
    prSource = text
    summary = extractTranscriptSummary(parseJsonlTail(text))
  }

  if (!summary) {
    const output =
      await readSupervisorJsonlTolerant<Partial<AgentSupervisorOutputMessage>>(
        paths.output,
      )
    summary = extractOutputSummary(output.records)
    prSource ??= output.records.map(record => extractText(record)).join('\n')
  }

  if (!summary) {
    const events =
      await readSupervisorJsonlTolerant<Partial<AgentSupervisorEventMessage>>(
        paths.events,
      )
    summary = extractEventSummary(events.records)
    prSource ??= events.records.map(record => extractText(record)).join('\n')
  }

  const pr = extractAgentSupervisorPrReference([summary, prSource].filter(Boolean).join('\n'))
  const decoratedSummary =
    summary && pr.label && !summary.includes(pr.label)
      ? `${pr.label} · ${summary}`
      : summary
  return {
    summary: decoratedSummary,
    prLabel: pr.label,
    prUrl: pr.url,
  }
}

export async function refreshAgentSupervisorRowSummary(
  rawJobId: string,
  options: { force?: boolean } = {},
): Promise<AgentSupervisorRowSummary> {
  const jobId = AgentSupervisorJobIdSchema.parse(rawJobId)
  const cacheKey = jobId
  const cachedAt = summaryRefreshCache.get(cacheKey) ?? 0
  if (!options.force && Date.now() - cachedAt < SUMMARY_REFRESH_INTERVAL_MS) {
    const state = await readAgentSupervisorJobState(jobId)
    const pr = extractAgentSupervisorPrReference(state?.summary ?? null)
    return { summary: state?.summary ?? null, prLabel: pr.label, prUrl: pr.url }
  }

  const rowSummary = await deriveAgentSupervisorRowSummary(jobId)
  summaryRefreshCache.set(cacheKey, Date.now())
  if (!rowSummary.summary) return rowSummary
  const next = await updateAgentSupervisorJobState(jobId, current => {
    if (!current) throw new Error(`Agent supervisor job not found: ${jobId}`)
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      summary: rowSummary.summary,
    }
  })
  await upsertAgentSupervisorRosterJob(next)
  return rowSummary
}

export async function readAgentSupervisorRosterWithSummaries(): Promise<AgentSupervisorRoster> {
  await reconcileAgentSupervisorStaleProcesses().catch(() => undefined)
  const roster = await readAgentSupervisorRoster()
  for (const job of roster.jobs) {
    await refreshAgentSupervisorRowSummary(job.id).catch(() => undefined)
  }
  return await readAgentSupervisorRoster()
}
