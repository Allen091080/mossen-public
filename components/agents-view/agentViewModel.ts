import { resolve } from 'path'
import type {
  AgentSupervisorResultArtifact,
  AgentSupervisorRoster,
  AgentSupervisorRosterJob,
  AgentSupervisorStatus,
  AgentSupervisorWorktree,
} from '../../services/agentSupervisor/schema.js'
import { readAgentSupervisorWorktreeMetadata } from '../../services/agentSupervisor/worktreeIsolation.js'
import { getDisplayAppVersion } from '../../utils/version.js'

export type AgentViewStage =
  | 'needs_input'
  | 'working'
  | 'ready_for_review'
  | 'completed'
  | 'stopped_failed'

export type AgentViewMachineState =
  | 'just_dispatched'
  | 'queued'
  | 'working'
  | 'needs_input'
  | 'ready_for_review'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stale'

export type AgentViewActionKind =
  | 'attach'
  | 'inspect'
  | 'peek'
  | 'reply'
  | 'review'
  | 'respawn'

export type AgentViewAction = {
  kind: AgentViewActionKind
  label: string
  shortcut: string
}

export type AgentViewDispatchDefaults = {
  model?: string | null
  permissionMode?: string | null
  effort?: string | null
  agent?: string | null
  settings?: string | null
  addDirs?: string[]
  mcpConfig?: string[]
  pluginDirs?: string[]
  strictMcpConfig?: boolean
  fallbackModel?: string | null
  allowDangerouslySkipPermissions?: boolean
  dangerouslySkipPermissions?: boolean
}

export type AgentViewWorktreeSummary = {
  path: string | null
  branch: string | null
  baseRepo: string | null
  dirty: boolean | null
  cleanupEligible: boolean
  cleanupState: AgentSupervisorWorktree['cleanupState']
  ownedByMossen: boolean
  isolationReason: string | null
}

export type AgentViewResultSummary = {
  summary: string | null
  artifacts: AgentSupervisorResultArtifact[]
  artifactCount: number
  riskCount: number
  nextActionCount: number
}

export type AgentViewTokenUsageSummary = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type AgentViewErrorSummary = {
  message: string
  count: number
} | null

export type AgentViewRow = {
  id: string
  kind: 'supervisor_agent'
  state: AgentViewMachineState
  statusContext: AgentViewStage
  title: string
  status: AgentSupervisorStatus
  stage: AgentViewStage
  cwd: string
  branch: string | null
  model: string | null
  provider: string | null
  profile: string | null
  permissionMode: string | null
  effort: string | null
  agent: string | null
  processAlive: boolean
  sessionId: string | null
  parentWorkflowId: string | null
  parentGoalId: string | null
  pinned: boolean
  order: number
  promptSummary: string | null
  promptPreview: string | null
  lastActivity: string | null
  createdAt: string | null
  lastHeartbeatAt: string | null
  lastStartedAt: string | null
  lastExitedAt: string | null
  exitCode: number | null
  signal: string | null
  error: AgentViewErrorSummary
  lastQuestion: {
    text: string
    optionCount: number
    suggestedReply: string | null
  } | null
  result: AgentViewResultSummary
  tokenUsage: AgentViewTokenUsageSummary
  worktree: AgentViewWorktreeSummary | null
  primaryAction: AgentViewAction
  secondaryActions: AgentViewAction[]
  updatedAt: string
}

export type AgentViewGroup = {
  stage: AgentViewStage
  label: string
  rows: AgentViewRow[]
}

export type AgentViewCounts = {
  awaitingInput: number
  working: number
  readyForReview: number
  completed: number
  stoppedFailed: number
  total: number
}

export type AgentViewSnapshot = {
  appVersion: string
  generatedAt: string
  cwd: string
  dispatchDefaults: AgentViewDispatchDefaults
  counts: AgentViewCounts
  rows: AgentViewRow[]
  groups: AgentViewGroup[]
}

export type AgentViewJsonRow = {
  id: string
  kind: 'supervisor_agent'
  state: AgentViewMachineState
  statusContext: AgentViewStage
  title: string
  status: AgentSupervisorStatus
  stage: AgentViewStage
  cwd: string
  branch: string | null
  model: string | null
  provider: string | null
  profile: string | null
  permissionMode: string | null
  effort: string | null
  agent: string | null
  processAlive: boolean
  sessionId: string | null
  parentWorkflowId: string | null
  parentGoalId: string | null
  pinned: boolean
  promptSummary: string | null
  question: {
    text: string
    optionCount: number
    suggestedReply: string | null
  } | null
  worktree: {
    path: string | null
    branch: string | null
    dirty: boolean | null
    cleanupEligible: boolean
  } | null
  result: {
    summary: string | null
    artifacts: AgentSupervisorResultArtifact[]
    artifactCount: number
    riskCount: number
    nextActionCount: number
  }
  resultSummary: string | null
  artifacts: AgentSupervisorResultArtifact[]
  error: AgentViewErrorSummary
  exitCode: number | null
  signal: string | null
  tokenUsage: AgentViewTokenUsageSummary
  createdAt: string | null
  updatedAt: string
  lastHeartbeatAt: string | null
  lastStartedAt: string | null
  lastExitedAt: string | null
}

export const AGENT_VIEW_STAGE_ORDER: AgentViewStage[] = [
  'needs_input',
  'working',
  'ready_for_review',
  'completed',
  'stopped_failed',
]

const ACTIONS: Record<AgentViewActionKind, AgentViewAction> = {
  attach: { kind: 'attach', label: 'attach', shortcut: 'Enter/->' },
  inspect: { kind: 'inspect', label: 'inspect', shortcut: 'Space' },
  peek: { kind: 'peek', label: 'peek', shortcut: 'Space' },
  reply: { kind: 'reply', label: 'reply', shortcut: 'r' },
  review: { kind: 'review', label: 'review', shortcut: 'Enter' },
  respawn: { kind: 'respawn', label: 'respawn', shortcut: 'shell' },
}

const PR_REFERENCE_PATTERN =
  /(?:https?:\/\/[^\s)]+\/(?:pull|merge_requests|(?:-|repos\/[^/]+\/[^/]+\/pulls))\/\d+\b|\b(?:PR|pull request|merge request)\s*#?\d+\b)/i

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasResult(job: Pick<
  AgentSupervisorRosterJob,
  'resultArtifactCount' | 'resultNextActionCount' | 'resultRiskCount' | 'resultSummary'
>): boolean {
  return Boolean(
    job.resultSummary ||
      (job.resultArtifactCount ?? 0) > 0 ||
      (job.resultRiskCount ?? 0) > 0 ||
      (job.resultNextActionCount ?? 0) > 0,
  )
}

function hasPrSignal(job: Pick<
  AgentSupervisorRosterJob,
  'lastSummaryLine' | 'promptPreview' | 'resultSummary'
>): boolean {
  return PR_REFERENCE_PATTERN.test(
    [job.lastSummaryLine, job.promptPreview, job.resultSummary]
      .filter(Boolean)
      .join('\n'),
  )
}

export function getAgentViewStage(job: AgentSupervisorRosterJob): AgentViewStage {
  if (job.status === 'needs_input' || job.lastQuestionText) return 'needs_input'
  if (job.status === 'working' || job.status === 'queued') return 'working'
  if (job.status === 'idle') {
    return hasResult(job) || hasPrSignal(job) ? 'ready_for_review' : 'working'
  }
  if (job.status === 'completed') {
    return hasResult(job) || hasPrSignal(job) ? 'ready_for_review' : 'completed'
  }
  return 'stopped_failed'
}

export function getAgentViewMachineState(
  job: AgentSupervisorRosterJob,
): AgentViewMachineState {
  const stage = getAgentViewStage(job)
  if (stage === 'needs_input') return 'needs_input'
  if (stage === 'ready_for_review') return 'ready_for_review'
  if (job.status === 'queued') return 'queued'
  if (job.status === 'working') return job.processAlive === false ? 'stale' : 'working'
  if (job.status === 'idle') return job.processAlive === false ? 'stale' : 'working'
  if (job.status === 'completed') return 'completed'
  if (job.status === 'failed') return 'failed'
  if (job.status === 'stopped') return 'stopped'
  return 'working'
}

function getPrimaryAction(stage: AgentViewStage): AgentViewAction {
  switch (stage) {
    case 'needs_input':
      return ACTIONS.reply
    case 'working':
      return ACTIONS.attach
    case 'ready_for_review':
      return ACTIONS.review
    case 'completed':
      return ACTIONS.inspect
    case 'stopped_failed':
      return ACTIONS.inspect
  }
}

function getSecondaryActions(stage: AgentViewStage): AgentViewAction[] {
  switch (stage) {
    case 'needs_input':
      return [ACTIONS.attach, ACTIONS.peek]
    case 'working':
      return [ACTIONS.peek]
    case 'ready_for_review':
      return [ACTIONS.peek, ACTIONS.attach]
    case 'completed':
      return []
    case 'stopped_failed':
      return [ACTIONS.respawn]
  }
}

export function getAgentViewStageLabel(stage: AgentViewStage): string {
  switch (stage) {
    case 'needs_input':
      return 'Needs input'
    case 'working':
      return 'Working'
    case 'ready_for_review':
      return 'Ready for review'
    case 'completed':
      return 'Completed'
    case 'stopped_failed':
      return 'Stopped/failed'
  }
}

function summarizeWorktree(
  metadata: AgentSupervisorWorktree | null,
): AgentViewWorktreeSummary | null {
  if (!metadata) return null
  return {
    path: metadata.path,
    branch: metadata.baseBranch,
    baseRepo: metadata.baseRepo,
    dirty: metadata.dirty,
    cleanupEligible: metadata.cleanupEligible,
    cleanupState: metadata.cleanupState,
    ownedByMossen: metadata.ownedByMossen,
    isolationReason: metadata.isolationReason,
  }
}

function rowMatchesCwd(row: AgentViewRow, cwd: string): boolean {
  const root = resolve(cwd)
  const candidates = [
    row.cwd,
    row.worktree?.path ?? null,
    row.worktree?.baseRepo ?? null,
  ].filter((item): item is string => Boolean(item))

  return candidates.some(candidate => {
    const resolved = resolve(candidate)
    return resolved === root || resolved.startsWith(`${root}/`)
  })
}

function jobToRow(
  job: AgentSupervisorRosterJob,
  worktree: AgentSupervisorWorktree | null,
): AgentViewRow {
  const stage = getAgentViewStage(job)
  const summarizedWorktree = summarizeWorktree(worktree)
  return {
    id: job.id,
    kind: 'supervisor_agent',
    state: getAgentViewMachineState(job),
    statusContext: stage,
    title: job.title,
    status: job.status,
    stage,
    cwd: job.cwd,
    branch: summarizedWorktree?.branch ?? null,
    model: job.model ?? null,
    // Provider/profile are reserved protocol fields. The current supervisor
    // stores resolved model text but not the originating model profile yet.
    provider: null,
    profile: null,
    permissionMode: job.permissionMode ?? null,
    effort: job.effort ?? null,
    agent: job.agent,
    processAlive: job.processAlive ?? false,
    sessionId: job.sessionId ?? null,
    parentWorkflowId: job.parentWorkflowId ?? null,
    parentGoalId: job.parentGoalId ?? null,
    pinned: job.pinned,
    order: job.order,
    promptSummary: job.promptPreview ?? job.title,
    promptPreview: job.promptPreview ?? null,
    lastActivity: job.lastSummaryLine,
    createdAt: job.createdAt ?? null,
    lastHeartbeatAt: null,
    lastStartedAt: job.lastStartedAt ?? null,
    lastExitedAt: job.lastExitedAt ?? null,
    exitCode: job.exitCode ?? null,
    signal: job.signal ?? null,
    error: job.lastErrorMessage
      ? {
          message: job.lastErrorMessage,
          count: job.errorCount ?? 1,
        }
      : null,
    lastQuestion: job.lastQuestionText
      ? {
          text: job.lastQuestionText,
          optionCount: job.lastQuestionOptionCount ?? 0,
          suggestedReply: job.lastQuestionSuggestedReply ?? null,
        }
      : null,
    result: {
      summary: job.resultSummary ?? null,
      artifacts: job.resultArtifacts ?? [],
      artifactCount: job.resultArtifactCount ?? 0,
      riskCount: job.resultRiskCount ?? 0,
      nextActionCount: job.resultNextActionCount ?? 0,
    },
    tokenUsage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    },
    worktree: summarizedWorktree,
    primaryAction: getPrimaryAction(stage),
    secondaryActions: getSecondaryActions(stage),
    updatedAt: job.lastUpdatedAt,
  }
}

function sortRows(rows: AgentViewRow[]): AgentViewRow[] {
  return rows.slice().sort((a, b) => {
    const stageDelta =
      AGENT_VIEW_STAGE_ORDER.indexOf(a.stage) -
      AGENT_VIEW_STAGE_ORDER.indexOf(b.stage)
    if (stageDelta !== 0) return stageDelta
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return timestamp(b.updatedAt) - timestamp(a.updatedAt)
  })
}

function countRows(rows: AgentViewRow[]): AgentViewCounts {
  const counts: AgentViewCounts = {
    awaitingInput: 0,
    working: 0,
    readyForReview: 0,
    completed: 0,
    stoppedFailed: 0,
    total: rows.length,
  }
  for (const row of rows) {
    if (row.stage === 'needs_input') counts.awaitingInput += 1
    else if (row.stage === 'working') counts.working += 1
    else if (row.stage === 'ready_for_review') counts.readyForReview += 1
    else if (row.stage === 'completed') counts.completed += 1
    else if (row.stage === 'stopped_failed') counts.stoppedFailed += 1
  }
  return counts
}

function groupRows(rows: AgentViewRow[]): AgentViewGroup[] {
  return AGENT_VIEW_STAGE_ORDER.flatMap(stage => {
    const stageRows = rows.filter(row => row.stage === stage)
    return stageRows.length > 0
      ? [{ stage, label: getAgentViewStageLabel(stage), rows: stageRows }]
      : []
  })
}

export async function buildAgentViewSnapshot(
  roster: AgentSupervisorRoster,
  options: {
    cwd: string
    dispatchDefaults?: AgentViewDispatchDefaults
    generatedAt?: string
    includeAllCwds?: boolean
  },
): Promise<AgentViewSnapshot> {
  const rowsWithWorktrees = await Promise.all(
    roster.jobs.map(async job =>
      jobToRow(
        job,
        await readAgentSupervisorWorktreeMetadata(job.id).catch(() => null),
      ),
    ),
  )
  const filteredRows = options.includeAllCwds
    ? rowsWithWorktrees
    : rowsWithWorktrees.filter(row => rowMatchesCwd(row, options.cwd))
  const rows = sortRows(filteredRows)
  return {
    appVersion: getDisplayAppVersion(),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    cwd: resolve(options.cwd),
    dispatchDefaults: options.dispatchDefaults ?? {},
    counts: countRows(rows),
    rows,
    groups: groupRows(rows),
  }
}

export function formatAgentViewCounts(counts: AgentViewCounts): string {
  return [
    `${counts.awaitingInput} awaiting input`,
    `${counts.working} working`,
    `${counts.readyForReview + counts.completed} completed`,
  ].join(' · ')
}

export function agentViewRowsToJson(rows: AgentViewRow[]): AgentViewJsonRow[] {
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    state: row.state,
    statusContext: row.statusContext,
    title: row.title,
    status: row.status,
    stage: row.stage,
    cwd: row.cwd,
    branch: row.branch,
    model: row.model,
    provider: row.provider,
    profile: row.profile,
    permissionMode: row.permissionMode,
    effort: row.effort,
    agent: row.agent,
    processAlive: row.processAlive,
    sessionId: row.sessionId,
    parentWorkflowId: row.parentWorkflowId,
    parentGoalId: row.parentGoalId,
    pinned: row.pinned,
    promptSummary: row.promptSummary,
    question: row.lastQuestion
      ? {
          text: row.lastQuestion.text,
          optionCount: row.lastQuestion.optionCount,
          suggestedReply: row.lastQuestion.suggestedReply,
        }
      : null,
    worktree: row.worktree
      ? {
          path: row.worktree.path,
          branch: row.worktree.branch,
          dirty: row.worktree.dirty,
          cleanupEligible: row.worktree.cleanupEligible,
        }
      : null,
    result: {
      summary: row.result.summary,
      artifacts: row.result.artifacts,
      artifactCount: row.result.artifactCount,
      riskCount: row.result.riskCount,
      nextActionCount: row.result.nextActionCount,
    },
    resultSummary: row.result.summary,
    artifacts: row.result.artifacts,
    error: row.error,
    exitCode: row.exitCode,
    signal: row.signal,
    tokenUsage: row.tokenUsage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastStartedAt: row.lastStartedAt,
    lastExitedAt: row.lastExitedAt,
  }))
}
