/**
 * Workflow keyword detection for the prompt input.
 *
 * Three standalone trigger words let the user opt into multi-agent
 * orchestration, mirroring the thinking/ultraplan keyword UX:
 *  - `workflow` / `workflows` — opt in for THIS message.
 *  - `ultrawork` — strongest single-turn orchestration for THIS message.
 *  - `ultracode` — turn ON standing (session-wide) orchestration mode.
 * All are highlighted (rainbow shimmer) and surface an opt-in notification.
 * Gated behind the same flag that enables the Workflow tool itself, so users
 * without orchestration never see a meaningless highlight.
 */

import { feature } from 'bun:bundle'
import { isUltracodeActive, setUltracodeActive } from '../bootstrap/state.js'
import { t } from './i18n/index.js'
import { isWorkflowKeywordTriggerEnabled } from './workflowAvailability.js'

export function isWorkflowKeywordEnabled(): boolean {
  // feature() from bun:bundle must appear directly in an if/ternary condition
  // (it is a build-time define target), so it cannot be returned directly.
  return feature('WORKFLOW_SCRIPTS') ? isWorkflowKeywordTriggerEnabled() : false
}

// Word-boundary, case-insensitive. `workflowy`, `reflow`, `ultraworking`,
// `ultracodebase` etc. must NOT match.
const WORKFLOW_RE = /\bworkflows?\b/i
const ULTRAWORK_RE = /\bultrawork\b/i
const ULTRACODE_RE = /\bultracode\b/i

export function hasWorkflowKeyword(text: string): boolean {
  return WORKFLOW_RE.test(text)
}

export function hasUltraworkKeyword(text: string): boolean {
  return ULTRAWORK_RE.test(text)
}

export function hasUltracodeKeyword(text: string): boolean {
  return ULTRACODE_RE.test(text)
}

/** True when the message contains any orchestration trigger word. */
export function hasAnyWorkflowTrigger(text: string): boolean {
  return (
    hasWorkflowKeyword(text) ||
    hasUltraworkKeyword(text) ||
    hasUltracodeKeyword(text)
  )
}

/**
 * Find positions of all three trigger keywords for highlighting.
 *
 * IMPORTANT: A fresh /g literal is created on every call. Reusing a module-level
 * /g regex would leak `lastIndex` between calls (and String.prototype.matchAll
 * copies lastIndex from the source regex), causing intermittent missed matches
 * on the next render. See the same note in thinking.ts. Do not hoist this regex.
 */
export function findWorkflowTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(/\b(?:workflows?|ultrawork|ultracode)\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

/**
 * Build the opt-in system-reminder wrapper for a submitted value.
 *
 * Pure and gate-injectable: `enabled` (and `ultracodeStanding`) are passed in so
 * the logic is testable without the build-time feature() macro or session state.
 * Additive and reversible — when no trigger applies, the value is returned
 * verbatim, never mutated in place.
 *
 * Reminder priority (strongest first): ultracode keyword > ultrawork keyword >
 * workflow keyword > already-standing ultracode mode.
 */
export function buildWorkflowReminder(
  value: string,
  enabled: boolean,
  ultracodeStanding = false,
): string | null {
  if (!enabled) return null
  // Slash commands (e.g. `/workflows`) merely contain the substring "workflows";
  // running one is not an opt-in to orchestration, so never attach a reminder.
  if (value.trimStart().startsWith('/')) return null
  let key:
    | 'ui.workflowKeyword.reminder'
    | 'ui.workflowKeyword.ultraworkReminder'
    | 'ui.workflowKeyword.ultracodeReminder'
    | 'ui.workflowKeyword.ultracodeStandingReminder'
    | null = null
  if (hasUltracodeKeyword(value)) {
    key = 'ui.workflowKeyword.ultracodeReminder'
  } else if (hasUltraworkKeyword(value)) {
    key = 'ui.workflowKeyword.ultraworkReminder'
  } else if (hasWorkflowKeyword(value)) {
    key = 'ui.workflowKeyword.reminder'
  } else if (ultracodeStanding) {
    key = 'ui.workflowKeyword.ultracodeStandingReminder'
  }
  if (!key) return null
  // Returns ONLY the reminder block. The caller injects it as a SEPARATE
  // isMeta user message (model-visible, user-hidden) — never concatenated into
  // the user's typed text. Concatenation is what leaked the reminder into the
  // transcript; the injection site is processTextPrompt.ts.
  return `<system-reminder>\n${t(key)}\n</system-reminder>`
}

/**
 * Production entry point: gate on the WORKFLOW_SCRIPTS build flag, then delegate
 * to the injectable, testable buildWorkflowReminder. Returns the reminder block
 * to inject as a separate isMeta message (model-visible, user-hidden), or null
 * when no trigger applies. Side effect: typing the `ultracode` keyword latches
 * standing orchestration mode ON for the session.
 */
export function workflowReminderFor(value: string): string | null {
  // Slash commands are never an orchestration opt-in. Bail before any side
  // effect: otherwise `/workflows ultracode on` would BOTH latch ultracode here
  // and emit a reminder.
  if (value.trimStart().startsWith('/')) return null
  const enabled = isWorkflowKeywordEnabled()
  if (enabled && hasUltracodeKeyword(value)) {
    setUltracodeActive(true)
  }
  return buildWorkflowReminder(value, enabled, enabled && isUltracodeActive())
}
