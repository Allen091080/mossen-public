// Cross-component channel for "the Agent View dashboard wants to attach to a
// supervisor job". The dashboard React tree can't unmount itself cleanly —
// once we leave React land we own stdio. So the shell-side entrypoint owns a
// loop that alternates between:
//
//   1. render(<Dashboard />) — Ink runs, takes stdio, user picks a job
//   2. on attach request: instance.unmount() — Ink lets go of stdio
//   3. run the raw PTY bridge — process.stdin/stdout flow to the worker
//   4. bridge exits (Ctrl-A d or job exit) → loop back to (1)
//
// React side (BackgroundTasksDialog) only needs to call
// `requestAgentViewAttach({...})`. The outer loop wakes up, tears the Ink
// instance down, and runs the bridge. The dashboard component can also
// signal "user wants to fully exit" via `requestAgentViewExit()`.

import { EventEmitter } from 'events'

export type AgentViewAttachRequest = {
  jobId: string
  socketPath: string
}

type SessionEvent =
  | { kind: 'attach'; req: AgentViewAttachRequest }
  | { kind: 'exit' }

const emitter = new EventEmitter()
emitter.setMaxListeners(0)

/**
 * Called by the React dashboard when the user presses Enter on a live
 * supervisor job. The shell-side loop picks this up, unmounts Ink, and runs
 * the PTY bridge against the worker's attach socket.
 */
export function requestAgentViewAttach(req: AgentViewAttachRequest): void {
  emitter.emit('agent_view_session', { kind: 'attach', req })
}

/**
 * Called when the dashboard wants to exit Agent View entirely. The shell-side
 * loop tears down the Ink instance and returns.
 */
export function requestAgentViewExit(): void {
  emitter.emit('agent_view_session', { kind: 'exit' })
}

/**
 * Awaitable that the shell-side loop uses each iteration. Resolves on the
 * next event published by the React dashboard.
 */
export function waitForAgentViewSessionEvent(): Promise<SessionEvent> {
  return new Promise(resolve => {
    const listener = (event: SessionEvent): void => {
      emitter.off('agent_view_session', listener)
      resolve(event)
    }
    emitter.once('agent_view_session', listener)
  })
}
