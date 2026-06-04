import { execFile } from 'child_process'
import { promisify } from 'util'
import { whichSync } from '../../utils/which.js'

const execFileAsync = promisify(execFile)
const PR_STATUS_CACHE_MS = 15_000
const PR_STATUS_DISABLED_VALUE = '0'

const PR_URL_PATTERN =
  /https?:\/\/[^\s)]+\/(?:pull|merge_requests|(?:-|repos\/[^/]+\/[^/]+\/pulls))\/(\d+)\b/i
const PR_NUMBER_PATTERN = /\b(?:PR|pull request|merge request)\s*#?(\d+)\b/i

export type AgentSupervisorPrStatusState =
  | 'checks_running'
  | 'checks_passed'
  | 'merged'
  | 'unknown'

export type AgentSupervisorPrStatus = {
  label: string
  url: string | null
  state: AgentSupervisorPrStatusState
}

type PrStatusInput = {
  id: string
  label: string
  lastSummaryLine: string | null
}

type CacheEntry = {
  expiresAt: number
  status: AgentSupervisorPrStatus
}

const statusCache = new Map<string, CacheEntry>()

function isPrStatusEnabled(): boolean {
  return process.env.MOSSEN_AGENT_VIEW_PR_STATUS !== PR_STATUS_DISABLED_VALUE
}

function extractPrReference(input: PrStatusInput): AgentSupervisorPrStatus | null {
  const text = [input.label, input.lastSummaryLine ?? ''].join('\n')
  const urlMatch = text.match(PR_URL_PATTERN)
  if (urlMatch?.[1]) {
    return { label: `PR #${urlMatch[1]}`, url: urlMatch[0], state: 'unknown' }
  }
  const numberMatch = text.match(PR_NUMBER_PATTERN)
  if (numberMatch?.[1]) {
    return { label: `PR #${numberMatch[1]}`, url: null, state: 'unknown' }
  }
  return null
}

function checkRollupState(value: unknown): AgentSupervisorPrStatusState {
  if (!Array.isArray(value) || value.length === 0) return 'unknown'
  let sawCompleted = false
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const status = String(record.status ?? record.state ?? '').toUpperCase()
    const conclusion = String(record.conclusion ?? '').toUpperCase()
    if (['IN_PROGRESS', 'QUEUED', 'PENDING', 'REQUESTED', 'WAITING'].includes(status)) {
      return 'checks_running'
    }
    if (['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion) || status === 'COMPLETED') {
      sawCompleted = true
      continue
    }
    return 'unknown'
  }
  return sawCompleted ? 'checks_passed' : 'unknown'
}

function classifyGhPrView(raw: string): AgentSupervisorPrStatusState {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const state = String(parsed.state ?? '').toUpperCase()
  if (state === 'MERGED') return 'merged'
  return checkRollupState(parsed.statusCheckRollup)
}

async function queryGhPrStatus(reference: AgentSupervisorPrStatus): Promise<AgentSupervisorPrStatus> {
  if (!reference.url || !whichSync('gh')) return reference
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', reference.url, '--json', 'state,mergeStateStatus,statusCheckRollup,isDraft'],
      { timeout: 5_000, maxBuffer: 256 * 1024 },
    )
    return { ...reference, state: classifyGhPrView(stdout) }
  } catch {
    return reference
  }
}

export async function resolveAgentSupervisorPrStatus(
  input: PrStatusInput,
): Promise<AgentSupervisorPrStatus | null> {
  if (!isPrStatusEnabled()) return null
  const reference = extractPrReference(input)
  if (!reference) return null
  const cacheKey = reference.url ?? `${input.id}:${reference.label}`
  const cached = statusCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.status
  const status = await queryGhPrStatus(reference)
  statusCache.set(cacheKey, { expiresAt: now + PR_STATUS_CACHE_MS, status })
  return status
}

export async function resolveAgentSupervisorPrStatuses(
  inputs: PrStatusInput[],
): Promise<Record<string, AgentSupervisorPrStatus>> {
  const entries = await Promise.all(
    inputs.map(async input => {
      const status = await resolveAgentSupervisorPrStatus(input)
      return status ? ([input.id, status] as const) : null
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is [string, AgentSupervisorPrStatus] => Boolean(entry)))
}
