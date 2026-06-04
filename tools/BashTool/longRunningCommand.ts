import stripAnsi from 'strip-ansi'

export type LongRunningCommandState =
  | 'none'
  | 'candidate'
  | 'startup-detected'

const LONG_RUNNING_COMMAND_PATTERNS = [
  /\bcargo\s+run\b/i,
  /\bcargo\s+watch\b[\s\S]*\b(?:run|serve)\b/i,
  /\bcargo\s+tauri\s+dev\b/i,
  /\btrunk\s+serve\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|preview|watch|start)\b/i,
  /\bdeno\s+task\s+(?:dev|serve|watch|start)\b/i,
  /\b(?:vite|next|nuxt|astro|webpack-dev-server)\b/i,
  /\b(?:uvicorn|hypercorn)\b[\s\S]*(?:--reload|\bapp\b)/i,
  /\b(?:rails|bin\/rails)\s+(?:server|s)\b/i,
  /\bphp\s+artisan\s+serve\b/i,
  /\bflutter\s+run\b/i,
  /\bpython3?\s+-m\s+http\.server\b/i,
  // W146.2 P2-12: anchored to a shell-command position (start-of-string
  // or shell separator) instead of `\b`. Without the anchor the previous
  // pattern matched `cat program.go run` because `.` is non-word and so
  // the `g` of `go` sat on a `\b` boundary.
  /(?:^|[\n;&|])\s*(?:go|air)\s+run\b/i,
  /\bdocker\s+compose\s+up\b(?![^&\n]*\s-d\b)/i,
  /\bdocker-compose\s+up\b(?![^&\n]*\s-d\b)/i,
]

// Sampling/bounded patterns. When the operator pipes `cargo run` into one of
// these, the command is bounded in time or output and must NOT be treated as
// a dev-server startup we should auto-background — because once head/timeout
// has fired, the parent shell exits and the dev server still leaks in the
// background. The model should switch to `run_in_background: true` or a
// `timeout` wrapper instead.
const BOUNDED_COMMAND_PATTERNS = [
  /\|\s*head\b/i,
  /\|\s*tail\b/i,
  /\btail\s+-n\b/i,
  /\|\s*grep\s+-m\b/i,
  /\|\s*sed\s+-n\b/i,
  /\btimeout\s+\d+/i,
  /\bgtimeout\s+\d+/i,
]

// Backtick is intentional: Rust 1.85+ emits `Finished `dev` profile ...`
// (Cargo wraps the profile/binary names in backticks). The previous
// character class only covered single/double quotes and missed the real
// output, leaving cargo run stuck in `candidate` instead of escalating to
// `startup-detected`.
const FINISHED_AND_RUNNING_PATTERN =
  /(?:^|\n)\s*Finished\s+[`'"]?dev[`'"]?\s+profile[\s\S]{0,800}(?:^|\n)\s*Running\s+[`'"]?[^`'"\n]+[`'"]?/i

const STARTUP_SIGNAL_PATTERNS = [
  FINISHED_AND_RUNNING_PATTERN,
  /(?:^|\n)\s*Running\s+[`'"]?[^`'"\n]+[`'"]?/i,
  /\bLocal:\s+https?:\/\/[^\s]+/i,
  /\bNetwork:\s+https?:\/\/[^\s]+/i,
  /\b(?:listening|listen)\s+on\s+(?:https?:\/\/)?[^\s]+/i,
  /\bserver\s+(?:running|started|listening|ready)\b/i,
  /\bready\s+in\s+\d+(?:\.\d+)?\s*(?:ms|s)\b/i,
  /\bcompiled\s+successfully\b/i,
  /\bapp\s+(?:started|running)\b/i,
  /\bdevelopment\s+server\s+(?:running|started|ready)\b/i,
]

// macOS Cocoa runtime emits these as soon as any GUI app boots — they are
// noise, not a real readiness signal. We keep them out of STARTUP_SIGNAL_*
// so the auto-background path only fires on real readiness output.
export function isMacOSGuiNoise(line: string): boolean {
  return (
    /\bTSM\s+AdjustCapsLockLEDForKeyTransitionHandling\b/i.test(line) ||
    /\bIMKCFRunLoopWakeUpReliable\b/i.test(line)
  )
}

export function isBoundedCommand(command: string): boolean {
  return BOUNDED_COMMAND_PATTERNS.some(pattern => pattern.test(command))
}

export function isLikelyLongRunningCommand(command: string): boolean {
  if (isBoundedCommand(command)) {
    return false
  }
  return LONG_RUNNING_COMMAND_PATTERNS.some(pattern => pattern.test(command))
}

export function detectLongRunningCommandState(
  command: string,
  output: string,
): LongRunningCommandState {
  if (!isLikelyLongRunningCommand(command)) {
    return 'none'
  }

  const cleanedOutput = stripAnsi(output)
  // If the only signal in the output is macOS GUI noise (IMK/TSM), don't
  // promote to startup-detected — that would auto-background a process
  // that hasn't actually finished booting.
  const lines = cleanedOutput.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length > 0 && lines.every(isMacOSGuiNoise)) {
    return 'candidate'
  }
  if (STARTUP_SIGNAL_PATTERNS.some(pattern => pattern.test(cleanedOutput))) {
    return 'startup-detected'
  }

  return 'candidate'
}

export function getLongRunningCommandProgressText(
  state: LongRunningCommandState,
): { en: string; zh: string } | null {
  if (state === 'startup-detected') {
    return {
      en: 'The app/service appears to be running. Mossen should move it to the background and continue verification instead of waiting for it to exit.',
      zh: '应用/服务看起来已经运行。Mossen 应把它转到后台并继续验证，而不是等待它退出。',
    }
  }

  if (state === 'candidate') {
    return {
      en: 'This looks like a long-running dev command. If it keeps running after startup, use Ctrl+B to send it to the background.',
      zh: '这看起来是长运行开发命令。启动后如果持续运行，可用 Ctrl+B 转到后台。',
    }
  }

  return null
}
