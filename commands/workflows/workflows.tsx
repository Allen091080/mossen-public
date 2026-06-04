import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getProjectRoot } from '../../bootstrap/state.js'
import { t } from '../../utils/i18n/index.js'
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
  pauseWorkflowTask,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

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

function renderRunDetail(runId: string): string {
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

/**
 * Save a run's script as a reusable named workflow (S5 "Save as").
 * `save <runId> [name] [--user]` — default scope is project (.mossen/workflows),
 * `--user` writes to ~/.mossen/workflows. The saved file becomes a /<name>
 * command on next command load.
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
  const task = context.getAppState().tasks?.[runId]
  if (!task || task.type !== 'local_workflow') {
    return t('cmd.workflows.notFound', { runId })
  }
  if (task.status === 'paused') {
    return t('cmd.workflows.alreadyPaused', { runId })
  }
  if (task.status !== 'running') {
    return t('cmd.workflows.taskNotRunning', { runId })
  }
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  return pauseWorkflowTask(runId, setAppState)
    ? t('cmd.workflows.paused', { runId })
    : t('cmd.workflows.alreadyPaused', { runId })
}

function resumeTaskRun(
  runId: string | undefined,
  context: LocalJSXCommandContext,
): WorkflowCommandResult {
  if (!runId) return { message: t('cmd.workflows.resumeTaskUsage') }
  const task = context.getAppState().tasks?.[runId]
  if (!task || task.type !== 'local_workflow') {
    return { message: t('cmd.workflows.notFound', { runId }) }
  }
  if (task.status !== 'paused') {
    return { message: t('cmd.workflows.notPaused', { runId }) }
  }
  const meta = loadRunMeta(runId)
  return {
    message: t('cmd.workflows.resumeQueued', { runId }),
    nextInput: buildWorkflowResumeNextInput(
      runId,
      meta?.scriptPath ?? task.scriptPath ?? runScriptPath(runId),
      meta?.args ?? task.args,
    ),
  }
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

  if (tokens[0] === 'pause') {
    onDone(pauseTaskRun(tokens[1], context), { display: 'system' })
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

  if (tokens[0] === 'ultracode') {
    onDone(ultracode(tokens.slice(1)))
    return null
  }

  // Otherwise treat the first token as a runId to inspect.
  onDone(renderRunDetail(tokens[0]!))
  return null
}
