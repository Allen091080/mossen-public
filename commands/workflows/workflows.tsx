import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getProjectRoot } from '../../bootstrap/state.js'
import { t } from '../../utils/i18n/index.js'
import { formatDuration, formatNumber } from '../../utils/format.js'
import {
  listWorkflowRuns,
  loadRunLog,
  loadRunMeta,
  loadRunScript,
  runScriptPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
} from '../../tools/WorkflowTool/savedWorkflows.js'
import { isUltracodeActive, setUltracodeActive } from '../../bootstrap/state.js'
import { WORKFLOW_TOOL_NAME } from '../../tools/WorkflowTool/constants.js'
import {
  buildWorkflowResumePrompt,
  killWorkflowTask,
  pauseWorkflowTask,
  retryWorkflowAgent,
  skipWorkflowAgent,
  type LocalWorkflowTaskState,
  type WorkflowAgentTaskProgress,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

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

function renderRunList(): string {
  const runs = listWorkflowRuns()
  if (runs.length === 0) {
    return [t('cmd.workflows.empty'), t('cmd.workflows.emptyHint')].join('\n')
  }
  const lines = runs.map(r => {
    const agents = r.agentCount != null ? `${r.agentCount} agent(s)` : ''
    const toks = r.tokensSpent != null ? `~${r.tokensSpent} tok` : ''
    const meta = [agents, toks].filter(Boolean).join(', ')
    return `  ${statusGlyph(r.status)} ${r.runId}  ${r.workflowName}${meta ? `  (${meta})` : ''}`
  })
  return [
    t('cmd.workflows.listTitle'),
    ...lines,
    '',
    t('cmd.workflows.detailHint'),
  ].join('\n')
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compact(value: unknown, maxLength = 180): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function taskElapsedMs(task: WorkflowTaskSnapshot, now = Date.now()): number {
  const start = asNumber(task.startTime)
  if (!start) return 0
  const end =
    task.status === 'running' || task.status === 'paused'
      ? now
      : asNumber(task.endTime) || now
  return Math.max(0, end - start - asNumber(task.totalPausedMs))
}

function agentElapsedMs(agent: WorkflowAgentSnapshot, now = Date.now()): number {
  if (typeof agent.durationMs === 'number') return Math.max(0, agent.durationMs)
  const startedAt = asNumber(agent.startedAt)
  if (!startedAt) return 0
  return Math.max(0, now - startedAt)
}

function statusSummary(agents: readonly WorkflowAgentSnapshot[]): string {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const status = agent.status ?? 'unknown'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
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

function agentLine(agent: WorkflowAgentSnapshot, now = Date.now()): string {
  const parts = [
    `#${agent.agentNumber ?? '?'} ${agent.phase ? `[${agent.phase}] ` : ''}${agent.label ?? 'agent'}`,
    agent.status ?? 'unknown',
    `${formatNumber(asNumber(agent.tokens))} tok`,
    `${formatNumber(asNumber(agent.toolCalls))} tools`,
  ]
  const elapsed = agentElapsedMs(agent, now)
  if (elapsed > 0) parts.push(formatDuration(elapsed, { mostSignificantOnly: true }))
  const tool = compact(
    agent.lastToolName
      ? `${agent.lastToolName}${agent.lastToolSummary ? ` ${agent.lastToolSummary}` : ''}`
      : null,
    80,
  )
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
  const header = [
    `${statusGlyph((task.status as WorkflowRunMeta['status']) ?? 'running')} ${task.workflowName ?? runId} (${task.workflowRunId ?? task.runId ?? runId})`,
    `${t('cmd.workflows.status')}: ${task.paused ? 'paused' : (task.status ?? 'unknown')}`,
    `${t('cmd.workflows.agents')}: ${task.agentCount ?? agents.length}`,
    `${t('cmd.workflows.tokens')}: ~${formatNumber(asNumber(task.tokensSpent))}`,
    `${t('cmd.workflows.duration')}: ${formatDuration(taskElapsedMs(task, now), { mostSignificantOnly: true })}`,
    `${t('cmd.workflows.tools')}: ${formatNumber(asNumber(task.totalToolCalls))}`,
    task.failures?.length
      ? `${t('cmd.workflows.failures')}: ${task.failures.length}`
      : null,
  ].filter((line): line is string => line !== null)

  const phaseLines =
    phaseTitles.length > 0
      ? [
          t('cmd.workflows.phases'),
          ...phaseTitles.map((phase, index) => {
            const phaseAgents = agents.filter(agent => agent.phase === phase)
            const tokens = phaseAgents.reduce(
              (sum, agent) => sum + asNumber(agent.tokens),
              0,
            )
            const tools = phaseAgents.reduce(
              (sum, agent) => sum + asNumber(agent.toolCalls),
              0,
            )
            const elapsed = phaseAgents.reduce(
              (sum, agent) => sum + agentElapsedMs(agent, now),
              0,
            )
            const counts = statusSummary(phaseAgents)
            const meta = [
              `${phaseAgents.length} agent(s)`,
              counts,
              `${formatNumber(tokens)} tok`,
              `${formatNumber(tools)} tools`,
              elapsed > 0
                ? formatDuration(elapsed, { mostSignificantOnly: true })
                : null,
            ].filter((part): part is string => Boolean(part))
            return `  ${index + 1}. ${phase}${meta.length ? ` · ${meta.join(' · ')}` : ''}`
          }),
        ]
      : []

  const agentLines =
    agents.length > 0
      ? [t('cmd.workflows.agentsDetail'), ...agents.map(agent => agentLine(agent, now))]
      : []

  const log = task.logs ?? task.log ?? []
  const progressLines =
    log.length > 0
      ? [t('cmd.workflows.progress'), ...log.slice(-10).map(line => `  ${line}`)]
      : []

  const controls = t('cmd.workflows.controlsHint', { runId })
  return [
    ...header,
    '',
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
  ].filter((l): l is string => l !== null)
  const body =
    log.length > 0
      ? [t('cmd.workflows.progress'), ...log.map(l => `  ${l}`)]
      : [t('cmd.workflows.noProgress')]
  return [...header, '', ...body].join('\n')
}

function renderAgentDetail(
  runId: string | undefined,
  agentId: string | undefined,
  tasks: Record<string, unknown> | null | undefined,
): string {
  const agentNumber = parseWorkflowAgentNumber(agentId)
  if (!runId || !agentNumber) return t('cmd.workflows.agentDetailUsage')
  const found = findWorkflowTaskForRun(tasks, runId)
  if (!found) return t('cmd.workflows.notFound', { runId })
  const agent = (found.task.agents ?? []).find(
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
    `${t('cmd.workflows.tokens')}: ~${formatNumber(asNumber(agent.tokens))}`,
    `${t('cmd.workflows.tools')}: ${formatNumber(asNumber(agent.toolCalls))}`,
    agentElapsedMs(agent) > 0
      ? `${t('cmd.workflows.duration')}: ${formatDuration(agentElapsedMs(agent), { mostSignificantOnly: true })}`
      : null,
    agent.agentType ? `agentType: ${agent.agentType}` : null,
    agent.model ? `model: ${agent.model}` : null,
    agent.isolation ? `isolation: ${agent.isolation}` : null,
    compact(agent.promptPreview)
      ? `${t('cmd.workflows.prompt')}: ${compact(agent.promptPreview)}`
      : null,
    agent.lastToolName
      ? `${t('cmd.workflows.lastTool')}: ${compact(`${agent.lastToolName}${agent.lastToolSummary ? ` ${agent.lastToolSummary}` : ''}`)}`
      : null,
    compact(agent.resultPreview)
      ? `${t('cmd.workflows.result')}: ${compact(agent.resultPreview)}`
      : null,
    agent.error ? `error: ${agent.error}` : null,
    '',
    t('cmd.workflows.agentControlsHint', {
      runId,
      agentNumber: String(agentNumber),
    }),
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

/**
 * Save a run's script as a reusable named workflow (S5 "Save as").
 * `save <runId> [name] [--user]` — default scope is the project workflow
 * directory, `--user` writes to ~/.mossen/workflows. The saved file becomes a
 * /<name> command on next command load.
 */
function saveRun(args: string[]): string {
  const useUser = args.includes('--user')
  const positional = args.filter(a => a !== '--user')
  const runId = positional[0]
  if (!runId) return t('cmd.workflows.saveUsage')
  const script = loadRunScript(runId)
  if (script == null) return t('cmd.workflows.notFound', { runId })

  // Derive the saved name: explicit arg, else the workflow's meta name, else
  // the runId. Sanitize to a filesystem- and command-safe slug.
  const explicit = positional[1]
  const metaName = listWorkflowRuns().find(r => r.runId === runId)?.workflowName
  const rawName = explicit || metaName || runId
  const name = rawName.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!name) return t('cmd.workflows.saveBadName')

  const dir = useUser
    ? getUserWorkflowsDir()
    : getProjectWorkflowsDir(getProjectRoot())
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${name}.js`)
    writeFileSync(dest, script, 'utf8')
    return t('cmd.workflows.saved', {
      name,
      scope: useUser ? 'user' : 'project',
      path: dest,
    })
  } catch (err) {
    return t('cmd.workflows.saveFailed', { error: (err as Error).message })
  }
}

export function buildWorkflowResumeNextInput(
  runId: string,
  scriptPath: string,
  args?: unknown,
): string {
  return (
    buildWorkflowResumePrompt({ runId, scriptPath, args }) ??
    `Resume workflow run ${runId} using the ${WORKFLOW_TOOL_NAME} tool.`
  )
}

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

function resumeRun(args: string[]): { message: string; nextInput?: string } {
  const runId = args[0]
  if (!runId) return { message: t('cmd.workflows.resumeUsage') }
  const script = loadRunScript(runId)
  if (script == null) return { message: t('cmd.workflows.notFound', { runId }) }
  const meta = loadRunMeta(runId)
  return {
    message: t('cmd.workflows.resumeQueued', { runId }),
    nextInput: buildWorkflowResumeNextInput(
      runId,
      meta?.scriptPath ?? runScriptPath(runId),
      meta?.args,
    ),
  }
}

type WorkflowCommandResult = { message: string; nextInput?: string }

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
  if (task.status !== 'paused') {
    return { message: t('cmd.workflows.notPaused', { runId }) }
  }
  const meta = loadRunMeta(workflowRunId)
  return {
    message: t('cmd.workflows.resumeQueued', { runId }),
    nextInput: buildWorkflowResumeNextInput(
      workflowRunId,
      meta?.scriptPath ?? task.scriptPath ?? runScriptPath(workflowRunId),
      meta?.args ?? task.args,
    ),
  }
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
): Promise<null> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    onDone(renderRunList())
    return null
  }

  if (tokens[0] === 'save') {
    onDone(saveRun(tokens.slice(1)))
    return null
  }

  if (tokens[0] === 'resume') {
    const result = resumeRun(tokens.slice(1))
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
      renderAgentDetail(tokens[1], tokens[2], context.getAppState().tasks),
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
