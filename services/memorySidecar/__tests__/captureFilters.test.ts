// W435 S1 — POC behavior tests for services/memorySidecar/captureFilters.ts
//
// Locks the existing contracts of the three pure functions:
//   isControlPlaneMessage / isAssistantControlOutput / stripInternalReasoning
//
// Includes specific regression cases that earlier waves (W119 H6, W121-A
// item 5) traced to bugs — those are the "edge case" assertions and are
// load-bearing for future refactors.
import { describe, expect, test } from 'bun:test'
import {
  CN_SHORT_OPS_PATTERNS,
  isAssistantControlOutput,
  isControlPlaneMessage,
  stripInternalReasoning,
} from '../captureFilters.js'

describe('isControlPlaneMessage', () => {
  test('slash commands are control-plane', () => {
    expect(isControlPlaneMessage('/memory')).toBe(true)
    expect(isControlPlaneMessage('/memory-sidecar recall foo')).toBe(true)
    expect(isControlPlaneMessage('  /model  ')).toBe(true)
  })

  test('terminal-output wrappers are control-plane', () => {
    expect(isControlPlaneMessage('<command-name>ls</command-name>')).toBe(true)
    expect(isControlPlaneMessage('<local-command-stdout>foo</local-command-stdout>')).toBe(true)
    expect(isControlPlaneMessage('<bash-stderr>err</bash-stderr>')).toBe(true)
    expect(isControlPlaneMessage('<system-reminder>tip</system-reminder>')).toBe(true)
  })

  test('wave instruction packets are control-plane (CN + EN)', () => {
    expect(isControlPlaneMessage('执行 W418 P0 三件套')).toBe(true)
    expect(isControlPlaneMessage('启动 W432 review')).toBe(true)
    expect(isControlPlaneMessage('implement W116 first')).toBe(true)
    expect(isControlPlaneMessage('Run W57a smoke')).toBe(true)
    expect(isControlPlaneMessage('W110 final report attached')).toBe(true)
  })

  test('control instruction markers (CN + EN)', () => {
    expect(isControlPlaneMessage('硬红线：不动 captureFilters')).toBe(true)
    expect(isControlPlaneMessage('Commit: abc1234')).toBe(true)
    expect(isControlPlaneMessage('Red lines: do not touch')).toBe(true)
    expect(isControlPlaneMessage('Smoke requirements:')).toBe(true)
    expect(isControlPlaneMessage('push = false')).toBe(true)
  })

  test('normal conversation is NOT control-plane', () => {
    expect(isControlPlaneMessage('hello world')).toBe(false)
    expect(isControlPlaneMessage('Use TypeScript strict mode')).toBe(false)
    // Mid-sentence wave id reference must not trigger (anchored to start).
    expect(isControlPlaneMessage('We talked about W116 last week')).toBe(false)
    // "/" not at very start — false.
    expect(isControlPlaneMessage('use a/b testing')).toBe(false)
  })
})

describe('isAssistantControlOutput', () => {
  test('short completion markers are control output', () => {
    expect(isAssistantControlOutput('全部通过')).toBe(true)
    expect(isAssistantControlOutput('修复完成')).toBe(true)
    expect(isAssistantControlOutput('好了。')).toBe(true)
    expect(isAssistantControlOutput('运行完成')).toBe(true)
  })

  test('English short-op responses are control output', () => {
    expect(isAssistantControlOutput('Let me check the file')).toBe(true)
    expect(isAssistantControlOutput("I'll fix that")).toBe(true)
    expect(isAssistantControlOutput('Running smoke')).toBe(true)
    expect(isAssistantControlOutput('Done.')).toBe(true)
    expect(isAssistantControlOutput('Got it.')).toBe(true)
  })

  test('commit reports are control output', () => {
    expect(isAssistantControlOutput('Commit: `abc1234567`')).toBe(true)
    expect(isAssistantControlOutput('commit 0bf98648a3f0c2b1')).toBe(true)
    expect(isAssistantControlOutput('Commit hashes: abc, def')).toBe(true)
    expect(isAssistantControlOutput('Changed files: a.ts, b.ts')).toBe(true)
  })

  test('W121-A regression: legitimate sentences sharing common openers are NOT skipped', () => {
    // These were dropping erroneously before W121-A item 5 tightened patterns.
    expect(isAssistantControlOutput('运行结果让我确认这个方案可行')).toBe(false)
    expect(isAssistantControlOutput('我来这个项目是为了长期验证记忆')).toBe(false)
    // "现在" alone without an operational verb anchor.
    expect(isAssistantControlOutput('现在的设计已经合理')).toBe(false)
  })

  test('long messages with operational openers are NOT control output (length gate)', () => {
    // 40+ char threshold prevents long sentences from being skipped.
    const longMsg = "Let me explain why this approach makes sense for your use case here"
    expect(longMsg.length).toBeGreaterThanOrEqual(40)
    expect(isAssistantControlOutput(longMsg)).toBe(false)
  })

  test('normal conversation is NOT control output', () => {
    expect(isAssistantControlOutput('The function returns a Promise')).toBe(false)
    expect(isAssistantControlOutput('你的代码看起来很合理')).toBe(false)
  })
})

describe('stripInternalReasoning', () => {
  test('strips well-formed <think> blocks', () => {
    expect(stripInternalReasoning('<think>private musings</think>visible')).toBe('visible')
    expect(stripInternalReasoning('before<think>hidden</think>after')).toBe('beforeafter')
  })

  test('multi-line <think> blocks', () => {
    const input = 'leading\n<think>\nline 1\nline 2\n</think>\ntrailing'
    expect(stripInternalReasoning(input)).toBe('leading\n\ntrailing')
  })

  test('attribute-tolerant inside lowercase <think>', () => {
    expect(stripInternalReasoning('<think mode="hidden">x</think>y')).toBe('y')
  })

  test('W435b regression: uppercase <THINK> is stripped (case-insensitive)', () => {
    // The function docstring promises case-insensitive stripping and the
    // inner regex uses the /i flag. W435 pinned the broken pre-fix behavior
    // (early-exit guard `text.includes('<think')` matched lowercase only).
    // W435b fixed the guard to /<think/i.test(text) so uppercase blocks
    // are now stripped as documented. This test pins the corrected
    // behavior so any future regression is intentional.
    expect(stripInternalReasoning('<THINK>x</THINK>y')).toBe('y')
    expect(stripInternalReasoning('<Think attr="z">y</Think>after')).toBe('after')
  })

  test('unterminated <think> block strips to end', () => {
    expect(stripInternalReasoning('keep<think>lost forever')).toBe('keep')
  })

  test('no <think> tag returns unchanged', () => {
    expect(stripInternalReasoning('plain text')).toBe('plain text')
    expect(stripInternalReasoning('')).toBe('')
  })

  test('only <think> content trims to empty', () => {
    expect(stripInternalReasoning('<think>only this</think>')).toBe('')
    expect(stripInternalReasoning('   <think>only this</think>   ')).toBe('')
  })
})

describe('CN_SHORT_OPS_PATTERNS export', () => {
  test('exports the tightened pattern array (W121-A item 5 anchor)', () => {
    expect(Array.isArray(CN_SHORT_OPS_PATTERNS)).toBe(true)
    expect(CN_SHORT_OPS_PATTERNS.length).toBeGreaterThanOrEqual(5)
    expect(CN_SHORT_OPS_PATTERNS.every(p => p instanceof RegExp)).toBe(true)
  })
})
