/**
 * Workflow keyword detection for the prompt input.
 *
 * Command-style keyword prefixes, explicit natural-language requests, and
 * strong trigger words let the user opt into multi-agent orchestration,
 * mirroring the thinking keyword UX:
 *  - `workflow` / `workflows` at the start of the prompt — opt in for THIS message.
 *  - `ultracode` — single-turn orchestration for THIS message.
 *  - “use/run a workflow” — natural-language opt-in for THIS message.
 * Keyword prefixes/triggers are highlighted (rainbow shimmer) and surface an
 * opt-in notification; natural-language requests inject only the model-visible
 * reminder so incidental mentions of workflows do not light up the prompt.
 * Gated behind the same flag that enables the Workflow tool itself, so users
 * without orchestration never see a meaningless highlight.
 */

import { feature } from 'bun:bundle'
import { isUltracodeActive } from '../bootstrap/state.js'
import { t } from './i18n/index.js'
import { isWorkflowKeywordTriggerEnabled } from './workflowAvailability.js'

export function isWorkflowKeywordEnabled(): boolean {
  // feature() from bun:bundle must appear directly in an if/ternary condition
  // (it is a build-time define target), so it cannot be returned directly.
  return feature('WORKFLOW_SCRIPTS') ? isWorkflowKeywordTriggerEnabled() : false
}

// Word-boundary, case-insensitive. `workflowy`, `reflow`, `ultracodebase`,
// etc. must NOT match. The workflow keyword itself only triggers as a
// command-style prefix so ordinary mid-sentence mentions remain inert.
const WORKFLOW_PREFIX_COMMAND_RE = /^\s*workflows?\b/i
const ULTRACODE_RE = /\bultracode\b/i
const WORKFLOW_DIRECT_REQUEST_RE =
  /\b(?:use|run|launch|start|write|create|build)\s+(?:a\s+)?workflows?\b/i
const BROAD_PARALLEL_REQUEST_RE =
  /\b(?:comprehensive|broad|large[-\s]?scale)\s+parallel\s+(?:review|audit|research|analysis|sweep)\b/i
const MULTI_AGENT_REQUEST_RE =
  /\bmulti[-\s]?agent\s+(?:orchestration|research|review|audit|analysis|parallel|fan[-\s]?out)\b/i
const FANOUT_AGENT_REQUEST_RE =
  /\bfan[-\s]?out\s+(?:with|to|across)\s+(?:multiple|many)\s+(?:agents|subagents)\b/i
const suppressedWorkflowReminderPrompts = new Set<string>()
const MACOS_OPTION_W_CHAR = '∑'

type WorkflowKeywordDismissKey = {
  meta?: boolean
  ctrl?: boolean
  backspace?: boolean
}

type WorkflowTriggerPosition = {
  end: number
}

export function hasWorkflowKeyword(text: string): boolean {
  return hasWorkflowPrefixCommand(text) || hasWorkflowDirectRequest(text)
}

export function hasUltracodeKeyword(text: string): boolean {
  return ULTRACODE_RE.test(text)
}

function hasWorkflowPrefixCommand(text: string): boolean {
  return WORKFLOW_PREFIX_COMMAND_RE.test(text)
}

export function hasWorkflowDirectRequest(text: string): boolean {
  return (
    WORKFLOW_DIRECT_REQUEST_RE.test(text) ||
    BROAD_PARALLEL_REQUEST_RE.test(text) ||
    MULTI_AGENT_REQUEST_RE.test(text) ||
    FANOUT_AGENT_REQUEST_RE.test(text)
  )
}

/** True when the message contains any orchestration trigger. */
export function hasAnyWorkflowTrigger(text: string): boolean {
  return hasUltracodeKeyword(text) || hasWorkflowKeyword(text)
}

/**
 * Find positions of keyword triggers for highlighting.
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
  const workflowPrefixMatch = /^(\s*)(workflows?)\b/i.exec(text)
  if (workflowPrefixMatch) {
    const leading = workflowPrefixMatch[1]?.length ?? 0
    const word = workflowPrefixMatch[2] ?? ''
    positions.push({
      word,
      start: leading,
      end: leading + word.length,
    })
  }

  const matches = text.matchAll(/\bultracode\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions.sort((a, b) => a.start - b.start)
}

export function isWorkflowKeywordDismissShortcut(
  char: string,
  key: WorkflowKeywordDismissKey,
): boolean {
  if (key.ctrl) return false
  return (
    (key.meta === true && char.toLowerCase() === 'w') ||
    char === MACOS_OPTION_W_CHAR
  )
}

export function shouldDismissWorkflowKeywordOnBackspace({
  cursorOffset,
  dismissed,
  key,
  triggers,
}: {
  cursorOffset: number
  dismissed: boolean
  key: WorkflowKeywordDismissKey
  triggers: WorkflowTriggerPosition[]
}): boolean {
  return (
    key.backspace === true &&
    !dismissed &&
    triggers.some(trigger => trigger.end === cursorOffset)
  )
}

/**
 * Build the opt-in system-reminder wrapper for a submitted value.
 *
 * Pure and gate-injectable: `enabled` (and `ultracodeStanding`) are passed in so
 * the logic is testable without the build-time feature() macro or session state.
 * Additive and reversible — when no trigger applies, the value is returned
 * verbatim, never mutated in place.
 *
 * Reminder priority (strongest first): ultracode keyword > workflow
 * keyword/direct request > already-standing ultracode mode.
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
    | 'ui.workflowKeyword.ultracodeReminder'
    | 'ui.workflowKeyword.ultracodeStandingReminder'
    | null = null
  if (hasUltracodeKeyword(value)) {
    key = 'ui.workflowKeyword.ultracodeReminder'
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

export function suppressNextWorkflowReminderFor(value: string): void {
  if (!value.trim()) return
  suppressedWorkflowReminderPrompts.add(value)
}

export function consumeSuppressedWorkflowReminder(value: string): boolean {
  if (!suppressedWorkflowReminderPrompts.has(value)) return false
  suppressedWorkflowReminderPrompts.delete(value)
  return true
}

export function clearSuppressedWorkflowRemindersForTests(): void {
  suppressedWorkflowReminderPrompts.clear()
}

/**
 * Production entry point: gate on the WORKFLOW_SCRIPTS build flag, then delegate
 * to the injectable, testable buildWorkflowReminder. Returns the reminder block
 * to inject as a separate isMeta message (model-visible, user-hidden), or null
 * when no trigger applies. The `ultracode` keyword itself is single-turn; only
 * /effort ultracode (or explicit command toggles) changes standing mode.
 */
export function workflowReminderFor(value: string): string | null {
  // Slash commands are never an orchestration opt-in. Bail before any side
  // effect or reminder.
  if (value.trimStart().startsWith('/')) return null
  if (consumeSuppressedWorkflowReminder(value)) return null
  const enabled = isWorkflowKeywordEnabled()
  return buildWorkflowReminder(value, enabled, enabled && isUltracodeActive())
}
