import { describe, expect, test } from 'bun:test'
import {
  extractJson,
  formatIssues,
  stripLiteralThinking,
  validateAgainstSchema,
} from '../schemaValidate.js'

describe('stripLiteralThinking', () => {
  test('removes a whole literal <think>…</think> span and trims', () => {
    // The exact shape observed in a real run: think block, then the answer.
    expect(
      stripLiteralThinking('<think>\nThe user wants: A\n</think>\n\nA'),
    ).toBe('A')
  })

  test('removes a trailing think block too (answer-then-think)', () => {
    expect(stripLiteralThinking('A<think>reasoning about B</think>')).toBe('A')
  })

  test('removes multiple think spans, preserves text between them', () => {
    expect(
      stripLiteralThinking('<think>x</think>A<think>y</think>B'),
    ).toBe('AB')
  })

  test('is case-insensitive and strips stray unpaired tags', () => {
    expect(stripLiteralThinking('<THINK>z</THINK>')).toBe('')
    expect(stripLiteralThinking('clean</think>')).toBe('clean')
  })

  test('leaves think-free text untouched', () => {
    expect(stripLiteralThinking('just the answer')).toBe('just the answer')
  })
})

describe('validateAgainstSchema — primitives', () => {
  test('accepts a matching type', () => {
    expect(validateAgainstSchema('hi', { type: 'string' }).ok).toBe(true)
    expect(validateAgainstSchema(3, { type: 'number' }).ok).toBe(true)
    expect(validateAgainstSchema(3, { type: 'integer' }).ok).toBe(true)
    expect(validateAgainstSchema(true, { type: 'boolean' }).ok).toBe(true)
  })

  test('rejects a mismatching type with a path+message', () => {
    const r = validateAgainstSchema('x', { type: 'number' })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.message).toMatch(/expected number/)
  })

  test('integer rejects a float', () => {
    expect(validateAgainstSchema(3.5, { type: 'integer' }).ok).toBe(false)
  })

  test('number range constraints', () => {
    expect(validateAgainstSchema(5, { type: 'number', minimum: 1, maximum: 10 }).ok).toBe(true)
    expect(validateAgainstSchema(0, { type: 'number', minimum: 1 }).ok).toBe(false)
    expect(validateAgainstSchema(11, { type: 'number', maximum: 10 }).ok).toBe(false)
  })

  test('enum + const', () => {
    expect(validateAgainstSchema('a', { enum: ['a', 'b'] }).ok).toBe(true)
    expect(validateAgainstSchema('c', { enum: ['a', 'b'] }).ok).toBe(false)
    expect(validateAgainstSchema(42, { const: 42 }).ok).toBe(true)
    expect(validateAgainstSchema(43, { const: 42 }).ok).toBe(false)
  })

  test('nullable / type array allows null', () => {
    expect(validateAgainstSchema(null, { type: 'string', nullable: true }).ok).toBe(true)
    expect(validateAgainstSchema(null, { type: ['string', 'null'] }).ok).toBe(true)
    expect(validateAgainstSchema(null, { type: 'string' }).ok).toBe(false)
  })
})

describe('validateAgainstSchema — objects', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'count'],
    additionalProperties: false,
  }

  test('accepts a valid object', () => {
    const r = validateAgainstSchema(
      { title: 'x', count: 2, tags: ['a', 'b'] },
      schema,
    )
    expect(r.ok).toBe(true)
  })

  test('flags missing required fields', () => {
    const r = validateAgainstSchema({ title: 'x' }, schema)
    expect(r.ok).toBe(false)
    expect(r.errors.map(e => e.path)).toContain('count')
  })

  test('flags wrong nested types with full path', () => {
    const r = validateAgainstSchema(
      { title: 'x', count: 2, tags: ['a', 5] },
      schema,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.path).toBe('tags[1]')
  })

  test('rejects additional properties when additionalProperties:false', () => {
    const r = validateAgainstSchema(
      { title: 'x', count: 2, extra: true },
      schema,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.map(e => e.path)).toContain('extra')
  })
})

describe('validateAgainstSchema — arrays', () => {
  test('minItems / maxItems', () => {
    const schema = { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 2 }
    expect(validateAgainstSchema([1], schema).ok).toBe(true)
    expect(validateAgainstSchema([], schema).ok).toBe(false)
    expect(validateAgainstSchema([1, 2, 3], schema).ok).toBe(false)
  })
})

describe('extractJson', () => {
  test('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  test('parses a fenced json block', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 })
  })

  test('parses a fenced block without language', () => {
    expect(extractJson('```\n[1,2,3]\n```')).toEqual([1, 2, 3])
  })

  test('extracts the first balanced object amid prose', () => {
    expect(extractJson('The answer is {"x": {"y": 2}} ok')).toEqual({ x: { y: 2 } })
  })

  test('is not fooled by braces inside strings', () => {
    expect(extractJson('{"s":"a } b"}')).toEqual({ s: 'a } b' })
  })

  test('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON/)
  })

  test('throws on malformed JSON', () => {
    expect(() => extractJson('{"a": }')).toThrow(/not valid JSON/)
  })
})

describe('formatIssues', () => {
  test('renders a bullet list', () => {
    const out = formatIssues([
      { path: 'count', message: 'is required' },
      { path: '', message: 'expected object' },
    ])
    expect(out).toContain('- count: is required')
    expect(out).toContain('- (root): expected object')
  })
})
