import { describe, expect, test } from 'bun:test'
import { extractMeta, validateMeta, WorkflowMetaError } from '../meta.js'

describe('extractMeta', () => {
  test('extracts a minimal valid meta block', () => {
    const src = `export const meta = { name: 'demo', description: 'A demo workflow' }
    log('hi')`
    const { meta, bodyStartIndex } = extractMeta(src)
    expect(meta.name).toBe('demo')
    expect(meta.description).toBe('A demo workflow')
    expect(src.slice(bodyStartIndex)).toContain("log('hi')")
  })

  test('extracts phases array', () => {
    const src = `export const meta = {
      name: 'review',
      description: 'Review changes',
      phases: [{ title: 'Scan', detail: 'grep logs' }, { title: 'Fix' }],
    }
    phase('Scan')`
    const { meta } = extractMeta(src)
    expect(meta.phases).toHaveLength(2)
    expect(meta.phases![0]).toEqual({ title: 'Scan', detail: 'grep logs', model: undefined })
    expect(meta.phases![1].title).toBe('Fix')
  })

  test('handles braces inside strings without miscounting', () => {
    const src = `export const meta = { name: 'x', description: 'has } brace and { brace' }
    body`
    const { meta } = extractMeta(src)
    expect(meta.description).toBe('has } brace and { brace')
  })

  test('handles nested objects in phases', () => {
    const src = `export const meta = { name: 'n', description: 'd', phases: [{ title: 'A' }] , model: 'sonnet' }
    rest`
    const { meta, bodyStartIndex } = extractMeta(src)
    expect(meta.model).toBe('sonnet')
    expect(src.slice(bodyStartIndex).trim()).toBe('rest')
  })

  test('rejects a script with no meta block', () => {
    expect(() => extractMeta(`log('no meta here')`)).toThrow(WorkflowMetaError)
  })

  test('rejects meta missing name', () => {
    expect(() =>
      extractMeta(`export const meta = { description: 'no name' }\nbody`),
    ).toThrow(/name/)
  })

  test('rejects meta missing description', () => {
    expect(() =>
      extractMeta(`export const meta = { name: 'x' }\nbody`),
    ).toThrow(/description/)
  })

  test('rejects non-literal meta (function call)', () => {
    expect(() =>
      extractMeta(`export const meta = { name: makeName(), description: 'd' }\nbody`),
    ).toThrow(WorkflowMetaError)
  })

  test('rejects non-literal meta (arrow function)', () => {
    expect(() =>
      extractMeta(
        `export const meta = { name: 'x', description: 'd', go: () => 1 }\nbody`,
      ),
    ).toThrow(/pure object literal/)
  })

  test('rejects unterminated meta literal', () => {
    expect(() =>
      extractMeta(`export const meta = { name: 'x', description: 'd'`),
    ).toThrow(/Unterminated/)
  })
})

describe('validateMeta', () => {
  test('rejects non-object', () => {
    expect(() => validateMeta(42)).toThrow(WorkflowMetaError)
  })

  test('rejects phases that is not an array', () => {
    expect(() =>
      validateMeta({ name: 'x', description: 'd', phases: 'nope' }),
    ).toThrow(/phases must be an array/)
  })

  test('rejects a phase without a title', () => {
    expect(() =>
      validateMeta({ name: 'x', description: 'd', phases: [{ detail: 'no title' }] }),
    ).toThrow(/title/)
  })
})
