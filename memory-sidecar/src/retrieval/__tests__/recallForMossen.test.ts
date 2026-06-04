// W435c — parseRecallForMossenArgs CLI parser.
//
// Pure string parser; locks the CLI surface that /memory-sidecar recall
// dispatches through. Full recallForMossen() integration test is deferred
// (needs sqlite-seeded fixture).
import { describe, expect, test } from 'bun:test'
import { parseRecallForMossenArgs } from '../recallForMossen.js'

describe('parseRecallForMossenArgs', () => {
  test('empty input -> empty query', () => {
    const r = parseRecallForMossenArgs('')
    expect(r.query).toBe('')
    expect(r.limit).toBeUndefined()
    expect(r.maxTokens).toBeUndefined()
    expect(r.debug).toBe(false)
    expect(r.explain).toBe(false)
    expect(r.warnings).toEqual([])
  })

  test('plain query is captured', () => {
    const r = parseRecallForMossenArgs('use pnpm')
    expect(r.query).toBe('use pnpm')
  })

  test('--limit N is parsed', () => {
    const r = parseRecallForMossenArgs('foo --limit 5 bar')
    expect(r.query).toBe('foo bar')
    expect(r.limit).toBe(5)
  })

  test('--limit clamped to <= 20', () => {
    const r = parseRecallForMossenArgs('foo --limit 50')
    expect(r.limit).toBe(20)
  })

  test('--limit invalid value -> warning + limit undefined', () => {
    const r = parseRecallForMossenArgs('foo --limit abc')
    expect(r.limit).toBeUndefined()
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toContain('ignored invalid --limit value: abc')
  })

  test('--max-tokens N is parsed and clamped to [100, 4000]', () => {
    const a = parseRecallForMossenArgs('foo --max-tokens 200')
    expect(a.maxTokens).toBe(200)

    const b = parseRecallForMossenArgs('foo --max-tokens 50')
    expect(b.maxTokens).toBe(100)

    const c = parseRecallForMossenArgs('foo --max-tokens 99999')
    expect(c.maxTokens).toBe(4000)
  })

  test('--max-tokens invalid -> warning', () => {
    const r = parseRecallForMossenArgs('foo --max-tokens junk')
    expect(r.maxTokens).toBeUndefined()
    expect(r.warnings.length).toBe(1)
  })

  test('--debug flag toggles position-agnostic', () => {
    const a = parseRecallForMossenArgs('foo --debug')
    expect(a.debug).toBe(true)
    expect(a.query).toBe('foo')

    const b = parseRecallForMossenArgs('--debug foo')
    expect(b.debug).toBe(true)
    expect(b.query).toBe('foo')
  })

  test('--explain flag toggles', () => {
    const r = parseRecallForMossenArgs('foo --explain')
    expect(r.explain).toBe(true)
  })

  test('multiple flags combine cleanly', () => {
    const r = parseRecallForMossenArgs(
      '--debug react components --limit 3 --max-tokens 500 --explain',
    )
    expect(r.query).toBe('react components')
    expect(r.limit).toBe(3)
    expect(r.maxTokens).toBe(500)
    expect(r.debug).toBe(true)
    expect(r.explain).toBe(true)
    expect(r.warnings).toEqual([])
  })

  test('extra whitespace between tokens is collapsed', () => {
    const r = parseRecallForMossenArgs('  foo    bar  ')
    expect(r.query).toBe('foo bar')
  })
})
