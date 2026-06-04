// W435c — Pure helpers in retrieval/context.ts.
//
// normalizeQueryTerms / hasQueryMatch / hasStrongMatch are pure string
// functions used by the recall path. Locking them prevents silent
// regressions when query normalization rules are tweaked.
import { describe, expect, test } from 'bun:test'
import {
  hasQueryMatch,
  hasStrongMatch,
  normalizeQueryTerms,
} from '../context.js'

describe('normalizeQueryTerms', () => {
  test('empty input returns empty terms', () => {
    const n = normalizeQueryTerms('')
    expect(n.terms).toEqual([])
    expect(n.strongTerms).toEqual([])
    expect(n.fullQuery).toBe('')
  })

  test('whitespace-only returns empty terms', () => {
    const n = normalizeQueryTerms('   \n\t  ')
    expect(n.terms).toEqual([])
    expect(n.fullQuery).toBe('')
  })

  test('multi-token ASCII query lowercases + splits + sets strong terms', () => {
    const n = normalizeQueryTerms('Use PNPM not Npm')
    expect(n.fullQuery).toBe('use pnpm not npm')
    expect(n.terms).toEqual(['use', 'pnpm', 'not', 'npm'])
    // Strong = ≥3 ASCII identifier chars; "use" (3), "pnpm" (4), "not" (3),
    // "npm" (3) all qualify.
    expect(n.strongTerms.length).toBe(4)
  })

  test('multi-token CJK query keeps multi-char CJK as strong', () => {
    const n = normalizeQueryTerms('使用 pnpm')
    expect(n.terms).toEqual(['使用', 'pnpm'])
    expect(n.strongTerms).toContain('使用')
    expect(n.strongTerms).toContain('pnpm')
  })

  test('CJK sidecar terms keep original terms and add English recall variants', () => {
    const n = normalizeQueryTerms('记忆 持久化')
    expect(n.terms).toEqual(['记忆', '持久化'])
    expect(n.strongTerms).toEqual(['记忆', '持久化'])
    expect(n.termGroups.map(group => group.variants)).toEqual([
      ['记忆', 'memory', 'memory-sidecar', 'sidecar'],
      [
        '持久化',
        'storage',
        'persistence',
        'persisted',
        'persistent',
        'archive',
        'jsonl',
        'sqlite',
        'fts',
      ],
    ])
  })

  test('M4 gate: single-CJK-char query returns empty terms', () => {
    const n = normalizeQueryTerms('我')
    expect(n.terms).toEqual([])
    expect(n.strongTerms).toEqual([])
  })

  test('M4 gate: bare CJK stopword query returns empty terms', () => {
    // "的" is a common CJK stopword; single-char rule already catches it,
    // but the explicit stopword set also exists for safety.
    const n = normalizeQueryTerms('的')
    expect(n.terms).toEqual([])
  })

  test('short ASCII terms (<3 chars) are NOT in strongTerms', () => {
    const n = normalizeQueryTerms('a b cd')
    expect(n.terms).toEqual(['a', 'b', 'cd'])
    // None of a/b/cd are >=3 chars, so strongTerms is empty.
    expect(n.strongTerms).toEqual([])
  })

  test('rawQuery is preserved (original whitespace/case)', () => {
    const n = normalizeQueryTerms('  Use PNPM  ')
    expect(n.rawQuery).toBe('  Use PNPM  ')
    expect(n.fullQuery).toBe('use pnpm')
  })
})

describe('hasQueryMatch', () => {
  test('empty query never matches', () => {
    expect(hasQueryMatch('any text', normalizeQueryTerms(''))).toBe(false)
  })

  test('fullQuery substring match wins', () => {
    const n = normalizeQueryTerms('use pnpm')
    expect(hasQueryMatch('Always use pnpm in this repo', n)).toBe(true)
  })

  test('all terms present (even out of order) matches', () => {
    const n = normalizeQueryTerms('pnpm not')
    // Tokens "pnpm" + "not" both appear (not necessarily adjacent).
    expect(hasQueryMatch('Do not use npm; pnpm is required', n)).toBe(true)
  })

  test('missing one term -> no match', () => {
    const n = normalizeQueryTerms('pnpm bun')
    expect(hasQueryMatch('Use pnpm only', n)).toBe(false)
  })

  test('case-insensitive', () => {
    const n = normalizeQueryTerms('PNPM')
    expect(hasQueryMatch('use pnpm here', n)).toBe(true)
  })

  test('CJK sidecar aliases match English memory storage text', () => {
    const n = normalizeQueryTerms('记忆 持久化')
    expect(
      hasQueryMatch(
        'Memory sidecar storage uses archive JSONL and SQLite FTS',
        n,
      ),
    ).toBe(true)
  })

  test('CJK alias matching still requires every query concept', () => {
    const n = normalizeQueryTerms('记忆 持久化')
    expect(hasQueryMatch('Memory sidecar recall has a benchmark', n)).toBe(false)
  })
})

describe('hasStrongMatch', () => {
  test('empty query never strong-matches', () => {
    expect(hasStrongMatch('any text', normalizeQueryTerms(''))).toBe(false)
  })

  test('fullQuery substring is a strong match', () => {
    const n = normalizeQueryTerms('use pnpm')
    expect(hasStrongMatch('always use pnpm here', n)).toBe(true)
  })

  test('any single strong term is a strong match', () => {
    const n = normalizeQueryTerms('a pnpm')
    // "a" is not strong (len <3); "pnpm" is strong.
    expect(hasStrongMatch('text mentions pnpm only', n)).toBe(true)
  })

  test('only short terms -> no strong match', () => {
    const n = normalizeQueryTerms('a b cd')
    expect(hasStrongMatch('text with a, b, cd', n)).toBe(false)
  })

  test('CJK sidecar aliases count as strong matches when English variants hit', () => {
    const n = normalizeQueryTerms('记忆 持久化')
    expect(hasStrongMatch('SQLite FTS stores memory-sidecar archive data', n)).toBe(true)
  })
})
