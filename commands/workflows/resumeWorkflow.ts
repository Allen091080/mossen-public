import { WORKFLOW_TOOL_NAME } from '../../tools/WorkflowTool/constants.js'
import {
  loadRunMeta,
  loadRunScript,
  runScriptPath,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import { buildWorkflowResumePrompt } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { t } from '../../utils/i18n/index.js'

export type WorkflowCommandResult = { message: string; nextInput?: string }

export function isResumableWorkflowRunStatus(status: string | undefined): boolean {
  return status === 'paused' || status === 'killed'
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

export function buildWorkflowResumeResult(
  runId: string,
  scriptPath: string,
  args?: unknown,
  messageRunId = runId,
): WorkflowCommandResult {
  return {
    message: t('cmd.workflows.resumeQueued', { runId: messageRunId }),
    nextInput: buildWorkflowResumeNextInput(runId, scriptPath, args),
  }
}

export function resumeRunFromJournal(
  runId: string | undefined,
): WorkflowCommandResult {
  if (!runId) return { message: t('cmd.workflows.resumeUsage') }
  const script = loadRunScript(runId)
  if (script == null) return { message: t('cmd.workflows.notFound', { runId }) }
  const meta = loadRunMeta(runId)
  if (!meta) return { message: t('cmd.workflows.notFound', { runId }) }
  if (!isResumableWorkflowRunStatus(meta.status)) {
    return { message: t('cmd.workflows.notPaused', { runId }) }
  }
  return buildWorkflowResumeResult(
    runId,
    meta.scriptPath ?? runScriptPath(runId),
    meta.args,
  )
}
