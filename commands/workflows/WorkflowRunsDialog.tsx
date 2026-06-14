import React, { useMemo, useState } from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { Box, Text, useInput } from '../../ink.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import {
  killWorkflowTask,
  pauseWorkflowTask,
  retryWorkflowAgent,
  skipWorkflowAgent,
  type LocalWorkflowTaskState,
  type WorkflowAgentTaskProgress,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  listWorkflowRuns,
  loadJournal,
  loadRunLog,
  runScriptPath,
  workflowReportPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import { formatDuration, formatNumber } from '../../utils/format.js'
import { t } from '../../utils/i18n/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { deriveWorkflowSaveName, saveRun } from './saveWorkflow.js'
import { exportWorkflowRunReport } from './exportWorkflowReport.js'
import {
  buildWorkflowResumeResult,
  isResumableWorkflowRunStatus,
  resumeRunFromJournal,
} from './resumeWorkflow.js'
import {
  buildWorkflowPhaseMetricSummary,
  buildWorkflowRunMetricSummary,
  workflowAgentElapsedMs,
  workflowSumAgentElapsedMs,
} from './progressSummary.js'
import {
  buildWorkflowProgressTree,
  buildWorkflowTree,
  workflowRuntimeStatusToMachineState,
  type WorkflowJsonTreeNode,
} from './workflowProgressTree.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

type WorkflowRunItem =
  | {
      kind: 'live'
      id: string
      runId: string
      name: string
      status: string
      task: LocalWorkflowTaskState
    }
  | {
      kind: 'history'
      id: string
      runId: string
      name: string
      status: WorkflowRunMeta['status']
      meta: WorkflowRunMeta
    }

export type WorkflowSaveScope = 'project' | 'user'

export type WorkflowDialogMode = 'list' | 'run' | 'phase' | 'agent' | 'save'

export type WorkflowMainViewState =
  | { mode: 'list' }
  | { mode: 'run'; runId: string }
  | { mode: 'phase'; runId: string; phase: string }
  | { mode: 'agent'; runId: string; agentNumber: number }

type ViewState = WorkflowMainViewState | WorkflowSaveViewState

export type WorkflowSaveViewState = {
  mode: 'save'
  runId: string
  scope: WorkflowSaveScope
  previous: WorkflowMainViewState
}

function isWorkflowTask(task: unknown): task is LocalWorkflowTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    (task as { type?: string }).type === 'local_workflow'
  )
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return '>'
    case 'paused':
      return '||'
    case 'completed':
      return 'ok'
    case 'failed':
      return '!!'
    case 'killed':
      return 'x'
    default:
      return '-'
  }
}

function statusColor(status: string): 'success' | 'error' | 'warning' | 'background' {
  switch (status) {
    case 'completed':
    case 'cached':
      return 'success'
    case 'failed':
    case 'killed':
      return 'error'
    case 'paused':
    case 'skipped':
    case 'retry_requested':
      return 'warning'
    default:
      return 'background'
  }
}

function compact(value: unknown, maxLength = 140): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function compactResultPreview(value: unknown): string | undefined {
  const preview = compact(
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })(),
    160,
  )
  return preview ?? undefined
}

function workflowAgentStatusFromJournal(
  entry: NonNullable<ReturnType<typeof loadJournal>>['entries'][number] | undefined,
): WorkflowAgentTaskProgress['status'] {
  if (!entry) return 'queued'
  if (entry.status === 'skipped') return 'skipped'
  if (entry.status === 'retry_requested') return 'retry_requested'
  if (entry.status === 'completed') return 'completed'
  if (entry.ok) return 'completed'
  return 'failed'
}

export function historyAgentsForRun(runId: string): WorkflowAgentTaskProgress[] {
  const journal = loadJournal(runId)
  const started = journal?.started ?? []
  if (started.length === 0) return []
  const completedByCall = new Map(
    (journal?.entries ?? []).map(entry => [`${entry.index}\0${entry.hash}`, entry]),
  )
  return started.map(start => {
    const completed = completedByCall.get(`${start.index}\0${start.hash}`)
    return {
      agentNumber: start.agentNumber,
      ...(completed?.agentId ?? start.agentId
        ? { agentId: completed?.agentId ?? start.agentId }
        : {}),
      ...(completed?.transcriptPath ?? start.transcriptPath
        ? { transcriptPath: completed?.transcriptPath ?? start.transcriptPath }
        : {}),
      label: start.label,
      phase: start.phase,
      status: workflowAgentStatusFromJournal(completed),
      tokens: completed?.tokens ?? 0,
      toolCalls: completed?.toolCalls ?? 0,
      ...(typeof completed?.durationMs === 'number'
        ? { durationMs: completed.durationMs }
        : {}),
      ...(start.opts.agentType ? { agentType: start.opts.agentType } : {}),
      ...(start.opts.model ? { model: start.opts.model } : {}),
      ...(start.opts.isolation ? { isolation: start.opts.isolation } : {}),
      ...(start.promptPreview ? { promptPreview: start.promptPreview } : {}),
      ...(typeof start.queuedAt === 'number' ? { queuedAt: start.queuedAt } : {}),
      ...(typeof start.startedAt === 'number'
        ? { startedAt: start.startedAt }
        : {}),
      ...(typeof (completed?.lastProgressAt ?? start.lastProgressAt) === 'number'
        ? { lastProgressAt: completed?.lastProgressAt ?? start.lastProgressAt }
        : {}),
      ...(completed?.remoteSessionId
        ? { remoteSessionId: completed.remoteSessionId }
        : {}),
      ...(start.lastAttemptReason
        ? { lastAttemptReason: start.lastAttemptReason }
        : {}),
      ...(completed?.lastToolName ?? start.lastToolName
        ? { lastToolName: completed?.lastToolName ?? start.lastToolName }
        : {}),
      ...(completed?.lastToolSummary ?? start.lastToolSummary
        ? { lastToolSummary: completed?.lastToolSummary ?? start.lastToolSummary }
        : {}),
      ...((completed?.recentToolCalls ?? start.recentToolCalls)?.length
        ? { recentToolCalls: completed?.recentToolCalls ?? start.recentToolCalls }
        : {}),
      ...(completed?.value !== undefined
        ? { resultPreview: compactResultPreview(completed.value) }
        : {}),
    }
  })
}

function phaseTitlesFromProgress(
  phaseDefinitions: readonly { title: string }[] | undefined,
  phaseNames: readonly string[] | undefined,
  agents: readonly Pick<WorkflowAgentTaskProgress, 'phase'>[],
): string[] {
  const titles: string[] = []
  const add = (title: unknown) => {
    const value = typeof title === 'string' ? title.trim() : ''
    if (value && !titles.includes(value)) titles.push(value)
  }
  for (const phase of phaseDefinitions ?? []) add(phase.title)
  for (const phase of phaseNames ?? []) add(phase)
  for (const agent of agents) add(agent.phase ?? undefined)
  return titles
}

function phaseTitles(task: LocalWorkflowTaskState): string[] {
  return phaseTitlesFromProgress(task.phaseDefinitions, task.phases, task.agents ?? [])
}

export function sumAgentElapsedMs(
  agents: readonly WorkflowAgentTaskProgress[],
): number {
  return workflowSumAgentElapsedMs(agents)
}

export function recentToolCallLines(agent: WorkflowAgentTaskProgress): string[] {
  const recent = agent.recentToolCalls?.length
    ? agent.recentToolCalls
    : agent.lastToolName
      ? [
          {
            name: agent.lastToolName,
            ...(agent.lastToolSummary ? { summary: agent.lastToolSummary } : {}),
          },
        ]
      : []
  return recent.map((tool, index) => {
    const label = recent.length > 1 ? `Tool ${index + 1}` : 'Tool'
    return `${label}: ${tool.name}${tool.summary ? ` ${tool.summary}` : ''}`
  })
}

function findRun(items: readonly WorkflowRunItem[], runId: string): WorkflowRunItem | null {
  return items.find(item => item.runId === runId || item.id === runId) ?? null
}

function runPhases(item: WorkflowRunItem): string[] {
  if (item.kind === 'live') return phaseTitles(item.task)
  return phaseTitlesFromProgress(
    item.meta.phases,
    undefined,
    historyAgentsForRun(item.runId),
  )
}

function workflowTreeForItem(item: WorkflowRunItem): WorkflowJsonTreeNode {
  if (item.kind === 'history') return buildWorkflowTree(item.meta)
  return buildWorkflowProgressTree({
    runId: item.runId,
    label: item.task.title ?? item.task.workflowName,
    state: workflowRuntimeStatusToMachineState(item.task.status, {
      paused: item.task.paused,
    }),
    phases:
      item.task.phaseDefinitions ??
      item.task.phases.map(title => ({ title })),
    agents: item.task.agents,
    failures: item.task.failures,
    result: item.task.result,
    reportPath: workflowReportPath(item.runId),
    tokensSpent: item.task.tokensSpent,
    totalToolCalls: item.task.totalToolCalls,
    durationMs: item.task.durationMs,
  })
}

function workflowTreePhaseNodes(
  tree: WorkflowJsonTreeNode | null,
): WorkflowJsonTreeNode[] {
  return tree?.children.filter(node => node.kind === 'phase') ?? []
}

function workflowTreeRunLevelAgentNodes(
  tree: WorkflowJsonTreeNode | null,
): WorkflowJsonTreeNode[] {
  return tree?.children.filter(node => node.kind === 'agent') ?? []
}

function workflowTreeVerificationNode(
  tree: WorkflowJsonTreeNode | null,
): WorkflowJsonTreeNode | null {
  return tree?.children.find(node => node.kind === 'verification') ?? null
}

function workflowVerificationLine(
  node: WorkflowJsonTreeNode | null,
  runId: string,
): string {
  const report = compact(workflowReportPath(runId), 80)
  const summary = compact(node?.resultSummary, 120)
  const state = node?.state ?? 'queued'
  return [
    `verification: ${state}`,
    summary ? `summary: ${summary}` : null,
    report ? `report: ${report}` : null,
  ].filter((item): item is string => item !== null).join(' · ')
}

function workflowTreeNodeAgentMetricSummary(node: WorkflowJsonTreeNode): {
  agentCount: number
  statusSummary: string
  tokens: number
  toolCalls: number
  elapsedMs: number
} {
  const agents = (node.kind === 'phase' ? node.children : [node])
    .filter(item => item.kind === 'agent')
  const statusCounts = new Map<string, number>()
  let tokens = 0
  let toolCalls = 0
  let elapsedMs = 0
  for (const agent of agents) {
    statusCounts.set(agent.state, (statusCounts.get(agent.state) ?? 0) + 1)
    tokens += agent.tokenUsage.totalTokens ?? 0
    toolCalls += agent.toolCalls
    elapsedMs += agent.durationMs ?? 0
  }
  return {
    agentCount: agents.length,
    statusSummary: Array.from(statusCounts.entries())
      .map(([status, count]) => `${count} ${status}`)
      .join(', '),
    tokens,
    toolCalls,
    elapsedMs,
  }
}

export function shouldRouteWorkflowAgentControl(
  mode: WorkflowDialogMode,
  runLevelAgentSelected = false,
): boolean {
  return mode === 'phase' || mode === 'agent' || (mode === 'run' && runLevelAgentSelected)
}

export function canStopWorkflowAgentStatus(
  status: WorkflowAgentTaskProgress['status'],
): boolean {
  return status === 'queued' || status === 'running' || status === 'retry_requested'
}

export function canRestartWorkflowAgentStatus(
  status: WorkflowAgentTaskProgress['status'],
): boolean {
  return status === 'running'
}

export function workflowSelectedActionHint(params: {
  mode: WorkflowDialogMode
  hasSelectedRun: boolean
  selectedRunKind?: 'live' | 'history' | null
  selectedRunStatus?: string | null
  selectedAgent?: Pick<WorkflowAgentTaskProgress, 'agentNumber' | 'status'> | null
  runLevelAgentSelected?: boolean
  hasSelectedPhase?: boolean
}): string {
  if (params.mode === 'save') return 'Tab switch scope · Enter save · Esc back'
  if (!params.hasSelectedRun) return 'No workflow selected'

  const actions: string[] = []
  const agentSelected =
    params.selectedAgent &&
    shouldRouteWorkflowAgentControl(
      params.mode,
      params.runLevelAgentSelected === true,
    )

  if (params.mode === 'list') {
    actions.push('Enter open run')
  } else if (agentSelected) {
    actions.push(
      params.mode === 'agent'
        ? `Viewing agent #${params.selectedAgent!.agentNumber}`
        : `Enter peek agent #${params.selectedAgent!.agentNumber}`,
    )
    if (
      params.selectedRunKind === 'live' &&
      canStopWorkflowAgentStatus(params.selectedAgent!.status)
    ) {
      actions.push('x stop agent')
    }
    if (
      params.selectedRunKind === 'live' &&
      canRestartWorkflowAgentStatus(params.selectedAgent!.status)
    ) {
      actions.push('r restart agent')
    }
  } else if (params.mode === 'run' && params.hasSelectedPhase) {
    actions.push('Enter open phase')
  } else if (params.mode === 'phase') {
    actions.push('Enter peek agent')
  }

  if (params.selectedRunKind === 'live') {
    if (params.selectedRunStatus === 'running') {
      actions.push('p pause workflow', 'x stop workflow')
    } else if (
      params.selectedRunStatus === 'paused' ||
      params.selectedRunStatus === 'killed'
    ) {
      actions.push('p resume workflow')
    }
  } else if (
    params.selectedRunStatus === 'paused' ||
    params.selectedRunStatus === 'killed'
  ) {
    actions.push('p resume workflow')
  }

  actions.push('e export report', 's save')
  return actions.join(' · ')
}

export function shouldShowRunLevelAgents(
  phaseCount: number,
  agentCount: number,
): boolean {
  return phaseCount === 0 && agentCount > 0
}

export function workflowRunOpenTarget(
  runId: string,
  phases: readonly string[],
  selectedPhaseIndex: number,
  agent: WorkflowAgentTaskProgress | null | undefined,
): WorkflowMainViewState | null {
  const phase = phases[selectedPhaseIndex]
  if (phase) return { mode: 'phase', runId, phase }
  if (shouldShowRunLevelAgents(phases.length, agent ? 1 : 0)) {
    return { mode: 'agent', runId, agentNumber: agent.agentNumber }
  }
  return null
}

export function workflowAgentBackTarget(
  runId: string,
  phase: string | null | undefined,
): WorkflowMainViewState {
  return phase ? { mode: 'phase', runId, phase } : { mode: 'run', runId }
}

export function workflowSaveOpenTarget(
  runId: string,
  currentView: WorkflowMainViewState | WorkflowSaveViewState,
): WorkflowSaveViewState {
  const previous: WorkflowMainViewState =
    currentView.mode === 'save' ? currentView.previous : currentView
  return {
    mode: 'save',
    runId,
    scope: 'project',
    previous,
  }
}

export function toggleWorkflowSaveScope(
  scope: WorkflowSaveScope,
): WorkflowSaveScope {
  return scope === 'project' ? 'user' : 'project'
}

export function workflowSaveRunArgs(
  runId: string,
  scope: WorkflowSaveScope,
): string[] {
  return scope === 'user' ? [runId, '--user'] : [runId]
}

export function workflowLiveRunListMetricSummary(
  task: LocalWorkflowTaskState,
): ReturnType<typeof buildWorkflowRunMetricSummary> {
  return buildWorkflowRunMetricSummary(task, task.agents)
}

export function workflowInputGuideText(mode: WorkflowDialogMode): string {
  if (mode === 'save') return 'tab:switch-scope | enter:save | esc:back'
  return [
    'up/down:select',
    'enter/right:open',
    'esc/left:back',
    mode === 'agent' ? 'j/k:scroll' : null,
    'p:pause/resume',
    'x:stop',
    'r:restart-agent',
    's:save',
    'e:export-report',
  ].filter((item): item is string => item !== null).join(' | ')
}

function inputGuide(mode: WorkflowDialogMode) {
  return () => workflowInputGuideText(mode)
}

export function WorkflowRunsDialog({ onDone }: Props): React.ReactNode {
  const tasks = useAppState(state => state.tasks)
  const setAppState = useSetAppState()
  const [view, setView] = useState<ViewState>({ mode: 'list' })
  const [selectedRunIndex, setSelectedRunIndex] = useState(0)
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0)
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0)
  const [agentScroll, setAgentScroll] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  const items = useMemo<WorkflowRunItem[]>(() => {
    const live = Object.values(tasks ?? {})
      .filter(isWorkflowTask)
      .map(task => ({
        kind: 'live' as const,
        id: task.id,
        runId: task.workflowRunId ?? task.runId,
        name: task.workflowName,
        status: task.paused ? 'paused' : task.status,
        task,
      }))
      .sort((a, b) => b.task.startTime - a.task.startTime)
    const liveRunIds = new Set(live.map(item => item.runId))
    const history = listWorkflowRuns()
      .filter(run => !liveRunIds.has(run.runId))
      .map(run => ({
        kind: 'history' as const,
        id: run.runId,
        runId: run.runId,
        name: run.workflowName,
        status: run.status,
        meta: run,
      }))
    return [...live, ...history]
  }, [tasks])

  const selectedRun =
    view.mode === 'list'
      ? items[selectedRunIndex] ?? null
      : findRun(items, view.runId)
  const historyAgents =
    selectedRun?.kind === 'history'
      ? historyAgentsForRun(selectedRun.runId)
      : []
  const selectedRunTree = selectedRun ? workflowTreeForItem(selectedRun) : null
  const phaseNodes = workflowTreePhaseNodes(selectedRunTree)
  const runLevelAgentNodes = workflowTreeRunLevelAgentNodes(selectedRunTree)
  const verificationNode = workflowTreeVerificationNode(selectedRunTree)
  const phases = phaseNodes.length > 0
    ? phaseNodes.map(node => node.label)
    : selectedRun
      ? runPhases(selectedRun)
      : []
  const agents =
    selectedRun?.kind === 'live'
      ? view.mode === 'phase'
        ? selectedRun.task.agents.filter(agent => agent.phase === view.phase)
        : selectedRun.task.agents
      : selectedRun?.kind === 'history'
        ? view.mode === 'phase'
          ? historyAgents.filter(agent => agent.phase === view.phase)
          : historyAgents
      : []
  const showRunLevelAgents = shouldShowRunLevelAgents(
    phases.length,
    runLevelAgentNodes.length || agents.length,
  )
  const currentAgent =
    view.mode === 'agent'
      ? agents.find(agent => agent.agentNumber === view.agentNumber) ?? null
      : agents[selectedAgentIndex] ?? null
  const selectedRunMetricSummary = selectedRun
    ? selectedRun.kind === 'live'
      ? buildWorkflowRunMetricSummary(selectedRun.task, selectedRun.task.agents)
      : buildWorkflowRunMetricSummary(selectedRun.meta, historyAgents)
    : null

  const close = (result = t('cmd.workflows.dismissed')) =>
    onDone(result, { display: 'system' })

  const saveSelectedRun = (runId: string, scope: WorkflowSaveScope) => {
    const result = saveRun(workflowSaveRunArgs(runId, scope))
    setMessage(result)
    onDone(result, { display: 'system' })
  }

  const openSaveDialog = (run: WorkflowRunItem) => {
    setView(workflowSaveOpenTarget(run.runId, view))
  }

  const exportSelectedRun = (run: WorkflowRunItem) => {
    const result = exportWorkflowRunReport(run.runId)
    setMessage(result.message)
  }

  const resumeSelectedRun = (run: WorkflowRunItem) => {
    const result =
      run.kind === 'live'
        ? buildWorkflowResumeResult(
            run.runId,
            run.task.scriptPath ?? runScriptPath(run.runId),
            run.task.args,
          )
        : resumeRunFromJournal(run.runId)
    onDone(result.message, {
      display: 'system',
      ...(result.nextInput
        ? { nextInput: result.nextInput, submitNextInput: true }
        : {}),
    })
  }

  useInput((_input, key) => {
    if (key.escape || key.leftArrow) {
      if (view.mode === 'save') {
        setView(view.previous)
        return
      }
      if (view.mode === 'agent') {
        setView(workflowAgentBackTarget(view.runId, currentAgent?.phase))
        setAgentScroll(0)
        return
      }
      if (view.mode === 'phase') {
        setView({ mode: 'run', runId: view.runId })
        return
      }
      if (view.mode === 'run') {
        setView({ mode: 'list' })
        return
      }
      close()
      return
    }

    if (view.mode === 'save') {
      if (key.tab) {
        setView({
          ...view,
          scope: toggleWorkflowSaveScope(view.scope),
        })
        return
      }
      if (key.return) {
        saveSelectedRun(view.runId, view.scope)
      }
      return
    }

    if (_input === 's' && selectedRun) {
      openSaveDialog(selectedRun)
      return
    }

    if (_input === 'e' && selectedRun) {
      exportSelectedRun(selectedRun)
      return
    }

    const liveRun = selectedRun?.kind === 'live' ? selectedRun : null
    const routeToSelectedAgent =
      showRunLevelAgents && currentAgent
        ? shouldRouteWorkflowAgentControl(view.mode, true)
        : shouldRouteWorkflowAgentControl(view.mode)
    if (_input === 'p') {
      if (liveRun && liveRun.task.status === 'running' && !liveRun.task.paused) {
        const ok = pauseWorkflowTask(liveRun.task.id, setAppState)
        setMessage(ok ? t('cmd.workflows.paused', { runId: liveRun.runId }) : null)
      } else if (
        selectedRun &&
        isResumableWorkflowRunStatus(selectedRun.status)
      ) {
        resumeSelectedRun(selectedRun)
      } else if (selectedRun) {
        setMessage(t('cmd.workflows.notPaused', { runId: selectedRun.runId }))
      }
      return
    }
    if (_input === 'x' && liveRun) {
      if (routeToSelectedAgent && currentAgent) {
        if (!canStopWorkflowAgentStatus(currentAgent.status)) {
          setMessage(
            t('cmd.workflows.agentNotRunning', {
              runId: liveRun.runId,
              agentNumber: String(currentAgent.agentNumber),
            }),
          )
          return
        }
        skipWorkflowAgent(liveRun.task.id, currentAgent.agentNumber, setAppState)
        setMessage(
          t('cmd.workflows.agentStopped', {
            runId: liveRun.runId,
            agentNumber: String(currentAgent.agentNumber),
          }),
        )
      } else {
        killWorkflowTask(liveRun.task.id, setAppState)
        setMessage(t('cmd.workflows.stopped', { runId: liveRun.runId }))
      }
      return
    }
    if (
      _input === 'r' &&
      liveRun &&
      routeToSelectedAgent &&
      currentAgent
    ) {
      if (currentAgent.status !== 'running') {
        setMessage(
          t('cmd.workflows.agentNotRunning', {
            runId: liveRun.runId,
            agentNumber: String(currentAgent.agentNumber),
          }),
        )
        return
      }
      retryWorkflowAgent(liveRun.task.id, currentAgent.agentNumber, setAppState)
      setMessage(
        t('cmd.workflows.agentRetryQueued', {
          runId: liveRun.runId,
          agentNumber: String(currentAgent.agentNumber),
        }),
      )
      return
    }

    if (view.mode === 'list') {
      if (key.upArrow) setSelectedRunIndex(index => Math.max(0, index - 1))
      if (key.downArrow) {
        setSelectedRunIndex(index => Math.min(Math.max(0, items.length - 1), index + 1))
      }
      if ((key.return || key.rightArrow) && selectedRun) {
        setView({ mode: 'run', runId: selectedRun.runId })
        setSelectedPhaseIndex(0)
        setSelectedAgentIndex(0)
      }
      return
    }

    if (view.mode === 'run') {
      if (key.upArrow) {
        if (showRunLevelAgents) {
          setSelectedAgentIndex(index => Math.max(0, index - 1))
        } else {
          setSelectedPhaseIndex(index => Math.max(0, index - 1))
        }
      }
      if (key.downArrow) {
        if (showRunLevelAgents) {
          setSelectedAgentIndex(index => Math.min(Math.max(0, agents.length - 1), index + 1))
        } else {
          setSelectedPhaseIndex(index => Math.min(Math.max(0, phases.length - 1), index + 1))
        }
      }
      if (key.return || key.rightArrow) {
        const target = workflowRunOpenTarget(
          view.runId,
          phases,
          selectedPhaseIndex,
          currentAgent,
        )
        if (target) {
          setView(target)
          if (target.mode === 'phase') setSelectedAgentIndex(0)
          if (target.mode === 'agent') setAgentScroll(0)
        }
      }
    }

    if (view.mode === 'phase') {
      if (key.upArrow) setSelectedAgentIndex(index => Math.max(0, index - 1))
      if (key.downArrow) {
        setSelectedAgentIndex(index => Math.min(Math.max(0, agents.length - 1), index + 1))
      }
      if ((key.return || key.rightArrow) && currentAgent) {
        setView({
          mode: 'agent',
          runId: view.runId,
          agentNumber: currentAgent.agentNumber,
        })
        setAgentScroll(0)
      }
    }

    if (view.mode === 'agent') {
      if (_input === 'j' || key.downArrow) setAgentScroll(offset => offset + 1)
      if (_input === 'k' || key.upArrow) setAgentScroll(offset => Math.max(0, offset - 1))
    }
  })

  const subtitle = selectedRun ? (
    <Text>
      <Text color={statusColor(selectedRun.status)}>{statusGlyph(selectedRun.status)} {selectedRun.status}</Text>
      <Text dimColor> · {selectedRun.runId}</Text>
    </Text>
  ) : undefined
  const selectedActionHint = workflowSelectedActionHint({
    mode: view.mode,
    hasSelectedRun: selectedRun !== null,
    selectedRunKind: selectedRun?.kind ?? null,
    selectedRunStatus: selectedRun?.status ?? null,
    selectedAgent: currentAgent,
    runLevelAgentSelected: showRunLevelAgents && Boolean(currentAgent),
    hasSelectedPhase: phases.length > 0,
  })

  return (
    <Dialog
      title={t('cmd.workflows.dialogTitle')}
      subtitle={subtitle}
      onCancel={() => close()}
      color="background"
      inputGuide={inputGuide(view.mode)}
    >
      {items.length === 0 ? (
        <Box flexDirection="column">
          <Text>{t('cmd.workflows.empty')}</Text>
          <Text dimColor>{t('cmd.workflows.emptyHint')}</Text>
        </Box>
      ) : null}
      {items.length > 0 && view.mode === 'list' ? (
        <Box flexDirection="column">
          <Text dimColor>{selectedActionHint}</Text>
          {items.map((item, index) => (
            <Text key={item.id} color={index === selectedRunIndex ? 'suggestion' : undefined}>
              {index === selectedRunIndex ? '> ' : '  '}
              {statusGlyph(item.status)} {item.name}{' '}
              <Text dimColor>
                {item.runId} · {item.status}
                {item.kind === 'live'
                  ? (() => {
                      const summary = workflowLiveRunListMetricSummary(item.task)
                      return ` · ${formatNumber(summary.agentCount)} agents · ${formatNumber(summary.tokens)} tok`
                    })()
                  : item.meta.agentCount != null
                    ? ` · ${formatNumber(item.meta.agentCount)} agents${item.meta.tokensSpent != null ? ` · ${formatNumber(item.meta.tokensSpent)} tok` : ''}`
                    : ''}
              </Text>
            </Text>
          ))}
          {message ? <Text color="warning">{message}</Text> : null}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'run' ? (
        <Box flexDirection="column">
          <Text bold>{selectedRun.name}</Text>
          <Text dimColor>{selectedActionHint}</Text>
          {selectedRun.kind === 'live' ? (
            <>
              <Text dimColor>
                {formatNumber(selectedRunMetricSummary?.agentCount ?? 0)} agents ·{' '}
                {formatNumber(selectedRunMetricSummary?.tokens ?? 0)} tok ·{' '}
                {formatNumber(selectedRunMetricSummary?.toolCalls ?? 0)} tools ·{' '}
                {formatDuration(selectedRunMetricSummary?.elapsedMs ?? 0, { mostSignificantOnly: true })}
              </Text>
              <Text color={statusColor(verificationNode?.state ?? 'queued')}>
                {workflowVerificationLine(verificationNode, selectedRun.runId)}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {showRunLevelAgents
                  ? agents.map((agent, index) => (
                      <Text key={agent.agentNumber} color={index === selectedAgentIndex ? 'suggestion' : undefined}>
                        {index === selectedAgentIndex ? '> ' : '  '}
                        #{agent.agentNumber} {agent.label}{' '}
                        <Text color={statusColor(agent.status)}>{agent.status}</Text>
                        <Text dimColor>
                          {' '}· {formatNumber(agent.tokens)} tok · {formatNumber(agent.toolCalls)} tools
                        </Text>
                      </Text>
                    ))
                  : phases.map((phase, index) => {
                      const phaseNode = phaseNodes[index] ?? null
                      const phaseAgents = selectedRun.task.agents.filter(agent => agent.phase === phase)
                      const phaseSummary = phaseNode
                        ? workflowTreeNodeAgentMetricSummary(phaseNode)
                        : buildWorkflowPhaseMetricSummary(
                            phase,
                            phaseAgents,
                          )
                      const selected = index === selectedPhaseIndex
                      return (
                        <Text key={phase} color={selected ? 'suggestion' : undefined}>
                          {selected ? '> ' : '  '}
                          {phase}{' '}
                          <Text dimColor>
                            · {phaseSummary.agentCount} agents · {phaseSummary.statusSummary}
                            {' '}· {formatNumber(phaseSummary.tokens)} tok
                            {' '}· {formatNumber(phaseSummary.toolCalls)} tools
                            {phaseSummary.elapsedMs > 0
                              ? ` · ${formatDuration(phaseSummary.elapsedMs, { mostSignificantOnly: true })}`
                              : ''}
                          </Text>
                        </Text>
                      )
                  })}
              </Box>
            </>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>
                {formatNumber(selectedRunMetricSummary?.agentCount ?? 0)} agents · ~
                {formatNumber(selectedRunMetricSummary?.tokens ?? 0)} tok
                {selectedRun.meta.totalToolCalls != null || agents.length > 0
                  ? ` · ${formatNumber(selectedRunMetricSummary?.toolCalls ?? 0)} tools`
                  : ''}
                {(selectedRunMetricSummary?.elapsedMs ?? 0) > 0
                  ? ` · ${formatDuration(selectedRunMetricSummary?.elapsedMs ?? 0, { mostSignificantOnly: true })}`
                  : ''}
              </Text>
              <Text color={statusColor(verificationNode?.state ?? selectedRun.status)}>
                {workflowVerificationLine(verificationNode, selectedRun.runId)}
              </Text>
              {agents.length > 0 ? (
                <Box flexDirection="column" marginTop={1}>
                  {showRunLevelAgents
                    ? agents.map((agent, index) => (
                        <Text key={agent.agentNumber} color={index === selectedAgentIndex ? 'suggestion' : undefined}>
                          {index === selectedAgentIndex ? '> ' : '  '}
                          #{agent.agentNumber} {agent.label}{' '}
                          <Text color={statusColor(agent.status)}>{agent.status}</Text>
                          <Text dimColor>
                            {' '}· {formatNumber(agent.tokens)} tok · {formatNumber(agent.toolCalls)} tools
                          </Text>
                        </Text>
                      ))
                    : phases.map((phase, index) => {
                        const phaseNode = phaseNodes[index] ?? null
                        const phaseAgents = agents.filter(agent => agent.phase === phase)
                        const phaseSummary = phaseNode
                          ? workflowTreeNodeAgentMetricSummary(phaseNode)
                          : buildWorkflowPhaseMetricSummary(
                              phase,
                              phaseAgents,
                            )
                        const selected = index === selectedPhaseIndex
                        return (
                          <Text key={phase} color={selected ? 'suggestion' : undefined}>
                            {selected ? '> ' : '  '}
                            {phase}{' '}
                            <Text dimColor>
                              · {phaseSummary.agentCount} agents · {phaseSummary.statusSummary}
                              {' '}· {formatNumber(phaseSummary.tokens)} tok
                              {' '}· {formatNumber(phaseSummary.toolCalls)} tools
                              {phaseSummary.elapsedMs > 0
                                ? ` · ${formatDuration(phaseSummary.elapsedMs, { mostSignificantOnly: true })}`
                                : ''}
                            </Text>
                          </Text>
                        )
                      })}
                </Box>
              ) : (
                loadRunLog(selectedRun.runId).slice(-8).map(line => (
                  <Text key={line} dimColor>{line}</Text>
                ))
              )}
            </Box>
          )}
          {message ? <Text color="warning">{message}</Text> : null}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'phase' ? (
        <Box flexDirection="column">
          <Text bold>{view.phase}</Text>
          <Text dimColor>{selectedActionHint}</Text>
          {agents.map((agent, index) => (
            <Text key={agent.agentNumber} color={index === selectedAgentIndex ? 'suggestion' : undefined}>
              {index === selectedAgentIndex ? '> ' : '  '}
              #{agent.agentNumber} {agent.label}{' '}
              <Text color={statusColor(agent.status)}>{agent.status}</Text>
              <Text dimColor>
                {' '}· {formatNumber(agent.tokens)} tok · {formatNumber(agent.toolCalls)} tools
              </Text>
            </Text>
          ))}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'agent' && currentAgent ? (
        <Box flexDirection="column">
          <Text bold>#{currentAgent.agentNumber} {currentAgent.label}</Text>
          <Text dimColor>{selectedActionHint}</Text>
          <Text color={statusColor(currentAgent.status)}>
            {currentAgent.status}
            <Text dimColor>
              {' '}· {formatNumber(currentAgent.tokens)} tok ·{' '}
              {formatNumber(currentAgent.toolCalls)} tools ·{' '}
              {formatDuration(workflowAgentElapsedMs(currentAgent), { mostSignificantOnly: true })}
            </Text>
          </Text>
          {[
            currentAgent.agentId ? `Agent ID: ${currentAgent.agentId}` : null,
            currentAgent.transcriptPath ? `Transcript: ${currentAgent.transcriptPath}` : null,
            currentAgent.remoteSessionId ? `Remote: ${currentAgent.remoteSessionId}` : null,
            currentAgent.promptPreview ? `Prompt: ${currentAgent.promptPreview}` : null,
            ...recentToolCallLines(currentAgent),
            currentAgent.resultPreview ? `Result: ${currentAgent.resultPreview}` : null,
            currentAgent.error ? `Error: ${currentAgent.error}` : null,
          ]
            .filter((line): line is string => Boolean(line))
            .slice(agentScroll, agentScroll + 8)
            .map(line => (
              <Text key={line} wrap="wrap">{compact(line, 220)}</Text>
            ))}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'save' ? (
        <Box flexDirection="column">
          <Text bold>{t('cmd.workflows.saveDialogTitle')}</Text>
          <Text>
            {t('cmd.workflows.saveDialogRun')}: {selectedRun.name}{' '}
            <Text dimColor>{selectedRun.runId}</Text>
          </Text>
          <Text>
            {t('cmd.workflows.saveDialogName')}: /
            {deriveWorkflowSaveName({
              runId: selectedRun.runId,
              metaName: selectedRun.name,
            })}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {(['project', 'user'] as const).map(scope => (
              <Text key={scope} color={view.scope === scope ? 'suggestion' : undefined}>
                {view.scope === scope ? '> ' : '  '}
                {scope === 'project'
                  ? t('cmd.workflows.saveScopeProject')
                  : t('cmd.workflows.saveScopeUser')}
              </Text>
            ))}
          </Box>
          <Text dimColor>{t('cmd.workflows.saveDialogHint')}</Text>
        </Box>
      ) : null}
    </Dialog>
  )
}
