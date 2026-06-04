/**
 * runAgent-backed implementation of the engine's agent() primitive.
 *
 * This is the bridge from the workflow engine to Mossen's real subagent system:
 * each agent() call resolves an agent definition, assembles that agent's own
 * tool pool, runs it to completion via runAgent(), and returns the final text —
 * or, when a JSON Schema was supplied, a parsed-and-validated object (retrying
 * with the validation errors fed back, matching the public contract's
 * "model retries on mismatch" guarantee).
 *
 * The pure parse/validate/retry-decision logic lives in schemaValidate.ts and
 * is unit-tested there; this module is the thin I/O-bound wiring that can only
 * be exercised end-to-end via the workflow smoke test.
 */

import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext, Tools } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import type { ModelAlias } from '../../../utils/model/aliases.js'
import { assembleToolPool } from '../../../tools.js'
import { createUserMessage, extractTextContent } from '../../../utils/messages.js'
import { createAgentId } from '../../../utils/uuid.js'
import { getQuerySourceForAgent } from '../../../utils/promptCategory.js'
import { runAgent } from '../../AgentTool/runAgent.js'
import { finalizeAgentTool } from '../../AgentTool/agentToolUtils.js'
import {
  isBuiltInAgent,
  resolveAgentTypeFlexible,
  type AgentDefinition,
} from '../../AgentTool/loadAgentsDir.js'
import { GENERAL_PURPOSE_AGENT } from '../../AgentTool/built-in/generalPurposeAgent.js'
import {
  extractJson,
  formatIssues,
  stripLiteralThinking,
  validateAgainstSchema,
} from './schemaValidate.js'
import type { AgentCallOptions, AgentRunResult } from './types.js'
import type { RunOneAgent } from './runtime.js'

/** How many times to re-prompt an agent whose output fails schema validation. */
export const MAX_SCHEMA_RETRIES = 2

export class WorkflowSchemaError extends Error {
  constructor(label: string, detail: string) {
    super(`agent "${label}" did not return schema-valid output: ${detail}`)
    this.name = 'WorkflowSchemaError'
  }
}

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
    '\n\nIMPORTANT: Respond with ONLY a single JSON value conforming to this ' +
    'JSON Schema. No prose, no explanation, no markdown fences — raw JSON only.\n\n' +
    `JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  )
}

/** Create the engine's RunOneAgent backed by the real subagent runtime. */
export function createWorkflowAgentRunner(
  deps: WorkflowAgentRunnerDeps,
): RunOneAgent {
  const { toolUseContext, canUseTool, runId, abortController } = deps

  /** Run a single agent turn to completion; return its final text + tokens. */
  async function runOnce(
    agentDefinition: AgentDefinition,
    availableTools: Tools,
    promptText: string,
    model: ModelAlias | undefined,
    label: string,
  ): Promise<{ text: string; tokens: number }> {
    const startTime = Date.now()
    const agentId = createAgentId()
    const promptMessages: Message[] = [createUserMessage({ content: promptText })]
    const messages: Message[] = []
    for await (const message of runAgent({
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
      // Thread the (optionally unlinked) abort controller so background runs'
      // subagents survive the originating tool call returning.
      override: abortController
        ? { agentId, abortController }
        : { agentId },
      transcriptSubdir: `workflows/${runId}`,
    })) {
      messages.push(message)
    }
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
    }
  }

  return async function runOneAgent(
    prompt: string,
    opts: AgentCallOptions,
    meta: { agentNumber: number; phase: string | null; label: string },
  ): Promise<AgentRunResult> {
    const agentDefinition = resolveAgentDefinition(toolUseContext, opts.agentType)
    const appState = toolUseContext.getAppState()
    const workerPermissionContext = {
      ...appState.toolPermissionContext,
      mode: agentDefinition.permissionMode ?? ('acceptEdits' as const),
    }
    const availableTools = assembleToolPool(
      workerPermissionContext,
      appState.mcp.tools,
    )
    const model = opts.model as ModelAlias | undefined

    // No schema → return the agent's final text verbatim.
    if (!opts.schema) {
      const { text, tokens } = await runOnce(
        agentDefinition,
        availableTools,
        prompt,
        model,
        meta.label,
      )
      return { value: text, tokens, ok: true }
    }

    // Schema → instruct for JSON, then parse+validate with re-prompt on failure.
    // promptText carries the schema instruction (and, on retry, the rejection
    // feedback) — runOnce must receive promptText, not the bare prompt.
    let promptText = prompt + buildSchemaInstruction(opts.schema)
    let totalTokens = 0
    let lastDetail = ''
    for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
      const { text, tokens } = await runOnce(
        agentDefinition,
        availableTools,
        promptText,
        model,
        meta.label,
      )
      totalTokens += tokens
      try {
        const parsed = extractJson(text)
        const validation = validateAgainstSchema(parsed, opts.schema)
        if (validation.ok) {
          return { value: validation.value, tokens: totalTokens, ok: true }
        }
        lastDetail = formatIssues(validation.errors)
      } catch (err) {
        lastDetail = (err as Error).message
      }
      // Re-prompt with the specific failure so the model can correct itself.
      promptText =
        prompt +
        buildSchemaInstruction(opts.schema) +
        `\n\nYour previous response was rejected:\n${lastDetail}\n` +
        'Return corrected JSON only.'
    }
    throw new WorkflowSchemaError(meta.label, lastDetail)
  }
}
