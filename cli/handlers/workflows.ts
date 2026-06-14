/**
 * Workflow CLI handlers.
 *
 * These are read-only protocol surfaces for external UIs and tests. The
 * interactive `/workflows` command remains the richer TUI, while
 * `mossen workflows --json` and `mossen workflow <id> --json` expose the same
 * persisted run facts as a stable machine-readable contract.
 */
/* eslint-disable no-console -- CLI handlers intentionally write stdout/stderr. */

import {
  listWorkflowRuns,
  loadRunLog,
  loadRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import {
  workflowRunToJson,
  workflowRunsToJson,
  type WorkflowJsonRun,
} from '../../commands/workflows/workflowProgressTree.js'
import { exportWorkflowRunReport } from '../../commands/workflows/exportWorkflowReport.js'
import { switchSession } from '../../bootstrap/state.js'
import { asSessionId } from '../../types/ids.js'
import { validateUuid } from '../../utils/uuid.js'

export type WorkflowsHandlerOptions = {
  json?: boolean
  report?: boolean
  sessionId?: string
}

function workflowRunWithLog(run: WorkflowJsonRun): WorkflowJsonRun & { log: string[] } {
  return {
    ...run,
    log: loadRunLog(run.runId),
  }
}

function formatWorkflowRun(run: WorkflowJsonRun): string {
  const title = run.title ?? run.workflowName
  const metrics = [
    `${run.agentCount} agents`,
    `${run.totalToolCalls} tools`,
    run.tokenUsage.totalTokens === null
      ? null
      : `${run.tokenUsage.totalTokens} tokens`,
  ].filter(Boolean)
  return `${run.id} · ${run.state} · ${title}${metrics.length ? ` · ${metrics.join(' · ')}` : ''}`
}

function applyWorkflowSessionOption(options: WorkflowsHandlerOptions): boolean {
  if (!options.sessionId) return true
  const sessionId = validateUuid(options.sessionId)
  if (!sessionId) {
    console.error(`Invalid workflow session id: ${options.sessionId}`)
    process.exitCode = 1
    return false
  }
  switchSession(asSessionId(sessionId))
  return true
}

export async function workflowsHandler(
  options: WorkflowsHandlerOptions = {},
): Promise<void> {
  if (!applyWorkflowSessionOption(options)) return
  const runs = listWorkflowRuns()
  if (options.json) {
    console.log(JSON.stringify(workflowRunsToJson(runs), null, 2))
    return
  }
  if (runs.length === 0) {
    console.log('No workflow runs recorded for this session.')
    return
  }
  console.log(workflowRunsToJson(runs).map(formatWorkflowRun).join('\n'))
}

export async function workflowHandler(
  runId: string,
  options: WorkflowsHandlerOptions = {},
): Promise<void> {
  if (!applyWorkflowSessionOption(options)) return
  if (options.report) {
    const result = exportWorkflowRunReport(runId)
    console[result.ok ? 'log' : 'error'](result.message)
    if (!result.ok) process.exitCode = 1
    return
  }
  const meta = loadRunMeta(runId)
  if (!meta) {
    console.error(`Workflow run not found: ${runId}`)
    process.exitCode = 1
    return
  }
  const run = workflowRunWithLog(workflowRunToJson(meta))
  if (options.json) {
    console.log(JSON.stringify(run, null, 2))
    return
  }
  console.log(formatWorkflowRun(run))
  if (run.resultSummary) console.log(`Result: ${run.resultSummary}`)
  if (run.failures.length > 0) console.log(`Failures: ${run.failures.join(' · ')}`)
  if (run.log.length > 0) {
    console.log('')
    console.log(run.log.join('\n'))
  }
}
