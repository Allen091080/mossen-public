/**
 * Minimal JSON-Schema validator for workflow agent({schema}) results.
 *
 * Workflows can ask an agent for structured output by passing a JSON Schema.
 * The engine instructs the agent to return JSON, parses it, and validates it
 * here; on failure the engine re-prompts with the errors so the model corrects
 * itself (the same "retry on mismatch" guarantee the public contract gives).
 *
 * This is a pragmatic subset of JSON Schema (the shapes workflows actually use):
 * type (object/array/string/number/integer/boolean/null + arrays of types),
 * properties, required, items, enum, const, additionalProperties:false,
 * minItems/maxItems, minimum/maximum, nullable. It is intentionally small and
 * dependency-free rather than a full Draft-2020 implementation.
 */

export type JsonSchema = Record<string, unknown>

export type ValidationIssue = { path: string; message: string }

/** Result of validating a value. `errors` is empty when `ok` is true. */
export type SchemaValidation = {
  ok: boolean
  value: unknown
  errors: ValidationIssue[]
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return typeOf(value) === 'object'
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    default:
      return true // unknown type keyword → don't constrain
  }
}

function walk(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: ValidationIssue[],
): void {
  if (schema == null || typeof schema !== 'object') return

  // enum / const
  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some(e => deepEqual(e, value))
    if (!ok) {
      errors.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` })
      return
    }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) {
    errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` })
    return
  }

  // type (string or array of strings); nullable allows null in addition
  const declaredType = schema.type
  if (declaredType !== undefined) {
    const types = Array.isArray(declaredType) ? declaredType : [declaredType]
    const allowNull = schema.nullable === true || types.includes('null')
    if (value === null && allowNull) return
    const ok = types.some(t => matchesType(value, String(t)))
    if (!ok) {
      errors.push({
        path,
        message: `expected ${types.join('|')}, got ${typeOf(value)}`,
      })
      return
    }
  }

  if (typeOf(value) === 'object') {
    validateObject(value as Record<string, unknown>, schema, path, errors)
  } else if (Array.isArray(value)) {
    validateArray(value, schema, path, errors)
  } else if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `must be >= ${schema.minimum}` })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, message: `must be <= ${schema.maximum}` })
    }
  } else if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `must be at least ${schema.minLength} chars` })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ path, message: `must be at most ${schema.maxLength} chars` })
    }
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  errors: ValidationIssue[],
): void {
  const properties = (schema.properties as Record<string, JsonSchema>) ?? {}
  const required = Array.isArray(schema.required) ? schema.required : []

  for (const key of required) {
    if (!(String(key) in value)) {
      errors.push({ path: join(path, String(key)), message: 'is required' })
    }
  }
  for (const [key, sub] of Object.entries(properties)) {
    if (key in value) {
      walk(value[key], sub, join(path, key), errors)
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push({ path: join(path, key), message: 'is not allowed' })
      }
    }
  }
}

function validateArray(
  value: unknown[],
  schema: JsonSchema,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push({ path, message: `must have at least ${schema.minItems} items` })
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push({ path, message: `must have at most ${schema.maxItems} items` })
  }
  const items = schema.items as JsonSchema | undefined
  if (items && typeof items === 'object') {
    value.forEach((item, i) => walk(item, items, `${path}[${i}]`, errors))
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (ak.length !== bk.length) return false
    return ak.every(k =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  }
  return false
}

/** Validate a value against a JSON schema. */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
): SchemaValidation {
  const errors: ValidationIssue[] = []
  walk(value, schema, '', errors)
  return { ok: errors.length === 0, value, errors }
}

/**
 * Extract a JSON value from an agent's free-form text answer.
 *
 * Handles three common shapes: a fenced ```json block, a fenced ``` block, or
 * the first balanced {...} / [...] span in the text. Returns the parsed value
 * or throws with a clear message.
 */
/**
 * Strip LITERAL `<think>…</think>` tags an agent emitted as plain text.
 *
 * Structured thinking blocks (type: 'thinking') are already dropped upstream by
 * extractTextContent. But some backends/models emit their reasoning as a literal
 * `<think>…</think>` text span instead of a structured block; that text reaches
 * the agent's final output verbatim and pollutes the workflow's return value. We
 * remove whole tag spans, plus any stray unpaired `<think>`/`</think>` tag, then
 * trim. Content outside the tags is preserved.
 */
export function stripLiteralThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

export function extractJson(text: string): unknown {
  const fenced =
    /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ??
    sliceBalanced(text)
  if (fenced == null) {
    throw new Error('no JSON object or array found in agent output')
  }
  try {
    return JSON.parse(fenced.trim())
  } catch (err) {
    throw new Error(`agent output is not valid JSON: ${(err as Error).message}`)
  }
}

/** Find the first balanced {...} or [...] span (string-aware). */
function sliceBalanced(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start < 0) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr: string | null = null
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") inStr = ch
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Format validation errors for a re-prompt. */
export function formatIssues(errors: ValidationIssue[]): string {
  return errors
    .map(e => `- ${e.path || '(root)'}: ${e.message}`)
    .join('\n')
}
