const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

// Bounds for the optional `--turns N` flag on `/goal set`. Mirror the clamp in
// getSessionGoalMaxTurns so a per-goal budget can't exceed the global ceiling.
const TURN_BUDGET_MIN = 1
const TURN_BUDGET_MAX = 500

function maskCodeSpans(text: string): string {
  const chars = text.split('')
  let inInlineCode = false
  let inFence = false
  for (let index = 0; index < chars.length; index++) {
    if (
      chars[index] === '`' &&
      chars[index + 1] === '`' &&
      chars[index + 2] === '`'
    ) {
      inFence = !inFence
      chars[index] = ' '
      chars[index + 1] = ' '
      chars[index + 2] = ' '
      index += 2
      continue
    }
    if (!inFence && chars[index] === '`') {
      inInlineCode = !inInlineCode
      chars[index] = ' '
      continue
    }
    if (inFence || inInlineCode) {
      chars[index] = chars[index] === '\n' ? '\n' : ' '
    }
  }
  return chars.join('')
}

function cleanupFlagText(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim()
}

function findTextFlag(
  text: string,
  flag: 'criteria' | 'constraints',
): {
  start: number
  end: number
  value: string
} | null {
  const masked = maskCodeSpans(text)
  const pattern = new RegExp(`(?:^|\\s)--${flag}(?:=|\\s+)`, 'i')
  const match = pattern.exec(masked)
  if (!match) return null
  const valueStart = match.index + match[0].length
  const quote = text[valueStart]
  if (quote === '"' || quote === "'") {
    const quoteEnd = text.indexOf(quote, valueStart + 1)
    const end = quoteEnd === -1 ? text.length : quoteEnd + 1
    return {
      start: match.index,
      end,
      value: text.slice(valueStart + 1, quoteEnd === -1 ? text.length : quoteEnd),
    }
  }
  const nextFlag = /\s--(?:criteria|constraints|turns)\b/i.exec(
    masked.slice(valueStart),
  )
  const end = nextFlag ? valueStart + nextFlag.index : text.length
  return {
    start: match.index,
    end,
    value: text.slice(valueStart, end),
  }
}

/**
 * Extract a `--turns N` (or `--turns=N`) flag from goal text. Returns the
 * cleaned goal text plus the parsed budget (clamped to [1,500]), or undefined
 * budget when the flag is absent or its value is non-numeric.
 */
export function extractTurnBudget(text: string): {
  text: string
  turnBudget?: number
} {
  const masked = maskCodeSpans(text)
  const match = /(?:^|\s)--turns(?:=|\s+)(\d+)(?=\s|$)/i.exec(masked)
  if (!match) return { text }
  const cleaned = (
    text.slice(0, match.index) + text.slice(match.index + match[0].length)
  )
  const normalized = cleanupFlagText(cleaned)
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return { text: normalized }
  const turnBudget = Math.min(
    TURN_BUDGET_MAX,
    Math.max(TURN_BUDGET_MIN, Math.floor(parsed)),
  )
  return { text: normalized, turnBudget }
}

function extractTextFlag(text: string, flag: 'criteria' | 'constraints'): {
  text: string
  value?: string
} {
  const match = findTextFlag(text, flag)
  if (!match) return { text }
  const value = match.value.trim()
  const cleaned = cleanupFlagText(text.slice(0, match.start) + text.slice(match.end))
  return value ? { text: cleaned, value } : { text: cleaned }
}

export function extractGoalContract(text: string): {
  text: string
  successCriteria?: string
  constraints?: string
} {
  const criteria = extractTextFlag(text, 'criteria')
  const constraints = extractTextFlag(criteria.text, 'constraints')
  return {
    text: constraints.text,
    ...(criteria.value ? { successCriteria: criteria.value } : {}),
    ...(constraints.value ? { constraints: constraints.value } : {}),
  }
}

export type SessionGoalCommandAction =
  | 'status'
  | 'set'
  | 'clear'
  | 'done'
  | 'pause'
  | 'resume'
  | 'explain'
  | 'edit'
  | 'budget'
  | 'history'
  | 'doctor'
  | 'board'

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
  if (action === 'edit') return { action, body }
  if (action === 'budget') return { action, body }
  if (action === 'history') return { action, body }
  if (action === 'board' || action === 'loop') return { action: 'board', body }
  if (action === 'doctor' || action === 'diagnostics' || action === 'diag') {
    return { action: 'doctor', body }
  }
  if (action === 'why' || action === 'explain') return { action: 'explain', body }
  if (action === 'set') return { action, body }
  return { action: 'set', body: trimmed }
}
