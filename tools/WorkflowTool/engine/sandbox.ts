/**
 * Controlled JavaScript evaluation for workflow scripts.
 *
 * A workflow body is plain JavaScript that calls the engine primitives
 * (agent / parallel / pipeline / phase / log / workflow) and may use standard
 * JS builtins. It must NOT reach the filesystem, network, process, or any
 * Node/Bun API, and must be deterministic across resume (so Date.now /
 * Math.random / argless `new Date()` are blocked).
 *
 * Isolation strategy (no external VM dependency, faithful to the public
 * Workflow contract):
 *
 *  1. The script body runs inside an async `Function` whose parameter list both
 *     INJECTS the allowed surface (primitives + curated builtins) and SHADOWS
 *     every dangerous global by binding its name to `undefined`. Inside the
 *     body `require`, `process`, `fetch`, `eval`, `Function`, `globalThis`,
 *     etc. therefore resolve to the shadow params, not the real globals.
 *  2. `Math` is replaced by a frozen clone whose `random` throws; `Date` by a
 *     guard that throws on `.now()` and argless construction.
 *  3. A static pre-scan rejects `import` / `require(` / dynamic `import(` before
 *     anything runs.
 *  4. Execution races against a timeout and an optional AbortSignal.
 *
 * This is defense-in-depth, not a cryptographic boundary: the workflow author
 * is the operator (scripts come from the model under the operator's session),
 * so the goal is to prevent accidents and enforce determinism, mirroring the
 * documented capability surface rather than sandboxing hostile code.
 */

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
  // NOTE: `eval` and `arguments` are deliberately NOT shadowed here — they are
  // reserved binding names in strict mode, so using them as parameter names is
  // itself a SyntaxError. They are blocked by static rejection instead (see
  // rejectModuleSyntax). `Function` (shadowed below) closes the other dynamic
  // code-eval avenue.
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

/** A Math clone whose nondeterministic member throws. */
function makeSafeMath(): Math {
  const clone: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(Math)) {
    clone[key] = (Math as unknown as Record<string, unknown>)[key]
  }
  clone.random = () => {
    throw new WorkflowScriptError(
      'Math.random() is unavailable in workflows (breaks resume determinism). ' +
        'Vary by agent index/label instead.',
    )
  }
  return Object.freeze(clone) as unknown as Math
}

/** A Date guard: argless `new Date()` and `Date.now()` throw; explicit args ok. */
function makeSafeDate(): DateConstructor {
  const denied = () => {
    throw new WorkflowScriptError(
      'Date.now() / new Date() are unavailable in workflows (breaks resume ' +
        'determinism). Pass timestamps via args, or stamp results after the run.',
    )
  }
  // Typed as `any` locally so the static-member + prototype assignments below
  // don't trip DateConstructor's read-only `prototype`; cast on return.
  const SafeDate: any = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) denied()
    // @ts-expect-error -- forwarding to the real Date with explicit args
    return new Date(...args)
  }
  // Copy static members, then override now().
  SafeDate.parse = Date.parse
  SafeDate.UTC = Date.UTC
  SafeDate.now = denied
  SafeDate.prototype = Date.prototype
  return SafeDate as DateConstructor
}

/** Curated safe builtins exposed to workflow bodies. */
function safeBuiltins(): Record<string, unknown> {
  return {
    JSON,
    Math: makeSafeMath(),
    Date: makeSafeDate(),
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    RegExp,
    Symbol,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    structuredClone:
      typeof structuredClone === 'function' ? structuredClone : undefined,
  }
}

export type SandboxScope = Record<string, unknown>

export type RunSandboxOptions = {
  /** Full workflow source (the meta block is stripped automatically). */
  source: string
  /** Engine surface injected into the body: agent, parallel, pipeline, etc. */
  scope: SandboxScope
  /** Hard wall-clock ceiling for the whole script. */
  timeoutMs: number
  /** Optional external cancellation. */
  signal?: AbortSignal
}

/** Reject module syntax before execution (workflows are self-contained). */
function rejectModuleSyntax(source: string): void {
  // `import x from` / `import(` / bare `import '...'`
  if (/(^|[^.\w])import\s*[({'"\w*]/.test(source)) {
    throw new WorkflowScriptError(
      'Workflow scripts cannot use import. They run self-contained against the ' +
        'injected engine surface (agent/parallel/pipeline/phase/log/workflow).',
    )
  }
  if (/(^|[^.\w])require\s*\(/.test(source)) {
    throw new WorkflowScriptError(
      'Workflow scripts cannot use require. Use the injected engine surface only.',
    )
  }
  // `eval` / `arguments` can't be shadowed as strict-mode params, so reject the
  // identifiers statically (member accesses like `obj.eval` are left alone).
  if (/(^|[^.\w])eval\s*\(/.test(source)) {
    throw new WorkflowScriptError(
      'Workflow scripts cannot use eval. Use the injected engine surface only.',
    )
  }
}

/**
 * Strip the leading `export const meta = {...}` (and any other top-level
 * `export ` keywords) so the body runs as a plain async function. `export`
 * keywords are the only module-ism the contract permits at the top.
 */
function stripExports(source: string): string {
  return source.replace(/(^|\n)\s*export\s+(const|let|var|function|async)\b/g, '$1$2')
}

/**
 * Evaluate a workflow body in the controlled context.
 *
 * Returns whatever the script returns (its top-level `return`), or undefined.
 */
export async function runSandbox(options: RunSandboxOptions): Promise<unknown> {
  const { source, scope, timeoutMs, signal } = options
  rejectModuleSyntax(source)
  const body = stripExports(source)

  const builtins = safeBuiltins()

  // Parameter names = injected scope + safe builtins + shadowed globals.
  // Later duplicates would be a syntax error, so de-dupe deterministically.
  const injected: Record<string, unknown> = { ...builtins, ...scope }
  const paramNames: string[] = []
  const paramValues: unknown[] = []
  const seen = new Set<string>()
  for (const [k, v] of Object.entries(injected)) {
    if (seen.has(k)) continue
    seen.add(k)
    paramNames.push(k)
    paramValues.push(v)
  }
  for (const g of SHADOWED_GLOBALS) {
    if (seen.has(g)) continue
    seen.add(g)
    paramNames.push(g)
    paramValues.push(undefined)
  }

  let fn: (...args: unknown[]) => Promise<unknown>
  try {
    // eslint-disable-next-line no-new-func -- controlled evaluation; see file header
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (...a: string[]) => (...args: unknown[]) => Promise<unknown>
    fn = new AsyncFunction(...paramNames, `"use strict";\n${body}`)
  } catch (err) {
    throw new WorkflowScriptError(
      `Workflow script failed to parse: ${(err as Error).message}`,
    )
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkflowTimeoutError(timeoutMs)), timeoutMs)
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return
    if (signal.aborted) reject(new WorkflowScriptError('Workflow aborted.'))
    signal.addEventListener('abort', () =>
      reject(new WorkflowScriptError('Workflow aborted.')),
    )
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(...paramValues)),
      timeout,
      aborted,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
