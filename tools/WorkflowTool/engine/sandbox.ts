/**
 * Controlled JavaScript evaluation for workflow scripts.
 *
 * A workflow body is plain JavaScript that calls the engine primitives
 * (agent / parallel / pipeline / phase / log / workflow) and may use standard
 * JS builtins. It must NOT reach the filesystem, network, process, or any
 * Node/Bun API, and must be deterministic across resume (so Date.now /
 * Math.random / argless `new Date()` are blocked).
 *
 * Isolation strategy (VM-backed, faithful to the public Workflow contract):
 *
 *  1. The script body runs inside a `node:vm` context so synchronous runaway
 *     loops are cut off by `runInContext(..., { timeout })`, matching the
 *     official workflow runner's first-frame timeout behavior.
 *  2. The allowed surface (primitives) is injected as globals through VM-native
 *     wrappers, while dangerous names (`process`, `fetch`, `Function`,
 *     `globalThis`, etc.) are shadowed to `undefined` inside the context.
 *  3. VM-native builtins are used where possible. `Math.random` and `Date`
 *     are patched inside the VM context so nondeterministic calls throw without
 *     handing host constructors to the workflow script.
 *  4. A static pre-scan rejects `import` / `require(` / dynamic `import(` before
 *     anything runs.
 *  5. Async execution races against a timeout and an optional AbortSignal.
 *
 * This is defense-in-depth, not a cryptographic boundary: the workflow author
 * is the operator (scripts come from the model under the operator's session),
 * so the goal is to prevent accidents and enforce determinism, mirroring the
 * documented capability surface rather than sandboxing hostile code.
 */

import vm from 'node:vm'
import { parse } from 'acorn'

export class WorkflowScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowScriptError'
  }
}

export class WorkflowTimeoutError extends Error {
  constructor(ms: number) {
    super(`Workflow script exceeded its ${ms}ms time budget.`)
    this.name = 'WorkflowTimeoutError'
  }
}

const DEFAULT_SYNC_TIMEOUT_MS = 1000

/** Global names shadowed to `undefined` inside every workflow body. */
const SHADOWED_GLOBALS = [
  'globalThis',
  'global',
  'self',
  'window',
  'process',
  'require',
  'module',
  'exports',
  // Shadow eval at the VM global layer too. Static rejection catches direct
  // eval(...), but aliases and constructors can otherwise recover it.
  'eval',
  // `arguments` is deliberately not shadowed here — it is not a global, and
  // binding it in strict mode would itself be a SyntaxError.
  'Function',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Bun',
  'Deno',
  'Buffer',
  'crypto',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'importScripts',
  '__dirname',
  '__filename',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
]

export type SandboxScope = Record<string, unknown>

type AstNode = {
  type: string
  [key: string]: unknown
}

export type RunSandboxOptions = {
  /** Workflow script body; callers must strip the leading meta declaration. */
  source: string
  /** Engine surface injected into the body: agent, parallel, pipeline, etc. */
  scope: SandboxScope
  /** Hard wall-clock ceiling for the whole script. */
  timeoutMs: number
  /** First-frame synchronous VM ceiling. Defaults lower than the whole run. */
  syncTimeoutMs?: number
  /** Optional external cancellation. */
  signal?: AbortSignal
}

type WorkflowScriptSyntaxCheck =
  | { ok: true }
  | { ok: false; error: string }

export const WORKFLOW_DETERMINISM_ERROR =
  'Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.'

function workflowImportError(): WorkflowScriptError {
  return new WorkflowScriptError(
    'Workflow scripts cannot use import. They run self-contained against the ' +
      'injected engine surface (agent/parallel/pipeline/phase/log/workflow).',
  )
}

function workflowRequireError(): WorkflowScriptError {
  return new WorkflowScriptError(
    'Workflow scripts cannot use require. Use the injected engine surface only.',
  )
}

function workflowEvalError(): WorkflowScriptError {
  return new WorkflowScriptError(
    'Workflow scripts cannot use eval. Use the injected engine surface only.',
  )
}

function workflowConstructorError(): WorkflowScriptError {
  return new WorkflowScriptError(
    'Workflow scripts cannot access constructor properties. Use the injected engine surface only.',
  )
}

function isIdentifier(node: unknown, name: string): boolean {
  return isAstNode(node) && node.type === 'Identifier' && node.name === name
}

function isLiteralString(node: unknown, value: string): boolean {
  return (
    isAstNode(node) &&
    node.type === 'Literal' &&
    (node as { value?: unknown }).value === value
  )
}

function isNamedMember(
  node: unknown,
  objectName: string,
  propertyName: string,
): boolean {
  if (!isAstNode(node) || node.type !== 'MemberExpression') return false
  const member = node as {
    object?: unknown
    property?: unknown
    computed?: unknown
  }
  if (!isIdentifier(member.object, objectName)) return false
  return member.computed === true
    ? isLiteralString(member.property, propertyName)
    : isIdentifier(member.property, propertyName)
}

function isConstructorMemberAccess(node: unknown): boolean {
  if (!isAstNode(node) || node.type !== 'MemberExpression') return false
  const member = node as { property?: unknown; computed?: unknown }
  return member.computed === true
    ? isLiteralString(member.property, 'constructor')
    : isIdentifier(member.property, 'constructor')
}

function isCallOfNamedMember(
  node: unknown,
  objectName: string,
  propertyName: string,
): boolean {
  return (
    isAstNode(node) &&
    node.type === 'CallExpression' &&
    isNamedMember(
      (node as { callee?: unknown }).callee,
      objectName,
      propertyName,
    )
  )
}

function callExpressionArgs(node: AstNode): unknown[] {
  const args = (node as { arguments?: unknown }).arguments
  return Array.isArray(args) ? args : []
}

function isConstructorReflectAccess(node: unknown): boolean {
  if (!isAstNode(node) || node.type !== 'CallExpression') return false
  const call = node as { callee?: unknown }
  const args = callExpressionArgs(node)
  if (
    isNamedMember(call.callee, 'Reflect', 'get') &&
    isLiteralString(args[1], 'constructor')
  ) {
    return true
  }
  if (
    isNamedMember(call.callee, 'Object', 'getOwnPropertyDescriptor') &&
    isLiteralString(args[1], 'constructor')
  ) {
    return true
  }
  return false
}

function isArglessDateConstruction(node: unknown): boolean {
  if (!isAstNode(node)) return false
  if (node.type !== 'NewExpression' && node.type !== 'CallExpression') {
    return false
  }
  const expr = node as { callee?: unknown; arguments?: unknown }
  return (
    isIdentifier(expr.callee, 'Date') &&
    Array.isArray(expr.arguments) &&
    expr.arguments.length === 0
  )
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function walkAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') {
      continue
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walkAst(child, visit)
      }
      continue
    }
    if (isAstNode(value)) walkAst(value, visit)
  }
}

function parseForForbiddenSyntax(source: string): AstNode | null {
  try {
    return parse(wrappedWorkflowSource(source), {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as unknown as AstNode
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Static import declarations are invalid inside the wrapped async function.
    // Preserve the workflow-specific error instead of falling through to a generic
    // parse error when the parser can identify an import token.
    if (/\bimport\b/i.test(message)) throw workflowImportError()
    return null
  }
}

/** Reject module/eval syntax before execution (workflows are self-contained). */
function rejectModuleSyntax(source: string): void {
  const program = parseForForbiddenSyntax(source)
  if (!program) return

  walkAst(program, node => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportDefaultDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ImportExpression'
    ) {
      throw workflowImportError()
    }
    if (
      node.type === 'MetaProperty' &&
      isAstNode(node.meta) &&
      node.meta.name === 'import'
    ) {
      throw workflowImportError()
    }
    if (
      node.type === 'CallExpression' &&
      isAstNode(node.callee) &&
      node.callee.type === 'Identifier'
    ) {
      if (node.callee.name === 'require') throw workflowRequireError()
      if (node.callee.name === 'eval') throw workflowEvalError()
    }
    if (isConstructorReflectAccess(node)) throw workflowConstructorError()
    if (isConstructorMemberAccess(node)) throw workflowConstructorError()
  })
}

export function checkWorkflowScriptDeterminism(source: string): string | null {
  let program: AstNode | null
  try {
    program = parseForForbiddenSyntax(source)
  } catch {
    return null
  }
  if (!program) return null

  let blocked = false
  walkAst(program, node => {
    if (blocked) return
    if (
      isCallOfNamedMember(node, 'Date', 'now') ||
      isCallOfNamedMember(node, 'Math', 'random') ||
      isArglessDateConstruction(node)
    ) {
      blocked = true
    }
  })

  return blocked ? WORKFLOW_DETERMINISM_ERROR : null
}

const DETERMINISTIC_GUARDS = `
(() => {
  const randomDenied = () => {
    throw new Error(
      'Math.random() is unavailable in workflows (breaks resume determinism). ' +
        'Vary by agent index/label instead.'
    )
  }
  Object.defineProperty(Math, 'random', {
    value: randomDenied,
    writable: false,
    configurable: false,
  })

  const NativeDate = Date
  const dateDenied = () => {
    throw new Error(
      'Date.now() / new Date() are unavailable in workflows (breaks resume ' +
        'determinism). Pass timestamps via args, or stamp results after the run.'
    )
  }
  function SafeDate(...args) {
    if (args.length === 0) dateDenied()
    if (new.target) return Reflect.construct(NativeDate, args, new.target)
    return NativeDate(...args)
  }
  Object.defineProperties(SafeDate, {
    parse: { value: NativeDate.parse },
    UTC: { value: NativeDate.UTC },
    now: { value: dateDenied },
    prototype: { value: NativeDate.prototype },
  })
  Object.defineProperty(globalThis, 'Date', {
    value: SafeDate,
    writable: true,
    configurable: true,
  })

  const hideConstructor = (target) => {
    try {
      Object.defineProperty(target, 'constructor', {
        value: undefined,
        writable: false,
        configurable: false,
      })
    } catch {}
  }
  const AsyncFunction = (async function () {}).constructor
  const GeneratorFunction = (function* () {}).constructor
  const AsyncGeneratorFunction = (async function* () {}).constructor
  for (const target of [
    Object.prototype,
    Array.prototype,
    Function.prototype,
    AsyncFunction.prototype,
    GeneratorFunction.prototype,
    AsyncGeneratorFunction.prototype,
    Date.prototype,
    RegExp.prototype,
    Map.prototype,
    Set.prototype,
    Promise.prototype,
  ]) {
    hideConstructor(target)
  }
})()
`

type HostCallable = (...args: unknown[]) => unknown
type HostFunctionBridge = (id: number, args: unknown[]) => unknown

type ScopeAdapter = {
  toSandboxValue(value: unknown, freezeObjects?: boolean): unknown
}

function createScopeAdapter(context: vm.Context): ScopeAdapter {
  const hostFunctions = new Map<number, HostCallable>()
  let nextHostFunctionId = 1

  const makeHostFunction = vm.runInContext(
    `((bridge, id) => {
      const wrapped = (...args) => bridge(id, args)
      Object.defineProperty(wrapped, 'constructor', {
        value: undefined,
        enumerable: false,
        configurable: false,
      })
      Object.defineProperty(wrapped, 'prototype', {
        value: undefined,
        enumerable: false,
        configurable: false,
      })
      Object.setPrototypeOf(wrapped, null)
      return Object.freeze(wrapped)
    })`,
    context,
  ) as (bridge: HostFunctionBridge, id: number) => unknown

  const makeEmptyObject = vm.runInContext(
    `(() => Object.create(null))`,
    context,
  ) as () => object

  const defineObjectEntries = vm.runInContext(
    `((out, entries, freezeObjects) => {
      for (const [key, value] of entries) {
        Object.defineProperty(out, key, {
          value,
          enumerable: true,
          writable: !freezeObjects,
          configurable: !freezeObjects,
        })
      }
      return freezeObjects ? Object.freeze(out) : out
    })`,
    context,
  ) as (
    out: object,
    entries: Array<[string, unknown]>,
    freezeObjects: boolean,
  ) => unknown

  const makeArray = vm.runInContext(
    `((items, freezeObjects) => {
      const out = Array.from(items)
      return freezeObjects ? Object.freeze(out) : out
    })`,
    context,
  ) as (items: unknown[], freezeObjects: boolean) => unknown

  const toSandboxValue = (
    value: unknown,
    freezeObjects = false,
    seen = new WeakMap<object, unknown>(),
  ): unknown => {
    if (value == null || (typeof value !== 'object' && typeof value !== 'function')) {
      return value
    }

    if (typeof value === 'function') {
      const id = nextHostFunctionId++
      hostFunctions.set(id, value as HostCallable)
      return makeHostFunction(bridge, id)
    }

    const objectValue = value as object
    const seenValue = seen.get(objectValue)
    if (seenValue) return seenValue

    if (Array.isArray(value)) {
      const items = value.map(item => toSandboxValue(item, freezeObjects, seen))
      const out = makeArray(items, freezeObjects)
      seen.set(objectValue, out)
      return out
    }

    const out = makeEmptyObject()
    seen.set(objectValue, out)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const entries: Array<[string, unknown]> = []
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) continue
      entries.push([key, toSandboxValue(descriptor.value, freezeObjects, seen)])
    }
    return defineObjectEntries(out, entries, freezeObjects)
  }

  const bridge: HostFunctionBridge = (id, args) => {
    const fn = hostFunctions.get(id)
    if (!fn) throw new WorkflowScriptError('Workflow host function is no longer available.')
    const result = fn(...args)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).then(value => toSandboxValue(value))
    }
    return toSandboxValue(result)
  }

  return { toSandboxValue }
}

function isVmTimeout(err: unknown): boolean {
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message?: unknown }).message)
      : ''
  return /Script execution timed out after \d+ms/.test(message)
}

function isSyntaxErrorLike(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'SyntaxError'
  )
}

function normalizeExecutionError(err: unknown): never {
  if (isSyntaxErrorLike(err)) {
    const message =
      typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err)
    throw new WorkflowScriptError(
      `Workflow script failed to parse: ${message}`,
    )
  }
  throw err
}

function wrappedWorkflowSource(source: string): string {
  return `(async function() {\n"use strict";\n${source}\n})()`
}

function preflightWorkflowScriptSyntax(source: string): void {
  try {
    // Parse only. This does not execute the workflow body; execution still
    // happens inside the VM context below.
    new Function(`return (async function() {\n"use strict";\n${source}\n})`)
  } catch (err) {
    throw new WorkflowScriptError(
      `Workflow script failed to parse: ${(err as Error).message}`,
    )
  }
}

function compileWorkflowScript(source: string): vm.Script {
  rejectModuleSyntax(source)
  preflightWorkflowScriptSyntax(source)
  try {
    return new vm.Script(wrappedWorkflowSource(source), {
      filename: 'workflow.js',
    })
  } catch (err) {
    throw new WorkflowScriptError(
      `Workflow script failed to parse: ${(err as Error).message}`,
    )
  }
}

/** Preflight workflow script syntax before launching a background run. */
export function checkWorkflowScriptSyntax(
  source: string,
): WorkflowScriptSyntaxCheck {
  try {
    compileWorkflowScript(source)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function createContext(scope: SandboxScope, timeoutMs: number): vm.Context {
  const context = vm.createContext({})
  new vm.Script(DETERMINISTIC_GUARDS, {
    filename: 'workflow-determinism-guards.js',
  }).runInContext(context, { timeout: timeoutMs })

  for (const name of SHADOWED_GLOBALS) {
    context[name] = undefined
  }

  const adapter = createScopeAdapter(context)
  for (const [name, value] of Object.entries(scope)) {
    context[name] = adapter.toSandboxValue(value, true)
  }
  return context
}

/**
 * Evaluate a workflow body in the controlled context.
 *
 * Returns whatever the script returns (its top-level `return`), or undefined.
 */
export async function runSandbox(options: RunSandboxOptions): Promise<unknown> {
  const { source, scope, timeoutMs, signal } = options
  const syncTimeoutMs = Math.max(
    1,
    Math.floor(
      Math.min(
        timeoutMs,
        options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
      ),
    ),
  )
  const script = compileWorkflowScript(source)
  const context = createContext(scope, syncTimeoutMs)

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkflowTimeoutError(timeoutMs)), timeoutMs)
  })
  let removeAbortListener: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return
    if (signal.aborted) reject(new WorkflowScriptError('Workflow aborted.'))
    const abort = () => {
      reject(new WorkflowScriptError('Workflow aborted.'))
    }
    signal.addEventListener('abort', abort)
    removeAbortListener = () => signal.removeEventListener('abort', abort)
  })

  try {
    let value: unknown
    try {
      value = script.runInContext(context, { timeout: syncTimeoutMs })
    } catch (err) {
      if (isVmTimeout(err)) throw new WorkflowTimeoutError(syncTimeoutMs)
      normalizeExecutionError(err)
    }
    const execution = Promise.resolve(value).catch(normalizeExecutionError)
    return await Promise.race([execution, timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    removeAbortListener?.()
  }
}
