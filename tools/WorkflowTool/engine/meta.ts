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

import { parse } from 'acorn'
import type { WorkflowMeta } from './types.js'

export class WorkflowMetaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowMetaError'
  }
}

type AstNode = {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

type AstProgram = AstNode & {
  body: AstNode[]
}

const RESERVED_META_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const MAX_WORKFLOW_SCRIPT_BYTES = 1024 * 1024

function assertScriptSize(source: string): void {
  if (source.length <= MAX_WORKFLOW_SCRIPT_BYTES) return
  throw new WorkflowMetaError(`Script exceeds ${MAX_WORKFLOW_SCRIPT_BYTES} bytes`)
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function parseProgram(source: string): AstProgram {
  try {
    return parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AstProgram
  } catch (err) {
    throw new WorkflowMetaError(
      `Script parse error: ${err instanceof Error ? err.message : String(err)}. ` +
        'Workflow scripts must be plain JavaScript — TypeScript syntax ' +
        '(type annotations like `: string[]`, interfaces, generics) fails to parse.',
    )
  }
}

function getMetaInitializer(statement: AstNode): AstNode {
  if (statement.type !== 'ExportNamedDeclaration') {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  const declaration = statement.declaration
  if (!isAstNode(declaration) || declaration.type !== 'VariableDeclaration') {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  if (declaration.kind !== 'const') {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  const declarations = declaration.declarations
  if (!Array.isArray(declarations) || declarations.length !== 1) {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  const first = declarations[0]
  if (!isAstNode(first)) {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  const id = first.id
  const init = first.init
  if (
    !isAstNode(id) ||
    id.type !== 'Identifier' ||
    id.name !== 'meta' ||
    !isAstNode(init) ||
    init.type !== 'ObjectExpression'
  ) {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  return init
}

function pureLiteralValue(node: AstNode): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'ArrayExpression': {
      const elements = node.elements
      if (!Array.isArray(elements)) return []
      return elements.map(element => {
        if (element === null) throw new Error('sparse arrays not allowed')
        if (!isAstNode(element)) {
          throw new Error('non-literal array element in meta')
        }
        if (element.type === 'SpreadElement') throw new Error('spread not allowed in meta')
        return pureLiteralValue(element)
      })
    }
    case 'ObjectExpression':
      return pureObjectLiteral(node)
    case 'TemplateLiteral': {
      const expressions = node.expressions
      if (Array.isArray(expressions) && expressions.length > 0) {
        throw new Error('template interpolation not allowed in meta')
      }
      const quasis = Array.isArray(node.quasis) ? node.quasis : []
      return quasis
        .map(quasi => {
          if (!isAstNode(quasi)) return ''
          const value = quasi.value
          if (
            typeof value === 'object' &&
            value !== null &&
            'cooked' in value
          ) {
            const cooked = (value as { cooked?: unknown }).cooked
            return typeof cooked === 'string' ? cooked : ''
          }
          return ''
        })
        .join('')
    }
    case 'UnaryExpression': {
      const argument = node.argument
      if (
        node.operator === '-' &&
        isAstNode(argument) &&
        argument.type === 'Literal' &&
        typeof argument.value === 'number'
      ) {
        return -argument.value
      }
      throw new Error('only negative-number unary allowed in meta')
    }
    default:
      throw new Error(`non-literal node type in meta: ${node.type}`)
  }
}

function propertyKey(property: AstNode): string {
  const key = property.key
  let name: string
  if (isAstNode(key) && key.type === 'Identifier') {
    name = String(key.name)
  } else if (isAstNode(key) && key.type === 'Literal') {
    name = String(key.value)
  } else {
    throw new Error(
      `unsupported key type in meta: ${isAstNode(key) ? key.type : typeof key}`,
    )
  }
  if (RESERVED_META_KEYS.has(name)) {
    throw new Error(`reserved key name not allowed in meta: ${name}`)
  }
  return name
}

function pureObjectLiteral(node: AstNode): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>
  const properties = node.properties
  if (!Array.isArray(properties)) return out
  for (const property of properties) {
    if (!isAstNode(property) || property.type !== 'Property') {
      throw new Error('only plain properties allowed in meta')
    }
    if (property.computed) throw new Error('computed keys not allowed in meta')
    if (property.method || property.kind !== 'init') {
      throw new Error('methods/accessors not allowed in meta')
    }
    const value = property.value
    if (!isAstNode(value)) {
      throw new Error('property value missing in meta')
    }
    out[propertyKey(property)] = pureLiteralValue(value)
  }
  return out
}

function skipBodyPrefix(source: string, start: number): number {
  let index = start
  while (index < source.length && /[;\s]/.test(source[index] ?? '')) {
    index++
  }
  return index
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
    title: typeof rec.title === 'string' && rec.title.trim() ? rec.title : undefined,
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
  scriptBody: string
} {
  assertScriptSize(source)
  const program = parseProgram(source)
  const firstStatement = program.body[0]
  if (!firstStatement) {
    throw new WorkflowMetaError(
      '`export const meta = { name, description, phases }` must be the FIRST statement in the script',
    )
  }
  const init = getMetaInitializer(firstStatement)
  let raw: unknown
  try {
    raw = pureObjectLiteral(init)
  } catch (err) {
    throw new WorkflowMetaError(
      `meta must be a pure literal: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const meta = validateMeta(raw)
  const bodyStartIndex = skipBodyPrefix(source, firstStatement.end)
  return {
    meta,
    bodyStartIndex,
    scriptBody: source.slice(bodyStartIndex),
  }
}
