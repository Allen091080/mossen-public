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
import { buildWorkbenchWorkflowSnapshot } from '../../commands/workflows/workbenchSnapshot.js'
import { validateWorkflowTargetsForCommand } from '../../commands/workflows/validateWorkflow.js'
import { switchSession } from '../../bootstrap/state.js'
import { asSessionId } from '../../types/ids.js'
import { validateUuid } from '../../utils/uuid.js'
import {
  validateWorkflowDraftEnvelope,
  workflowPublicationProtocolDescriptor,
} from '../../commands/workflows/publicationProtocol.js'
import { publishWorkflowDraft } from '../../commands/workflows/publicationRegistry.js'
import { writeToStdoutAndWait } from '../../utils/process.js'
import {
  cancelPublishedWorkflowRun,
  enablePublishedWorkflow,
  invokePublishedWorkflow,
  queryPublishedWorkflowRun,
  type PublishedWorkflowOperationResult,
} from '../../commands/workflows/publishedRunProtocol.js'

export type WorkflowsHandlerOptions = {
  json?: boolean
  workbench?: boolean
  report?: boolean
  capabilities?: boolean
  sessionId?: string
  operation?: string
  stdin?: boolean
  inputText?: string
}

const MAX_WORKFLOW_PUBLICATION_INPUT_BYTES = 10 * 1024 * 1024

async function readWorkflowPublicationInput(
  options: WorkflowsHandlerOptions,
): Promise<unknown> {
  let text = options.inputText
  if (text === undefined) {
    if (!options.stdin) {
      throw new Error('typed workflow operation requires --stdin')
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > MAX_WORKFLOW_PUBLICATION_INPUT_BYTES) {
        throw new Error(
          `workflow publication input exceeds ${MAX_WORKFLOW_PUBLICATION_INPUT_BYTES} bytes`,
        )
      }
      chunks.push(buffer)
    }
    text = Buffer.concat(chunks).toString('utf8')
  }
  if (!text.trim()) throw new Error('workflow publication stdin was empty')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(
      `invalid workflow publication JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function writeWorkflowStdout(value: string): Promise<void> {
  return writeToStdoutAndWait(`${value}\n`)
}

async function printWorkflowPublicationProtocolError(
  error: unknown,
): Promise<void> {
  await writeWorkflowStdout(
    JSON.stringify(
      {
        version: 1,
        surface: 'workflow-publication-error',
        status: 'failed',
        code: 'invalid_input',
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
}

async function printPublishedWorkflowOperation(
  result: PublishedWorkflowOperationResult<unknown>,
): Promise<void> {
  if ('response' in result) {
    await writeWorkflowStdout(JSON.stringify(result.response, null, 2))
    return
  }
  await writeWorkflowStdout(JSON.stringify(result.conflict, null, 2))
  process.exitCode = 1
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
  const operations = [
    'validate-draft',
    'publish-draft',
    'enable-published',
    'run-published',
    'query-published-run',
    'cancel-published-run',
  ]
  if (options.operation && !operations.includes(options.operation)) {
    console.error(`Unknown workflows operation: ${options.operation}`)
    process.exitCode = 1
    return
  }
  if (
    options.operation === 'enable-published' ||
    options.operation === 'run-published' ||
    options.operation === 'query-published-run' ||
    options.operation === 'cancel-published-run'
  ) {
    try {
      const input = await readWorkflowPublicationInput(options)
      const result =
        options.operation === 'enable-published'
          ? await enablePublishedWorkflow(input)
          : options.operation === 'run-published'
            ? await invokePublishedWorkflow(input)
            : options.operation === 'query-published-run'
              ? queryPublishedWorkflowRun(input)
              : await cancelPublishedWorkflowRun(input)
      await printPublishedWorkflowOperation(result)
    } catch (error) {
      await printWorkflowPublicationProtocolError(error)
    }
    return
  }
  if (options.operation === 'validate-draft') {
    try {
      const input = await readWorkflowPublicationInput(options)
      await writeWorkflowStdout(
        JSON.stringify(validateWorkflowDraftEnvelope(input), null, 2),
      )
    } catch (error) {
      await printWorkflowPublicationProtocolError(error)
    }
    return
  }
  if (options.operation === 'publish-draft') {
    try {
      const input = await readWorkflowPublicationInput(options)
      const result = await publishWorkflowDraft(input)
      if ('receipt' in result) {
        await writeWorkflowStdout(JSON.stringify(result.receipt, null, 2))
      } else {
        await writeWorkflowStdout(JSON.stringify(result.conflict, null, 2))
        process.exitCode = 1
      }
    } catch (error) {
      await printWorkflowPublicationProtocolError(error)
    }
    return
  }
  if (options.capabilities) {
    await writeWorkflowStdout(
      JSON.stringify(workflowPublicationProtocolDescriptor(), null, 2),
    )
    return
  }
  if (!applyWorkflowSessionOption(options)) return
  const runs = listWorkflowRuns()
  if (options.workbench) {
    await writeWorkflowStdout(
      JSON.stringify(
        buildWorkbenchWorkflowSnapshot({
          runs,
          registryResults: validateWorkflowTargetsForCommand(['--all']),
        }),
        null,
        2,
      ),
    )
    return
  }
  if (options.json) {
    await writeWorkflowStdout(JSON.stringify(workflowRunsToJson(runs), null, 2))
    return
  }
  if (runs.length === 0) {
    await writeWorkflowStdout('No workflow runs recorded for this session.')
    return
  }
  await writeWorkflowStdout(
    workflowRunsToJson(runs).map(formatWorkflowRun).join('\n'),
  )
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
