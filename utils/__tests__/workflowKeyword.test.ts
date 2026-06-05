import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildWorkflowReminder,
  clearSuppressedWorkflowRemindersForTests,
  consumeSuppressedWorkflowReminder,
  findWorkflowTriggerPositions,
  hasAnyWorkflowTrigger,
  hasUltracodeKeyword,
  hasWorkflowDirectRequest,
  hasWorkflowKeyword,
  isWorkflowKeywordDismissShortcut,
  shouldDismissWorkflowKeywordOnBackspace,
  suppressNextWorkflowReminderFor,
} from '../workflowKeyword.js'

// NOTE on the WORKFLOW_SCRIPTS gate: isWorkflowKeywordEnabled()/applyWorkflow
// Reminder() route through feature() from bun:bundle, which is a build-time
// define macro — under plain `bun test` it always evaluates to false and cannot
// be flipped by env or mock.module (the macro is resolved at transpile time, not
// module resolution). So the gating LOGIC is tested via the pure, injectable
// buildWorkflowReminder(value, enabled); the thin feature()-bound wrappers are
// exercised at runtime by the startup smoke + harness.

describe('workflowKeyword', () => {
  afterEach(() => {
    clearSuppressedWorkflowRemindersForTests()
  })

  describe('hasWorkflowKeyword', () => {
    test('matches explicit natural-language workflow requests', () => {
      expect(hasWorkflowKeyword('please use a workflow here')).toBe(true)
    })

    test('does not match incidental standalone workflow mentions', () => {
      expect(hasWorkflowKeyword('compare these workflows')).toBe(false)
      expect(hasWorkflowKeyword('workflow design notes')).toBe(false)
    })

    test('is case-insensitive', () => {
      expect(hasWorkflowKeyword('RUN A WORKFLOW now')).toBe(true)
      expect(hasWorkflowKeyword('Use WorkFlows please')).toBe(true)
    })

    test('does NOT match "workflowy" (no trailing boundary)', () => {
      expect(hasWorkflowKeyword('open workflowy app')).toBe(false)
    })

    test('does not treat non-official ultrawork wording as a trigger', () => {
      expect(hasAnyWorkflowTrigger('use ultrawork')).toBe(false)
      expect(findWorkflowTriggerPositions('try ultrawork please')).toHaveLength(0)
      expect(buildWorkflowReminder('try ultrawork please', true)).toBeNull()
    })

    test('does NOT match "reflow" / "dataflow" (no leading boundary)', () => {
      expect(hasWorkflowKeyword('reflow the layout')).toBe(false)
      expect(hasWorkflowKeyword('a dataflow graph')).toBe(false)
    })

    test('returns false when keyword absent', () => {
      expect(hasWorkflowKeyword('just a normal message')).toBe(false)
    })

    test('matches explicit requests when adjacent to punctuation', () => {
      expect(hasWorkflowKeyword('run a workflow.')).toBe(true)
      expect(hasWorkflowKeyword('please use workflows.')).toBe(true)
    })

    test('detects all workflow trigger variants', () => {
      expect(hasUltracodeKeyword('turn on ultracode')).toBe(true)
      expect(hasAnyWorkflowTrigger('ordinary prompt')).toBe(false)
    })

    test('treats explicit natural-language orchestration requests as opt-in', () => {
      expect(hasWorkflowDirectRequest('run a workflow for this migration')).toBe(
        true,
      )
      expect(
        hasWorkflowDirectRequest(
          'do a comprehensive parallel review of this API surface',
        ),
      ).toBe(true)
      expect(hasWorkflowDirectRequest('use multi-agent research here')).toBe(true)
      expect(hasWorkflowDirectRequest('fan out across multiple agents')).toBe(true)
      expect(hasAnyWorkflowTrigger('use multi-agent research here')).toBe(true)
    })

    test('does not treat incidental agent wording as workflow opt-in', () => {
      expect(hasWorkflowDirectRequest('compare multi-agent systems')).toBe(false)
      expect(hasWorkflowDirectRequest('this agent should review one file')).toBe(
        false,
      )
    })
  })

  describe('findWorkflowTriggerPositions', () => {
    test('returns correct position for a single ultracode match', () => {
      const text = 'use ultracode now'
      const positions = findWorkflowTriggerPositions(text)
      expect(positions).toHaveLength(1)
      expect(positions[0]).toEqual({ word: 'ultracode', start: 4, end: 13 })
      expect(text.slice(positions[0]!.start, positions[0]!.end)).toBe('ultracode')
    })

    test('finds multiple occurrences with correct offsets', () => {
      const text = 'ultracode then ultracode'
      const positions = findWorkflowTriggerPositions(text)
      expect(positions).toHaveLength(2)
      expect(positions[0]!.start).toBe(0)
      expect(positions[1]!.start).toBe(15)
      for (const p of positions) {
        expect(text.slice(p.start, p.end)).toBe(p.word)
      }
    })

    test('does not produce positions for workflow mentions or non-boundary substrings', () => {
      expect(
        findWorkflowTriggerPositions('workflow workflows workflowy ultracodebase'),
      ).toHaveLength(0)
    })

    test('preserves original casing in word field', () => {
      const positions = findWorkflowTriggerPositions('a UltraCode here')
      expect(positions[0]!.word).toBe('UltraCode')
    })

    test('no lastIndex leak across repeated calls', () => {
      const text = 'a ultracode b'
      const a = findWorkflowTriggerPositions(text)
      const b = findWorkflowTriggerPositions(text)
      expect(a).toEqual(b)
      expect(a).toHaveLength(1)
    })

    test('stable when interleaved with hasWorkflowKeyword (shared-regex leak guard)', () => {
      const text = 'one ultracode two'
      hasWorkflowKeyword('use a workflow')
      const first = findWorkflowTriggerPositions(text)
      hasWorkflowKeyword('run a workflow')
      const second = findWorkflowTriggerPositions(text)
      expect(first).toEqual(second)
      expect(first).toHaveLength(1)
      expect(first[0]!.start).toBe(4)
    })
  })

  describe('workflow keyword dismiss controls', () => {
    test('matches official Alt/Option+W shortcut without matching Ctrl+W', () => {
      expect(isWorkflowKeywordDismissShortcut('w', { meta: true })).toBe(true)
      expect(isWorkflowKeywordDismissShortcut('W', { meta: true })).toBe(true)
      expect(isWorkflowKeywordDismissShortcut('w', { ctrl: true })).toBe(false)
      expect(isWorkflowKeywordDismissShortcut('x', { meta: true })).toBe(false)
    })

    test('matches macOS Option+W character when Option is not sent as Meta', () => {
      expect(isWorkflowKeywordDismissShortcut('∑', {})).toBe(true)
      expect(isWorkflowKeywordDismissShortcut('∑', { ctrl: true })).toBe(false)
    })

    test('backspace dismisses only at the end of a workflow trigger keyword', () => {
      const triggers = findWorkflowTriggerPositions('use ultracode now')

      expect(
        shouldDismissWorkflowKeywordOnBackspace({
          cursorOffset: 13,
          dismissed: false,
          key: { backspace: true },
          triggers,
        }),
      ).toBe(true)
      expect(
        shouldDismissWorkflowKeywordOnBackspace({
          cursorOffset: 12,
          dismissed: false,
          key: { backspace: true },
          triggers,
        }),
      ).toBe(false)
      expect(
        shouldDismissWorkflowKeywordOnBackspace({
          cursorOffset: 13,
          dismissed: true,
          key: { backspace: true },
          triggers,
        }),
      ).toBe(false)
      expect(
        shouldDismissWorkflowKeywordOnBackspace({
          cursorOffset: 13,
          dismissed: false,
          key: {},
          triggers,
        }),
      ).toBe(false)
    })
  })

  describe('buildWorkflowReminder (returns an isMeta block, or null)', () => {
    test('returns ONLY a <system-reminder> block, not the user text', () => {
      // Contract: the block is injected as a SEPARATE isMeta message, never
      // concatenated into the user's text — that leaked it into the transcript.
      const out = buildWorkflowReminder('build a workflow', true)
      expect(out).not.toBeNull()
      expect(out!.startsWith('<system-reminder>')).toBe(true)
      expect(out!.trimEnd().endsWith('</system-reminder>')).toBe(true)
      expect(out).not.toContain('build a workflow')
    })

    test('does not fire for incidental workflow mentions', () => {
      expect(buildWorkflowReminder('compare these workflows', true)).toBeNull()
      expect(buildWorkflowReminder('workflow design notes', true)).toBeNull()
    })

    test('fires for explicit natural-language workflow requests', () => {
      expect(
        buildWorkflowReminder(
          'please do a broad parallel audit of these packages',
          true,
        ),
      ).not.toBeNull()
    })

    test('returns null when the keyword is absent (gate enabled)', () => {
      expect(buildWorkflowReminder('just a normal message', true)).toBeNull()
    })

    test('returns null when the gate is disabled (keyword present)', () => {
      expect(buildWorkflowReminder('build a workflow', false)).toBeNull()
    })

    test('returns null for near-miss substrings', () => {
      expect(buildWorkflowReminder('open workflowy and reflow', true)).toBeNull()
    })

    test('returns null for slash commands (e.g. /workflows)', () => {
      // `/workflows` only contains the substring "workflows"; not an opt-in.
      expect(buildWorkflowReminder('/workflows', true)).toBeNull()
      expect(buildWorkflowReminder('/workflows ultracode on', true)).toBeNull()
      expect(buildWorkflowReminder('  /workflows save wf_x', true)).toBeNull()
    })

    test('standing ultracode fires even without a keyword in the message', () => {
      // 3rd arg = ultracodeStanding: no keyword, but standing mode on through
      // /effort ultracode or an explicit command toggle -> fires.
      expect(buildWorkflowReminder('just keep going', true, true)).not.toBeNull()
      expect(buildWorkflowReminder('just keep going', true, false)).toBeNull()
    })
  })

  describe('workflow reminder suppression', () => {
    test('suppresses exactly one matching prompt reminder', () => {
      suppressNextWorkflowReminderFor('ultracode: audit auth')

      expect(consumeSuppressedWorkflowReminder('different workflow prompt')).toBe(false)
      expect(consumeSuppressedWorkflowReminder('ultracode: audit auth')).toBe(true)
      expect(consumeSuppressedWorkflowReminder('ultracode: audit auth')).toBe(false)
    })

    test('ignores blank suppression requests', () => {
      suppressNextWorkflowReminderFor('   ')
      expect(consumeSuppressedWorkflowReminder('   ')).toBe(false)
    })
  })
})
