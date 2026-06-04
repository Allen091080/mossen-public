/**
 * runAgent-backed implementation of the engine's agent() primitive.
 *
 * This is the bridge from the workflow engine to Mossen's real subagent system:
 * each agent() call resolves an agent definition, assembles that agent's own
 * tool pool, runs it to completion via runAgent(), and returns the final text —
 * or, when a JSON Schema was supplied, injects a schema-specific
 * StructuredOutput tool and returns the tool-provided object (retrying when the
 * agent fails to call the tool or the result is rejected).
 *
 * The pure parse/validate/retry-decision logic lives in schemaValidate.ts and
 * is unit-tested there; this module is the thin I/O-bound wiring that can only
 * be exercised end-to-end via the workflow smoke test.
 */

import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext, Tools } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import { createChildAbortController } from '../../../utils/abortController.js'
import type { ModelAlias } from '../../../utils/model/aliases.js'
import { assembleToolPool } from '../../../tools.js'
import { createUserMessage, extractTextContent } from '../../../utils/messages.js'
import { createAgentId } from '../../../utils/uuid.js'
import { getQuerySourceForAgent } from '../../../utils/promptCategory.js'
import { runWithCwdOverride } from '../../../utils/cwd.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  createAgentWorktree,
  hasWorktreeChanges,
  removeAgentWorktree,
} from '../../../utils/worktree.js'
import { runAgent } from '../../AgentTool/runAgent.js'
import { finalizeAgentTool } from '../../AgentTool/agentToolUtils.js'
import {
  isBuiltInAgent,
  resolveAgentTypeFlexible,
  type AgentDefinition,
} from '../../AgentTool/loadAgentsDir.js'
import { GENERAL_PURPOSE_AGENT } from '../../AgentTool/built-in/generalPurposeAgent.js'
import {
  createSyntheticOutputTool,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '../../SyntheticOutputTool/SyntheticOutputTool.js'
import {
  formatIssues,
  stripLiteralThinking,
  validateAgainstSchema,
} from './schemaValidate.js'
import type { AgentCallOptions, AgentRunResult } from './types.js'
import {
  WORKFLOW_AGENT_RETRY_ABORT_REASON,
  WORKFLOW_AGENT_SKIP_ABORT_REASON,
} from './types.js'
import type { RunOneAgent } from './runtime.js'

/** How many times to re-prompt an agent whose output fails schema validation. */
export const MAX_SCHEMA_RETRIES = 2

export class WorkflowSchemaError extends Error {
  constructor(label: string, detail: string) {
    super(`agent "${label}" did not return schema-valid output: ${detail}`)
    this.name = 'WorkflowSchemaError'
  }
}

type WorkflowAgentWorktreeInfo = Awaited<ReturnType<typeof createAgentWorktree>>

export type WorkflowAgentRunnerDeps = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  /** Groups subagent transcripts under subagents/workflows/<runId>/. */
  runId: string
  /**
   * Optional abort controller for the run. When the workflow runs in the
   * background (S2), this is an UNLINKED controller so spawned subagents keep
   * running after the originating tool call returns; if omitted, subagents
   * inherit the parent turn's controller (foreground behaviour).
   */
  abortController?: AbortController
  registerAgentController?: (
    agentNumber: number,
    controller: AbortController,
  ) => () => void
}

function resolveAgentDefinition(
  toolUseContext: ToolUseContext,
  requested: string | undefined,
): AgentDefinition {
  const wanted = requested?.trim() || GENERAL_PURPOSE_AGENT.agentType
  const agents = toolUseContext.options.agentDefinitions.activeAgents
  const resolved = resolveAgentTypeFlexible(agents, wanted)
  if (resolved.kind === 'found') return resolved.agent
  // Fall back to general-purpose so a workflow never hard-fails on an unknown
  // agentType — the script author gets the default research agent.
  if (wanted === GENERAL_PURPOSE_AGENT.agentType) return GENERAL_PURPOSE_AGENT
  const known = agents.map(a => a.agentType).join(', ')
  throw new Error(
    `Workflow agent type "${wanted}" not found. Available: ${known || '(none)'}`,
  )
}

function buildSchemaInstruction(schema: Record<string, unknown>): string {
  return (
    `\n\nIMPORTANT: Complete this task by calling the ${SYNTHETIC_OUTPUT_TOOL_NAME} ` +
    'tool exactly once with data conforming to this JSON Schema. Do not return ' +
    'the structured result as prose or raw JSON text.\n\n' +
    `JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  )
}

export function withStructuredOutputTool(
  availableTools: Tools,
  schema: Record<string, unknown>,
  label: string,
): Tools {
  const created = createSyntheticOutputTool(schema)
  if ('error' in created) {
    throw new WorkflowSchemaError(label, `invalid schema: ${created.error}`)
  }
  return [
    ...availableTools.filter(tool => tool.name !== SYNTHETIC_OUTPUT_TOOL_NAME),
    created.tool,
  ]
}

export function withStructuredOutputAllowed(
  agentDefinition: AgentDefinition,
): AgentDefinition {
  const tools = agentDefinition.tools
  if (
    tools === undefined ||
    (tools.length === 1 && tools[0] === '*') ||
    tools.includes(SYNTHETIC_OUTPUT_TOOL_NAME)
  ) {
    return agentDefinition
  }
  return {
    ...agentDefinition,
    tools: [...tools, SYNTHETIC_OUTPUT_TOOL_NAME],
  }
}

export function extractStructuredOutputFromMessages(
  messages: Message[],
): unknown | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (
      message?.type === 'attachment' &&
      message.attachment?.type === 'structured_output'
    ) {
      return message.attachment.data
    }
  }
  return undefined
}

function workflowAgentWorktreeSlug(runId: string, agentNumber: number): string {
  const safeRunId =
    runId
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'wf'
  return `${safeRunId}-${agentNumber}`
}

async function cleanupWorkflowAgentWorktree(
  worktreeInfo: WorkflowAgentWorktreeInfo | null,
): Promise<void> {
  if (!worktreeInfo) return
  const { worktreePath, worktreeBranch, headCommit, gitRoot, hookBased } =
    worktreeInfo

  if (hookBased) {
    logForDebugging(`Hook-based workflow agent worktree kept at: ${worktreePath}`)
    return
  }

  if (headCommit) {
    const changed = await hasWorktreeChanges(worktreePath, headCommit)
    if (!changed) {
      await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot)
      return
    }
  }

  logForDebugging(`Workflow agent worktree has changes, keeping: ${worktreePath}`)
}

/** Create the engine's RunOneAgent backed by the real subagent runtime. */
export function createWorkflowAgentRunner(
  deps: WorkflowAgentRunnerDeps,
): RunOneAgent {
  const {
    toolUseContext,
    canUseTool,
    runId,
    abortController,
    registerAgentController,
  } = deps

  /** Run a single agent turn to completion; return its final text + tokens. */
  async function runOnce(
    agentDefinition: AgentDefinition,
    availableTools: Tools,
    promptText: string,
    model: ModelAlias | undefined,
    label: string,
    worktreePath: string | undefined,
    agentAbortController: AbortController | undefined,
  ): Promise<{ text: string; tokens: number; structuredOutput?: unknown }> {
    const startTime = Date.now()
    const agentId = createAgentId()
    const promptMessages: Message[] = [createUserMessage({ content: promptText })]
    const messages: Message[] = []
    const run = () =>
      runAgent({
        agentDefinition,
        promptMessages,
        toolUseContext,
        canUseTool,
        isAsync: false,
        availableTools,
        querySource: getQuerySourceForAgent(
          agentDefinition.agentType,
          isBuiltInAgent(agentDefinition),
        ),
        model,
        description: label,
        worktreePath,
        // Thread the (optionally unlinked) abort controller so background runs'
        // subagents survive the originating tool call returning.
        override: agentAbortController
          ? { agentId, abortController: agentAbortController }
          : { agentId },
        transcriptSubdir: `workflows/${runId}`,
      })
    const stream = worktreePath
      ? runWithCwdOverride(worktreePath, run)
      : run()
    for await (const message of stream) {
      messages.push(message)
    }
    const structuredOutput = extractStructuredOutputFromMessages(messages)
    const result = finalizeAgentTool(messages, agentId, {
      prompt: promptText,
      resolvedAgentModel: model ?? agentDefinition.model ?? 'inherit',
      isBuiltInAgent: isBuiltInAgent(agentDefinition),
      startTime,
      agentType: agentDefinition.agentType,
      isAsync: false,
    })
    return {
      // Strip any literal <think>…</think> the model emitted as plain text, so
      // the workflow's return value (and any downstream schema parse) sees clean
      // output. Structured thinking blocks are already dropped by
      // extractTextContent; this catches the text-literal variant.
      text: stripLiteralThinking(extractTextContent(result.content, '\n')),
      tokens: result.totalTokens,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    }
  }

  return async function runOneAgent(
    prompt: string,
    opts: AgentCallOptions,
    meta: { agentNumber: number; phase: string | null; label: string },
  ): Promise<AgentRunResult> {
    const agentDefinition = resolveAgentDefinition(toolUseContext, opts.agentType)
    const agentAbortController = abortController
      ? createChildAbortController(abortController)
      : undefined
    const unregisterAgentController = agentAbortController
      ? registerAgentController?.(meta.agentNumber, agentAbortController)
      : undefined
    const worktreeInfo =
      opts.isolation === 'worktree'
        ? await createAgentWorktree(
            workflowAgentWorktreeSlug(runId, meta.agentNumber),
          )
        : null
    const appState = toolUseContext.getAppState()
    const workerPermissionContext = {
      ...appState.toolPermissionContext,
      mode: agentDefinition.permissionMode ?? ('acceptEdits' as const),
    }
    const baseAvailableTools = assembleToolPool(
      workerPermissionContext,
      appState.mcp.tools,
    )
    const model = opts.model as ModelAlias | undefined

    try {
      // No schema → return the agent's final text verbatim.
      if (!opts.schema) {
        const { text, tokens } = await runOnce(
          agentDefinition,
          baseAvailableTools,
          prompt,
          model,
          meta.label,
          worktreeInfo?.worktreePath,
          agentAbortController,
        )
        return { value: text, tokens, ok: true }
      }

      // Schema → require the StructuredOutput tool, then validate+retry on failure.
      // promptText carries the schema instruction (and, on retry, the rejection
      // feedback) — runOnce must receive promptText, not the bare prompt.
      const schemaAgentDefinition = withStructuredOutputAllowed(agentDefinition)
      const schemaTools = withStructuredOutputTool(
        baseAvailableTools,
        opts.schema,
        meta.label,
      )
      let promptText = prompt + buildSchemaInstruction(opts.schema)
      let totalTokens = 0
      let lastDetail = ''
      for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
        const { tokens, structuredOutput } = await runOnce(
          schemaAgentDefinition,
          schemaTools,
          promptText,
          model,
          meta.label,
          worktreeInfo?.worktreePath,
          agentAbortController,
        )
        totalTokens += tokens
        if (structuredOutput === undefined) {
          lastDetail = `the agent never called the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool`
        } else {
          const validation = validateAgainstSchema(structuredOutput, opts.schema)
          if (validation.ok) {
            return { value: validation.value, tokens: totalTokens, ok: true }
          }
          lastDetail = formatIssues(validation.errors)
        }
        // Re-prompt with the specific failure so the model can correct itself.
        promptText =
          prompt +
          buildSchemaInstruction(opts.schema) +
          `\n\nYour previous response was rejected:\n${lastDetail}\n` +
          `Call ${SYNTHETIC_OUTPUT_TOOL_NAME} with corrected data only.`
      }
      throw new WorkflowSchemaError(meta.label, lastDetail)
    } catch (err) {
      if (agentAbortController?.signal.aborted) {
        if (agentAbortController.signal.reason === WORKFLOW_AGENT_SKIP_ABORT_REASON) {
          return { value: null, tokens: 0, ok: false, status: 'skipped' }
        }
        if (agentAbortController.signal.reason === WORKFLOW_AGENT_RETRY_ABORT_REASON) {
          return {
            value: null,
            tokens: 0,
            ok: false,
            status: 'retry_requested',
          }
        }
      }
      throw err
    } finally {
      unregisterAgentController?.()
      await cleanupWorkflowAgentWorktree(worktreeInfo)
    }
  }
}
