import { describe, expect, test } from 'bun:test'
import {
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

  test('strips export keywords so meta block is harmless', async () => {
    const out = await runSandbox({
      ...base,
      source: `export const meta = { name: 'x', description: 'd' }\nreturn meta.name`,
    })
    expect(out).toBe('x')
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

  test('eval is rejected before execution', async () => {
    await expect(
      runSandbox({ ...base, source: `return eval('1+1')` }),
    ).rejects.toThrow(/eval/)
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

  test('syntax error surfaces as WorkflowScriptError', async () => {
    await expect(
      runSandbox({ ...base, source: `return (((` }),
    ).rejects.toThrow(WorkflowScriptError)
  })
})

describe('runSandbox — limits', () => {
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
