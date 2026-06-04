import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  projectIdFromCwd,
  recallForMossen,
  type RecallItem,
} from '../../memory-sidecar/src/index.js'
import type { Message } from '../../types/message.js'
import { getUserMessageText } from '../../utils/messages.js'

const PREFETCH_LIMIT = 3
const PREFETCH_MAX_TOKENS = 500
const PREFETCH_MIN_SCORE = 1
const PREFETCH_MAX_QUERY_CHARS = 600
const PREFETCH_MAX_SUMMARY_CHARS = 260
const PREFETCH_LOW_SIGNAL_TERMS = new Set([
  'how',
  'what',
  'why',
  '怎么',
  '怎么做',
  '怎么验证',
  '如何',
  '如何做',
  '如何验证',
  '是什么',
])

export type MemorySidecarPrefetchOptions = {
  cwd: string
  messages: Message[]
  limit?: number
  maxTokens?: number
  minScore?: number
}

export async function buildMemorySidecarPrefetchReminder({
  cwd,
  messages,
  limit = PREFETCH_LIMIT,
  maxTokens = PREFETCH_MAX_TOKENS,
  minScore = PREFETCH_MIN_SCORE,
}: MemorySidecarPrefetchOptions): Promise<string | null> {
  const query = prefetchQueryFromMessages(messages)
  if (!query) return null

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch {
    return null
  }
  if (!config.enabled) return null

  const effectiveLimit = Math.max(
    1,
    Math.min(limit, config.retrieval.maxResults, PREFETCH_LIMIT),
  )
  const effectiveMaxTokens = Math.max(
    100,
    Math.min(maxTokens, config.retrieval.maxTokens, PREFETCH_MAX_TOKENS),
  )
  let result
  try {
    result = await recallForMossen({
      rootDir: config.homeDir,
      projectId: projectIdFromCwd(cwd),
      query,
      limit: effectiveLimit,
      maxTokens: effectiveMaxTokens,
    })
  } catch {
    return null
  }

  const items = result.items
    .filter(item => item.score >= minScore)
    .slice(0, effectiveLimit)
  if (items.length === 0) return null

  return formatPrefetchReminder(items)
}

export function prefetchQueryFromMessages(messages: Message[]): string {
  const collapsed = messages
    .filter(message => message.type === 'user' && !message.isMeta)
    .map(message => getUserMessageText(message))
    .filter((text): text is string => text !== null && text.trim().length > 0)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''

  const terms = collapsed.split(/\s+/)
  const filteredTerms = terms.filter(term =>
    !PREFETCH_LOW_SIGNAL_TERMS.has(term.toLowerCase()),
  )
  const query = filteredTerms.length > 0 ? filteredTerms.join(' ') : collapsed
  return query.slice(0, PREFETCH_MAX_QUERY_CHARS)
}

function formatPrefetchReminder(items: RecallItem[]): string {
  const lines = items.map(item => {
    const title = compact(item.title, 120)
    const summary = compact(item.summary, PREFETCH_MAX_SUMMARY_CHARS)
    const evidence = item.evidenceIds.length > 0
      ? ` evidence=${item.evidenceIds.join(',')}`
      : ''
    return `- ${item.source}:${item.id} score=${item.score}${evidence}\n  ${title}${summary ? ` - ${summary}` : ''}`
  })

  return [
    '<system-reminder>',
    'Relevant prior sidecar memory for this turn. Use it only when it directly helps; prefer current files and visible conversation if they conflict.',
    ...lines,
    '</system-reminder>',
  ].join('\n')
}

function compact(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}
