/**
 * Shared types for the workflow engine.
 *
 * A workflow is a JavaScript script that begins with an `export const meta`
 * literal and then drives subagents through the engine primitives
 * (agent / parallel / pipeline / phase / log / workflow). The engine evaluates
 * the script in a controlled context and streams progress back to the caller.
 */

/** A single phase entry in the meta block (for the progress display). */
export type WorkflowPhaseMeta = {
  title: string
  detail?: string
  model?: string
}

export type WorkflowPhaseInput = string | WorkflowPhaseMeta

export type WorkflowRecentToolCall = {
  name: string
  summary?: string
}

/** The `export const meta = {...}` literal at the top of every workflow. */
export type WorkflowMeta = {
  name: string
  description: string
  title?: string
  whenToUse?: string
  phases?: WorkflowPhaseMeta[]
  model?: string
}

/** Options accepted by the in-script `agent()` primitive. */
export type AgentCallOptions = {
  label?: string
  phase?: WorkflowPhaseInput
  /** JSON Schema; when present the agent result is validated & returned as an object. */
  schema?: Record<string, unknown>
  model?: string
  isolation?: 'worktree' | 'remote'
  agentType?: string
}

export type WorkflowAgentProgressMeta = {
  agentType?: string
  model?: string
  isolation?: 'worktree' | 'remote'
  promptPreview?: string
  queuedAt?: number
  startedAt?: number
  lastProgressAt?: number
  remoteSessionId?: string
  lastAttemptReason?: string
  lastToolName?: string
  lastToolSummary?: string
  recentToolCalls?: WorkflowRecentToolCall[]
  resultPreview?: string
}

export type WorkflowAgentProgressUpdate = {
  tokens?: number
  toolCalls?: number
  lastToolName?: string
  lastToolSummary?: string
  recentToolCalls?: WorkflowRecentToolCall[]
  resultPreview?: string
}

/** A progress event emitted by the engine while a workflow runs. */
export type WorkflowProgressEvent =
  | { kind: 'phase'; title: string }
  | { kind: 'log'; message: string }
  | ({
      kind: 'agent_queued'
      label: string
      phase: string | null
      agentNumber: number
    } & WorkflowAgentProgressMeta)
  | ({
      kind: 'agent_start'
      label: string
      phase: string | null
      agentNumber: number
    } & WorkflowAgentProgressMeta)
  | ({
      kind: 'agent_progress'
      label: string
      phase: string | null
      agentNumber: number
      tokens?: number
      toolCalls?: number
    } & WorkflowAgentProgressMeta)
  | ({
      kind: 'agent_end'
      label: string
      phase: string | null
      agentNumber: number
      ok: boolean
      status?: 'completed' | 'failed' | 'skipped' | 'cached'
      error?: string
      tokens: number
      toolCalls?: number
      durationMs?: number
    } & WorkflowAgentProgressMeta)

/** Sink the runtime uses to surface progress to the WorkflowTool call(). */
export type ProgressSink = (event: WorkflowProgressEvent) => void

/** Result of a single agent run inside the engine. */
export type AgentRunResult = {
  /** The agent's final text, or the schema-validated object when a schema was given. */
  value: unknown
  /** Output tokens attributed to this run (best-effort). */
  tokens: number
  /** Tool calls made by this agent run (best-effort). */
  toolCalls?: number
  ok: boolean
  /** Internal control result for user-driven workflow task controls. */
  status?: 'completed' | 'failed' | 'skipped' | 'retry_requested' | 'stalled'
  /** Idle timeout that caused a stalled result, when status is 'stalled'. */
  stallTimeoutMs?: number
  /** Wall-clock time spent running this agent attempt. */
  durationMs?: number
  /** Hosted remote session id for remote workflow agents. */
  remoteSessionId?: string
}

export type WorkflowAgentControlAction = 'skip' | 'retry'

export const WORKFLOW_AGENT_SKIP_ABORT_REASON = 'workflow_agent_skipped'
export const WORKFLOW_AGENT_RETRY_ABORT_REASON = 'workflow_agent_retry'
export const WORKFLOW_AGENT_STALL_ABORT_REASON = 'workflow_agent_stalled'
