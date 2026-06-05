import { describe, expect, test } from 'bun:test'
import {
  checkWorkflowScriptDeterminism,
  checkWorkflowScriptSyntax,
  runSandbox,
  WorkflowScriptError,
  WorkflowTimeoutError,
} from '../sandbox.js'

const base = {
  source: '',
  scope: {},
  timeoutMs: 1000,
}

describe('runSandbox — allowed surface', () => {
  test('returns the script return value', async () => {
    const out = await runSandbox({ ...base, source: `return 1 + 2` })
    expect(out).toBe(3)
  })

  test('async/await works', async () => {
    const out = await runSandbox({
      ...base,
      source: `const v = await Promise.resolve(41); return v + 1`,
    })
    expect(out).toBe(42)
  })

  test('safe builtins available (JSON, Math.max, Array)', async () => {
    const out = await runSandbox({
      ...base,
      source: `return JSON.stringify({ m: Math.max(2, 9), a: Array.from({length:3},(_,i)=>i) })`,
    })
    expect(JSON.parse(out as string)).toEqual({ m: 9, a: [0, 1, 2] })
  })

  test('injected scope primitives are callable', async () => {
    const calls: string[] = []
    const out = await runSandbox({
      ...base,
      scope: {
        log: (m: string) => calls.push(m),
        agent: async (p: string) => `ran:${p}`,
      },
      source: `log('hello'); return await agent('task')`,
    })
    expect(calls).toEqual(['hello'])
    expect(out).toBe('ran:task')
  })

  test('injected timers work while global setTimeout stays hidden', async () => {
    const out = await runSandbox({
      ...base,
      scope: {
        timers: {
          wait: async () => undefined,
          setTimeout: async (_ms: number, value: string) => value,
        },
      },
      source: `await timers.wait(1); return [typeof setTimeout, await timers.setTimeout(1, 'ok')].join(':')`,
    })
    expect(out).toBe('undefined:ok')
  })

  test('explicit Date args still work', async () => {
    const out = await runSandbox({
      ...base,
      source: `return new Date(2020, 0, 1).getFullYear()`,
    })
    expect(out).toBe(2020)
  })
})

describe('runSandbox — blocked surface', () => {
  test('Math.random throws', async () => {
    await expect(
      runSandbox({ ...base, source: `return Math.random()` }),
    ).rejects.toThrow(/Math.random/)
  })

  test('Date.now throws', async () => {
    await expect(
      runSandbox({ ...base, source: `return Date.now()` }),
    ).rejects.toThrow(/determinism/)
  })

  test('argless new Date throws', async () => {
    await expect(
      runSandbox({ ...base, source: `return new Date()` }),
    ).rejects.toThrow(/determinism/)
  })

  test('process is shadowed to undefined', async () => {
    const out = await runSandbox({ ...base, source: `return typeof process` })
    expect(out).toBe('undefined')
  })

  test('globalThis / fetch / Function are shadowed', async () => {
    const out = await runSandbox({
      ...base,
      source: `return [typeof globalThis, typeof fetch, typeof Function].join(',')`,
    })
    expect(out).toBe('undefined,undefined,undefined')
  })

  test('constructor member access is rejected before execution', async () => {
    await expect(
      runSandbox({
        ...base,
        source: `return Object.constructor('return 1')()`,
      }),
    ).rejects.toThrow(/constructor/)
    await expect(
      runSandbox({
        ...base,
        source: `return Math.max['constructor']('return 1')()`,
      }),
    ).rejects.toThrow(/constructor/)
    await expect(
      runSandbox({
        ...base,
        source: `const AsyncFunction = (async () => {}).constructor; return await AsyncFunction('return 1')()`,
      }),
    ).rejects.toThrow(/constructor/)
  })

  test('injected host functions stay callable without host prototypes', async () => {
    const out = await runSandbox({
      ...base,
      scope: {
        agent: async () => ({ ok: true }),
        budget: {
          total: 100,
          spent: () => 0,
          remaining: () => 100,
        },
      },
      source: `
        const result = await agent('task')
        return [
          typeof agent,
          Object.getPrototypeOf(agent) === null,
          Object.getPrototypeOf(result) === null,
          result.ok,
          budget.spent(),
          Object.getPrototypeOf(budget) === null,
        ].join(':')
      `,
    })

    expect(out).toBe('function:true:true:true:0:true')
  })

  test('eval is rejected before execution', async () => {
    await expect(
      runSandbox({ ...base, source: `return eval('1+1')` }),
    ).rejects.toThrow(/eval/)
  })

  test('eval aliases stay unavailable at runtime', async () => {
    const out = await runSandbox({
      ...base,
      source: `
        let alias = 'blocked'
        try {
          const e = eval
          alias = typeof e === 'undefined' ? 'undefined' : e('1+1')
        } catch (err) {
          alias = err instanceof TypeError ? 'typeerror' : 'error'
        }
        return alias
      `,
    })

    expect(out).toBe('undefined')
  })

  test('import syntax is rejected before execution', async () => {
    await expect(
      runSandbox({ ...base, source: `import fs from 'fs'\nreturn 1` }),
    ).rejects.toThrow(WorkflowScriptError)
  })

  test('require is rejected before execution', async () => {
    await expect(
      runSandbox({ ...base, source: `const fs = require('fs')\nreturn 1` }),
    ).rejects.toThrow(/require/)
  })

  test('dynamic import is rejected', async () => {
    await expect(
      runSandbox({ ...base, source: `return import('fs')` }),
    ).rejects.toThrow(WorkflowScriptError)
  })

  test('forbidden words inside strings do not trigger module-syntax rejection', async () => {
    const out = await runSandbox({
      ...base,
      source: `return [
        'important claims require evidence',
        'do not eval guesses',
        'literal import("fs") text',
      ].join(' | ')`,
    })

    expect(out).toBe(
      'important claims require evidence | do not eval guesses | literal import("fs") text',
    )
  })

  test('syntax error surfaces as WorkflowScriptError', async () => {
    await expect(
      runSandbox({ ...base, source: `return (((` }),
    ).rejects.toThrow(WorkflowScriptError)
  })
})

describe('checkWorkflowScriptSyntax', () => {
  test('accepts a parseable workflow body without executing it', () => {
    const check = checkWorkflowScriptSyntax(
      `throw new Error('must not execute during preflight')`,
    )
    expect(check).toEqual({ ok: true })
  })

  test('returns a stable error for invalid syntax', () => {
    const check = checkWorkflowScriptSyntax(`const value = ;`)
    expect(check.ok).toBe(false)
    if ('error' in check) {
      expect(check.error).toContain('Workflow script failed to parse')
    }
  })
})

describe('checkWorkflowScriptDeterminism', () => {
  test('ignores nondeterministic API names inside strings', () => {
    expect(
      checkWorkflowScriptDeterminism(`
        const prompt = 'Explain why Date.now(), Math.random(), and new Date() are risky.'
        return agent(prompt)
      `),
    ).toBeNull()
  })

  test('rejects actual nondeterministic API calls', () => {
    expect(checkWorkflowScriptDeterminism(`return Date.now()`)).toContain(
      'Workflow scripts must be deterministic',
    )
    expect(checkWorkflowScriptDeterminism(`return Math.random()`)).toContain(
      'Workflow scripts must be deterministic',
    )
    expect(checkWorkflowScriptDeterminism(`return new Date()`)).toContain(
      'Workflow scripts must be deterministic',
    )
    expect(checkWorkflowScriptDeterminism(`return Date()`)).toContain(
      'Workflow scripts must be deterministic',
    )
  })
})

describe('runSandbox — limits', () => {
  test('a synchronous runaway loop hits the VM timeout', async () => {
    await expect(
      runSandbox({
        ...base,
        timeoutMs: 50,
        source: `while (true) {}`,
      }),
    ).rejects.toThrow(WorkflowTimeoutError)
  })

  test('synchronous first-frame timeout is separate from the whole run timeout', async () => {
    await expect(
      runSandbox({
        ...base,
        timeoutMs: 5000,
        syncTimeoutMs: 25,
        source: `while (true) {}`,
      }),
    ).rejects.toThrow('Workflow script exceeded its 25ms time budget.')
  })

  test('an awaiting script that never resolves hits the timeout', async () => {
    await expect(
      runSandbox({
        ...base,
        timeoutMs: 50,
        source: `await new Promise(() => {}); return 1`,
      }),
    ).rejects.toThrow(WorkflowTimeoutError)
  })

  test('respects an external abort signal', async () => {
    const ctrl = new AbortController()
    const p = runSandbox({
      ...base,
      timeoutMs: 5000,
      signal: ctrl.signal,
      source: `await new Promise(() => {}); return 1`,
    })
    ctrl.abort()
    await expect(p).rejects.toThrow(/aborted/)
  })
})
