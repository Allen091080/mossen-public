import { existsSync, readFileSync } from 'node:fs'
import type { MossenGoalState } from '../../bootstrap/state.js'
import {
  buildLoopLivenessReport,
  type LoopLivenessReport,
  type LoopWorkItem,
  type LoopWorkStatus,
} from '../../utils/loopLiveness.js'
import { LOOP_PROCESS_PS_COMMAND } from '../../utils/loopProcessDiagnostics.js'
import { formatSessionGoalStateReason } from '../../utils/sessionGoalOutput.js'
import { truncateToGraphemeCount } from '../../utils/truncate.js'
import {
  listWorkflowRuns,
  workflowFinalReportPath,
  workflowReportPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import {
  workflowRunToJson,
  type WorkflowJsonRun,
  type WorkflowJsonTreeNode,
  type WorkflowMachineState,
} from '../workflows/workflowProgressTree.js'

export type LoopBoardProviderGateStatus =
  | 'passed'
  | 'failed'
  | 'missing'
  | 'skipped'
  | 'blocked'
  | 'unknown'

export type LoopBoardProviderGate = {
  id: string
  label: string
  status: LoopBoardProviderGateStatus
  artifactPath?: string
  envName?: string
  detail?: string
  nextAction?: string
}

export type LoopBoardWorkflowState =
  | LoopWorkStatus
  | WorkflowMachineState
  | 'unverifiable'

export type LoopBoardAgent = {
  agentNumber: number | null
  label: string
  phase: string | null
  state: string
  lastProgressAt: number | null
  transcriptPath: string | null
  toolCalls: number
  tokens: number | null
}

export type LoopBoardWorkflow = {
  runId: string
  workflowName: string
  state: LoopBoardWorkflowState
  status: string
  attachedToGoal: boolean
  parentGoalId: string | null
  phaseState: string
  agentCount: number
  agents: LoopBoardAgent[]
  lastProgressAt: number | null
  staleRisk: boolean
  issue: string | null
  reportPath: string
  finalReportPath: string
  validationCommand: string
  artifacts: string[]
  nextAction: string
}

export type LoopBoardGoal = {
  id: string
  status: MossenGoalState['status']
  text: string
  reason: string
  turnCount: number
  turnBudget: number
  nextPlan: string | null
}

export type LoopBoard = {
  version: 1
  generatedAt: string
  goal: LoopBoardGoal | null
  liveness: LoopLivenessReport
  workflows: LoopBoardWorkflow[]
  providerGates: LoopBoardProviderGate[]
  processDiagnostics: {
    mode: 'read-only'
    command: string
    nextAction: string
  }
  nextAction: string
}

const DEFAULT_REAL_PROVIDER_ARTIFACTS = [
  {
    id: 'w472-real-provider-deep-research',
    label: 'W472 real-provider deep research',
    path: '/tmp/mossen-harness/W472.workflow-real-provider-deep-research/artifacts/assertions.json',
  },
  {
    id: 'w476-real-provider-task-matrix',
    label: 'W476 real-provider task matrix',
    path: '/tmp/mossen-harness/W476.workflow-real-provider-task-matrix/artifacts/assertions.json',
  },
] as const

function compact(value: unknown, maxChars = 120): string {
  if (value == null) return ''
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

function readProviderArtifact(
  id: string,
  label: string,
  artifactPath: string,
): LoopBoardProviderGate {
  if (!existsSync(artifactPath)) {
    return {
      id,
      label,
      status: 'missing',
      artifactPath,
      detail: 'artifact missing',
      nextAction: 'run the gated provider smoke when credentials are available',
    }
  }
  try {
    const payload = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      status?: unknown
    }
    const status = typeof payload.status === 'string' ? payload.status : 'unknown'
    return {
      id,
      label,
      status:
        status === 'passed'
          ? 'passed'
          : status === 'failed'
            ? 'failed'
            : status === 'skipped'
              ? 'skipped'
              : status === 'blocked'
                ? 'blocked'
                : 'unknown',
      artifactPath,
      detail: `artifact status=${status}`,
      nextAction:
        status === 'passed'
          ? 'none'
          : 'refresh provider evidence before release completion',
    }
  } catch (err) {
    return {
      id,
      label,
      status: 'unknown',
      artifactPath,
      detail: err instanceof Error ? err.message : String(err),
      nextAction: 'inspect provider artifact',
    }
  }
}

export function defaultLoopBoardProviderGates(): LoopBoardProviderGate[] {
  const configuredEnvName = process.env.MOSSEN_W472_REAL_API_KEY_ENV?.trim()
  const keyGate: LoopBoardProviderGate = configuredEnvName
    ? {
        id: 'real-provider-api-key-env',
        label: 'Real-provider API key env',
        envName: configuredEnvName,
        status: process.env[configuredEnvName] ? 'passed' : 'missing',
        detail: process.env[configuredEnvName]
          ? 'configured env var is present'
          : 'configured env var is missing',
        nextAction: process.env[configuredEnvName]
          ? 'none'
          : 'export the configured local env var before refresh',
      }
    : {
        id: 'real-provider-api-key-env',
        label: 'Real-provider API key env',
        envName: 'MOSSEN_W472_REAL_API_KEY_ENV',
        status: 'unknown',
        detail: 'provider key env-var name is not configured',
        nextAction: 'set MOSSEN_W472_REAL_API_KEY_ENV to a local key env var',
      }
  return [
    keyGate,
    ...DEFAULT_REAL_PROVIDER_ARTIFACTS.map(item =>
      readProviderArtifact(item.id, item.label, item.path),
    ),
  ]
}

function traverseAgents(node: WorkflowJsonTreeNode): LoopBoardAgent[] {
  const childAgents = node.children.flatMap(traverseAgents)
  if (node.kind !== 'agent') return childAgents
  return [
    {
      agentNumber: node.agentNumber,
      label: node.label,
      phase: node.phase,
      state: node.state,
      lastProgressAt: node.lastProgressAt,
      transcriptPath: node.transcriptPath,
      toolCalls: node.toolCalls,
      tokens: node.tokenUsage.totalTokens,
    },
    ...childAgents,
  ]
}

function latestAgentProgress(agents: readonly LoopBoardAgent[]): number | null {
  let latest: number | null = null
  for (const agent of agents) {
    if (typeof agent.lastProgressAt !== 'number') continue
    latest = latest === null ? agent.lastProgressAt : Math.max(latest, agent.lastProgressAt)
  }
  return latest
}

function workflowStateFromJson(run: WorkflowJsonRun): LoopBoardWorkflowState {
  if (run.status === 'completed' && run.verification.state === 'ready') {
    return 'unverifiable'
  }
  if (run.status === 'failed') return 'failed'
  if (run.status === 'killed') return 'killed'
  if (run.status === 'paused') return 'paused'
  return run.state
}

function nextActionForWorkflow(
  state: LoopBoardWorkflowState,
  work?: LoopWorkItem,
): string {
  if (work?.nextAction && work.nextAction !== 'none') return work.nextAction
  switch (state) {
    case 'active':
    case 'running':
    case 'planning':
    case 'verifying':
      return 'wait'
    case 'paused':
      return 'resume'
    case 'stale':
      return 'inspect'
    case 'failed':
    case 'killed':
    case 'cancelled':
      return 'review_failure'
    case 'unverifiable':
    case 'ready_for_review':
      return 'verify'
    case 'completed':
      return 'none'
    default:
      return 'inspect'
  }
}

function validationCommandForRun(run: WorkflowJsonRun): string {
  return run.verification.commands[0] ?? `/workflows ${run.runId}`
}

function workflowFromRun(
  meta: WorkflowRunMeta,
  work?: LoopWorkItem,
): LoopBoardWorkflow {
  const run = workflowRunToJson(meta)
  const agents = traverseAgents(run.tree)
  const state = work?.status ?? workflowStateFromJson(run)
  const reportPath = run.reportPath
  const finalReportPath = meta.finalReportPath ?? workflowFinalReportPath(run.runId)
  const artifacts = Array.from(
    new Set(
      [
        ...run.artifacts,
        reportPath,
        finalReportPath,
        run.scriptPath,
        run.transcriptDir,
      ].filter((value): value is string => Boolean(value)),
    ),
  )
  return {
    runId: run.runId,
    workflowName: run.workflowName,
    state,
    status: work?.status ?? run.status,
    attachedToGoal: Boolean(run.parentGoalId),
    parentGoalId: run.parentGoalId,
    phaseState: run.phases.map(phase => `${phase.title}:${phase.state}`).join(', ') || 'n/a',
    agentCount: run.agentCount,
    agents,
    lastProgressAt: work?.lastProgressAt ?? latestAgentProgress(agents),
    staleRisk: work?.status === 'stale',
    issue: work?.issue ?? null,
    reportPath,
    finalReportPath,
    validationCommand: validationCommandForRun(run),
    artifacts,
    nextAction: nextActionForWorkflow(state, work),
  }
}

function workflowFromWork(work: LoopWorkItem): LoopBoardWorkflow {
  const runId = work.runId ?? work.taskId
  const reportPath = workflowReportPath(runId)
  const finalReportPath = workflowFinalReportPath(runId)
  return {
    runId,
    workflowName: work.workflowName ?? work.label,
    state: work.status,
    status: work.status,
    attachedToGoal: work.attachedToGoal,
    parentGoalId: work.goalId ?? null,
    phaseState: 'live',
    agentCount: 0,
    agents: [],
    lastProgressAt: work.lastProgressAt ?? null,
    staleRisk: work.status === 'stale',
    issue: work.issue ?? null,
    reportPath,
    finalReportPath,
    validationCommand: `/workflows ${runId}`,
    artifacts: Array.from(new Set([...work.evidence, reportPath, finalReportPath])),
    nextAction: nextActionForWorkflow(work.status, work),
  }
}

function goalToBoard(goal: MossenGoalState | null | undefined): LoopBoardGoal | null {
  if (!goal) return null
  return {
    id: goal.id,
    status: goal.status,
    text: goal.text,
    reason: formatSessionGoalStateReason(goal),
    turnCount: goal.turnCount,
    turnBudget: goal.turnBudget,
    nextPlan: goal.nextPlan ?? null,
  }
}

function nextActionForBoard(params: {
  goal: MossenGoalState | null | undefined
  liveness: LoopLivenessReport
  workflows: readonly LoopBoardWorkflow[]
  providerGates: readonly LoopBoardProviderGate[]
}): string {
  if (!params.goal) return '/goal set <objective>'
  if (params.liveness.verdict === 'stale') return '/goal doctor'
  if (params.liveness.verdict === 'failed') return 'review workflow failure evidence'
  if (params.workflows.some(workflow => workflow.nextAction === 'verify')) {
    return 'verify workflow evidence before completion'
  }
  if (params.liveness.verdict === 'wait') return 'wait for active workflow progress'
  if (params.providerGates.some(gate => gate.status !== 'passed')) {
    return 'refresh or acknowledge provider gates before release completion'
  }
  if (params.goal.status === 'paused' || params.goal.status === 'blocked') {
    return '/goal resume'
  }
  if (params.liveness.verdict === 'complete') return 'review final evidence'
  return '/goal status'
}

export function buildLoopBoard(options: {
  goal?: MossenGoalState | null
  tasks?: Record<string, unknown> | null
  runs?: WorkflowRunMeta[]
  now?: number
  staleAfterMs?: number
  providerGates?: LoopBoardProviderGate[]
}): LoopBoard {
  const now = options.now ?? Date.now()
  const liveness = buildLoopLivenessReport(options.tasks, {
    goalId: options.goal?.id,
    includeUnattached: true,
    now,
    ...(options.staleAfterMs !== undefined
      ? { staleAfterMs: options.staleAfterMs }
      : {}),
  })
  const liveWorkflowByRunId = new Map<string, LoopWorkItem>()
  for (const item of liveness.works) {
    if (item.kind !== 'workflow') continue
    liveWorkflowByRunId.set(item.runId ?? item.taskId, item)
  }
  const workflows = (options.runs ?? listWorkflowRuns()).map(meta =>
    workflowFromRun(meta, liveWorkflowByRunId.get(meta.runId)),
  )
  for (const item of liveWorkflowByRunId.values()) {
    const runId = item.runId ?? item.taskId
    if (!workflows.some(workflow => workflow.runId === runId)) {
      workflows.push(workflowFromWork(item))
    }
  }
  const providerGates =
    options.providerGates ?? defaultLoopBoardProviderGates()
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    goal: goalToBoard(options.goal),
    liveness,
    workflows,
    providerGates,
    processDiagnostics: {
      mode: 'read-only',
      command: LOOP_PROCESS_PS_COMMAND,
      nextAction: '/goal doctor',
    },
    nextAction: nextActionForBoard({
      goal: options.goal,
      liveness,
      workflows,
      providerGates,
    }),
  }
}

function providerGateLine(gate: LoopBoardProviderGate): string {
  const parts = [
    gate.status,
    gate.envName ? `env=${gate.envName}` : null,
    gate.artifactPath ? `artifact=${gate.artifactPath}` : null,
    gate.detail ? compact(gate.detail, 100) : null,
    gate.nextAction && gate.nextAction !== 'none' ? `next=${gate.nextAction}` : null,
  ].filter((part): part is string => part !== null)
  return `  - ${gate.label}: ${parts.join('; ')}`
}

function workflowLine(workflow: LoopBoardWorkflow): string {
  const parts = [
    `run=${workflow.runId}`,
    workflow.attachedToGoal ? 'attached=goal' : 'attached=session',
    `phase=${workflow.phaseState || 'n/a'}`,
    `agents=${workflow.agentCount}`,
    workflow.staleRisk ? 'staleRisk=yes' : 'staleRisk=no',
    workflow.issue ? `issue=${workflow.issue}` : null,
    `report=${workflow.reportPath}`,
    `final=${workflow.finalReportPath}`,
    `validation=${workflow.validationCommand}`,
    workflow.nextAction !== 'none' ? `next=${workflow.nextAction}` : null,
  ].filter((part): part is string => part !== null)
  return `  - [${workflow.state}] ${workflow.workflowName}: ${parts.join('; ')}`
}

function agentLine(agent: LoopBoardAgent, workflow: LoopBoardWorkflow): string {
  const label = agent.agentNumber ? `#${agent.agentNumber} ${agent.label}` : agent.label
  const parts = [
    `workflow=${workflow.runId}`,
    agent.phase ? `phase=${agent.phase}` : null,
    `state=${agent.state}`,
    `tools=${agent.toolCalls}`,
    agent.tokens !== null ? `tokens=${agent.tokens}` : null,
    agent.transcriptPath ? `transcript=${agent.transcriptPath}` : null,
  ].filter((part): part is string => part !== null)
  return `  - ${label}: ${parts.join('; ')}`
}

export function renderLoopBoard(board: LoopBoard): string {
  const goalLines = board.goal
    ? [
        `Goal: ${board.goal.status} ${board.goal.id}`,
        `  text: ${truncateToGraphemeCount(board.goal.text, 180)}`,
        `  turns: ${board.goal.turnCount}/${board.goal.turnBudget}`,
        `  reason: ${truncateToGraphemeCount(board.goal.reason, 180)}`,
        board.goal.nextPlan
          ? `  nextPlan: ${truncateToGraphemeCount(board.goal.nextPlan, 180)}`
          : null,
      ].filter((line): line is string => line !== null)
    : ['Goal: none']
  const countText = Object.entries(board.liveness.counts)
    .map(([status, count]) => `${status}=${count}`)
    .join(' ')
  const agentLines = board.workflows.flatMap(workflow =>
    workflow.agents.map(agent => agentLine(agent, workflow)),
  )
  return [
    'Loop board',
    `Generated: ${board.generatedAt}`,
    ...goalLines,
    `Liveness: ${board.liveness.verdict} (${countText})`,
    '',
    'Workflows:',
    ...(board.workflows.length
      ? board.workflows.map(workflowLine)
      : ['  - none']),
    '',
    'Agents:',
    ...(agentLines.length ? agentLines : ['  - none']),
    '',
    'Provider gates:',
    ...(board.providerGates.length
      ? board.providerGates.map(providerGateLine)
      : ['  - none']),
    '',
    `Process diagnostics: ${board.processDiagnostics.mode}; command=${board.processDiagnostics.command}; next=${board.processDiagnostics.nextAction}`,
    `Next action: ${board.nextAction}`,
    'JSON: /loop status --json',
  ].join('\n')
}

export function renderLoopBoardJson(board: LoopBoard): string {
  return JSON.stringify(board, null, 2)
}
