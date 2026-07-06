import { WORKFLOW_TOOL_NAME } from '../../tools/WorkflowTool/constants.js'
import {
  loadWorkflowCheckpoint,
  loadRunMeta,
  loadRunScript,
  refreshWorkflowCheckpoint,
  runScriptPath,
  type WorkflowCheckpoint,
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
  checkpoint?: WorkflowCheckpoint | null,
): WorkflowCommandResult {
  const checkpointLine = checkpoint
    ? `\ncheckpoint: status=${checkpoint.status}; completed=${checkpoint.counts.completed}; started=${checkpoint.counts.started}; pending=${checkpoint.counts.pendingStarted}; script=${checkpoint.scriptExists ? 'present' : 'missing'}`
    : ''
  return {
    message: `${t('cmd.workflows.resumeQueued', { runId: messageRunId })}${checkpointLine}`,
    nextInput: buildWorkflowResumeNextInput(runId, scriptPath, args),
  }
}

export function buildWorkflowResumeSafetyMessage(
  runId: string,
  checkpoint: WorkflowCheckpoint | null,
): string | null {
  if (!checkpoint) {
    return `Workflow ${runId} has no recovery checkpoint; inspect run artifacts before resuming.`
  }
  if (checkpoint.resumeSafety.canResume) return null
  return `Workflow ${runId} cannot be resumed: ${checkpoint.resumeSafety.blockedReason ?? 'checkpoint blocked resume'}.`
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
  const checkpoint = refreshWorkflowCheckpoint(runId) ?? loadWorkflowCheckpoint(runId)
  const safetyMessage = buildWorkflowResumeSafetyMessage(runId, checkpoint)
  if (safetyMessage) return { message: safetyMessage }
  return buildWorkflowResumeResult(
    runId,
    meta.scriptPath ?? runScriptPath(runId),
    meta.args,
    runId,
    checkpoint,
  )
}
