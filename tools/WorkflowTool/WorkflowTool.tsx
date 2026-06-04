import { Box, Text } from '../../ink.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool } from 'src/Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForToolName } from '../../utils/permissions/permissions.js'
import {
  getOriginalCwd,
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
} from '../../bootstrap/state.js'
import {
  completeWorkflowTask,
  consumeWorkflowAgentControl,
  failWorkflowTask,
  finishWorkflowTask,
  registerWorkflowAgentController,
  registerWorkflowTask,
  updateWorkflowTaskProgress,
  waitForWorkflowTaskResume,
  WORKFLOW_PAUSE_ABORT_REASON,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { WORKFLOW_TOOL_PROMPT } from './prompt.js'
import { extractMeta } from './engine/meta.js'
import { createLimiter, defaultConcurrency } from './engine/concurrency.js'
import { createBudget } from './engine/budget.js'
import { createJournal } from './engine/journal.js'
import {
  appendJournalEntry,
  appendJournalStartedEntry,
  finalizeRunMeta,
  initRunArtifacts,
  loadJournal,
  runScriptPath,
  saveRunLog,
} from './engine/journalStore.js'
import { createWorkflowRuntime } from './engine/runtime.js'
import { createWorkflowAgentRunner } from './engine/agentRunner.js'
import { checkWorkflowScriptSyntax, runSandbox } from './engine/sandbox.js'
import type { WorkflowMeta, WorkflowProgressEvent } from './engine/types.js'
import {
  loadWorkflowRefsFromAllSources,
  resolveWorkflowFromAllSources,
} from './savedWorkflows.js'
import type { WorkflowRuntime } from './engine/runtime.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  buildNamedWorkflowPermissionUpdates,
  normalizeWorkflowPermissionRuleContent,
} from './permissionRules.js'
import { readWorkflowScriptFile } from './scriptFile.js'

/** Default wall-clock ceiling for a whole workflow run (30 minutes). */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_NESTED_WORKFLOW_DEPTH = 1
export const MAX_WORKFLOW_RESULT_LOG_LINES = 1000
const RESUME_RUN_ID_PATTERN = /^wf_[a-z0-9-]{6,}$/

const inputSchema = z.object({
  script: z
    .string()
    .optional()
    .describe(
      'The workflow script (JavaScript) to run. Must begin with `export const meta = {...}`. Provide this, scriptPath, or name.',
    ),
  name: z
    .string()
    .optional()
    .describe(
      'Name of a saved, plugin-provided, or bundled workflow to run. Alternative to script or scriptPath.',
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Ignored. Set the workflow description in the script's meta block.",
    ),
  title: z
    .string()
    .optional()
    .describe("Ignored. Set the workflow title in the script's meta block."),
  scriptPath: z
    .string()
    .optional()
    .describe(
      'Absolute path to a workflow script file. Alternative to script or name.',
    ),
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
    .regex(RESUME_RUN_ID_PATTERN)
    .optional()
    .describe(
      'Resume a prior run: the longest unchanged prefix of agent() calls returns cached results instantly; the first changed/new call and everything after runs live. Same script + args ⇒ full cache hit.',
    ),
})

type WorkflowInput = z.infer<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum(['async_launched', 'remote_launched']),
    taskId: z.string().describe('ID of the background monitor task.'),
    runId: z
      .string()
      .optional()
      .describe(
        'Local workflow run identifier for resumeFromRunId. Absent for remote_launched.',
      ),
    summary: z.string().describe('Workflow launch summary.'),
    transcriptDir: z
      .string()
      .optional()
      .describe('Directory where subagent transcripts are written during execution.'),
    scriptPath: z
      .string()
      .optional()
      .describe(
        'Path to the persisted workflow script for this invocation. Edit and pass back as scriptPath to re-run.',
      ),
    sessionUrl: z
      .string()
      .optional()
      .describe('CCR session URL when status is remote_launched.'),
    warning: z.string().optional().describe('Non-blocking launch warning.'),
    error: z.string().optional().describe('Set if launch failed before execution.'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type WorkflowOutput = z.infer<OutputSchema>

type ChildWorkflowRuntimeBehavior = {
  forcedPhase: string
  ignorePhaseChanges: boolean
  logPrefix: string
}

type ResolvedWorkflowSource = {
  source: string
  label: string
}

function sourceFromWorkflowRef(
  ref: Awaited<ReturnType<typeof resolveWorkflowFromAllSources>>,
  requestedName: string,
): ResolvedWorkflowSource {
  if (!ref) {
    throw new Error(`Workflow "${requestedName}" not found.`)
  }
  return {
    source:
      ref.source ??
      (ref.scriptPath
        ? readSourceFile(ref.scriptPath)
        : (() => {
            throw new Error(
              `workflow("${requestedName}"): workflow has no source or scriptPath.`,
            )
          })()),
    label: ref.name,
  }
}

async function resolveNamedWorkflowSource(
  name: string,
): Promise<ResolvedWorkflowSource> {
  const workflowName = name.trim()
  if (!workflowName) {
    throw new Error('Workflow name must be a non-empty string.')
  }
  const root = getProjectRoot()
  const saved = await resolveWorkflowFromAllSources(root, workflowName)
  if (!saved) {
    const available = (await loadWorkflowRefsFromAllSources(root)).map(
      wf => wf.commandName,
    )
    throw new Error(
      `Workflow "${workflowName}" not found. Available: ${
        available.length ? available.join(', ') : '(none)'
      }`,
    )
  }
  return sourceFromWorkflowRef(saved, workflowName)
}

async function readSource(input: WorkflowInput): Promise<string> {
  if (typeof input.script === 'string' && input.script.trim()) {
    return input.script
  }
  if (typeof input.scriptPath === 'string' && input.scriptPath.trim()) {
    return readWorkflowScriptFile(input.scriptPath)
  }
  if (typeof input.name === 'string' && input.name.trim()) {
    return (await resolveNamedWorkflowSource(input.name)).source
  }
  throw new Error('Must provide script, name, or scriptPath')
}

function normalizeResumeRunId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const runId = value.trim()
  if (!RESUME_RUN_ID_PATTERN.test(runId)) {
    throw new Error('resumeFromRunId must match /^wf_[a-z0-9-]{6,}$/.')
  }
  return runId
}

function readSourceFile(scriptPath: string): string {
  return readWorkflowScriptFile(scriptPath)
}

function workflowTranscriptDir(runId: string): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, getSessionId(), 'subagents', 'workflows', runId)
}

function workflowPermissionMessage(workflowName: string | null): string {
  return workflowName ? `Run workflow: ${workflowName}` : 'Run dynamic workflow'
}

async function resolveNestedWorkflowSource(
  nameOrRef: string | { scriptPath: string },
): Promise<{ source: string; label: string }> {
  if (typeof nameOrRef === 'string') {
    const name = nameOrRef.trim()
    if (!name) {
      throw new Error('workflow(name) requires a non-empty workflow name.')
    }
    const root = getProjectRoot()
    const saved = await resolveWorkflowFromAllSources(root, name)
    if (!saved) {
      const available = (await loadWorkflowRefsFromAllSources(root)).map(
        wf => wf.commandName,
      )
      throw new Error(
        `workflow("${name}"): no workflow with that name. Available: ${
          available.length ? available.join(', ') : '(none)'
        }`,
      )
    }
    return sourceFromWorkflowRef(saved, name)
  }

  const scriptPath = nameOrRef?.scriptPath?.trim()
  if (!scriptPath) {
    throw new Error(
      "workflow() expects a workflow name (string) or { scriptPath: string }.",
    )
  }
  return {
    source: readSourceFile(scriptPath),
    label: scriptPath,
  }
}

/** Render an engine progress event as a one-line log entry. */
function formatEvent(e: WorkflowProgressEvent): string | null {
  switch (e.kind) {
    case 'phase':
      return `▶ phase: ${e.title}`
    case 'log':
      return e.message
    case 'agent_queued':
      return `  … #${e.agentNumber} ${e.label}${e.phase ? ` [${e.phase}]` : ''} queued`
    case 'agent_start':
      return `  ↳ #${e.agentNumber} ${e.label}${e.phase ? ` [${e.phase}]` : ''} …`
    case 'agent_end':
      return `  ✓ #${e.agentNumber} ${e.label} (${e.status ?? (e.ok ? 'ok' : 'failed')}, ~${e.tokens} tok)`
    default:
      return null
  }
}

export function appendWorkflowResultLogLine(
  log: string[],
  line: string,
): void {
  if (log.length < MAX_WORKFLOW_RESULT_LOG_LINES) {
    log.push(line)
  }
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'orchestrate multiple subagents with a deterministic script',
  maxResultSizeChars: 200_000,
  inputSchema,
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
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
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const workflowName = normalizeWorkflowPermissionRuleContent(input.name)
    const permissionContext = context.getAppState().toolPermissionContext
    const suggestions = workflowName
      ? buildNamedWorkflowPermissionUpdates(workflowName)
      : undefined

    if (workflowName) {
      const denyRule = getRuleByContentsForToolName(
        permissionContext,
        WORKFLOW_TOOL_NAME,
        'deny',
      ).get(workflowName)
      if (denyRule) {
        return {
          behavior: 'deny',
          message: `Workflow execution blocked by permission rules: ${workflowName}`,
          decisionReason: {
            type: 'rule',
            rule: denyRule,
          },
        }
      }

      const askRule = getRuleByContentsForToolName(
        permissionContext,
        WORKFLOW_TOOL_NAME,
        'ask',
      ).get(workflowName)
      if (askRule) {
        return {
          behavior: 'ask',
          message: workflowPermissionMessage(workflowName),
          decisionReason: {
            type: 'rule',
            rule: askRule,
          },
          suggestions,
          updatedInput: input,
        }
      }

      const allowRule = getRuleByContentsForToolName(
        permissionContext,
        WORKFLOW_TOOL_NAME,
        'allow',
      ).get(workflowName)
      if (allowRule) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: {
            type: 'rule',
            rule: allowRule,
          },
        }
      }
    }

    return {
      behavior: 'ask',
      message: workflowPermissionMessage(workflowName),
      suggestions,
      updatedInput: input,
    }
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
      : input.name
        ? `Workflow: ${input.name}`
      : WORKFLOW_TOOL_NAME
  },
  async call(input: WorkflowInput, toolUseContext, canUseTool) {
    // Resume path: reuse the prior runId for the journal. The script source
    // itself still has to be supplied by script, scriptPath, or name, matching
    // the official input contract.
    const resumeRunId = normalizeResumeRunId(input.resumeFromRunId)
    const runId = resumeRunId
      ? resumeRunId
      : `wf_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const source = await readSource(input)

    // Validate + surface meta early so a malformed script fails fast — for the
    // background path too, so the caller learns of a bad script synchronously.
    const { meta, scriptBody } = extractMeta(source)
    const syntaxCheck = checkWorkflowScriptSyntax(scriptBody)
    if ('error' in syntaxCheck) {
      return {
        data: {
          status: 'async_launched',
          taskId: runId,
          runId,
          summary: meta.description,
          error: syntaxCheck.error,
        } satisfies WorkflowOutput,
      }
    }

    const prior = resumeRunId ? loadJournal(runId) : null
    const persistedScriptPath = runScriptPath(runId)
    const transcriptDir = workflowTranscriptDir(runId)
    // tool.call runs in normal Node (OUTSIDE the workflow sandbox), so Date is
    // available here — the determinism ban only applies to the script body.
    initRunArtifacts(runId, source, {
      runId,
      workflowName: meta.name,
      description: meta.description,
      title: meta.title,
      phases: meta.phases,
      defaultModel: meta.model,
      args: input.args,
      scriptPath: persistedScriptPath,
      transcriptDir,
      createdAt: new Date().toISOString(),
      status: 'running',
    })

    // Official workflows are async launches: use an UNLINKED abort controller
    // so the workflow + subagents survive this tool call returning.
    const runAbort = new AbortController()

    const log: string[] = []
    const startedAtMs = Date.now()
    const setTaskState =
      toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
    registerWorkflowTask({
      runId,
      workflowName: meta.name,
      description: meta.description,
      script: source,
      scriptPath: persistedScriptPath,
      args: input.args,
      title: meta.title,
      phaseDefinitions: meta.phases,
      transcriptDir,
      defaultModel: meta.model,
      toolUseId: toolUseContext.toolUseId,
      abortController: runAbort,
      setAppState: setTaskState,
    })
    const progress = (e: WorkflowProgressEvent) => {
      const line = formatEvent(e)
      if (line) appendWorkflowResultLogLine(log, line)
      updateWorkflowTaskProgress(runId, e, setTaskState)
    }

    const limiter = createLimiter(defaultConcurrency())
    const budget = createBudget(null)
    // Journal persists each recorded entry to disk so resume works across
    // separate tool invocations (not just in-memory within one run).
    const journal = createJournal(
      runId,
      prior,
      entry => appendJournalEntry(runId, entry),
      entry => appendJournalStartedEntry(runId, entry),
    )
    const runOneAgent = createWorkflowAgentRunner({
      toolUseContext,
      canUseTool,
      runId,
      abortController: runAbort,
      registerAgentController: (
        agentNumber: number,
        controller: AbortController,
      ) => registerWorkflowAgentController(runId, agentNumber, controller),
    })
    const runtimes: WorkflowRuntime[] = []
    const nestedWorkflowCounts = new Map<string, number>()
    const createRuntimeFor = (
      workflowArgs: unknown,
      depth: number,
      useJournal: boolean,
      workflowMeta: Pick<WorkflowMeta, 'phases' | 'model'>,
      childBehavior?: ChildWorkflowRuntimeBehavior,
    ): WorkflowRuntime => {
      let runtime: WorkflowRuntime
      runtime = createWorkflowRuntime({
        limiter,
        budget,
        progress,
        args: workflowArgs,
        runOneAgent,
        phases: workflowMeta.phases,
        defaultModel: workflowMeta.model,
        signal: runAbort.signal,
        journal: useJournal ? journal : undefined,
        ...(childBehavior ?? {}),
        getAgentControl: (agentNumber: number) =>
          consumeWorkflowAgentControl(runId, agentNumber),
        waitForResume: () => waitForWorkflowTaskResume(runId, runAbort.signal),
        runNestedWorkflow:
          depth >= MAX_NESTED_WORKFLOW_DEPTH
            ? undefined
            : async (nameOrRef, nestedArgs) => {
                const nested = await resolveNestedWorkflowSource(nameOrRef)
                const { meta: nestedMeta, scriptBody: nestedScriptBody } =
                  extractMeta(nested.source)
                const nestedName = nestedMeta.name || nested.label
                const nestedCount =
                  (nestedWorkflowCounts.get(nestedName) ?? 0) + 1
                nestedWorkflowCounts.set(nestedName, nestedCount)
                const childPhase = `▶ ${nestedName}${
                  nestedCount > 1 ? ` #${nestedCount}` : ''
                }`
                progress({
                  kind: 'phase',
                  title: childPhase,
                })
                progress({
                  kind: 'log',
                  message: `▶ running dynamic workflow ${nestedName}`,
                })
                const nestedRuntime = createRuntimeFor(
                  nestedArgs,
                  depth + 1,
                  false,
                  nestedMeta,
                  {
                    forcedPhase: childPhase,
                    ignorePhaseChanges: true,
                    logPrefix: `[${nestedName}] `,
                  },
                )
                try {
                  const result = await runSandbox({
                    source: nestedScriptBody,
                    scope: nestedRuntime.scope,
                    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                    signal: runAbort.signal,
                  })
                  progress({
                    kind: 'log',
                    message: `▶ ${nestedName} done`,
                  })
                  return result
                } catch (err) {
                  const message = (err as Error).message || String(err)
                  runtime.recordFailure(`${childPhase}: ${message}`)
                  progress({
                    kind: 'log',
                    message: `▶ ${nestedName} failed: ${message}`,
                  })
                  throw err
                }
              },
      })
      runtimes.push(runtime)
      return runtime
    }
    const runtime = createRuntimeFor(input.args, 0, true, meta)
    const agentCount = () =>
      runtimes.reduce((total, current) => total + current.agentCount(), 0)
    const totalToolCalls = () =>
      runtimes.reduce((total, current) => total + current.toolCallCount(), 0)
    const failures = () => runtimes.flatMap(current => current.failures())
    const durationMs = () => Date.now() - startedAtMs

    const execute = () =>
      runSandbox({
        source: scriptBody,
        scope: runtime.scope,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: runAbort.signal,
      })

    // Kick the run off detached, return a launch receipt immediately, and fire
    // a task-notification (+ persist final state) when it settles.
    void execute()
      .then(() => {
        saveRunLog(runId, log)
        finalizeRunMeta(runId, {
          status: 'completed',
          agentCount: agentCount(),
          totalToolCalls: totalToolCalls(),
          tokensSpent: budget.spent(),
          failures: failures(),
          durationMs: durationMs(),
        })
        completeWorkflowTask(runId, setTaskState, {
          agentCount: agentCount(),
          totalToolCalls: totalToolCalls(),
          tokensSpent: budget.spent(),
          failures: failures(),
          durationMs: durationMs(),
        })
      })
      .catch((err: unknown) => {
        const killed =
          runAbort.signal.aborted && runAbort.signal.reason === 'workflow_killed'
        const paused =
          runAbort.signal.aborted &&
          runAbort.signal.reason === WORKFLOW_PAUSE_ABORT_REASON
        saveRunLog(runId, log)
        if (paused) {
          finalizeRunMeta(runId, {
            status: 'paused',
            agentCount: agentCount(),
            totalToolCalls: totalToolCalls(),
            tokensSpent: budget.spent(),
            failures: failures(),
            durationMs: durationMs(),
          })
          return
        }
        finalizeRunMeta(runId, {
          status: 'failed',
          agentCount: agentCount(),
          totalToolCalls: totalToolCalls(),
          tokensSpent: budget.spent(),
          failures: failures(),
          durationMs: durationMs(),
        })
        const patch = {
          agentCount: agentCount(),
          totalToolCalls: totalToolCalls(),
          tokensSpent: budget.spent(),
          failures: failures(),
          durationMs: durationMs(),
        }
        if (killed) finishWorkflowTask(runId, 'killed', setTaskState, patch)
        else
          failWorkflowTask(runId, setTaskState, {
            ...patch,
            error: (err as Error).message,
          })
      })

    return {
      data: {
        status: 'async_launched',
        taskId: runId,
        runId,
        summary: meta.description,
        transcriptDir,
        scriptPath: persistedScriptPath,
      } satisfies WorkflowOutput,
    }
  },
  mapToolResultToToolResultBlockParam(content: WorkflowOutput, toolUseID: string) {
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: summarize(content),
      ...(content.error ? { is_error: true } : {}),
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
  if (data.error) {
    return `Workflow script has a syntax error and was not launched:\n${data.error}`
  }
  if (data.status === 'remote_launched') {
    return (
      `Workflow launched in a remote CCR session. Task ID: ${data.taskId}` +
      `${data.sessionUrl ? `\nSession: ${data.sessionUrl}` : ''}` +
      `\nSummary: ${data.summary}` +
      `${data.warning ? `\nWarning: ${data.warning}` : ''}` +
      '\nThe workflow runs against a fresh clone of the pushed branch; phase progress is visible at the session URL, not in /workflows. You will be notified when it completes.'
    )
  }
  const editHint = data.scriptPath
    ? `\n(Edit this file with Write/Edit and re-invoke Workflow with {scriptPath: "${data.scriptPath}"} to iterate without resending the script.)`
    : ''
  const resumeHint =
    data.scriptPath && data.runId
      ? `\nTo resume after editing the script: Workflow({scriptPath: "${data.scriptPath}", resumeFromRunId: "${data.runId}"})`
      : ''
  return (
    `Workflow launched in background. Task ID: ${data.taskId}` +
    `\nSummary: ${data.summary}` +
    `${data.transcriptDir ? `\nTranscript dir: ${data.transcriptDir}` : ''}` +
    `${data.scriptPath ? `\nScript file: ${data.scriptPath}` : ''}` +
    editHint +
    `${data.runId ? `\nRun ID: ${data.runId}` : ''}` +
    resumeHint +
    '\nYou will be notified when it completes. Use /workflows to watch live progress.'
  )
}
