/**
 * Static extraction + validation of a workflow's `meta` block.
 *
 * Every workflow script must begin with:
 *
 *   export const meta = { name: '...', description: '...', phases: [...] }
 *
 * The `meta` object must be a PURE LITERAL — no variables, function calls,
 * spreads, or template interpolation. We rely on that to extract and evaluate
 * it in total isolation BEFORE running any workflow body, so the permission
 * dialog and progress display can show what the workflow is without executing
 * a single line of its logic.
 */

import type { WorkflowMeta } from './types.js'

export class WorkflowMetaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowMetaError'
  }
}

/**
 * Find the `export const meta = { ... }` literal and return the source span of
 * the object literal (including the braces) plus the index just past it.
 */
function locateMetaLiteral(source: string): {
  literal: string
  endIndex: number
} {
  const marker = /export\s+const\s+meta\s*=\s*\{/.exec(source)
  if (!marker) {
    throw new WorkflowMetaError(
      'Workflow script must begin with `export const meta = { name, description }`.',
    )
  }
  // Start at the opening brace of the object literal.
  const open = marker.index + marker[0].length - 1
  let depth = 0
  let inString: string | null = null
  let escaped = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === inString) {
        inString = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return { literal: source.slice(open, i + 1), endIndex: i + 1 }
      }
    }
  }
  throw new WorkflowMetaError('Unterminated `meta` object literal.')
}

/**
 * Evaluate an object literal in total isolation.
 *
 * The literal is wrapped as `(<literal>)` and evaluated with an empty scope via
 * `new Function`. Because the meta block is required to be a pure literal, this
 * cannot reach globals, perform I/O, or call functions — a literal containing a
 * call/identifier throws here, which is the desired strictness.
 */
function evalPureLiteral(literal: string): unknown {
  let value: unknown
  try {
    // eslint-disable-next-line no-new-func -- evaluating a validated pure literal in an empty scope
    const fn = new Function(
      `"use strict"; return (${literal});`,
    ) as () => unknown
    value = fn()
  } catch (err) {
    // A literal that references an identifier (e.g. a function call or a
    // variable) throws a ReferenceError here in the empty scope — which is the
    // desired strictness for "must be a pure literal".
    throw new WorkflowMetaError(
      `meta is not a valid pure literal: ${(err as Error).message}`,
    )
  }
  // Reject actual non-data values (functions, symbols) AFTER evaluation, so a
  // string value that merely contains a keyword like "function" or "require"
  // is not falsely rejected.
  assertPureData(value, 'meta')
  return value
}

/** Throw unless `value` is JSON-shaped data (no functions / symbols / etc.). */
function assertPureData(value: unknown, path: string): void {
  if (value === null) return
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertPureData(v, `${path}[${i}]`))
    return
  }
  if (t === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertPureData(v, `${path}.${k}`)
    }
    return
  }
  throw new WorkflowMetaError(
    `meta must be a pure object literal — ${path} is a ${t} (no functions allowed).`,
  )
}

function asPhases(value: unknown): WorkflowMeta['phases'] {
  if (value == null) return undefined
  if (!Array.isArray(value)) {
    throw new WorkflowMetaError('meta.phases must be an array when present.')
  }
  return value.map((p, i) => {
    if (typeof p !== 'object' || p == null) {
      throw new WorkflowMetaError(`meta.phases[${i}] must be an object.`)
    }
    const rec = p as Record<string, unknown>
    if (typeof rec.title !== 'string' || !rec.title.trim()) {
      throw new WorkflowMetaError(`meta.phases[${i}].title must be a non-empty string.`)
    }
    return {
      title: rec.title,
      detail: typeof rec.detail === 'string' ? rec.detail : undefined,
      model: typeof rec.model === 'string' ? rec.model : undefined,
    }
  })
}

/** Validate a raw meta value into a typed WorkflowMeta. */
export function validateMeta(raw: unknown): WorkflowMeta {
  if (typeof raw !== 'object' || raw == null) {
    throw new WorkflowMetaError('meta must be an object literal.')
  }
  const rec = raw as Record<string, unknown>
  if (typeof rec.name !== 'string' || !rec.name.trim()) {
    throw new WorkflowMetaError('meta.name must be a non-empty string.')
  }
  if (typeof rec.description !== 'string' || !rec.description.trim()) {
    throw new WorkflowMetaError('meta.description must be a non-empty string.')
  }
  return {
    name: rec.name,
    description: rec.description,
    whenToUse: typeof rec.whenToUse === 'string' ? rec.whenToUse : undefined,
    phases: asPhases(rec.phases),
    model: typeof rec.model === 'string' ? rec.model : undefined,
  }
}

/**
 * Extract + validate the meta block from a workflow script.
 *
 * @returns the typed meta and the index in `source` where the body begins
 *          (just past the meta declaration), so the runtime can run the rest.
 */
export function extractMeta(source: string): {
  meta: WorkflowMeta
  bodyStartIndex: number
} {
  const { literal, endIndex } = locateMetaLiteral(source)
  const meta = validateMeta(evalPureLiteral(literal))
  return { meta, bodyStartIndex: endIndex }
}
