import {
  getSessionGoalActualTokenUsage,
  getSessionGoalHistory,
  type MossenGoalState,
} from '../../bootstrap/state.js'
import { formatTokens } from '../../utils/format.js'
import { t } from '../../utils/i18n/index.js'
import {
  buildLoopLivenessReport,
  type LoopLivenessReport,
  type LoopVerdict,
  type LoopWorkIssue,
  type LoopWorkItem,
  type LoopWorkStatus,
} from '../../utils/loopLiveness.js'
import {
  buildLoopProcessDiagnosticsReport,
  LOOP_PROCESS_PS_COMMAND,
  type LoopProcessDiagnosticsReport,
  type LoopProcessIssue,
} from '../../utils/loopProcessDiagnostics.js'
import {
  evaluateSessionGoalWorkflowPolicy,
  type SessionGoalWorkflowPolicyVerdict,
} from '../../utils/sessionGoalWorkflowPolicy.js'
import {
  formatSessionGoalStateReason,
  getSessionGoalStateReasonKind,
} from '../../utils/sessionGoalOutput.js'
import { truncateToGraphemeCount } from '../../utils/truncate.js'
import {
  buildLoopBoard,
  renderLoopBoard,
  renderLoopBoardJson,
} from '../loop/loopBoard.js'

const MAX_STATUS_GOAL_GRAPHEMES = 280
const MAX_STATUS_HISTORY_LINES = 3
const MAX_LOOP_WORK_LINES = 4
const MAX_LOOP_PROCESS_LINES = 6

function formatElapsed(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return 'unknown'
  const seconds = Math.max(0, Math.floor((now - created) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function statusLabel(status: MossenGoalState['status']): string {
  switch (status) {
    case 'active':
      return t('cmd.goal.status.value.active')
    case 'cleared':
      return t('cmd.goal.status.value.cleared')
    case 'completed':
      return t('cmd.goal.status.value.completed')
    case 'paused':
      return t('cmd.goal.status.value.paused')
    case 'blocked':
      return t('cmd.goal.status.value.blocked')
    case 'budget_limited':
      return t('cmd.goal.status.value.budgetLimited')
    case 'failed':
      return t('cmd.goal.status.value.failed')
  }
}

function goalOutcomeLabel(goal: MossenGoalState): string {
  switch (getSessionGoalStateReasonKind(goal)) {
    case 'continue':
      return t('cmd.goal.explain.outcome.continue')
    case 'launch_workflow':
      return t('cmd.goal.explain.outcome.launchWorkflow')
    case 'completed':
      return t('cmd.goal.explain.outcome.completed')
    case 'paused':
      return t('cmd.goal.explain.outcome.paused')
    case 'blocked':
      return t('cmd.goal.explain.outcome.blocked')
    case 'max_turns':
      return t('cmd.goal.explain.outcome.maxTurns')
    case 'error':
      return t('cmd.goal.explain.outcome.error')
    case 'cleared':
      return t('cmd.goal.explain.outcome.cleared')
    case 'pending':
      return t('cmd.goal.explain.outcome.pending')
    case 'deferred':
      return t('cmd.goal.explain.outcome.deferred')
    case 'wait_for_workflow':
      return t('cmd.goal.explain.outcome.waitWorkflow')
  }
}

function formatGoalTokenUsage(goal: MossenGoalState): string {
  const actualTokens = getSessionGoalActualTokenUsage(goal)
  if (actualTokens !== null) return formatTokens(actualTokens)
  return goal.tokenEstimate
    ? `~${formatTokens(goal.tokenEstimate)}`
    : t('ui.goalOverlay.tokenPending')
}

export function getGoalTokenUsageValue(goal: MossenGoalState): number {
  return getSessionGoalActualTokenUsage(goal) ?? goal.tokenEstimate ?? 0
}

function loopVerdictLabel(verdict: LoopVerdict): string {
  switch (verdict) {
    case 'idle':
      return t('cmd.goal.loop.verdict.idle')
    case 'wait':
      return t('cmd.goal.loop.verdict.wait')
    case 'stale':
      return t('cmd.goal.loop.verdict.stale')
    case 'failed':
      return t('cmd.goal.loop.verdict.failed')
    case 'verify':
      return t('cmd.goal.loop.verdict.verify')
    case 'complete':
      return t('cmd.goal.loop.verdict.complete')
  }
}

function loopWorkStatusLabel(status: LoopWorkStatus): string {
  switch (status) {
    case 'active':
      return t('cmd.goal.loop.status.active')
    case 'paused':
      return t('cmd.goal.loop.status.paused')
    case 'stale':
      return t('cmd.goal.loop.status.stale')
    case 'completed':
      return t('cmd.goal.loop.status.completed')
    case 'failed':
      return t('cmd.goal.loop.status.failed')
    case 'killed':
      return t('cmd.goal.loop.status.killed')
    case 'unverifiable':
      return t('cmd.goal.loop.status.unverifiable')
  }
}

function loopIssueLabel(issue: LoopWorkIssue): string {
  switch (issue) {
    case 'missing_controller':
      return t('cmd.goal.loop.issue.missingController')
    case 'stale_progress':
      return t('cmd.goal.loop.issue.staleProgress')
    case 'missing_recovery_artifact':
      return t('cmd.goal.loop.issue.missingRecoveryArtifact')
    case 'terminal_failure':
      return t('cmd.goal.loop.issue.terminalFailure')
    case 'terminal_killed':
      return t('cmd.goal.loop.issue.terminalKilled')
    case 'missing_terminal_evidence':
      return t('cmd.goal.loop.issue.missingTerminalEvidence')
  }
}

function loopActionLabel(action: LoopWorkItem['nextAction']): string | null {
  switch (action) {
    case 'wait':
      return t('cmd.goal.loop.action.wait')
    case 'inspect':
      return t('cmd.goal.loop.action.inspect')
    case 'verify':
      return t('cmd.goal.loop.action.verify')
    case 'resume':
      return t('cmd.goal.loop.action.resume')
    case 'review_failure':
      return t('cmd.goal.loop.action.reviewFailure')
    case 'none':
      return null
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function formatLoopWorkLine(item: LoopWorkItem): string {
  const status = loopWorkStatusLabel(item.status)
  const scope = item.attachedToGoal
    ? t('cmd.goal.loop.scope.goal')
    : t('cmd.goal.loop.scope.session')
  const details = [
    item.runId ? `id=${item.runId}` : `task=${item.taskId}`,
    scope,
    item.issue ? loopIssueLabel(item.issue) : null,
    item.ageMs !== undefined
      ? t('cmd.goal.loop.age', { age: formatDuration(item.ageMs) })
      : null,
    loopActionLabel(item.nextAction),
  ].filter((part): part is string => part !== null)
  return t('cmd.goal.loop.item', {
    label: truncateToGraphemeCount(item.label, 80),
    status,
    detail: details.join('; '),
  })
}

function renderLoopLiveness(
  goal: MossenGoalState,
  tasks?: Record<string, unknown>,
): string[] {
  const report: LoopLivenessReport = buildLoopLivenessReport(tasks, {
    goalId: goal.id,
    includeUnattached: true,
  })
  if (report.works.length === 0) {
    return [
      `${t('cmd.goal.loop.title')}: ${loopVerdictLabel(report.verdict)}`,
      t('cmd.goal.loop.none'),
    ]
  }
  const visible = report.works.slice(0, MAX_LOOP_WORK_LINES)
  const hiddenCount = report.works.length - visible.length
  return [
    `${t('cmd.goal.loop.title')}: ${loopVerdictLabel(report.verdict)}`,
    ...visible.map(formatLoopWorkLine),
    hiddenCount > 0
      ? t('cmd.goal.loop.more', { count: hiddenCount })
      : null,
  ].filter((line): line is string => line !== null)
}

function workflowPolicyLabel(
  verdict: SessionGoalWorkflowPolicyVerdict['type'],
): string {
  switch (verdict) {
    case 'launch_workflow':
      return t('cmd.goal.workflowPolicy.launch')
    case 'wait_for_workflow':
      return t('cmd.goal.workflowPolicy.wait')
    case 'continue':
      return t('cmd.goal.workflowPolicy.continue')
  }
}

function renderWorkflowPolicy(
  goal: MossenGoalState,
  tasks?: Record<string, unknown>,
): string[] {
  const policy = evaluateSessionGoalWorkflowPolicy(goal, tasks)
  return [
    `${t('cmd.goal.workflowPolicy.title')}: ${workflowPolicyLabel(policy.type)}`,
    `  - ${truncateToGraphemeCount(policy.reason, 160)}`,
  ]
}

function loopProcessIssueLabel(issue: LoopProcessIssue): string {
  switch (issue) {
    case 'long_running':
      return t('cmd.goal.doctor.issue.longRunning')
    case 'high_cpu':
      return t('cmd.goal.doctor.issue.highCpu')
    case 'long_running_high_cpu':
      return t('cmd.goal.doctor.issue.longRunningHighCpu')
  }
}

function formatLoopProcessLine(
  finding: LoopProcessDiagnosticsReport['findings'][number],
): string {
  return t('cmd.goal.doctor.processLine', {
    pid: String(finding.pid),
    cpu: finding.pcpu.toFixed(1),
    elapsed: finding.elapsedRaw,
    issue: loopProcessIssueLabel(finding.issue),
    command: truncateToGraphemeCount(finding.command, 120),
  })
}

export function renderGoalDoctorFromPsOutput(
  psOutput: string,
  options: { generatedAt?: string } = {},
): string {
  const report = buildLoopProcessDiagnosticsReport(psOutput, options)
  const visible = report.findings.slice(0, MAX_LOOP_PROCESS_LINES)
  const hiddenCount = report.findings.length - visible.length
  return [
    t('cmd.goal.doctor.title'),
    t('cmd.goal.doctor.readonly'),
    `${t('cmd.goal.doctor.command')}: ${LOOP_PROCESS_PS_COMMAND}`,
    `${t('cmd.goal.doctor.checked')}: ${report.checkedRows}`,
    report.findings.length === 0
      ? t('cmd.goal.doctor.none')
      : `${t('cmd.goal.doctor.findings')}: ${report.findings.length}`,
    ...visible.map(formatLoopProcessLine),
    hiddenCount > 0
      ? t('cmd.goal.doctor.more', { count: hiddenCount })
      : null,
    report.findings.length > 0 ? t('cmd.goal.doctor.confirmation') : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function renderGoalExplanation(
  goal: MossenGoalState | null,
  tasks?: Record<string, unknown>,
): string {
  if (!goal) {
    return [
      t('cmd.goal.explain.none'),
      t('cmd.goal.status.startHint'),
    ].join('\n')
  }

  return [
    t('cmd.goal.explain.title'),
    `${t('cmd.goal.status.status')}: ${statusLabel(goal.status)}`,
    `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
      goal.text,
      MAX_STATUS_GOAL_GRAPHEMES,
    )}`,
    goal.successCriteria
      ? `${t('cmd.goal.status.criteria')}: ${truncateToGraphemeCount(goal.successCriteria, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.constraints
      ? `${t('cmd.goal.status.constraints')}: ${truncateToGraphemeCount(goal.constraints, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.explain.outcome')}: ${goalOutcomeLabel(goal)}`,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}/${goal.turnBudget}`,
    `${t('cmd.goal.status.tokens')}: ${formatGoalTokenUsage(goal)}`,
    goal.lastTurnTokenEstimate !== undefined
      ? `${t('cmd.goal.status.lastTurnTokens')}: ~${formatTokens(goal.lastTurnTokenEstimate)}`
      : null,
    goal.lastEvaluatorTokenEstimate !== undefined
      ? `${t('cmd.goal.status.evaluatorTokens')}: ~${formatTokens(goal.lastEvaluatorTokenEstimate)}`
      : null,
    '',
    ...renderLoopLiveness(goal, tasks),
    ...renderWorkflowPolicy(goal, tasks),
    '',
    t('cmd.goal.explain.hint'),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function renderGoalHistoryTrailer(): string[] {
  const history = getSessionGoalHistory()
  if (history.length === 0) return []
  const recent = history.slice(-MAX_STATUS_HISTORY_LINES).reverse()
  const lines = recent.map(
    past =>
      `  • ${statusLabel(past.status)} (${past.turnCount}/${past.turnBudget}) — ${truncateToGraphemeCount(
        past.text,
        MAX_STATUS_GOAL_GRAPHEMES,
      )}`,
  )
  return ['', t('cmd.goal.status.historyTitle'), ...lines]
}

export function renderGoalHistory(): string {
  const history = renderGoalHistoryTrailer().filter(line => line.trim())
  return history.length > 0
    ? history.join('\n')
    : t('cmd.goal.status.historyEmpty')
}

export function renderGoalBoard(
  goal: MossenGoalState | null,
  tasks?: Record<string, unknown>,
  args = '',
): string {
  const board = buildLoopBoard({ goal, tasks })
  return args.trim().split(/\s+/).includes('--json')
    ? renderLoopBoardJson(board)
    : renderLoopBoard(board)
}

export function renderGoalStatus(
  goal: MossenGoalState | null,
  tasks?: Record<string, unknown>,
): string {
  if (
    !goal ||
    (goal.status !== 'active' &&
      goal.status !== 'paused' &&
      goal.status !== 'blocked' &&
      goal.status !== 'budget_limited')
  ) {
    const previous = goal
      ? [
          '',
          `${t('cmd.goal.status.previous')}: ${statusLabel(goal.status)}`,
          `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
            goal.text,
            MAX_STATUS_GOAL_GRAPHEMES,
          )}`,
        ]
      : []
    return [
      t('cmd.goal.status.none'),
      t('cmd.goal.status.scope'),
      t('cmd.goal.status.startHint'),
      ...previous,
      ...renderGoalHistoryTrailer(),
    ].join('\n')
  }

  const nextAction =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'budget_limited'
      ? t('cmd.goal.status.nextPaused')
      : t('cmd.goal.status.nextActive')

  return [
    t('cmd.goal.status.title'),
    `${t('cmd.goal.status.status')}: ${statusLabel(goal.status)}`,
    `${t('cmd.goal.status.goal')}: ${truncateToGraphemeCount(
      goal.text,
      MAX_STATUS_GOAL_GRAPHEMES,
    )}`,
    goal.successCriteria
      ? `${t('cmd.goal.status.criteria')}: ${truncateToGraphemeCount(goal.successCriteria, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.constraints
      ? `${t('cmd.goal.status.constraints')}: ${truncateToGraphemeCount(goal.constraints, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.status.turns')}: ${goal.turnCount}`,
    `${t('cmd.goal.status.budget')}: ${goal.turnBudget}`,
    `${t('cmd.goal.status.elapsed')}: ${formatElapsed(goal.createdAt)}`,
    `${t('cmd.goal.status.tokens')}: ${formatGoalTokenUsage(goal)}`,
    goal.lastTurnTokenEstimate !== undefined
      ? `${t('cmd.goal.status.lastTurnTokens')}: ~${formatTokens(goal.lastTurnTokenEstimate)}`
      : null,
    goal.lastEvaluatorTokenEstimate !== undefined
      ? `${t('cmd.goal.status.evaluatorTokens')}: ~${formatTokens(goal.lastEvaluatorTokenEstimate)}`
      : null,
    `${t('cmd.goal.status.reason')}: ${formatSessionGoalStateReason(goal)}`,
    '',
    ...renderLoopLiveness(goal, tasks),
    ...renderWorkflowPolicy(goal, tasks),
    '',
    goal.recentEvidence.length
      ? `${t('cmd.goal.status.evidence')}: ${truncateToGraphemeCount(goal.recentEvidence.join('; '), MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.negativeEvidence.length
      ? `${t('cmd.goal.status.negativeEvidence')}: ${truncateToGraphemeCount(goal.negativeEvidence.join('; '), MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    goal.nextPlan
      ? `${t('cmd.goal.status.nextPlan')}: ${truncateToGraphemeCount(goal.nextPlan, MAX_STATUS_GOAL_GRAPHEMES)}`
      : null,
    `${t('cmd.goal.status.next')}: ${nextAction}`,
    t('cmd.goal.status.overlayHint'),
    t('cmd.goal.status.scope'),
    ...renderGoalHistoryTrailer(),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
