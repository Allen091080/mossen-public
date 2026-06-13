import { existsSync } from 'fs'
import type {
  AgentSupervisorRoster,
  AgentSupervisorRosterJob,
  AgentSupervisorStatus,
} from '../../services/agentSupervisor/schema.js'

export type SupervisorAgentViewItem = {
  id: string
  type: 'supervisor_agent'
  label: string
  status: AgentSupervisorStatus
  cwd: string
  updatedAt: number
  lastSummaryLine: string | null
  promptPreview: string | null
  model: string | null
  permissionMode: string | null
  effort: string | null
  lastQuestionText: string | null
  lastQuestionOptionCount: number
  lastQuestionSuggestedReply: string | null
  resultSummary: string | null
  resultArtifactCount: number
  resultRiskCount: number
  resultNextActionCount: number
  pinned: boolean
  order: number
  agent: string | null
  parentWorkflowId: string | null
  parentGoalId: string | null
  processAlive: boolean
  directoryName: string
  cwdAvailable: boolean
  primaryAction: SupervisorAgentViewAction
  secondaryAction: SupervisorAgentViewAction | null
  statusContext: SupervisorAgentStatusContext
  resultBadge: string | null
  worktreeLabel: string | null
}

export type SupervisorAgentViewActionKind =
  | 'attach'
  | 'inspect'
  | 'peek'
  | 'reply'
  | 'review'

export type SupervisorAgentViewAction = {
  kind: SupervisorAgentViewActionKind
  label: string
  shortcut: string
}

export type SupervisorAgentStatusContext =
  | 'blocked_question'
  | 'ready_result'
  | 'running'
  | 'terminal'

export type SupervisorAgentViewGroup = {
  key: string
  label: string
  stage: SupervisorAgentGroupStage
  dateBucket: SupervisorAgentDateBucket
  status: AgentSupervisorStatus
  directoryName: string
  items: SupervisorAgentViewItem[]
}

export type SupervisorAgentGroupStage =
  | 'needs_input'
  | 'ready_for_review'
  | 'working'
  | 'completed'
  | 'stopped_failed'

export type SupervisorAgentDateBucket =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'older'
  | 'unknown'

const STATUS_RANK: Record<AgentSupervisorStatus, number> = {
  needs_input: 0,
  working: 1,
  queued: 2,
  idle: 3,
  failed: 4,
  stopped: 5,
  completed: 6,
}

export function getSupervisorAgentGroupStage(
  status: AgentSupervisorStatus,
): SupervisorAgentGroupStage {
  if (status === 'needs_input') return 'needs_input'
  if (status === 'idle') return 'ready_for_review'
  if (status === 'working' || status === 'queued') return 'working'
  if (status === 'completed') return 'completed'
  return 'stopped_failed'
}

const PR_REFERENCE_PATTERN =
  /(?:https?:\/\/[^\s)]+\/(?:pull|merge_requests|(?:-|repos\/[^/]+\/[^/]+\/pulls))\/(\d+)\b|\b(?:PR|pull request|merge request)\s*#?(\d+)\b)/i

const ACTIONS: Record<SupervisorAgentViewActionKind, SupervisorAgentViewAction> = {
  attach: { kind: 'attach', label: 'attach terminal', shortcut: 'Enter/→' },
  inspect: { kind: 'inspect', label: 'inspect', shortcut: 'Space' },
  peek: { kind: 'peek', label: 'preview card', shortcut: 'Space' },
  reply: { kind: 'reply', label: 'reply', shortcut: 'r' },
  review: { kind: 'review', label: 'review', shortcut: 'Space' },
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function startOfLocalDay(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function getSupervisorAgentDateBucket(
  updatedAt: number,
  now = Date.now(),
): SupervisorAgentDateBucket {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 'unknown'
  const today = startOfLocalDay(now)
  const yesterday = today - 24 * 60 * 60 * 1000
  const week = today - 6 * 24 * 60 * 60 * 1000
  if (updatedAt >= today) return 'today'
  if (updatedAt >= yesterday) return 'yesterday'
  if (updatedAt >= week) return 'this_week'
  return 'older'
}

function rosterJobToItem(job: AgentSupervisorRosterJob): SupervisorAgentViewItem {
  const cwdAvailable = existsSync(job.cwd)
  const parts = job.cwd.split('/').filter(Boolean)
  const directoryName = parts.at(-1) ?? job.cwd
  const actionModel = getSupervisorAgentActionModel(job)
  const resultBadge = getSupervisorAgentResultBadge(job)
  const worktreeLabel = getSupervisorAgentWorktreeLabel(job)
  return {
    id: job.id,
    type: 'supervisor_agent',
    label: job.title,
    status: job.status,
    cwd: job.cwd,
    updatedAt: timestamp(job.lastUpdatedAt),
    lastSummaryLine: job.lastSummaryLine,
    promptPreview: job.promptPreview ?? null,
    model: job.model ?? null,
    permissionMode: job.permissionMode ?? null,
    effort: job.effort ?? null,
    lastQuestionText: job.lastQuestionText ?? null,
    lastQuestionOptionCount: job.lastQuestionOptionCount ?? 0,
    lastQuestionSuggestedReply: job.lastQuestionSuggestedReply ?? null,
    resultSummary: job.resultSummary ?? null,
    resultArtifactCount: job.resultArtifactCount ?? 0,
    resultRiskCount: job.resultRiskCount ?? 0,
    resultNextActionCount: job.resultNextActionCount ?? 0,
    pinned: job.pinned,
    order: job.order,
    agent: job.agent,
    parentWorkflowId: job.parentWorkflowId ?? null,
    parentGoalId: job.parentGoalId ?? null,
    processAlive: job.processAlive ?? false,
    directoryName: cwdAvailable ? directoryName : `${directoryName} (missing)`,
    cwdAvailable,
    primaryAction: actionModel.primaryAction,
    secondaryAction: actionModel.secondaryAction,
    statusContext: actionModel.statusContext,
    resultBadge,
    worktreeLabel,
  }
}

export function getSupervisorAgentWorktreeLabel(
  job: Pick<AgentSupervisorRosterJob, 'cwd'>,
): string | null {
  const normalized = job.cwd.replace(/\\/g, '/')
  return /\/worktrees\/[a-z0-9][a-z0-9_-]{2,63}$/.test(normalized)
    ? 'worktree'
    : null
}

export function getSupervisorAgentActionModel(
  job: Pick<
    AgentSupervisorRosterJob,
    | 'lastQuestionText'
    | 'resultArtifactCount'
    | 'resultNextActionCount'
    | 'resultRiskCount'
    | 'resultSummary'
    | 'status'
  >,
): {
  primaryAction: SupervisorAgentViewAction
  secondaryAction: SupervisorAgentViewAction | null
  statusContext: SupervisorAgentStatusContext
} {
  if (job.status === 'needs_input' || job.lastQuestionText) {
    return {
      primaryAction: ACTIONS.reply,
      secondaryAction: ACTIONS.attach,
      statusContext: 'blocked_question',
    }
  }
  if (job.status === 'working' || job.status === 'queued') {
    return {
      primaryAction: ACTIONS.attach,
      secondaryAction: ACTIONS.peek,
      statusContext: 'running',
    }
  }
  const hasResult = Boolean(
    job.resultSummary ||
      (job.resultArtifactCount ?? 0) > 0 ||
      (job.resultRiskCount ?? 0) > 0 ||
      (job.resultNextActionCount ?? 0) > 0,
  )
  if (job.status === 'idle') {
    return {
      primaryAction: hasResult ? ACTIONS.review : ACTIONS.peek,
      secondaryAction: ACTIONS.attach,
      statusContext: hasResult ? 'ready_result' : 'running',
    }
  }
  if (job.status === 'completed') {
    return {
      primaryAction: hasResult ? ACTIONS.review : ACTIONS.inspect,
      secondaryAction: null,
      statusContext: hasResult ? 'ready_result' : 'terminal',
    }
  }
  return {
    primaryAction: ACTIONS.inspect,
    secondaryAction: null,
    statusContext: 'terminal',
  }
}

export function getSupervisorAgentResultBadge(
  job: Pick<
    AgentSupervisorRosterJob,
    'resultArtifactCount' | 'resultNextActionCount' | 'resultRiskCount' | 'resultSummary'
  >,
): string | null {
  const parts: string[] = []
  if (job.resultSummary) parts.push('result')
  if ((job.resultArtifactCount ?? 0) > 0) {
    parts.push(`${job.resultArtifactCount} artifact${job.resultArtifactCount === 1 ? '' : 's'}`)
  }
  if ((job.resultRiskCount ?? 0) > 0) {
    parts.push(`${job.resultRiskCount} risk${job.resultRiskCount === 1 ? '' : 's'}`)
  }
  if ((job.resultNextActionCount ?? 0) > 0) {
    parts.push(`${job.resultNextActionCount} next`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export function deriveSupervisorAgentViewItems(
  roster: AgentSupervisorRoster,
): SupervisorAgentViewItem[] {
  return roster.jobs.map(rosterJobToItem).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    const statusDelta = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (statusDelta !== 0) return statusDelta
    return b.updatedAt - a.updatedAt
  })
}

function parseSupervisorFilter(query: string): {
  text: string[]
  agent: string | null
  state: string | null
  cwd: string | null
  number: string | null
  pr: string | null
} {
  // Agent View supports structured filters such as agent:<name>,
  // status:<state>, cwd:<path>, #<number>, and PR URLs. Keep parsing in the view model so
  // shell and TUI tests can validate behavior without transcript access.
  const result = {
    text: [] as string[],
    agent: null as string | null,
    state: null as string | null,
    cwd: null as string | null,
    number: null as string | null,
    pr: null as string | null,
  }
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const normalizedToken = token.toLowerCase()
    if (normalizedToken.startsWith('a:')) {
      result.agent = token.slice(2).toLowerCase()
    } else if (normalizedToken.startsWith('agent:')) {
      result.agent = token.slice('agent:'.length).toLowerCase()
    } else if (normalizedToken.startsWith('s:')) {
      result.state = token.slice(2).toLowerCase()
    } else if (normalizedToken.startsWith('status:')) {
      result.state = token.slice('status:'.length).toLowerCase()
    } else if (normalizedToken.startsWith('cwd:')) {
      result.cwd = token.slice('cwd:'.length).toLowerCase()
    } else if (normalizedToken.startsWith('dir:')) {
      result.cwd = token.slice('dir:'.length).toLowerCase()
    } else if (normalizedToken.startsWith('d:')) {
      result.cwd = token.slice(2).toLowerCase()
    } else if (/^#\d+$/.test(token)) {
      result.number = token.slice(1)
    } else if (/\/pull\/\d+|\/merge_requests\/\d+|\/-\/merge_requests\/\d+/i.test(token)) {
      result.pr = token.toLowerCase()
    } else {
      result.text.push(token.toLowerCase())
    }
  }
  return result
}

function stateMatchesFilter(status: AgentSupervisorStatus, filter: string): boolean {
  if (filter === 'blocked') {
    return status === 'needs_input' || status === 'failed' || status === 'stopped'
  }
  return status === filter
}

export function filterSupervisorAgentViewItems(
  items: SupervisorAgentViewItem[],
  query: string,
): SupervisorAgentViewItem[] {
  const filters = parseSupervisorFilter(query)
  if (
    !filters.agent &&
    !filters.state &&
    !filters.cwd &&
    !filters.number &&
    !filters.pr &&
    filters.text.length === 0
  ) {
    return items
  }
  return items.filter((item, index) => {
    if (filters.agent && !(item.agent ?? '').toLowerCase().includes(filters.agent)) {
      return false
    }
    if (filters.state && !stateMatchesFilter(item.status, filters.state)) {
      return false
    }
    if (filters.cwd) {
      const cwdHaystack = [item.cwd, item.directoryName].join('\n').toLowerCase()
      if (!cwdHaystack.includes(filters.cwd)) return false
    }
    if (filters.number && String(index + 1) !== filters.number) {
      const haystack = [item.label, item.lastSummaryLine ?? ''].join('\n')
      if (
        !haystack.includes(`#${filters.number}`) &&
        !haystack.includes(`/pull/${filters.number}`) &&
        !haystack.includes(`/merge_requests/${filters.number}`)
      ) {
        return false
      }
    }
    const fields = [
      item.id,
      item.label,
      item.status,
      item.cwd,
      item.directoryName,
      item.agent ?? '',
      item.parentWorkflowId ?? '',
      item.parentGoalId ?? '',
      item.lastSummaryLine ?? '',
      item.promptPreview ?? '',
      item.model ?? '',
      item.permissionMode ?? '',
      item.effort ?? '',
      item.lastQuestionText ?? '',
      item.lastQuestionSuggestedReply ?? '',
      item.resultSummary ?? '',
      item.resultBadge ?? '',
      item.worktreeLabel ?? '',
      item.primaryAction.label,
      item.primaryAction.shortcut,
      item.secondaryAction?.label ?? '',
    ]
      .join('\n')
      .toLowerCase()
    if (filters.pr && !fields.includes(filters.pr)) return false
    return filters.text.every(token => fields.includes(token))
  })
}

export function groupSupervisorAgentViewItems(
  items: SupervisorAgentViewItem[],
  now = Date.now(),
): SupervisorAgentViewGroup[] {
  const groups = new Map<string, SupervisorAgentViewGroup>()
  for (const item of items) {
    const dateBucket = getSupervisorAgentDateBucket(item.updatedAt, now)
    const stage = getSupervisorAgentGroupStage(item.status)
    const key = `${stage}:${dateBucket}:${item.cwd}`
    const label = `${stage} · ${item.directoryName}`
    const group = groups.get(key)
    if (group) {
      group.items.push(item)
    } else {
      groups.set(key, {
        key,
        label,
        stage,
        dateBucket,
        status: item.status,
        directoryName: item.directoryName,
        items: [item],
      })
    }
  }
  return [...groups.values()]
}

export function getSupervisorAgentPrStatus(
  item: SupervisorAgentViewItem,
): string | null {
  const match = [item.label, item.lastSummaryLine ?? ''].join('\n').match(PR_REFERENCE_PATTERN)
  const number = match?.[1] ?? match?.[2]
  return number ? `PR #${number}` : null
}
