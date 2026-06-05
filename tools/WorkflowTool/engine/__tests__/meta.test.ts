import { describe, expect, test } from 'bun:test'
import {
  extractMeta,
  MAX_WORKFLOW_SCRIPT_BYTES,
  rewriteWorkflowMetaName,
  validateMeta,
  WorkflowMetaError,
} from '../meta.js'

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
      title: 'Review changed files',
      phases: [{ title: 'Scan', detail: 'grep logs' }, { title: 'Fix' }],
    }
    phase('Scan')`
    const { meta } = extractMeta(src)
    expect(meta.title).toBe('Review changed files')
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

  test('rejects scripts larger than the official workflow parser cap', () => {
    const oversized =
      `export const meta = { name: 'x', description: 'd' }\n` +
      'x'.repeat(MAX_WORKFLOW_SCRIPT_BYTES)
    expect(() => extractMeta(oversized)).toThrow(
      `Script exceeds ${MAX_WORKFLOW_SCRIPT_BYTES} bytes`,
    )
  })

  test('rejects meta that is not the first statement', () => {
    expect(() =>
      extractMeta(`const before = true\nexport const meta = { name: 'x', description: 'd' }`),
    ).toThrow(/FIRST statement/)
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
    ).toThrow(/non-literal/)
  })

  test('does not execute non-literal meta expressions while rejecting them', () => {
    const probe = globalThis as unknown as Record<string, unknown>
    probe.__workflowMetaExecuted = false
    expect(() =>
      extractMeta(
        `export const meta = { name: (globalThis.__workflowMetaExecuted = true, 'x'), description: 'd' }\nbody`,
      ),
    ).toThrow(WorkflowMetaError)
    expect(probe.__workflowMetaExecuted).toBe(false)
    delete probe.__workflowMetaExecuted
  })

  test('rejects non-literal meta (arrow function)', () => {
    expect(() =>
      extractMeta(
        `export const meta = { name: 'x', description: 'd', go: () => 1 }\nbody`,
      ),
    ).toThrow(/non-literal/)
  })

  test('rejects meta template interpolation', () => {
    expect(() =>
      extractMeta(
        "export const meta = { name: `x-${1}`, description: 'd' }\nbody",
      ),
    ).toThrow(/template interpolation/)
  })

  test('accepts literal templates without interpolation', () => {
    const { meta } = extractMeta(
      "export const meta = { name: `x`, description: `plain template` }\nbody",
    )
    expect(meta.description).toBe('plain template')
  })

  test('rejects sparse arrays and spreads in meta', () => {
    expect(() =>
      extractMeta(
        `export const meta = { name: 'x', description: 'd', phases: [, { title: 'A' }] }\nbody`,
      ),
    ).toThrow(/sparse arrays/)
    expect(() =>
      extractMeta(
        `export const meta = { name: 'x', description: 'd', phases: [...items] }\nbody`,
      ),
    ).toThrow(/spread/)
  })

  test('rejects computed and reserved meta keys', () => {
    expect(() =>
      extractMeta(`export const meta = { ['name']: 'x', description: 'd' }\nbody`),
    ).toThrow(/computed keys/)
    expect(() =>
      extractMeta(
        `export const meta = { name: 'x', description: 'd', constructor: {} }\nbody`,
      ),
    ).toThrow(/reserved key/)
  })

  test('rejects unterminated meta literal', () => {
    expect(() =>
      extractMeta(`export const meta = { name: 'x', description: 'd'`),
    ).toThrow(/Script parse error/)
  })
})

describe('rewriteWorkflowMetaName', () => {
  test('rewrites only meta.name and preserves the workflow body', () => {
    const src = `export const meta = { name: 'old-flow', description: 'A demo workflow' }
log('old-flow body should stay')
return 1
`

    const rewritten = rewriteWorkflowMetaName(src, 'new-flow')

    expect(extractMeta(rewritten).meta.name).toBe('new-flow')
    expect(extractMeta(rewritten).meta.description).toBe('A demo workflow')
    expect(rewritten).toContain("log('old-flow body should stay')")
    expect(rewritten).toContain('return 1')
  })

  test('escapes the saved command name as a JavaScript string literal', () => {
    const src = `export const meta = { name: \`old\`, description: 'A demo workflow' }
return 1
`

    const rewritten = rewriteWorkflowMetaName(src, 'quote-"flow')

    expect(extractMeta(rewritten).meta.name).toBe('quote-"flow')
    expect(rewritten).toContain('"quote-\\"flow"')
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
