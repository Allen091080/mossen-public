import React from 'react'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { TranscriptMessage } from '../../types/logs.js'
import { t } from '../../utils/i18n/index.js'
import { formatDuration, formatNumber } from '../../utils/format.js'
import { extractTextContent } from '../../utils/messages.js'
import {
  listWorkflowRuns,
  loadRunLog,
  loadRunMeta,
  runScriptPath,
  workflowReportPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import { isUltracodeActive, setUltracodeActive } from '../../bootstrap/state.js'
import {
  killWorkflowTask,
  pauseWorkflowTask,
  retryWorkflowAgent,
  skipWorkflowAgent,
  type LocalWorkflowTaskState,
  type WorkflowAgentTaskProgress,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  historyAgentsForRun,
  WorkflowRunsDialog,
} from './WorkflowRunsDialog.js'
import { saveRun } from './saveWorkflow.js'
import { exportWorkflowRunReport } from './exportWorkflowReport.js'
import {
  buildWorkflowResumeNextInput,
  buildWorkflowResumeResult,
  isResumableWorkflowRunStatus,
  resumeRunFromJournal,
  type WorkflowCommandResult,
} from './resumeWorkflow.js'
import {
  buildWorkflowPhaseMetricSummary,
  buildWorkflowRunMetricSummary,
  formatWorkflowPhaseMetricSummary,
  workflowAgentElapsedMs,
  workflowFiniteNumber,
} from './progressSummary.js'
import {
  buildWorkflowVerificationSummary,
  workflowRuntimeStatusToMachineState,
} from './workflowProgressTree.js'
import {
  flushSessionStorage,
  loadTranscriptFile,
} from '../../utils/sessionStorage.js'

type WorkflowAgentSnapshot = Partial<WorkflowAgentTaskProgress> & {
  agentNumber?: number
  label?: string
  phase?: string | null
  status?: string
}

type WorkflowTaskSnapshot = Partial<LocalWorkflowTaskState> & {
  type?: string
  status?: string
  id?: string
  runId?: string
  workflowRunId?: string
  workflowName?: string
  scriptPath?: string
  args?: unknown
  agents?: WorkflowAgentSnapshot[]
}

type WorkflowTaskLookup = {
  taskId: string
  workflowRunId: string
  task: WorkflowTaskSnapshot
}

function statusGlyph(status: WorkflowRunMeta['status']): string {
  switch (status) {
    case 'running':
      return '▶'
    case 'paused':
      return 'Ⅱ'
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    default:
      return '•'
  }
}

function compact(value: unknown, maxLength = 180): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function resultBlock(value: unknown, maxLength = 4000): string[] {
  if (value == null) return []
  const text = String(value).trim()
  if (!text) return []
  const rendered =
    text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
  return [
    `${t('cmd.workflows.result')}:`,
    ...rendered.split('\n').map(line => `  ${line}`),
  ]
}

function phaseTitlesForTask(task: WorkflowTaskSnapshot): string[] {
  const titles: string[] = []
  const add = (title: unknown) => {
    const value = typeof title === 'string' ? title.trim() : ''
    if (value && !titles.includes(value)) titles.push(value)
  }
  for (const phase of task.phaseDefinitions ?? []) add(phase.title)
  for (const phase of task.phases ?? []) add(phase)
  for (const agent of task.agents ?? []) add(agent.phase ?? undefined)
  return titles
}

function recentToolCalls(
  agent: WorkflowAgentSnapshot,
): Array<{ name: string; summary?: string }> {
  return agent.recentToolCalls?.length
    ? agent.recentToolCalls
    : agent.lastToolName
      ? [
          {
            name: agent.lastToolName,
            ...(agent.lastToolSummary ? { summary: agent.lastToolSummary } : {}),
          },
        ]
      : []
}

function formatToolCall(tool: { name: string; summary?: string }): string {
  return `${tool.name}${tool.summary ? ` ${tool.summary}` : ''}`
}

function workflowTranscriptMessageText(message: TranscriptMessage): string | null {
  if (message.type === 'user') {
    const text = compact(extractTextContent(message.message?.content, '\n'), 240)
    return text ? `User: ${text}` : null
  }
  if (message.type === 'assistant') {
    const text = compact(extractTextContent(message.message?.content, '\n'), 240)
    return text ? `Assistant: ${text}` : null
  }
  if (message.type === 'attachment') {
    const attachmentType =
      typeof message.attachment?.type === 'string'
        ? message.attachment.type
        : 'attachment'
    return `Attachment: ${attachmentType}`
  }
  if (message.type === 'system') {
    const subtype =
      typeof message.subtype === 'string' ? `:${message.subtype}` : ''
    return `System${subtype}`
  }
  return null
}

async function workflowAgentTranscriptTail(
  agent: WorkflowAgentSnapshot,
  maxLines = 8,
): Promise<string[]> {
  if (!agent.transcriptPath) return []
  try {
    await flushSessionStorage()
    const transcript = await loadTranscriptFile(agent.transcriptPath, {
      keepAllLeaves: true,
    })
    const allMessages = Array.from(transcript.messages.values())
    const scopedMessages = agent.agentId
      ? allMessages.filter(message => message.agentId === agent.agentId)
      : allMessages
    const messages = (scopedMessages.length > 0 ? scopedMessages : allMessages)
      .map(workflowTranscriptMessageText)
      .filter((line): line is string => Boolean(line))
    return messages.slice(-maxLines)
  } catch {
    return ['Transcript unavailable']
  }
}

function agentLine(agent: WorkflowAgentSnapshot, now = Date.now()): string {
  const parts = [
    `#${agent.agentNumber ?? '?'} ${agent.phase ? `[${agent.phase}] ` : ''}${agent.label ?? 'agent'}`,
    agent.status ?? 'unknown',
    `${formatNumber(workflowFiniteNumber(agent.tokens))} tok`,
    `${formatNumber(workflowFiniteNumber(agent.toolCalls))} tools`,
  ]
  const elapsed = workflowAgentElapsedMs(agent, now)
  if (elapsed > 0) parts.push(formatDuration(elapsed, { mostSignificantOnly: true }))
  if (agent.agentId) parts.push(`agentId: ${agent.agentId}`)
  if (agent.transcriptPath) parts.push(`transcript: ${agent.transcriptPath}`)
  const tool = compact(
    recentToolCalls(agent).at(-1)
      ? formatToolCall(recentToolCalls(agent).at(-1)!)
      : null,
    80,
  )
  if (agent.remoteSessionId) parts.push(`remote: ${agent.remoteSessionId}`)
  const prompt = compact(agent.promptPreview, 90)
  if (prompt) parts.push(`${t('cmd.workflows.prompt')}: ${prompt}`)
  if (tool) parts.push(tool)
  const result = compact(agent.resultPreview, 100)
  if (result) parts.push(result)
  if (agent.error) parts.push(`error: ${agent.error}`)
  return `  ${parts.join(' · ')}`
}

function renderLiveRunDetail(
  runId: string,
  task: WorkflowTaskSnapshot,
): string {
  const now = Date.now()
  const agents = task.agents ?? []
  const phaseTitles = phaseTitlesForTask(task)
  const runSummary = buildWorkflowRunMetricSummary(task, agents, now)
  const verification = buildWorkflowVerificationSummary({
    state: workflowRuntimeStatusToMachineState(task.status, {
      paused: task.paused,
    }),
    result: task.result,
    failures: task.failures,
    reportPath: workflowReportPath(task.workflowRunId ?? task.runId ?? runId),
  })
  const header = [
    `${statusGlyph((task.status as WorkflowRunMeta['status']) ?? 'running')} ${task.workflowName ?? runId} (${task.workflowRunId ?? task.runId ?? runId})`,
    `${t('cmd.workflows.status')}: ${task.paused ? 'paused' : (task.status ?? 'unknown')}`,
    `${t('cmd.workflows.agents')}: ${runSummary.agentCount}`,
    `${t('cmd.workflows.tokens')}: ~${formatNumber(runSummary.tokens)}`,
    `${t('cmd.workflows.duration')}: ${formatDuration(runSummary.elapsedMs, { mostSignificantOnly: true })}`,
    `${t('cmd.workflows.tools')}: ${formatNumber(runSummary.toolCalls)}`,
    task.failures?.length
      ? `${t('cmd.workflows.failures')}: ${task.failures.length}`
      : null,
    `verification: ${verification.state}${verification.summary ? ` · ${verification.summary}` : ''}`,
    `report: ${workflowReportPath(task.workflowRunId ?? task.runId ?? runId)}`,
  ].filter((line): line is string => line !== null)

  const phaseLines =
    phaseTitles.length > 0
      ? [
          t('cmd.workflows.phases'),
          ...phaseTitles.map((phase, index) => {
            const phaseAgents = agents.filter(agent => agent.phase === phase)
            const summary = buildWorkflowPhaseMetricSummary(
              phase,
              phaseAgents,
              now,
            )
            return `  ${index + 1}. ${formatWorkflowPhaseMetricSummary(summary)}`
          }),
        ]
      : []

  const agentLines =
    agents.length > 0
      ? [t('cmd.workflows.agentsDetail'), ...agents.map(agent => agentLine(agent, now))]
      : []

  const resultLines = resultBlock(task.result)
  const log = task.logs ?? task.log ?? []
  const progressLines =
    log.length > 0
      ? [t('cmd.workflows.progress'), ...log.slice(-10).map(line => `  ${line}`)]
      : []

  const controls = t('cmd.workflows.controlsHint', { runId })
  return [
    ...header,
    '',
    ...resultLines,
    ...(resultLines.length > 0 ? [''] : []),
    ...phaseLines,
    ...(phaseLines.length > 0 ? [''] : []),
    ...agentLines,
    ...(agentLines.length > 0 ? [''] : []),
    ...progressLines,
    ...(progressLines.length > 0 ? [''] : []),
    controls,
  ].join('\n')
}

function renderRunDetail(
  runId: string,
  tasks?: Record<string, unknown> | null,
): string {
  const live = findWorkflowTaskForRun(tasks, runId)
  if (live) return renderLiveRunDetail(runId, live.task)

  const runs = listWorkflowRuns()
  const meta = runs.find(r => r.runId === runId)
  if (!meta) {
    return t('cmd.workflows.notFound', { runId })
  }
  const log = loadRunLog(runId)
  const historyAgents = historyAgentsForRun(runId)
  if (historyAgents.length > 0) {
    return renderLiveRunDetail(runId, {
      type: 'local_workflow',
      status: meta.status,
      id: meta.runId,
      runId: meta.runId,
      workflowRunId: meta.runId,
      workflowName: meta.workflowName,
      startTime: Date.parse(meta.createdAt) || undefined,
      ...(meta.durationMs != null
        ? { endTime: (Date.parse(meta.createdAt) || Date.now()) + meta.durationMs }
        : {}),
      agentCount: meta.agentCount ?? historyAgents.length,
      totalToolCalls:
        meta.totalToolCalls ??
        historyAgents.reduce(
          (sum, agent) => sum + workflowFiniteNumber(agent.toolCalls),
          0,
        ),
      tokensSpent:
        meta.tokensSpent ??
        historyAgents.reduce(
          (sum, agent) => sum + workflowFiniteNumber(agent.tokens),
          0,
        ),
      phaseDefinitions: meta.phases,
      phases: meta.phases?.map(phase => phase.title) ?? [],
      failures: meta.failures,
      durationMs: meta.durationMs,
      result: meta.result,
      agents: historyAgents,
      log,
      logs: log,
    })
  }
  const header = [
    `${statusGlyph(meta.status)} ${meta.workflowName} (${meta.runId})`,
    `${t('cmd.workflows.status')}: ${meta.status}`,
    meta.agentCount != null
      ? `${t('cmd.workflows.agents')}: ${meta.agentCount}`
      : null,
    meta.tokensSpent != null
      ? `${t('cmd.workflows.tokens')}: ~${meta.tokensSpent}`
      : null,
    meta.durationMs != null
      ? `${t('cmd.workflows.duration')}: ${meta.durationMs}ms`
      : null,
    meta.failures?.length
      ? `${t('cmd.workflows.failures')}: ${meta.failures.length}`
      : null,
    `verification: ${buildWorkflowVerificationSummary({
      state: workflowRuntimeStatusToMachineState(meta.status),
      result: meta.result,
      failures: meta.failures,
      reportPath: workflowReportPath(meta.runId),
    }).state}`,
    `report: ${workflowReportPath(meta.runId)}`,
  ].filter((l): l is string => l !== null)
  const body =
    log.length > 0
      ? [t('cmd.workflows.progress'), ...log.map(l => `  ${l}`)]
      : [t('cmd.workflows.noProgress')]
  const resultLines = resultBlock(meta.result)
  return [
    ...header,
    '',
    ...resultLines,
    ...(resultLines.length > 0 ? [''] : []),
    ...body,
  ].join('\n')
}

async function renderAgentDetail(
  runId: string | undefined,
  agentId: string | undefined,
  tasks: Record<string, unknown> | null | undefined,
): Promise<string> {
  const agentNumber = parseWorkflowAgentNumber(agentId)
  if (!runId || !agentNumber) return t('cmd.workflows.agentDetailUsage')
  const found = findWorkflowTaskForRun(tasks, runId)
  const agentSource = found?.task.agents ?? historyAgentsForRun(runId)
  if (!found && agentSource.length === 0) {
    return loadRunMeta(runId)
      ? t('cmd.workflows.agentNotFound', {
          runId,
          agentNumber: String(agentNumber),
        })
      : t('cmd.workflows.notFound', { runId })
  }
  const agent = agentSource.find(
    item => item.agentNumber === agentNumber,
  )
  if (!agent) {
    return t('cmd.workflows.agentNotFound', {
      runId,
      agentNumber: String(agentNumber),
    })
  }

  const lines = [
    `${t('cmd.workflows.agentDetail')}: #${agentNumber} ${agent.label ?? 'agent'}`,
    `${t('cmd.workflows.status')}: ${agent.status ?? 'unknown'}`,
    agent.phase ? `${t('cmd.workflows.phase')}: ${agent.phase}` : null,
    `${t('cmd.workflows.tokens')}: ~${formatNumber(workflowFiniteNumber(agent.tokens))}`,
    `${t('cmd.workflows.tools')}: ${formatNumber(workflowFiniteNumber(agent.toolCalls))}`,
    workflowAgentElapsedMs(agent) > 0
      ? `${t('cmd.workflows.duration')}: ${formatDuration(workflowAgentElapsedMs(agent), { mostSignificantOnly: true })}`
      : null,
    agent.agentType ? `agentType: ${agent.agentType}` : null,
    agent.model ? `model: ${agent.model}` : null,
    agent.isolation ? `isolation: ${agent.isolation}` : null,
    agent.agentId ? `agentId: ${agent.agentId}` : null,
    agent.transcriptPath ? `transcript: ${agent.transcriptPath}` : null,
    agent.remoteSessionId ? `remote: ${agent.remoteSessionId}` : null,
    compact(agent.promptPreview)
      ? `${t('cmd.workflows.prompt')}: ${compact(agent.promptPreview)}`
      : null,
    ...recentToolCalls(agent).map((tool, index, tools) =>
      `${t('cmd.workflows.lastTool')}${tools.length > 1 ? ` ${index + 1}` : ''}: ${compact(formatToolCall(tool))}`,
    ),
    compact(agent.resultPreview)
      ? `${t('cmd.workflows.result')}: ${compact(agent.resultPreview)}`
      : null,
    agent.error ? `error: ${agent.error}` : null,
    ...(agent.transcriptPath
      ? [
          '',
          'Transcript tail:',
          ...(await workflowAgentTranscriptTail(agent)).map(line => `  ${line}`),
        ]
      : []),
    '',
    t('cmd.workflows.agentControlsHint', {
      runId,
      agentNumber: String(agentNumber),
    }),
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

export { buildWorkflowResumeNextInput }

function findWorkflowTaskForRun(
  tasks: Record<string, unknown> | null | undefined,
  runOrTaskId: string,
): WorkflowTaskLookup | null {
  if (!tasks) return null
  const exact = tasks[runOrTaskId] as WorkflowTaskLookup['task'] | undefined
  if (exact?.type === 'local_workflow') {
    return {
      taskId: exact.id ?? runOrTaskId,
      workflowRunId: exact.workflowRunId ?? exact.runId ?? runOrTaskId,
      task: exact,
    }
  }

  for (const [taskId, task] of Object.entries(tasks)) {
    const candidate = task as WorkflowTaskLookup['task'] | undefined
    if (
      candidate?.type === 'local_workflow' &&
      (candidate.id === runOrTaskId ||
        candidate.workflowRunId === runOrTaskId ||
        candidate.runId === runOrTaskId)
    ) {
      return {
        taskId: candidate.id ?? taskId,
        workflowRunId: candidate.workflowRunId ?? candidate.runId ?? runOrTaskId,
        task: candidate,
      }
    }
  }
  return null
}

function pauseTaskRun(
  runId: string | undefined,
  context: LocalJSXCommandContext,
): string {
  if (!runId) return t('cmd.workflows.pauseUsage')
  const found = findWorkflowTaskForRun(context.getAppState().tasks, runId)
  if (!found) {
    return t('cmd.workflows.notFound', { runId })
  }
  const { task, taskId } = found
  if (task.status === 'paused') {
    return t('cmd.workflows.alreadyPaused', { runId })
  }
  if (task.status !== 'running') {
    return t('cmd.workflows.taskNotRunning', { runId })
  }
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  return pauseWorkflowTask(taskId, setAppState)
    ? t('cmd.workflows.paused', { runId })
    : t('cmd.workflows.alreadyPaused', { runId })
}

function stopTaskRun(
  runId: string | undefined,
  context: LocalJSXCommandContext,
): string {
  if (!runId) return t('cmd.workflows.stopUsage')
  const found = findWorkflowTaskForRun(context.getAppState().tasks, runId)
  if (!found) {
    return t('cmd.workflows.notFound', { runId })
  }
  const { task, taskId } = found
  if (task.status !== 'running' && task.status !== 'paused') {
    return t('cmd.workflows.taskNotRunning', { runId })
  }
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  killWorkflowTask(taskId, setAppState)
  return t('cmd.workflows.stopped', { runId })
}

function resumeTaskRun(
  runId: string | undefined,
  context: LocalJSXCommandContext,
): WorkflowCommandResult {
  if (!runId) return { message: t('cmd.workflows.resumeTaskUsage') }
  const found = findWorkflowTaskForRun(context.getAppState().tasks, runId)
  if (!found) {
    return { message: t('cmd.workflows.notFound', { runId }) }
  }
  const { task, workflowRunId } = found
  if (!isResumableWorkflowTaskStatus(task.status)) {
    return { message: t('cmd.workflows.notPaused', { runId }) }
  }
  const meta = loadRunMeta(workflowRunId)
  return buildWorkflowResumeResult(
    workflowRunId,
    meta?.scriptPath ?? task.scriptPath ?? runScriptPath(workflowRunId),
    meta?.args ?? task.args,
    runId,
  )
}

function isResumableWorkflowTaskStatus(status: string | undefined): boolean {
  return isResumableWorkflowRunStatus(status)
}

function parseWorkflowAgentNumber(agentId: string | undefined): number | null {
  const parsed = Number.parseInt(agentId ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function hasVisibleAgent(
  task: WorkflowTaskLookup['task'],
  agentNumber: number,
): boolean {
  const agents = task.agents ?? []
  return agents.length === 0 || agents.some(agent => agent.agentNumber === agentNumber)
}

function isRetryableWorkflowAgent(
  task: WorkflowTaskLookup['task'],
  agentNumber: number,
): boolean {
  const agents = task.agents ?? []
  if (agents.length === 0) return true
  return agents.some(
    agent => agent.agentNumber === agentNumber && agent.status === 'running',
  )
}

function stopAgentRun(
  runId: string | undefined,
  agentId: string | undefined,
  context: LocalJSXCommandContext,
): string {
  const agentNumber = parseWorkflowAgentNumber(agentId)
  if (!runId || !agentNumber) return t('cmd.workflows.stopAgentUsage')
  const found = findWorkflowTaskForRun(context.getAppState().tasks, runId)
  if (!found) {
    return t('cmd.workflows.notFound', { runId })
  }
  if (!hasVisibleAgent(found.task, agentNumber)) {
    return t('cmd.workflows.agentNotFound', {
      runId,
      agentNumber: String(agentNumber),
    })
  }
  if (found.task.status !== 'running') {
    return t('cmd.workflows.taskNotRunning', { runId })
  }
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  skipWorkflowAgent(found.taskId, agentNumber, setAppState)
  return t('cmd.workflows.agentStopped', {
    runId,
    agentNumber: String(agentNumber),
  })
}

function retryAgentRun(
  runId: string | undefined,
  agentId: string | undefined,
  context: LocalJSXCommandContext,
): string {
  const agentNumber = parseWorkflowAgentNumber(agentId)
  if (!runId || !agentNumber) return t('cmd.workflows.retryAgentUsage')
  const found = findWorkflowTaskForRun(context.getAppState().tasks, runId)
  if (!found) {
    return t('cmd.workflows.notFound', { runId })
  }
  if (!hasVisibleAgent(found.task, agentNumber)) {
    return t('cmd.workflows.agentNotFound', {
      runId,
      agentNumber: String(agentNumber),
    })
  }
  if (found.task.status !== 'running') {
    return t('cmd.workflows.taskNotRunning', { runId })
  }
  if (!isRetryableWorkflowAgent(found.task, agentNumber)) {
    return t('cmd.workflows.agentNotRunning', {
      runId,
      agentNumber: String(agentNumber),
    })
  }
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  retryWorkflowAgent(found.taskId, agentNumber, setAppState)
  return t('cmd.workflows.agentRetryQueued', {
    runId,
    agentNumber: String(agentNumber),
  })
}

/** `ultracode [on|off]` — view or toggle standing orchestration mode (S6). */
function ultracode(args: string[]): string {
  const arg = (args[0] ?? '').toLowerCase()
  if (arg === 'off' || arg === 'stop' || arg === 'clear') {
    setUltracodeActive(false)
    return t('cmd.workflows.ultracodeOff')
  }
  if (arg === 'on') {
    setUltracodeActive(true)
    return t('cmd.workflows.ultracodeOn')
  }
  return isUltracodeActive()
    ? t('cmd.workflows.ultracodeStatusOn')
    : t('cmd.workflows.ultracodeStatusOff')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return <WorkflowRunsDialog onDone={onDone} />
  }

  if (tokens[0] === 'save') {
    onDone(saveRun(tokens.slice(1)))
    return null
  }

  if (tokens[0] === 'export' || tokens[0] === 'report') {
    onDone(exportWorkflowRunReport(tokens[1]).message, { display: 'system' })
    return null
  }

  if (tokens[0] === 'resume') {
    const result = resumeRunFromJournal(tokens[1])
    onDone(result.message, {
      display: 'system',
      ...(result.nextInput
        ? { nextInput: result.nextInput, submitNextInput: true }
        : {}),
    })
    return null
  }

  if (tokens[0] === 'agent') {
    onDone(
      await renderAgentDetail(tokens[1], tokens[2], context.getAppState().tasks),
      { display: 'system' },
    )
    return null
  }

  if (tokens[0] === 'pause') {
    onDone(pauseTaskRun(tokens[1], context), { display: 'system' })
    return null
  }

  if (tokens[0] === 'stop' || tokens[0] === 'kill') {
    onDone(stopTaskRun(tokens[1], context), { display: 'system' })
    return null
  }

  if (tokens[0] === 'resume-task') {
    const result = resumeTaskRun(tokens[1], context)
    onDone(result.message, {
      display: 'system',
      ...(result.nextInput
        ? { nextInput: result.nextInput, submitNextInput: true }
        : {}),
    })
    return null
  }

  if (tokens[0] === 'stop-agent' || tokens[0] === 'skip-agent') {
    onDone(stopAgentRun(tokens[1], tokens[2], context), { display: 'system' })
    return null
  }

  if (tokens[0] === 'retry-agent' || tokens[0] === 'restart-agent') {
    onDone(retryAgentRun(tokens[1], tokens[2], context), {
      display: 'system',
    })
    return null
  }

  if (tokens[0] === 'ultracode') {
    onDone(ultracode(tokens.slice(1)))
    return null
  }

  // Otherwise treat the first token as a runId to inspect.
  onDone(renderRunDetail(tokens[0]!, context.getAppState().tasks))
  return null
}
