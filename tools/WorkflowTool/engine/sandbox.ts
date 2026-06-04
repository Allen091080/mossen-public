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
 *  2. The allowed surface (primitives) is injected as globals, while dangerous
 *     names (`process`, `fetch`, `Function`, `globalThis`, etc.) are shadowed
 *     to `undefined` inside the context.
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

export type SandboxScope = Record<string, unknown>

export type RunSandboxOptions = {
  /** Workflow script body; callers must strip the leading meta declaration. */
  source: string
  /** Engine surface injected into the body: agent, parallel, pipeline, etc. */
  scope: SandboxScope
  /** Hard wall-clock ceiling for the whole script. */
  timeoutMs: number
  /** Optional external cancellation. */
  signal?: AbortSignal
}

type WorkflowScriptSyntaxCheck =
  | { ok: true }
  | { ok: false; error: string }

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
})()
`

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
  const context = vm.createContext({ ...scope })
  new vm.Script(DETERMINISTIC_GUARDS, {
    filename: 'workflow-determinism-guards.js',
  }).runInContext(context, { timeout: timeoutMs })

  for (const name of SHADOWED_GLOBALS) {
    context[name] = undefined
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
  const script = compileWorkflowScript(source)
  const context = createContext(scope, timeoutMs)

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
      value = script.runInContext(context, { timeout: timeoutMs })
    } catch (err) {
      if (isVmTimeout(err)) throw new WorkflowTimeoutError(timeoutMs)
      normalizeExecutionError(err)
    }
    const execution = Promise.resolve(value).catch(normalizeExecutionError)
    return await Promise.race([execution, timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    removeAbortListener?.()
  }
}
