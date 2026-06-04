/**
 * CLI exit helpers for subcommand handlers.
 *
 * Consolidates the 4-5 line "print + lint-suppress + exit" block that was
 * copy-pasted ~60 times across `mossen mcp *` / `mossen plugin *` handlers.
 * The `: never` return type lets TypeScript narrow control flow at call sites
 * without a trailing `return`.
 *
 * W453: structured exit code enum per dev/mossen-contract.json
 * `stable_surface.exit_codes` + cli-harness R5 §C.3. Use the enum below
 * (or the cliErrorWith() helper) for new exit-with-classification call
 * sites. Existing `process.exit(0|1|2|143)` callsites are not refactored
 * en masse (W453 minimum mode): retrofitting ~80 callsites with correct
 * semantic mapping is high-risk for cli-harness exit-classification —
 * each one needs case-by-case audit. New code SHOULD prefer
 * cliErrorWith(EXIT_CODE.X) over bare process.exit(N). The W453-full
 * backlog tracks the gradual migration.
 *
 * cli-harness consumes these per R8 §6 #7 to retire stderr-text-match
 * error classification (mossen-error-classify.ts).
 */
/* eslint-disable custom-rules/no-process-exit -- centralized CLI exit point */

// `return undefined as never` (not a post-exit throw) — tests spy on
// process.exit and let it return. Call sites write `return cliError(...)`
// where subsequent code would dereference narrowed-away values under mock.
// cliError uses console.error (tests spy on console.error); cliOk uses
// process.stdout.write (tests spy on process.stdout.write — Bun's console.log
// doesn't route through a spied process.stdout.write).

/**
 * Structured exit codes per dev/mossen-contract.json
 * `stable_surface.exit_codes`. Cli-harness reads these for typed error
 * dispatch. Keep the literal numbers in sync with the contract.
 */
export const EXIT_CODE = {
  OK: 0,
  GENERIC_ERROR: 1,
  AUTH_REQUIRED: 2,
  PROFILE_MISSING: 3,
  NETWORK_DENIED: 4,
  TOOL_NOT_ALLOWED: 5,
  TIMEOUT: 6,
  INTERNAL_PANIC: 7,
} as const

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE]

/** Human-readable name → exit code (for cli-harness contract cross-check). */
export const EXIT_CODE_NAMES: Record<ExitCode, string> = {
  [EXIT_CODE.OK]: 'ok',
  [EXIT_CODE.GENERIC_ERROR]: 'generic_error',
  [EXIT_CODE.AUTH_REQUIRED]: 'auth_required',
  [EXIT_CODE.PROFILE_MISSING]: 'profile_missing',
  [EXIT_CODE.NETWORK_DENIED]: 'network_denied',
  [EXIT_CODE.TOOL_NOT_ALLOWED]: 'tool_not_allowed',
  [EXIT_CODE.TIMEOUT]: 'timeout',
  [EXIT_CODE.INTERNAL_PANIC]: 'internal_panic',
}

/** Write an error message to stderr (if given) and exit with code 1. */
export function cliError(msg?: string): never {
  // biome-ignore lint/suspicious/noConsole: centralized CLI error output
  if (msg) console.error(msg)
  process.exit(EXIT_CODE.GENERIC_ERROR)
  return undefined as never
}

/**
 * Write an error message to stderr (if given) and exit with a structured
 * exit code. Prefer this over `cliError(...)` when the error category is
 * known (auth / profile / network / tool / timeout / panic), so cli-harness
 * can route the failure without re-parsing stderr text.
 *
 * Example: `cliErrorWith(EXIT_CODE.AUTH_REQUIRED, 'API key missing')`.
 */
export function cliErrorWith(code: ExitCode, msg?: string): never {
  // biome-ignore lint/suspicious/noConsole: centralized CLI error output
  if (msg) console.error(msg)
  process.exit(code)
  return undefined as never
}

/** Write a message to stdout (if given) and exit with code 0. */
export function cliOk(msg?: string): never {
  if (msg) process.stdout.write(msg + '\n')
  process.exit(EXIT_CODE.OK)
  return undefined as never
}
