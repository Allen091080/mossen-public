import type {
  JournalEntry,
  JournalStartedEntry,
} from '../../tools/WorkflowTool/engine/journal.js'
import {
  loadJournal,
  workflowCheckpointPath,
  workflowReportPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import type { WorkflowRecentToolCall } from '../../tools/WorkflowTool/engine/types.js'

export type WorkflowMachineState =
  | 'planning'
  | 'running'
  | 'blocked'
  | 'verifying'
  | 'ready_for_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type WorkflowJsonPhase = {
  title: string
  detail: string | null
  model: string | null
  state: WorkflowMachineState
}

export type WorkflowTreeNodeKind =
  | 'workflow'
  | 'phase'
  | 'agent'
  | 'verification'
  | 'failure'
  | 'result'

export type WorkflowTreeNodeState =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'verifying'
  | 'failed'
  | 'ready'
  | 'completed'
  | 'blocked'
  | 'cancelled'
  | 'skipped'
  | 'cached'

export type WorkflowJsonTreeNode = {
  id: string
  kind: WorkflowTreeNodeKind
  label: string
  state: WorkflowTreeNodeState
  statusContext: string | null
  agentId: string | null
  transcriptPath: string | null
  phase: string | null
  agentNumber: number | null
  model: string | null
  agentType: string | null
  isolation: string | null
  promptPreview: string | null
  queuedAt: number | null
  startedAt: number | null
  lastProgressAt: number | null
  remoteSessionId: string | null
  lastAttemptReason: string | null
  lastToolName: string | null
  lastToolSummary: string | null
  recentToolCalls: WorkflowRecentToolCall[]
  tokenUsage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  }
  toolCalls: number
  durationMs: number | null
  resultSummary: string | null
  error: string | null
  children: WorkflowJsonTreeNode[]
}

export type WorkflowVerificationSummary = {
  state: WorkflowTreeNodeState
  summary: string | null
  evidence: string[]
  commands: string[]
  artifacts: string[]
  failures: string[]
}

export type WorkflowProgressTreeAgent = {
  agentNumber: number
  agentId?: string
  transcriptPath?: string
  label: string
  phase?: string | null
  status?: string
  tokens?: number
  toolCalls?: number
  durationMs?: number
  agentType?: string
  model?: string
  isolation?: string
  promptPreview?: string
  queuedAt?: number
  startedAt?: number
  lastProgressAt?: number
  remoteSessionId?: string
  lastAttemptReason?: string
  lastToolName?: string
  lastToolSummary?: string
  recentToolCalls?: WorkflowRecentToolCall[]
  resultPreview?: string
  error?: string
}

export type WorkflowProgressTreeInput = {
  runId: string
  label: string
  state: WorkflowMachineState
  phases?: Array<{ title: string; detail?: string; model?: string }>
  agents?: WorkflowProgressTreeAgent[]
  failures?: string[]
  result?: unknown
  verification?: WorkflowVerificationSummary | null
  reportPath?: string | null
  tokensSpent?: number | null
  totalToolCalls?: number | null
  durationMs?: number | null
}

export type WorkflowJsonRun = {
  id: string
  runId: string
  kind: 'workflow'
  state: WorkflowMachineState
  status: WorkflowRunMeta['status']
  workflowName: string
  title: string | null
  description: string
  defaultModel: string | null
  args: unknown
  scriptPath: string | null
  transcriptDir: string | null
  reportPath: string | null
  createdAt: string
  updatedAt: string | null
  durationMs: number | null
  parentGoalId: string | null
  agentCount: number
  totalToolCalls: number
  tokenUsage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  }
  phases: WorkflowJsonPhase[]
  failures: string[]
  verification: WorkflowVerificationSummary
  artifacts: string[]
  result: string | null
  resultSummary: string | null
  tree: WorkflowJsonTreeNode
}

export function workflowStatusToMachineState(
  status: WorkflowRunMeta['status'],
): WorkflowMachineState {
  switch (status) {
    case 'running':
      return 'running'
    case 'paused':
      return 'blocked'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'cancelled'
  }
}

export function workflowRuntimeStatusToMachineState(
  status: string | undefined,
  options: { paused?: boolean } = {},
): WorkflowMachineState {
  if (options.paused) return 'blocked'
  switch (status) {
    case 'running':
      return 'running'
    case 'paused':
      return 'blocked'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'cancelled'
    default:
      return 'planning'
  }
}

export function collapseWorkflowResultSummary(
  value: unknown,
  maxLength = 500,
): string | null {
  if (value == null) return null
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength - 1)}…`
    : collapsed
}

function workflowPhaseToJson(
  phase: NonNullable<WorkflowRunMeta['phases']>[number],
  state: WorkflowMachineState,
): WorkflowJsonPhase {
  return {
    title: phase.title,
    detail: phase.detail ?? null,
    model: phase.model ?? null,
    state,
  }
}

function workflowNodeTokenUsage(tokens: number | null): WorkflowJsonTreeNode['tokenUsage'] {
  return {
    inputTokens: null,
    outputTokens: tokens,
    totalTokens: tokens,
  }
}

function workflowMachineStateToTreeState(
  state: WorkflowMachineState,
): WorkflowTreeNodeState {
  switch (state) {
    case 'planning':
      return 'queued'
    case 'running':
      return 'running'
    case 'blocked':
      return 'blocked'
    case 'verifying':
      return 'verifying'
    case 'ready_for_review':
      return 'ready'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
  }
}

function uniqueBounded(values: string[], max = 12): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= max) break
  }
  return result
}

function maybeParseJsonText(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed || !/^[{[]/.test(trimmed)) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function looksLikeValidationCommand(value: string): boolean {
  const trimmed = value.trim()
  if (/^\.\/\S+\.(?:md|json|txt|log|html|png|jpg|jpeg|webp|csv)$/i.test(trimmed)) {
    return false
  }
  return /^(?:bun|npm|pnpm|yarn|python3?|pytest|go test|cargo test|git diff --check|git status|\.\/|make|npx|tsc|eslint|vitest)\b/i.test(trimmed)
}

function looksLikeArtifactPath(value: string): boolean {
  return /(?:^|[\s"'])(?:\.{0,2}\/|\/)[^\s"']+\.(?:md|json|txt|log|html|png|jpg|jpeg|webp|csv|ts|tsx|js|jsx|py|go|rs|java|kt|swift)\b/i.test(value)
}

function collectWorkflowVerificationFacts(
  value: unknown,
  path: string,
  output: {
    evidence: string[]
    commands: string[]
    artifacts: string[]
  },
): void {
  if (value == null) return
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text) return
    const lowerPath = path.toLowerCase()
    if (looksLikeValidationCommand(text) || /command|cmd|test|verify|validation/.test(lowerPath)) {
      output.commands.push(text)
    }
    if (looksLikeArtifactPath(text) || /artifact|file|path|report|output/.test(lowerPath)) {
      output.artifacts.push(text)
    }
    if (
      /evidence|verification|verified|validation|check|test|claim|summary|result|report|finding|passed|failed/.test(lowerPath) ||
      output.commands.at(-1) === text ||
      output.artifacts.at(-1) === text
    ) {
      output.evidence.push(text)
    }
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (/evidence|verification|verified|validation|check|test|passed|failed|count|total/.test(path.toLowerCase())) {
      output.evidence.push(`${path}: ${String(value)}`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkflowVerificationFacts(item, path, output)
    return
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectWorkflowVerificationFacts(nested, path ? `${path}.${key}` : key, output)
    }
  }
}

function verificationStateFor(
  runState: WorkflowMachineState,
  hasEvidence: boolean,
  failures: readonly string[],
): WorkflowTreeNodeState {
  if (failures.length > 0) return 'failed'
  switch (runState) {
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'blocked':
      return 'blocked'
    case 'verifying':
      return 'verifying'
    case 'running':
      return hasEvidence ? 'verifying' : 'queued'
    case 'planning':
      return 'queued'
    case 'ready_for_review':
      return 'ready'
    case 'completed':
      return hasEvidence ? 'completed' : 'ready'
  }
}

export function buildWorkflowVerificationSummary(options: {
  state: WorkflowMachineState
  result?: unknown
  failures?: readonly string[]
  reportPath?: string | null
  finalReportPath?: string | null
}): WorkflowVerificationSummary {
  const failures = uniqueBounded([...(options.failures ?? [])], 20)
  const facts = {
    evidence: [] as string[],
    commands: [] as string[],
    artifacts: [] as string[],
  }
  const parsedResult = typeof options.result === 'string'
    ? maybeParseJsonText(options.result)
    : options.result
  collectWorkflowVerificationFacts(parsedResult, '', facts)
  const evidence = uniqueBounded(facts.evidence)
  const commands = uniqueBounded(facts.commands)
  const artifacts = uniqueBounded([
    ...(options.finalReportPath ? [options.finalReportPath] : []),
    ...(options.reportPath ? [options.reportPath] : []),
    ...facts.artifacts,
  ])
  const state = verificationStateFor(options.state, evidence.length > 0, failures)
  const summary = failures.length > 0
    ? `${failures.length} workflow failure${failures.length === 1 ? '' : 's'} captured`
    : evidence[0] ?? (options.state === 'completed'
        ? 'No explicit verification evidence captured'
        : 'Verification evidence pending')
  return {
    state,
    summary,
    evidence,
    commands,
    artifacts,
    failures,
  }
}

function journalAgentState(
  entry: JournalEntry | undefined,
  runState: WorkflowMachineState,
): WorkflowTreeNodeState {
  if (!entry) {
    if (runState === 'running') return 'running'
    if (runState === 'blocked') return 'blocked'
    if (runState === 'cancelled') return 'cancelled'
    return 'failed'
  }
  if (entry.status === 'skipped') return 'skipped'
  if (entry.status === 'retry_requested') return 'blocked'
  if (entry.status === 'stalled') return 'blocked'
  if (entry.status === 'completed') return 'completed'
  if (entry.ok) return 'completed'
  return 'failed'
}

function progressAgentState(status: string | undefined): WorkflowTreeNodeState {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'retry_requested':
      return 'blocked'
    case 'blocked':
      return 'blocked'
    case 'cancelled':
      return 'cancelled'
    case 'needs_input':
      return 'needs_input'
    case 'ready':
      return 'ready'
    case 'cached':
      return 'cached'
    default:
      return 'queued'
  }
}

function completedJournalByCall(
  entries: readonly JournalEntry[],
): Map<string, JournalEntry> {
  return new Map(entries.map(entry => [`${entry.index}\0${entry.hash}`, entry]))
}

function workflowAgentStatusContext(params: {
  state: WorkflowTreeNodeState
  error?: string | null
  lastAttemptReason?: string | null
  lastToolSummary?: string | null
  lastToolName?: string | null
  resultSummary?: string | null
  promptPreview?: string | null
  remoteSessionId?: string | null
}): string | null {
  if (params.error) return params.error
  if (params.lastAttemptReason) return `last attempt: ${params.lastAttemptReason}`
  if (params.lastToolSummary) return `tool: ${params.lastToolSummary}`
  if (params.lastToolName) return `tool: ${params.lastToolName}`
  if (params.resultSummary) return `result: ${params.resultSummary}`
  if (
    params.promptPreview &&
    (params.state === 'queued' || params.state === 'running')
  ) {
    return `${params.state}: ${params.promptPreview}`
  }
  if (params.remoteSessionId) return `remote session: ${params.remoteSessionId}`
  return null
}

function workflowAgentNode(
  runId: string,
  start: JournalStartedEntry,
  completed: JournalEntry | undefined,
  runState: WorkflowMachineState,
): WorkflowJsonTreeNode {
  const tokens = completed?.tokens ?? 0
  const state = journalAgentState(completed, runState)
  const resultSummary = completed
    ? completed.resultPreview ?? collapseWorkflowResultSummary(completed.value, 240)
    : null
  const error = completed && !completed.ok
    ? completed.status ?? 'agent failed'
    : null
  const agentId = completed?.agentId ?? start.agentId ?? null
  const transcriptPath = completed?.transcriptPath ?? start.transcriptPath ?? null
  const lastProgressAt = completed?.lastProgressAt ?? start.lastProgressAt ?? null
  const lastToolName = completed?.lastToolName ?? start.lastToolName ?? null
  const lastToolSummary =
    completed?.lastToolSummary ?? start.lastToolSummary ?? null
  const recentToolCalls =
    completed?.recentToolCalls ?? start.recentToolCalls ?? []
  return {
    id: `${runId}:agent:${start.agentNumber}`,
    kind: 'agent',
    label: start.label,
    state,
    agentId,
    transcriptPath,
    statusContext: workflowAgentStatusContext({
      state,
      error,
      lastAttemptReason: start.lastAttemptReason ?? null,
      lastToolSummary,
      lastToolName,
      resultSummary,
      promptPreview: start.promptPreview ?? null,
      remoteSessionId: completed?.remoteSessionId ?? null,
    }),
    phase: start.phase,
    agentNumber: start.agentNumber,
    model: start.opts.model ?? null,
    agentType: start.opts.agentType ?? null,
    isolation: start.opts.isolation ?? null,
    promptPreview: start.promptPreview ?? null,
    queuedAt: start.queuedAt ?? null,
    startedAt: start.startedAt ?? null,
    lastProgressAt,
    remoteSessionId: completed?.remoteSessionId ?? null,
    lastAttemptReason: start.lastAttemptReason ?? null,
    lastToolName,
    lastToolSummary,
    recentToolCalls,
    tokenUsage: workflowNodeTokenUsage(tokens),
    toolCalls: completed?.toolCalls ?? 0,
    durationMs: completed?.durationMs ?? null,
    resultSummary,
    error,
    children: [],
  }
}

function emptyWorkflowNode(
  id: string,
  kind: WorkflowTreeNodeKind,
  label: string,
  state: WorkflowTreeNodeState,
  phase: string | null = null,
): WorkflowJsonTreeNode {
  return {
    id,
    kind,
    label,
    state,
    statusContext: null,
    agentId: null,
    transcriptPath: null,
    phase,
    agentNumber: null,
    model: null,
    agentType: null,
    isolation: null,
    promptPreview: null,
    queuedAt: null,
    startedAt: null,
    lastProgressAt: null,
    remoteSessionId: null,
    lastAttemptReason: null,
    lastToolName: null,
    lastToolSummary: null,
    recentToolCalls: [],
    tokenUsage: workflowNodeTokenUsage(null),
    toolCalls: 0,
    durationMs: null,
    resultSummary: null,
    error: null,
    children: [],
  }
}

function progressAgentNode(
  runId: string,
  agent: WorkflowProgressTreeAgent,
): WorkflowJsonTreeNode {
  const tokens = agent.tokens ?? 0
  const state = progressAgentState(agent.status)
  const resultSummary = collapseWorkflowResultSummary(agent.resultPreview, 240)
  const error = agent.error ?? null
  return {
    id: `${runId}:agent:${agent.agentNumber}`,
    kind: 'agent',
    label: agent.label,
    state,
    agentId: agent.agentId ?? null,
    transcriptPath: agent.transcriptPath ?? null,
    statusContext: workflowAgentStatusContext({
      state,
      error,
      lastAttemptReason: agent.lastAttemptReason ?? null,
      lastToolSummary: agent.lastToolSummary ?? null,
      lastToolName: agent.lastToolName ?? null,
      resultSummary,
      promptPreview: agent.promptPreview ?? null,
      remoteSessionId: agent.remoteSessionId ?? null,
    }),
    phase: agent.phase ?? null,
    agentNumber: agent.agentNumber,
    model: agent.model ?? null,
    agentType: agent.agentType ?? null,
    isolation: agent.isolation ?? null,
    promptPreview: agent.promptPreview ?? null,
    queuedAt: agent.queuedAt ?? null,
    startedAt: agent.startedAt ?? null,
    lastProgressAt: agent.lastProgressAt ?? null,
    remoteSessionId: agent.remoteSessionId ?? null,
    lastAttemptReason: agent.lastAttemptReason ?? null,
    lastToolName: agent.lastToolName ?? null,
    lastToolSummary: agent.lastToolSummary ?? null,
    recentToolCalls: agent.recentToolCalls ?? [],
    tokenUsage: workflowNodeTokenUsage(tokens),
    toolCalls: agent.toolCalls ?? 0,
    durationMs: agent.durationMs ?? null,
    resultSummary,
    error,
    children: [],
  }
}

export function buildWorkflowProgressTree(
  input: WorkflowProgressTreeInput,
): WorkflowJsonTreeNode {
  const treeState = workflowMachineStateToTreeState(input.state)
  const root = emptyWorkflowNode(
    input.runId,
    'workflow',
    input.label,
    treeState,
  )
  root.tokenUsage = workflowNodeTokenUsage(input.tokensSpent ?? null)
  root.toolCalls = input.totalToolCalls ?? 0
  root.durationMs = input.durationMs ?? null
  root.resultSummary = collapseWorkflowResultSummary(input.result, 500)

  const phaseNodes = new Map<string, WorkflowJsonTreeNode>()
  for (const phase of input.phases ?? []) {
    const node = emptyWorkflowNode(
      `${input.runId}:phase:${phase.title}`,
      'phase',
      phase.title,
      treeState,
      phase.title,
    )
    node.model = phase.model ?? null
    node.resultSummary = phase.detail ?? null
    phaseNodes.set(phase.title, node)
    root.children.push(node)
  }

  for (const agent of input.agents ?? []) {
    const agentNode = progressAgentNode(input.runId, agent)
    if (agent.phase) {
      let phaseNode = phaseNodes.get(agent.phase)
      if (!phaseNode) {
        phaseNode = emptyWorkflowNode(
          `${input.runId}:phase:${agent.phase}`,
          'phase',
          agent.phase,
          treeState,
          agent.phase,
        )
        phaseNodes.set(agent.phase, phaseNode)
        root.children.push(phaseNode)
      }
      phaseNode.children.push(agentNode)
    } else {
      root.children.push(agentNode)
    }
  }

  const verification = input.verification ?? buildWorkflowVerificationSummary({
    state: input.state,
    result: input.result,
    failures: input.failures,
    reportPath: input.reportPath ?? null,
  })
  const verificationNode = emptyWorkflowNode(
    `${input.runId}:verification`,
    'verification',
    'Verification evidence',
    verification.state,
  )
  verificationNode.resultSummary = verification.summary
  if (verification.failures.length > 0) {
    verificationNode.error = verification.failures.join('; ')
  }
  root.children.push(verificationNode)

  for (const [index, failure] of (input.failures ?? []).entries()) {
    const node = emptyWorkflowNode(
      `${input.runId}:failure:${index}`,
      'failure',
      `Failure ${index + 1}`,
      'failed',
    )
    node.error = failure
    root.children.push(node)
  }

  if (input.result) {
    const node = emptyWorkflowNode(
      `${input.runId}:result`,
      'result',
      'Result ready for review',
      'ready',
    )
    node.resultSummary = collapseWorkflowResultSummary(input.result, 500)
    root.children.push(node)
  }

  return root
}

export function buildWorkflowTree(meta: WorkflowRunMeta): WorkflowJsonTreeNode {
  const runState = workflowStatusToMachineState(meta.status)
  const journal = loadJournal(meta.runId)
  const completedByCall = completedJournalByCall(journal?.entries ?? [])
  const agents = (journal?.started ?? []).map(start => {
    const completed = completedByCall.get(`${start.index}\0${start.hash}`)
    const node = workflowAgentNode(meta.runId, start, completed, runState)
    return {
      agentNumber: node.agentNumber ?? start.agentNumber,
      label: node.label,
      phase: node.phase,
      status: node.state,
      ...(node.agentId ? { agentId: node.agentId } : {}),
      ...(node.transcriptPath ? { transcriptPath: node.transcriptPath } : {}),
      tokens: node.tokenUsage.totalTokens ?? 0,
      toolCalls: node.toolCalls,
      ...(node.agentType ? { agentType: node.agentType } : {}),
      ...(node.model ? { model: node.model } : {}),
      ...(node.isolation ? { isolation: node.isolation } : {}),
      ...(node.promptPreview ? { promptPreview: node.promptPreview } : {}),
      ...(typeof node.queuedAt === 'number' ? { queuedAt: node.queuedAt } : {}),
      ...(typeof node.startedAt === 'number' ? { startedAt: node.startedAt } : {}),
      ...(typeof node.lastProgressAt === 'number'
        ? { lastProgressAt: node.lastProgressAt }
        : {}),
      ...(node.remoteSessionId ? { remoteSessionId: node.remoteSessionId } : {}),
      ...(node.lastAttemptReason
        ? { lastAttemptReason: node.lastAttemptReason }
        : {}),
      ...(node.lastToolName ? { lastToolName: node.lastToolName } : {}),
      ...(node.lastToolSummary ? { lastToolSummary: node.lastToolSummary } : {}),
      ...(node.recentToolCalls.length
        ? { recentToolCalls: node.recentToolCalls }
        : {}),
      ...(node.resultSummary ? { resultPreview: node.resultSummary } : {}),
      ...(node.error ? { error: node.error } : {}),
    } satisfies WorkflowProgressTreeAgent
  })
  return buildWorkflowProgressTree({
    runId: meta.runId,
    label: meta.title ?? meta.workflowName,
    state: runState,
    phases: meta.phases,
    agents,
    failures: meta.failures,
    result: meta.result,
    verification: buildWorkflowVerificationSummary({
      state: runState,
      result: meta.result,
      failures: meta.failures,
      reportPath: workflowReportPath(meta.runId),
      finalReportPath: meta.finalReportPath,
    }),
    tokensSpent: meta.tokensSpent,
    totalToolCalls: meta.totalToolCalls,
    durationMs: meta.durationMs,
  })
}

export function workflowRunToJson(meta: WorkflowRunMeta): WorkflowJsonRun {
  const state = workflowStatusToMachineState(meta.status)
  const outputTokens = meta.tokensSpent ?? null
  const resultSummary = collapseWorkflowResultSummary(meta.result, 500)
  const reportPath = workflowReportPath(meta.runId)
  const verification = buildWorkflowVerificationSummary({
    state,
    result: meta.result,
    failures: meta.failures,
    reportPath,
    finalReportPath: meta.finalReportPath,
  })
  return {
    id: meta.runId,
    runId: meta.runId,
    kind: 'workflow',
    state,
    status: meta.status,
    workflowName: meta.workflowName,
    title: meta.title ?? null,
    description: meta.description,
    defaultModel: meta.defaultModel ?? null,
    args: meta.args ?? null,
    scriptPath: meta.scriptPath ?? null,
    transcriptDir: meta.transcriptDir ?? null,
    reportPath,
    createdAt: meta.createdAt,
    updatedAt: null,
    durationMs: meta.durationMs ?? null,
    parentGoalId: meta.parentGoalId ?? null,
    agentCount: meta.agentCount ?? 0,
    totalToolCalls: meta.totalToolCalls ?? 0,
    tokenUsage: {
      inputTokens: null,
      outputTokens,
      totalTokens: outputTokens,
    },
    phases: (meta.phases ?? []).map(phase => workflowPhaseToJson(phase, state)),
    failures: meta.failures ?? [],
    verification,
    artifacts: Array.from(
      new Set([...verification.artifacts, workflowCheckpointPath(meta.runId)]),
    ),
    result: meta.result ?? null,
    resultSummary,
    tree: buildWorkflowTree(meta),
  }
}

export function workflowRunsToJson(runs: WorkflowRunMeta[]): WorkflowJsonRun[] {
  return runs.map(run => workflowRunToJson(run))
}
