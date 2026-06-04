/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../constants/figures.js'
import { count } from '../utils/array.js'
import type { BackgroundTaskState } from './types.js'

function allTasksPending(tasks: BackgroundTaskState[]): boolean {
  return tasks.length > 0 && tasks.every(task => task.status === 'pending')
}

function prefixStartingIfPending(
  tasks: BackgroundTaskState[],
  label: string,
): string {
  return allTasksPending(tasks) ? `starting ${label}` : label
}

/**
 * Produces the compact footer-pill label for a set of background tasks.
 * Used by both the footer pill and the turn-duration transcript line so the
 * two surfaces agree on terminology.
 */
export function getPillLabel(tasks: BackgroundTaskState[]): string {
  const n = tasks.length
  const allSameType = tasks.every(t => t.type === tasks[0]!.type)
  const pendingOnly = allTasksPending(tasks)

  if (allSameType) {
    switch (tasks[0]!.type) {
      case 'local_bash': {
        const monitors = count(
          tasks,
          t => t.type === 'local_bash' && t.kind === 'monitor',
        )
        const shells = n - monitors
        const parts: string[] = []
        if (shells > 0)
          parts.push(
            prefixStartingIfPending(
              tasks,
              shells === 1 ? '1 shell' : `${shells} shells`,
            ),
          )
        if (monitors > 0)
          parts.push(
            prefixStartingIfPending(
              tasks,
              monitors === 1 ? '1 monitor' : `${monitors} monitors`,
            ),
          )
        return parts.join(', ')
      }
      case 'in_process_teammate': {
        const teamCount = new Set(
          tasks.map(t =>
            t.type === 'in_process_teammate' ? t.identity.teamName : '',
          ),
        ).size
        return prefixStartingIfPending(
          tasks,
          teamCount === 1 ? '1 team' : `${teamCount} teams`,
        )
      }
      case 'local_agent':
        return prefixStartingIfPending(
          tasks,
          n === 1 ? '1 local agent' : `${n} local agents`,
        )
      case 'local_workflow':
        return prefixStartingIfPending(
          tasks,
          n === 1 ? '1 background workflow' : `${n} background workflows`,
        )
      case 'monitor_mcp':
        return prefixStartingIfPending(
          tasks,
          n === 1 ? '1 monitor' : `${n} monitors`,
        )
      case 'dream':
        return pendingOnly ? 'starting dream' : 'dreaming'
    }
  }

  return pendingOnly
    ? `starting ${n} background ${n === 1 ? 'task' : 'tasks'}`
    : `${n} background ${n === 1 ? 'task' : 'tasks'}`
}

/**
 * True when the pill should show the dimmed " · ↓ to view" call-to-action.
 * Per the state diagram: only the two attention states (needs_input,
 * plan_ready) surface the CTA; plain running shows just the diamond + label.
 */
export function pillNeedsCta(_tasks: BackgroundTaskState[]): boolean {
  return false
}
