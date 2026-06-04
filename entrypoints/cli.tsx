// Wave 7 Door Lock: must run before any other module loads to normalize
// process.env.USER_TYPE on the public Mossen build entrypoint.
import { applyUserTypeRuntimeLock } from '../utils/userTypeRuntimeLock.js'
applyUserTypeRuntimeLock()
import { profileCheckpoint } from '../utils/startupProfiler.js'
import { registerProcessOutputErrorHandlers } from '../utils/process.js'
import { startCapturingEarlyInput } from '../utils/earlyInput.js'
import { exitWithError } from '../utils/process.js'
import { execIntoTmuxWorktree } from '../utils/worktree.js'

function restoreLaunchCwd(): void {
  const launchCwd = process.env.MOSSENSRC_LAUNCH_CWD
  if (!launchCwd) {
    return
  }

  try {
    process.chdir(launchCwd)
  } finally {
    delete process.env.MOSSENSRC_LAUNCH_CWD
  }
}

restoreLaunchCwd()
profileCheckpoint('cli_tsx_entry')
registerProcessOutputErrorHandlers()
startCapturingEarlyInput()

async function runFastPaths(): Promise<boolean> {
  const args = process.argv.slice(2)

  if (args.includes('--tmux') || args.some(arg => arg.startsWith('--tmux='))) {
    const result = await execIntoTmuxWorktree(args)
    if (result.handled) {
      return true
    }
    if (result.error) {
      exitWithError(result.error)
    }
  }

  // Mossen config CLI flags (G1-4 / D-G05-A): internal/debug only, hidden from --help
  if (
    args.includes('--get-mossen-config') ||
    args.includes('--set-mossen-config') ||
    args.includes('--clear-mossen-config') ||
    args.includes('--list-mossen-config')
  ) {
    const { handleConfigCliFlag } = await import('../services/config/index.js')
    const { handled, exitCode } = await handleConfigCliFlag(args)
    if (handled) {
      process.exit(exitCode)
    }
  }

  // Multi-profile CLI flags (S1-09c, D-S09-2=Z): user-facing 7 flag.
  // 全部走 services/config/profiles facade chain; CLI dump apiKey 已脱敏.
  {
    const { isModelProfileFlagPresent, handleModelProfileCliFlag } = await import(
      '../services/config/profileCli.js'
    )
    if (isModelProfileFlagPresent(args)) {
      const { handled, exitCode } = await handleModelProfileCliFlag(args)
      if (handled) {
        process.exit(exitCode)
      }
    }
  }

  return false
}

async function run(): Promise<void> {
  if (await runFastPaths()) {
    return
  }

  const { main } = await import('../main.js')
  await main()
}

// W148-C: outermost catch — prepend `mossen failed to start: ` so the
// operator can immediately tell this is a *startup* failure (not a
// runtime user-facing error). Stack is preserved verbatim afterwards
// so existing debug workflows still see the full trace; exit code
// stays 1 (exitWithError default). This catch never runs after the
// TUI has mounted — main.tsx owns its own error rendering past that
// point.
void run().catch(error => {
  const detail =
    error instanceof Error ? error.stack ?? error.message : String(error)
  exitWithError(`mossen failed to start: ${detail}`)
})
