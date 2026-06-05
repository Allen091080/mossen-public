import { Box, Text } from '../../ink.js'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolUseContext } from 'src/Tool.js'
import { generateTaskId, type SetAppState } from '../../Task.js'
import { getRemoteSessionUrl } from '../../constants/product.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForToolName } from '../../utils/permissions/permissions.js'
import {
  getOriginalCwd,
  getCurrentTurnTokenBudget,
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  getTurnOutputTokens,
  isUltracodeActive,
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
import { extractMeta, MAX_WORKFLOW_SCRIPT_BYTES } from './engine/meta.js'
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
import {
  checkWorkflowScriptDeterminism,
  checkWorkflowScriptSyntax,
  runSandbox,
} from './engine/sandbox.js'
import type { WorkflowMeta, WorkflowProgressEvent } from './engine/types.js'
import {
  loadWorkflowRefsFromAllSources,
  resolveWorkflowFromAllSources,
  type SavedWorkflowRef,
} from './savedWorkflows.js'
import {
  logWorkflowCompletionMetric,
  logWorkflowLaunchMetric,
  logWorkflowPhaseCompletionMetrics,
  workflowSourceForTelemetry,
} from './phaseTelemetry.js'
import type { WorkflowRuntime } from './engine/runtime.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  buildNamedWorkflowPermissionUpdates,
  normalizeWorkflowPermissionRuleContent,
} from './permissionRules.js'
import { buildWorkflowPermissionReview } from './permissionReview.js'
import { readWorkflowScriptFile } from './scriptFile.js'
import { isWorkflowRuntimeEnabled } from '../../utils/workflowAvailability.js'
import { hasRecordedWorkflowUsageConsent } from './usageConsent.js'
import {
  registerRemoteAgentTask,
  startRemoteAgentTaskPolling,
  type RemoteAgentTaskPollingDeps,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'

/** Default wall-clock ceiling for a whole workflow run (30 minutes). */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_NESTED_WORKFLOW_DEPTH = 1
export const MAX_WORKFLOW_RESULT_LOG_LINES = 1000
const RESUME_RUN_ID_PATTERN = /^wf_[a-z0-9-]{6,}$/

const inputSchema = z
  .strictObject({
    script: z
      .string()
      .max(MAX_WORKFLOW_SCRIPT_BYTES)
      .optional()
      .describe(
        'Self-contained workflow script. Must begin with `export const meta = {...}`. Provide this, scriptPath, or name.',
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
        'Path to a workflow script file on disk. Every Workflow invocation persists its script under the session directory and returns the path in the tool result. To iterate, edit that file and re-invoke Workflow with the same scriptPath instead of re-sending the full script. If `script` is also provided, that script content is reviewed and launched.',
      ),
    args: z
      .any()
      .optional()
      .describe(
        'Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, not JSON-encoded strings.',
      ),
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
  .refine(input => Boolean(input.script || input.name || input.scriptPath), {
    message: 'Must provide script, name, or scriptPath',
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
  scope?: SavedWorkflowRef['scope']
}

type WorkflowSourceResolution = {
  source: string
  resolvedScriptPath?: string
  scope?: SavedWorkflowRef['scope'] | 'inline' | 'scriptPath'
}

type RemoteWorkflowLaunchResult = {
  id: string
  title?: string
} | null

type RemoteWorkflowLaunchOptions = {
  initialMessage: string
  description: string
  title: string
  model?: string
  signal: AbortSignal
}

type WorkflowRemoteDeps = {
  launch: (
    options: RemoteWorkflowLaunchOptions,
  ) => Promise<RemoteWorkflowLaunchResult>
  getSessionUrl: (sessionId: string) => string
  startPolling: (
    params: { taskId: string; sessionId: string; setAppState: SetAppState },
    deps?: RemoteAgentTaskPollingDeps,
  ) => () => void
}

type RunningWorkflowTask = {
  id?: string
  type?: string
  status?: string
  runId?: string
  workflowRunId?: string
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
    scope: ref.scope,
  }
}

async function defaultRemoteWorkflowLaunch(
  options: RemoteWorkflowLaunchOptions,
): Promise<RemoteWorkflowLaunchResult> {
  const { teleportToRemote } = await import('../../utils/teleport.js')
  return teleportToRemote({
    initialMessage: options.initialMessage,
    description: options.description,
    title: options.title,
    ...(options.model ? { model: options.model } : {}),
    permissionMode: 'acceptEdits',
    signal: options.signal,
  })
}

let workflowRemoteDeps: WorkflowRemoteDeps = {
  launch: defaultRemoteWorkflowLaunch,
  getSessionUrl: getRemoteSessionUrl,
  startPolling: startRemoteAgentTaskPolling,
}

export function setWorkflowRemoteDepsForTest(
  overrides: Partial<WorkflowRemoteDeps>,
): () => void {
  const previous = workflowRemoteDeps
  workflowRemoteDeps = { ...workflowRemoteDeps, ...overrides }
  return () => {
    workflowRemoteDeps = previous
  }
}

function shouldLaunchRemoteWorkflow(
  input: WorkflowInput,
  toolUseContext: ToolUseContext,
  resumeRunId: string | null,
): boolean {
  if (resumeRunId) return false
  if (input.resumeFromRunId) return false
  const permissionContext =
    typeof toolUseContext.getAppState === 'function'
      ? toolUseContext.getAppState().toolPermissionContext
      : undefined
  return permissionContext?.shouldAvoidPermissionPrompts === true
}

function buildRemoteWorkflowInitialMessage(
  source: string,
  input: WorkflowInput,
  meta: WorkflowMeta,
): string {
  const callInput: Record<string, unknown> = {
    script: source,
  }
  if (input.args !== undefined) callInput.args = input.args
  if (input.timeoutMs !== undefined) callInput.timeoutMs = input.timeoutMs

  return [
    `Run the dynamic workflow "${meta.name}" in this remote session.`,
    '',
    'Call Workflow with this exact input, monitor it until it completes, then summarize the final outcome for the user.',
    '',
    '```json',
    JSON.stringify(callInput, null, 2),
    '```',
  ].join('\n')
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

async function resolveSource(
  input: WorkflowInput,
): Promise<WorkflowSourceResolution> {
  if (typeof input.scriptPath === 'string' && input.scriptPath.trim()) {
    const scriptPath = input.scriptPath.trim()
    if (typeof input.script === 'string' && input.script) {
      return {
        source: input.script,
        resolvedScriptPath: resolve(scriptPath),
        scope: 'scriptPath',
      }
    }
    return { source: readWorkflowScriptFile(scriptPath), scope: 'scriptPath' }
  }
  if (typeof input.name === 'string' && input.name.trim()) {
    const named = await resolveNamedWorkflowSource(input.name)
    return { source: input.script ?? named.source, scope: named.scope }
  }
  if (typeof input.script === 'string' && input.script.trim()) {
    return { source: input.script, scope: 'inline' }
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

function workflowInvocationMode(input: WorkflowInput): 'scriptPath' | 'named' | 'inline' {
  if (typeof input.scriptPath === 'string' && input.scriptPath.trim()) {
    return 'scriptPath'
  }
  if (typeof input.name === 'string' && input.name.trim()) return 'named'
  return 'inline'
}

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function findRunningWorkflowResumeTask(
  tasks: Record<string, unknown> | null | undefined,
  resumeRunId: string | null,
): { taskId: string; workflowRunId: string } | null {
  if (!tasks || !resumeRunId) return null
  for (const [taskId, task] of Object.entries(tasks)) {
    const candidate = task as RunningWorkflowTask | null | undefined
    if (
      candidate?.type === 'local_workflow' &&
      candidate.status === 'running' &&
      (candidate.workflowRunId === resumeRunId || candidate.runId === resumeRunId)
    ) {
      return {
        taskId: candidate.id || taskId,
        workflowRunId: resumeRunId,
      }
    }
  }
  return null
}

function workflowResumeRunningMessage(
  resumeRunId: string,
  taskId: string,
): string {
  return `Workflow ${resumeRunId} is still running (task ${taskId}). Stop it first with TaskStop({task_id: "${taskId}"}) before resuming.`
}

function removeInactiveWorkflowResumeTasks(
  tasks: Record<string, unknown> | null | undefined,
  resumeRunId: string | null,
  setAppState: SetAppState,
): void {
  if (!tasks || !resumeRunId) return
  const staleTaskIds = Object.entries(tasks)
    .filter(([, task]) => {
      const candidate = task as RunningWorkflowTask | null | undefined
      return (
        candidate?.type === 'local_workflow' &&
        candidate.status !== 'running' &&
        (candidate.workflowRunId === resumeRunId || candidate.runId === resumeRunId)
      )
    })
    .map(([taskId]) => taskId)
  if (staleTaskIds.length === 0) return

  setAppState(prev => {
    const nextTasks = { ...prev.tasks }
    for (const taskId of staleTaskIds) {
      delete nextTasks[taskId]
    }
    return { ...prev, tasks: nextTasks }
  })
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

function shouldSkipWorkflowLaunchPrompt(
  permissionContext: ReturnType<ToolUseContext['getAppState']>['toolPermissionContext'],
): boolean {
  return (
    permissionContext.shouldAvoidPermissionPrompts === true ||
    permissionContext.mode === 'bypassPermissions' ||
    (permissionContext.mode === 'plan' &&
      permissionContext.isBypassPermissionsModeAvailable) ||
    (permissionContext.mode === 'auto' && isUltracodeActive())
  )
}

function getWorkflowLaunchConsentHash(input: WorkflowInput): string | null {
  try {
    return buildWorkflowPermissionReview(input).usageConsentHash
  } catch {
    return null
  }
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  aliases: ['RunWorkflow'],
  searchHint: 'orchestrate subagents with deterministic JavaScript workflow',
  maxResultSizeChars: 100_000,
  inputSchema,
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isWorkflowRuntimeEnabled()
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
  requiresUserInteraction() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.script ?? input.name ?? ''
  },
  async validateInput(input, context) {
    if (!isWorkflowRuntimeEnabled()) {
      return {
        result: false,
        message:
          'Dynamic workflows are not enabled for this session (runtime setting, launch gate, or environment override).',
        errorCode: 6,
      }
    }

    const resumeRunId = normalizeResumeRunId(input.resumeFromRunId)
    let source: string
    try {
      source = (await resolveSource(input)).source
    } catch (err) {
      return {
        result: false,
        message: messageFromError(err),
        errorCode: 1,
      }
    }

    let scriptBody: string
    try {
      const parsed = extractMeta(source)
      scriptBody = parsed.scriptBody
    } catch (err) {
      return {
        result: false,
        message: `Invalid workflow script: ${messageFromError(err)}`,
        errorCode: 2,
      }
    }

    const determinismError = checkWorkflowScriptDeterminism(scriptBody)
    if (determinismError) {
      return {
        result: false,
        message: determinismError,
        errorCode: 4,
      }
    }

    const runningResumeTask = findRunningWorkflowResumeTask(
      context.getAppState().tasks,
      resumeRunId,
    )
    if (runningResumeTask && resumeRunId) {
      return {
        result: false,
        message: workflowResumeRunningMessage(
          resumeRunId,
          runningResumeTask.taskId,
        ),
        errorCode: 3,
      }
    }

    return { result: true }
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
    }

    if (shouldSkipWorkflowLaunchPrompt(permissionContext)) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'mode',
          mode: permissionContext.mode,
        },
      }
    }

    if (workflowName) {

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

    if (hasRecordedWorkflowUsageConsent(getWorkflowLaunchConsentHash(input))) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'mode',
          mode: permissionContext.mode,
        },
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
    if (input.scriptPath) return `Workflow: ${input.scriptPath}`
    try {
      const src = typeof input.script === 'string' ? input.script : null
      if (src) {
        const { meta } = extractMeta(src)
        return `Workflow: ${meta.name} — ${meta.description}`
      }
    } catch {
      // fall through to a generic label if meta can't be parsed yet
    }
    return input.name ? `Workflow: ${input.name}` : WORKFLOW_TOOL_NAME
  },
  async call(input: WorkflowInput, toolUseContext, canUseTool) {
    // Resume path: reuse the prior runId for the journal. The script source
    // itself still has to be supplied by script, scriptPath, or name, matching
    // the official input contract.
    const resumeRunId = normalizeResumeRunId(input.resumeFromRunId)
    const runningResumeTask = findRunningWorkflowResumeTask(
      typeof toolUseContext.getAppState === 'function'
        ? toolUseContext.getAppState().tasks
        : undefined,
      resumeRunId,
    )
    if (runningResumeTask && resumeRunId) {
      throw new Error(
        workflowResumeRunningMessage(resumeRunId, runningResumeTask.taskId),
      )
    }
    const setTaskState =
      toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
    const runId = resumeRunId
      ? resumeRunId
      : `wf_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const taskId = generateTaskId('local_workflow')
    const { source, scope: workflowSourceScope } = await resolveSource(input)

    // Validate + surface meta early so a malformed script fails fast — for the
    // background path too, so the caller learns of a bad script synchronously.
    const { meta, scriptBody } = extractMeta(source)
    const determinismError = checkWorkflowScriptDeterminism(scriptBody)
    if (determinismError) {
      return {
        data: {
          status: 'async_launched',
          taskId,
          runId,
          summary: meta.description,
          error: determinismError,
        } satisfies WorkflowOutput,
      }
    }
    const syntaxCheck = checkWorkflowScriptSyntax(scriptBody)
    if ('error' in syntaxCheck) {
      return {
        data: {
          status: 'async_launched',
          taskId,
          runId,
          summary: meta.description,
          error: syntaxCheck.error,
        } satisfies WorkflowOutput,
      }
    }
    const workflowSource = workflowSourceForTelemetry(workflowSourceScope)

    if (shouldLaunchRemoteWorkflow(input, toolUseContext, resumeRunId)) {
      const remoteTaskId = generateTaskId('remote_agent')
      const initialMessage = buildRemoteWorkflowInitialMessage(
        source,
        input,
        meta,
      )
      const launched = await workflowRemoteDeps.launch({
        initialMessage,
        description: `Remote dynamic workflow: ${meta.name}`,
        title: `workflow: ${meta.name}`,
        ...(meta.model ? { model: meta.model } : {}),
        signal: toolUseContext.abortController?.signal ?? new AbortController().signal,
      })
      if (!launched?.id) {
        throw new Error('Failed to create remote workflow session.')
      }
      const sessionUrl = workflowRemoteDeps.getSessionUrl(launched.id)
      registerRemoteAgentTask({
        taskId: remoteTaskId,
        sessionId: launched.id,
        title: launched.title ?? `workflow: ${meta.name}`,
        description: meta.description,
        remoteTaskType: 'remote-workflow',
        command: initialMessage,
        sessionUrl,
        toolUseId: toolUseContext.toolUseId,
        setAppState: setTaskState,
        remoteTaskMetadata: {
          workflowName: meta.name,
          description: meta.description,
          phaseTitles: meta.phases?.map(phase => phase.title) ?? [],
        },
      })
      workflowRemoteDeps.startPolling({
        taskId: remoteTaskId,
        sessionId: launched.id,
        setAppState: setTaskState,
      })
      return {
        data: {
          status: 'remote_launched',
          taskId: remoteTaskId,
          summary: meta.description,
          sessionUrl,
        } satisfies WorkflowOutput,
      }
    }

    const prior = resumeRunId ? loadJournal(runId) : null
    const persistedScriptPath = runScriptPath(runId)
    const transcriptDir = workflowTranscriptDir(runId)
    removeInactiveWorkflowResumeTasks(
      typeof toolUseContext.getAppState === 'function'
        ? toolUseContext.getAppState().tasks
        : undefined,
      resumeRunId,
      setTaskState,
    )
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
    logWorkflowLaunchMetric({
      invocationMode: workflowInvocationMode(input),
      workflowSource,
      workflowName: meta.name,
      workflowDescription: meta.description,
      phaseCount: meta.phases?.length ?? 0,
      hasArgs: input.args !== undefined,
      isResume: Boolean(resumeRunId),
      scriptSizeChars: source.length,
    })

    // Official workflows are async launches: use an UNLINKED abort controller
    // so the workflow + subagents survive this tool call returning.
    const runAbort = new AbortController()

    const log: string[] = []
    const startedAtMs = Date.now()
    registerWorkflowTask({
      taskId,
      runId,
      workflowRunId: runId,
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
      updateWorkflowTaskProgress(taskId, e, setTaskState)
    }
    const emitBundledPhaseCompletionMetrics = () => {
      if (workflowSourceScope !== 'bundled') return
      if (typeof toolUseContext.getAppState !== 'function') return
      const task = toolUseContext.getAppState().tasks?.[taskId] as
        | { workflowProgress?: unknown }
        | undefined
      const workflowProgress = Array.isArray(task?.workflowProgress)
        ? task.workflowProgress
        : []
      logWorkflowPhaseCompletionMetrics({
        workflowRunId: runId,
        workflowSource: 'built-in',
        workflowName: meta.name,
        progress: workflowProgress,
      })
    }

    const limiter = createLimiter(defaultConcurrency())
    const budget = createBudget(
      getCurrentTurnTokenBudget(),
      getTurnOutputTokens(),
    )
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
      ) => registerWorkflowAgentController(taskId, agentNumber, controller),
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
          consumeWorkflowAgentControl(taskId, agentNumber),
        waitForResume: () => waitForWorkflowTaskResume(taskId, runAbort.signal),
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
    const emitCompletionMetric = (
      status: 'completed' | 'failed' | 'killed',
    ) => {
      logWorkflowCompletionMetric({
        workflowRunId: runId,
        workflowSource,
        workflowName: meta.name,
        workflowDescription: meta.description,
        status,
        agentCount: agentCount(),
        totalTokens: budget.spent(),
        totalToolCalls: totalToolCalls(),
        durationMs: durationMs(),
      })
    }

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
        emitCompletionMetric('completed')
        emitBundledPhaseCompletionMetrics()
        finalizeRunMeta(runId, {
          status: 'completed',
          agentCount: agentCount(),
          totalToolCalls: totalToolCalls(),
          tokensSpent: budget.spent(),
          failures: failures(),
          durationMs: durationMs(),
        })
        completeWorkflowTask(taskId, setTaskState, {
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
          status: killed ? 'killed' : 'failed',
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
        emitCompletionMetric(killed ? 'killed' : 'failed')
        emitBundledPhaseCompletionMetrics()
        if (killed) finishWorkflowTask(taskId, 'killed', setTaskState, patch)
        else
          failWorkflowTask(taskId, setTaskState, {
            ...patch,
            error: (err as Error).message,
          })
      })

    return {
      data: {
        status: 'async_launched',
        taskId,
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
