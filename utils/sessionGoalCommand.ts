const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

// Bounds for the optional `--turns N` flag on `/goal set`. Mirror the clamp in
// getSessionGoalMaxTurns so a per-goal budget can't exceed the global ceiling.
const TURN_BUDGET_MIN = 1
const TURN_BUDGET_MAX = 500

/**
 * Extract a `--turns N` (or `--turns=N`) flag from goal text. Returns the
 * cleaned goal text plus the parsed budget (clamped to [1,500]), or undefined
 * budget when the flag is absent or its value is non-numeric.
 */
export function extractTurnBudget(text: string): {
  text: string
  turnBudget?: number
} {
  const match = /(?:^|\s)--turns(?:=|\s+)(\d+)(?=\s|$)/i.exec(text)
  if (!match) return { text }
  const cleaned = (
    text.slice(0, match.index) + text.slice(match.index + match[0].length)
  )
    .replace(/\s{2,}/g, ' ')
    .trim()
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return { text: cleaned }
  const turnBudget = Math.min(
    TURN_BUDGET_MAX,
    Math.max(TURN_BUDGET_MIN, Math.floor(parsed)),
  )
  return { text: cleaned, turnBudget }
}

export type SessionGoalCommandAction =
  | 'status'
  | 'set'
  | 'clear'
  | 'done'
  | 'pause'
  | 'resume'
  | 'explain'

export function parseSessionGoalAction(args: string): {
  action: SessionGoalCommandAction
  body: string
} {
  const trimmed = args.trim()
  if (!trimmed) return { action: 'status', body: '' }
  const firstSpace = trimmed.search(/\s/)
  const action =
    firstSpace === -1
      ? trimmed.toLowerCase()
      : trimmed.slice(0, firstSpace).toLowerCase()
  const body = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()
  if (action === 'status') return { action, body }
  if (CLEAR_ALIASES.has(action)) return { action: 'clear', body }
  if (action === 'done' || action === 'complete') return { action: 'done', body }
  if (action === 'pause') return { action, body }
  if (action === 'resume') return { action, body }
  if (action === 'why' || action === 'explain') return { action: 'explain', body }
  if (action === 'set') return { action, body }
  return { action: 'set', body: trimmed }
}
