// Parse /project subcommand arguments into structured commands.
// Round 2 ships exactly one subcommand: `purge`.

const FORBIDDEN_FLAGS = [
  '--all-projects',
  '--orphan-only',
  '--no-archive',
  '--force',
  '--yes',
  '--i-know-what-im-doing',
] as const

export type ParsedProjectCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | {
      // /project purge (dry-run) / /project purge --confirm <token>
      // /project purge --target <cwd> / --include-memory
      type: 'purge'
      target?: string
      includeMemory: boolean
      confirmToken?: string
    }
  | {
      // /project list — read-only inventory of ~/.mossen/projects/.
      type: 'list'
    }
  | {
      // /project status — read-only summary of the active project.
      type: 'status'
    }
  | { type: 'unsupported_flag'; flag: string }

function readFlagValue(parts: string[], flag: string): string | undefined {
  const idx = parts.findIndex(p => p === flag)
  if (idx < 0) return undefined
  const next = parts[idx + 1]
  return next ? next.trim() || undefined : undefined
}

export function parseProjectArgs(args?: string): ParsedProjectCommand {
  if (!args) {
    return { type: 'menu' }
  }
  const trimmed = args.trim()
  if (!trimmed) {
    return { type: 'menu' }
  }
  const parts = trimmed.split(/\s+/)
  const command = parts[0]?.toLowerCase()

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { type: 'help' }

    case 'list':
    case 'ls':
      return { type: 'list' }

    case 'status':
    case 'stat':
      return { type: 'status' }

    case 'purge': {
      // First reject any forbidden flag — these are red lines that should
      // never silently pass through. Reject with a tagged error so the UI
      // can show a localized message.
      for (const flag of FORBIDDEN_FLAGS) {
        if (parts.includes(flag)) {
          return { type: 'unsupported_flag', flag }
        }
      }

      const target = readFlagValue(parts, '--target')
      const confirmToken = readFlagValue(parts, '--confirm')
      const includeMemory = parts.includes('--include-memory')

      return {
        type: 'purge',
        target,
        includeMemory,
        confirmToken,
      }
    }

    default:
      return { type: 'menu' }
  }
}
