/**
 * In-flight tool registry — lets SDK consumers cancel a single tool by its
 * `tool_use_id` via the `control_request { subtype: 'tool_cancel' }`
 * protocol without aborting the whole turn.
 *
 * The producer (StreamingToolExecutor) registers a tool's per-execution
 * AbortController right before invoking the tool body and removes it on
 * any completion path (success, error, sibling-cascade, discard). The
 * consumer (cli/print.ts) looks up the controller by tool_use_id and
 * aborts it with reason `'tool_cancel'`; sibling tools in the same turn
 * keep running because each tool's controller is a leaf child of the
 * turn-level controller.
 *
 * Single-process by design: every running mossen owns the registry for
 * the tools it is currently executing. Multi-turn sessions reuse the
 * same registry (different ids per turn). Tools that never reach the
 * execution boundary (synthetic-error path, immediate completion) are
 * never registered, so lookup returns `false` for them — the consumer
 * sees `{cancelled: false}` and knows the work was already done.
 */

const inFlightToolControllers = new Map<string, AbortController>()

export function registerInFlightTool(
  toolUseId: string,
  controller: AbortController,
): void {
  inFlightToolControllers.set(toolUseId, controller)
}

export function unregisterInFlightTool(toolUseId: string): void {
  inFlightToolControllers.delete(toolUseId)
}

export type CancelToolResult = {
  cancelled: boolean
  reason: 'aborted' | 'unknown_id' | 'already_aborted'
}

export function cancelInFlightTool(
  toolUseId: string,
  reason = 'tool_cancel',
): CancelToolResult {
  const controller = inFlightToolControllers.get(toolUseId)
  if (!controller) {
    return { cancelled: false, reason: 'unknown_id' }
  }
  if (controller.signal.aborted) {
    return { cancelled: false, reason: 'already_aborted' }
  }
  controller.abort(reason)
  return { cancelled: true, reason: 'aborted' }
}

// Test-only helpers — exported separately to keep the production surface
// minimal. Used by W425 smoke; do not call from production code.
export function __resetInFlightToolRegistryForTests(): void {
  inFlightToolControllers.clear()
}

export function __peekInFlightToolRegistrySizeForTests(): number {
  return inFlightToolControllers.size
}
