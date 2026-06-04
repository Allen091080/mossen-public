/**
 * Token budget pool for the workflow engine.
 *
 * A workflow may be given a token target (e.g. the user's "+500k" directive).
 * The pool is shared across the main loop and all agents the workflow spawns.
 * The target is a HARD ceiling: once spent reaches total, further agent()
 * calls throw so a runaway loop cannot blow past the user's directive.
 *
 * `total` is null when no target was set; in that case remaining() is Infinity
 * and the ceiling never trips — loops that key on a budget must guard on
 * `budget.total` before relying on remaining().
 */

export type Budget = {
  /** The turn's token target, or null if none was set. */
  readonly total: number | null
  /** Output tokens spent so far across the shared pool. */
  spent(): number
  /** max(0, total - spent()), or Infinity when no target was set. */
  remaining(): number
  /** Record `n` output tokens against the pool. */
  add(n: number): void
  /** True once a target exists and has been reached. */
  exhausted(): boolean
}

export class BudgetExceededError extends Error {
  constructor(total: number, spent: number) {
    super(
      `Workflow token budget exhausted: spent ${spent} of ${total}. ` +
        `Further agent() calls are blocked.`,
    )
    this.name = 'BudgetExceededError'
  }
}

/**
 * Create a budget pool.
 *
 * @param total token target, or null/undefined for "no ceiling"
 * @param initialSpent tokens already spent before this workflow began (the pool
 *        is shared, so a parent's spend can be threaded in)
 */
export function createBudget(
  total: number | null = null,
  initialSpent = 0,
): Budget {
  let spent = Math.max(0, initialSpent)
  const cap = total != null && total > 0 ? Math.floor(total) : null

  return {
    total: cap,
    spent: () => spent,
    remaining: () => (cap == null ? Infinity : Math.max(0, cap - spent)),
    add: (n: number) => {
      if (Number.isFinite(n) && n > 0) spent += n
    },
    exhausted: () => cap != null && spent >= cap,
  }
}

/** Throw if the budget is exhausted; called before each agent() spawn. */
export function assertBudget(budget: Budget): void {
  if (budget.exhausted()) {
    throw new BudgetExceededError(budget.total ?? 0, budget.spent())
  }
}
