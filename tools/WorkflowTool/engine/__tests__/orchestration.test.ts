import { describe, expect, test } from 'bun:test'
import { createLimiter, defaultConcurrency } from '../concurrency.js'
import { parallel, pipeline } from '../orchestration.js'
import { assertBudget, BudgetExceededError, createBudget } from '../budget.js'

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

describe('createLimiter', () => {
  test('never exceeds max concurrency', async () => {
    const limiter = createLimiter(3)
    let active = 0
    let peak = 0
    const mk = () => async () => {
      active++
      peak = Math.max(peak, active)
      await tick(10)
      active--
      return 'ok'
    }
    await Promise.all(Array.from({ length: 12 }, () => limiter.run(mk())))
    expect(peak).toBeLessThanOrEqual(3)
  })

  test('runs all queued thunks to completion in order of release', async () => {
    const limiter = createLimiter(1)
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map(n =>
        limiter.run(async () => {
          await tick(2)
          order.push(n)
        }),
      ),
    )
    expect(order).toEqual([1, 2, 3, 4])
  })

  test('a throwing thunk releases its slot and rejects only its own caller', async () => {
    const limiter = createLimiter(1)
    const boom = limiter.run(async () => {
      throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')
    const after = await limiter.run(async () => 42)
    expect(after).toBe(42)
  })

  test('synchronous throw inside thunk is contained', async () => {
    const limiter = createLimiter(2)
    await expect(
      limiter.run((() => {
        throw new Error('sync')
      }) as any),
    ).rejects.toThrow('sync')
    expect(limiter.active()).toBe(0)
  })

  test('defaultConcurrency is within [1,16]', () => {
    const c = defaultConcurrency()
    expect(c).toBeGreaterThanOrEqual(1)
    expect(c).toBeLessThanOrEqual(16)
  })
})

describe('parallel (barrier)', () => {
  test('returns results in input order', async () => {
    const out = await parallel([
      async () => 'a',
      async () => 'b',
      async () => 'c',
    ])
    expect(out).toEqual(['a', 'b', 'c'])
  })

  test('a failing thunk becomes null and never rejects the whole call', async () => {
    const out = await parallel([
      async () => 1,
      async () => {
        throw new Error('x')
      },
      async () => 3,
    ])
    expect(out).toEqual([1, null, 3])
  })

  test('a synchronously-throwing thunk also becomes null', async () => {
    const out = await parallel([
      async () => 1,
      (() => {
        throw new Error('sync')
      }) as any,
    ])
    expect(out).toEqual([1, null])
  })
})

describe('pipeline (no barrier)', () => {
  test('threads each item through all stages', async () => {
    const out = await pipeline(
      [1, 2, 3],
      async (n: number) => n + 1,
      async (n: number) => n * 10,
    )
    expect(out).toEqual([20, 30, 40])
  })

  test('later stages receive (prev, originalItem, index)', async () => {
    const out = await pipeline(
      ['x', 'y'],
      async (item: string) => item.toUpperCase(),
      async (prev: string, original: unknown, index: number) =>
        `${prev}:${original}:${index}`,
    )
    expect(out).toEqual(['X:x:0', 'Y:y:1'])
  })

  test('a stage throwing drops that item to null and skips its remaining stages', async () => {
    let stage2Ran = 0
    const out = await pipeline(
      [1, 2, 3],
      async (n: number) => {
        if (n === 2) throw new Error('drop')
        return n
      },
      async (n: number) => {
        stage2Ran++
        return n * 100
      },
    )
    expect(out).toEqual([100, null, 300])
    expect(stage2Ran).toBe(2)
  })

  test('does not barrier between stages (fast item finishes its chain early)', async () => {
    const finishOrder: number[] = []
    await pipeline(
      [50, 5],
      async (ms: number) => {
        await tick(ms)
        return ms
      },
      async (ms: number) => {
        await tick(ms)
        finishOrder.push(ms)
        return ms
      },
    )
    expect(finishOrder[0]).toBe(5)
  })
})

describe('budget', () => {
  test('no target => remaining is Infinity and never exhausts', () => {
    const b = createBudget(null)
    expect(b.total).toBeNull()
    b.add(1_000_000)
    expect(b.remaining()).toBe(Infinity)
    expect(b.exhausted()).toBe(false)
  })

  test('tracks spend against a target', () => {
    const b = createBudget(1000)
    b.add(400)
    expect(b.spent()).toBe(400)
    expect(b.remaining()).toBe(600)
    expect(b.exhausted()).toBe(false)
    b.add(700)
    expect(b.remaining()).toBe(0)
    expect(b.exhausted()).toBe(true)
  })

  test('threads in an initial spend (shared pool)', () => {
    const b = createBudget(1000, 250)
    expect(b.spent()).toBe(250)
    expect(b.remaining()).toBe(750)
  })

  test('assertBudget throws once exhausted', () => {
    const b = createBudget(100)
    b.add(100)
    expect(() => assertBudget(b)).toThrow(BudgetExceededError)
  })

  test('assertBudget is a no-op when under budget or unbounded', () => {
    expect(() => assertBudget(createBudget(100, 50))).not.toThrow()
    expect(() => assertBudget(createBudget(null, 10 ** 9))).not.toThrow()
  })

  test('ignores non-positive / non-finite adds', () => {
    const b = createBudget(100)
    b.add(-5)
    b.add(NaN)
    b.add(Infinity)
    expect(b.spent()).toBe(0)
  })
})
