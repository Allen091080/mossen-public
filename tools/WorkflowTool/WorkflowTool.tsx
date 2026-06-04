import { Box, Text } from '../../ink.js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { buildTool } from 'src/Tool.js'
import { enqueueSdkEvent } from '../../utils/sdkEventQueue.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { WORKFLOW_TOOL_PROMPT } from './prompt.js'
import { extractMeta } from './engine/meta.js'
import { createLimiter, defaultConcurrency } from './engine/concurrency.js'
import { createBudget } from './engine/budget.js'
import { createJournal } from './engine/journal.js'
import {
  appendJournalEntry,
  finalizeRunMeta,
  initRunArtifacts,
  loadJournal,
  loadRunScript,
  runLogPath,
  saveRunLog,
} from './engine/journalStore.js'
import { createWorkflowRuntime } from './engine/runtime.js'
import { createWorkflowAgentRunner } from './engine/agentRunner.js'
import { runSandbox } from './engine/sandbox.js'
import type { WorkflowProgressEvent } from './engine/types.js'

/** Default wall-clock ceiling for a whole workflow run (30 minutes). */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const inputSchema = z.object({
  script: z
    .string()
    .optional()
    .describe(
      'The workflow script (JavaScript) to run. Must begin with `export const meta = {...}`. Provide this or scriptPath.',
    ),
  scriptPath: z
    .string()
    .optional()
    .describe('Absolute path to a workflow script file. Alternative to script.'),
  args: z
    .any()
    .optional()
    .describe('Value exposed to the script as the global `args`, verbatim.'),
  timeoutMs: z
    .number()
    .optional()
    .describe('Optional wall-clock ceiling for the whole run in milliseconds.'),
  resumeFromRunId: z
    .string()
    .optional()
    .describe(
      'Resume a prior run: the longest unchanged prefix of agent() calls returns cached results instantly; the first changed/new call and everything after runs live. Same script + args ⇒ full cache hit.',
    ),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      'Run the workflow in the background: the tool returns immediately with a runId, the workflow keeps running, and a task-notification fires on completion. Monitor progress with /workflows <runId>.',
    ),
})

type WorkflowInput = z.infer<typeof inputSchema>

type WorkflowCompletedOutput = {
  status: 'completed'
  runId: string
  workflowName: string
  result: unknown
  agentCount: number
  tokensSpent: number
  log: string[]
}

type WorkflowLaunchedOutput = {
  status: 'launched'
  runId: string
  workflowName: string
  outputFile: string
}

type WorkflowOutput = WorkflowCompletedOutput | WorkflowLaunchedOutput

function readSource(input: WorkflowInput): string {
  if (typeof input.script === 'string' && input.script.trim()) {
    return input.script
  }
  if (typeof input.scriptPath === 'string' && input.scriptPath.trim()) {
    try {
      return readFileSync(input.scriptPath, 'utf8')
    } catch (err) {
      throw new Error(
        `Could not read workflow scriptPath "${input.scriptPath}": ${(err as Error).message}`,
      )
    }
  }
  throw new Error('Workflow requires either `script` or `scriptPath`.')
}

/** Render an engine progress event as a one-line log entry. */
function formatEvent(e: WorkflowProgressEvent): string | null {
  switch (e.kind) {
    case 'phase':
      return `▶ phase: ${e.title}`
    case 'log':
      return e.message
    case 'agent_start':
      return `  ↳ #${e.agentNumber} ${e.label}${e.phase ? ` [${e.phase}]` : ''} …`
    case 'agent_end':
      return `  ✓ #${e.agentNumber} ${e.label} (${e.ok ? 'ok' : 'failed'}, ~${e.tokens} tok)`
    default:
      return null
  }
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'orchestrate multiple subagents with a deterministic script',
  maxResultSizeChars: 200_000,
  inputSchema,
  async description() {
    return 'Run a workflow script that orchestrates multiple subagents deterministically.'
  },
  async prompt() {
    return WORKFLOW_TOOL_PROMPT
  },
  isReadOnly() {
    // Subagents the workflow spawns may write; treat the tool as non-read-only.
    return false
  },
  isConcurrencySafe() {
    return false
  },
  userFacingName() {
    return WORKFLOW_TOOL_NAME
  },
  renderToolUseMessage(input: Partial<WorkflowInput> | undefined) {
    if (!input) return WORKFLOW_TOOL_NAME
    try {
      const src = typeof input.script === 'string' ? input.script : null
      if (src) {
        const { meta } = extractMeta(src)
        return `Workflow: ${meta.name} — ${meta.description}`
      }
    } catch {
      // fall through to a generic label if meta can't be parsed yet
    }
    return input.scriptPath
      ? `Workflow: ${input.scriptPath}`
      : WORKFLOW_TOOL_NAME
  },
  async call(input: WorkflowInput, toolUseContext, canUseTool) {
    // Resume path: reuse the prior runId and its persisted script (unless the
    // caller passed a new script) so the journal's prefix-cache lines up.
    const resuming =
      typeof input.resumeFromRunId === 'string' && input.resumeFromRunId.trim()
    const runId = resuming
      ? input.resumeFromRunId!.trim()
      : `wf_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const source =
      input.script == null && input.scriptPath == null && resuming
        ? loadRunScript(runId) ??
          (() => {
            throw new Error(
              `Cannot resume workflow ${runId}: no persisted script found and none provided.`,
            )
          })()
        : readSource(input)

    // Validate + surface meta early so a malformed script fails fast — for the
    // background path too, so the caller learns of a bad script synchronously.
    const { meta } = extractMeta(source)

    const prior = resuming ? loadJournal(runId) : null
    // tool.call runs in normal Node (OUTSIDE the workflow sandbox), so Date is
    // available here — the determinism ban only applies to the script body.
    initRunArtifacts(runId, source, {
      runId,
      workflowName: meta.name,
      description: meta.description,
      createdAt: new Date().toISOString(),
      status: 'running',
    })

    const background = input.run_in_background === true
    // Background runs use an UNLINKED abort controller so the workflow + its
    // subagents survive this tool call returning. Foreground runs share the
    // turn's controller (cancel-on-interrupt, the normal tool behaviour).
    const runAbort = background
      ? new AbortController()
      : toolUseContext.abortController

    const log: string[] = []
    const progress = (e: WorkflowProgressEvent) => {
      const line = formatEvent(e)
      if (line) log.push(line)
    }

    const limiter = createLimiter(defaultConcurrency())
    const budget = createBudget(null)
    // Journal persists each recorded entry to disk so resume works across
    // separate tool invocations (not just in-memory within one run).
    const journal = createJournal(runId, prior, entry =>
      appendJournalEntry(runId, entry),
    )
    const runOneAgent = createWorkflowAgentRunner({
      toolUseContext,
      canUseTool,
      runId,
      ...(background ? { abortController: runAbort } : {}),
    })
    const runtime = createWorkflowRuntime({
      limiter,
      budget,
      progress,
      args: input.args,
      runOneAgent,
      journal,
    })

    const execute = () =>
      runSandbox({
        source,
        scope: runtime.scope,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: runAbort.signal,
      })

    // ── Background path ─────────────────────────────────────────────────────
    // Kick the run off detached, return a launch receipt immediately, and fire
    // a task-notification (+ persist final state) when it settles.
    if (background) {
      void execute()
        .then(() => {
          saveRunLog(runId, log)
          finalizeRunMeta(runId, {
            status: 'completed',
            agentCount: runtime.agentCount(),
            tokensSpent: budget.spent(),
          })
          enqueueSdkEvent({
            type: 'system',
            subtype: 'task_notification',
            task_id: runId,
            tool_use_id: toolUseContext.toolUseId,
            status: 'completed',
            output_file: runLogPath(runId),
            summary: `Workflow "${meta.name}" completed — ${runtime.agentCount()} agent(s), ~${budget.spent()} tokens.`,
            usage: {
              total_tokens: budget.spent(),
              tool_uses: runtime.agentCount(),
              duration_ms: 0,
            },
          })
        })
        .catch((err: unknown) => {
          saveRunLog(runId, log)
          finalizeRunMeta(runId, {
            status: 'failed',
            agentCount: runtime.agentCount(),
            tokensSpent: budget.spent(),
          })
          enqueueSdkEvent({
            type: 'system',
            subtype: 'task_notification',
            task_id: runId,
            tool_use_id: toolUseContext.toolUseId,
            status: 'failed',
            output_file: runLogPath(runId),
            summary: `Workflow "${meta.name}" failed: ${(err as Error).message}`,
            usage: { total_tokens: budget.spent(), tool_uses: runtime.agentCount(), duration_ms: 0 },
          })
        })

      const launched: WorkflowLaunchedOutput = {
        status: 'launched',
        runId,
        workflowName: meta.name,
        outputFile: runLogPath(runId),
      }
      return { data: launched }
    }

    // ── Foreground path (synchronous) ───────────────────────────────────────
    try {
      const result = await execute()
      const data: WorkflowCompletedOutput = {
        status: 'completed',
        runId,
        workflowName: meta.name,
        result,
        agentCount: runtime.agentCount(),
        tokensSpent: budget.spent(),
        log,
      }
      saveRunLog(runId, log)
      finalizeRunMeta(runId, {
        status: 'completed',
        agentCount: runtime.agentCount(),
        tokensSpent: budget.spent(),
      })
      return { data }
    } catch (err) {
      saveRunLog(runId, log)
      finalizeRunMeta(runId, {
        status: 'failed',
        agentCount: runtime.agentCount(),
        tokensSpent: budget.spent(),
      })
      throw err
    }
  },
  mapToolResultToToolResultBlockParam(content: WorkflowOutput, toolUseID: string) {
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: summarize(content),
    }
  },
  renderToolResultMessage(content: WorkflowOutput) {
    // Ink requires every string to live inside a <Text>; returning a bare
    // string here crashes the whole render tree ("Text string ... must be
    // rendered within a <Text> component").
    return (
      <Box flexDirection="column">
        <Text>{summarize(content)}</Text>
      </Box>
    )
  },
})

function summarize(data: WorkflowOutput): string {
  if (data.status === 'launched') {
    return (
      `Workflow "${data.workflowName}" launched in the background (runId ${data.runId}). ` +
      `It will keep running; you'll get a task-notification when it finishes. ` +
      `Monitor progress with /workflows ${data.runId}.`
    )
  }
  const head = `Workflow "${data.workflowName}" completed — ${data.agentCount} agent(s), ~${data.tokensSpent} tokens.`
  const resultText =
    data.result === undefined
      ? '(no return value)'
      : typeof data.result === 'string'
        ? data.result
        : JSON.stringify(data.result, null, 2)
  const tail = data.log.length
    ? `\n\nProgress:\n${data.log.join('\n')}`
    : ''
  return `${head}\n\nResult:\n${resultText}${tail}`
}
