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

/** The `export const meta = {...}` literal at the top of every workflow. */
export type WorkflowMeta = {
  name: string
  description: string
  whenToUse?: string
  phases?: WorkflowPhaseMeta[]
  model?: string
}

/** Options accepted by the in-script `agent()` primitive. */
export type AgentCallOptions = {
  label?: string
  phase?: string
  /** JSON Schema; when present the agent result is validated & returned as an object. */
  schema?: Record<string, unknown>
  model?: string
  isolation?: 'worktree'
  agentType?: string
}

/** A progress event emitted by the engine while a workflow runs. */
export type WorkflowProgressEvent =
  | { kind: 'phase'; title: string }
  | { kind: 'log'; message: string }
  | {
      kind: 'agent_start'
      label: string
      phase: string | null
      agentNumber: number
    }
  | {
      kind: 'agent_end'
      label: string
      phase: string | null
      agentNumber: number
      ok: boolean
      tokens: number
    }

/** Sink the runtime uses to surface progress to the WorkflowTool call(). */
export type ProgressSink = (event: WorkflowProgressEvent) => void

/** Result of a single agent run inside the engine. */
export type AgentRunResult = {
  /** The agent's final text, or the schema-validated object when a schema was given. */
  value: unknown
  /** Output tokens attributed to this run (best-effort). */
  tokens: number
  ok: boolean
}
