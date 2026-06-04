import { describe, expect, test } from 'bun:test'
import {
  buildWorkflowReminder,
  findWorkflowTriggerPositions,
  hasAnyWorkflowTrigger,
  hasUltracodeKeyword,
  hasUltraworkKeyword,
  hasWorkflowKeyword,
} from '../workflowKeyword.js'

// NOTE on the WORKFLOW_SCRIPTS gate: isWorkflowKeywordEnabled()/applyWorkflow
// Reminder() route through feature() from bun:bundle, which is a build-time
// define macro — under plain `bun test` it always evaluates to false and cannot
// be flipped by env or mock.module (the macro is resolved at transpile time, not
// module resolution). So the gating LOGIC is tested via the pure, injectable
// buildWorkflowReminder(value, enabled); the thin feature()-bound wrappers are
// exercised at runtime by the startup smoke + harness.

describe('workflowKeyword', () => {
  describe('hasWorkflowKeyword', () => {
    test('matches standalone "workflow"', () => {
      expect(hasWorkflowKeyword('please use a workflow here')).toBe(true)
    })

    test('matches plural "workflows"', () => {
      expect(hasWorkflowKeyword('compare these workflows')).toBe(true)
    })

    test('is case-insensitive', () => {
      expect(hasWorkflowKeyword('WORKFLOW now')).toBe(true)
      expect(hasWorkflowKeyword('WorkFlows please')).toBe(true)
    })

    test('does NOT match "workflowy" (no trailing boundary)', () => {
      expect(hasWorkflowKeyword('open workflowy app')).toBe(false)
    })

    test('does NOT match "reflow" / "dataflow" (no leading boundary)', () => {
      expect(hasWorkflowKeyword('reflow the layout')).toBe(false)
      expect(hasWorkflowKeyword('a dataflow graph')).toBe(false)
    })

    test('returns false when keyword absent', () => {
      expect(hasWorkflowKeyword('just a normal message')).toBe(false)
    })

    test('matches when adjacent to punctuation', () => {
      expect(hasWorkflowKeyword('run a workflow.')).toBe(true)
      expect(hasWorkflowKeyword('(workflows)')).toBe(true)
    })
  })

  describe('findWorkflowTriggerPositions', () => {
    test('returns correct position for a single match', () => {
      const text = 'use a workflow now'
      const positions = findWorkflowTriggerPositions(text)
      expect(positions).toHaveLength(1)
      expect(positions[0]).toEqual({ word: 'workflow', start: 6, end: 14 })
      expect(text.slice(positions[0]!.start, positions[0]!.end)).toBe('workflow')
    })

    test('finds plural and reports the matched word', () => {
      const positions = findWorkflowTriggerPositions('two workflows please')
      expect(positions).toHaveLength(1)
      expect(positions[0]!.word).toBe('workflows')
      expect(positions[0]!.start).toBe(4)
      expect(positions[0]!.end).toBe(13)
    })

    test('finds multiple occurrences with correct offsets', () => {
      const text = 'workflow then another workflow'
      const positions = findWorkflowTriggerPositions(text)
      expect(positions).toHaveLength(2)
      expect(positions[0]!.start).toBe(0)
      expect(positions[1]!.start).toBe(22)
      for (const p of positions) {
        expect(text.slice(p.start, p.end)).toBe(p.word)
      }
    })

    test('does not produce positions for non-boundary substrings', () => {
      expect(findWorkflowTriggerPositions('workflowy reflow dataflow')).toHaveLength(0)
    })

    test('preserves original casing in word field', () => {
      const positions = findWorkflowTriggerPositions('a WorkFlow here')
      expect(positions[0]!.word).toBe('WorkFlow')
    })

    test('no lastIndex leak across repeated calls', () => {
      const text = 'a workflow b'
      const a = findWorkflowTriggerPositions(text)
      const b = findWorkflowTriggerPositions(text)
      expect(a).toEqual(b)
      expect(a).toHaveLength(1)
    })

    test('stable when interleaved with hasWorkflowKeyword (shared-regex leak guard)', () => {
      const text = 'one workflow two'
      hasWorkflowKeyword(text)
      const first = findWorkflowTriggerPositions(text)
      hasWorkflowKeyword(text)
      const second = findWorkflowTriggerPositions(text)
      expect(first).toEqual(second)
      expect(first).toHaveLength(1)
      expect(first[0]!.start).toBe(4)
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

    test('fires for the plural keyword too', () => {
      expect(buildWorkflowReminder('run two workflows', true)).not.toBeNull()
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
      // 3rd arg = ultracodeStanding: no keyword, but standing mode on → fires.
      expect(buildWorkflowReminder('just keep going', true, true)).not.toBeNull()
      expect(buildWorkflowReminder('just keep going', true, false)).toBeNull()
    })
  })
})
