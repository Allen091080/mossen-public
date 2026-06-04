// Parse plugin subcommand arguments into structured commands
export type ParsedCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'install'; marketplace?: string; plugin?: string }
  | {
      // /plugin install --dry-run <plugin@market|github-url> [--scope user|project|local]
      // /plugin install --confirm <token>
      type: 'install-plan'
      plugin?: string
      scope?: string
      confirmToken?: string
    }
  | {
      // /plugin install --url <https-zip-url> [--scope user|project|local]
      type: 'install-url'
      url?: string
      scope?: string
    }
  | { type: 'manage' }
  | { type: 'uninstall'; plugin?: string }
  | { type: 'enable'; plugin?: string }
  | { type: 'disable'; plugin?: string }
  | { type: 'validate'; path?: string }
  | {
      type: 'marketplace'
      action?: 'add' | 'remove' | 'update' | 'list'
      target?: string
    }
  | {
      // /plugin marketplace add --dry-run <source>
      // /plugin marketplace add --confirm <token>
      type: 'marketplace-add-plan'
      target?: string
      confirmToken?: string
    }
  | {
      // /plugin prune (dry-run) / /plugin prune --confirm <token>
      // confirmToken absent → dry-run; present → execute the previously-
      // issued plan via executePluginPrunePlan.
      type: 'prune'
      confirmToken?: string
    }
  | {
      // /plugin status — read-only summary of plugin cache + installed
      // registry. No marker writes, no cache mutation, no registry change.
      type: 'status'
    }
  | {
      // /plugin doctor — read-only actionable diagnosis of plugin state.
      type: 'doctor'
    }
  | {
      // /plugin sources — read-only summary of known/declared marketplace
      // sources and suggested install commands. No fetch, clone, or write.
      type: 'sources'
    }
  | {
      // /plugin paths — read-only summary of standard local extension paths.
      type: 'paths'
    }

export function parsePluginArgs(args?: string): ParsedCommand {
  if (!args) {
    return { type: 'menu' }
  }

  const parts = args.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase()

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { type: 'help' }

    case 'install':
    case 'i': {
      if (parts[1] === '--dry-run') {
        const scopeIndex = parts.findIndex(part => part === '--scope')
        const scope =
          scopeIndex >= 0 ? parts[scopeIndex + 1]?.trim() : undefined
        const plugin = parts
          .slice(2)
          .filter((part, index, items) => {
            if (part === '--scope') return false
            return items[index - 1] !== '--scope'
          })
          .join(' ')
          .trim()
        return { type: 'install-plan', plugin: plugin || undefined, scope }
      }
      if (parts[1] === '--confirm') {
        return { type: 'install-plan', confirmToken: parts[2] }
      }
      if (parts[1] === '--url') {
        const scopeIndex = parts.findIndex(part => part === '--scope')
        const scope =
          scopeIndex >= 0 ? parts[scopeIndex + 1]?.trim() : undefined
        return { type: 'install-url', url: parts[2], scope }
      }

      const target = parts[1]
      if (!target) {
        return { type: 'install' }
      }

      // Check if it's in format plugin@marketplace
      if (target.includes('@')) {
        const [plugin, marketplace] = target.split('@')
        return { type: 'install', plugin, marketplace }
      }

      // Check if the target looks like a marketplace (URL or path)
      const isMarketplace =
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('file://') ||
        target.includes('/') ||
        target.includes('\\')

      if (isMarketplace) {
        // This is a marketplace URL/path, no plugin specified
        return { type: 'install', marketplace: target }
      }

      // Otherwise treat it as a plugin name
      return { type: 'install', plugin: target }
    }

    case 'manage':
      return { type: 'manage' }

    case 'uninstall':
      return { type: 'uninstall', plugin: parts[1] }

    case 'enable':
      return { type: 'enable', plugin: parts[1] }

    case 'disable':
      return { type: 'disable', plugin: parts[1] }

    case 'validate': {
      const target = parts.slice(1).join(' ').trim()
      return { type: 'validate', path: target || undefined }
    }

    case 'status':
    case 'stat':
      return { type: 'status' }

    case 'doctor':
    case 'diag':
    case 'diagnose':
      return { type: 'doctor' }

    case 'sources':
    case 'source':
      return { type: 'sources' }

    case 'paths':
    case 'path':
      return { type: 'paths' }

    case 'prune': {
      // Optional `--confirm <token>` to commit a prior dry-run. Token
      // shape (8 hex chars) is enforced inside executePluginPrunePlan;
      // here we just shuttle the value through.
      const flagIdx = parts.findIndex(p => p === '--confirm')
      const confirmToken =
        flagIdx >= 0 ? parts[flagIdx + 1]?.trim() || undefined : undefined
      return { type: 'prune', confirmToken }
    }

    case 'marketplace':
    case 'market': {
      const action = parts[1]?.toLowerCase()
      const rest = parts.slice(2)
      const target = rest.join(' ')

      switch (action) {
        case 'add': {
          if (rest[0] === '--dry-run') {
            return {
              type: 'marketplace-add-plan',
              target: rest.slice(1).join(' '),
            }
          }
          if (rest[0] === '--confirm') {
            return {
              type: 'marketplace-add-plan',
              confirmToken: rest[1],
            }
          }
          return { type: 'marketplace', action: 'add', target }
        }
        case 'remove':
        case 'rm':
          return { type: 'marketplace', action: 'remove', target }
        case 'update':
          return { type: 'marketplace', action: 'update', target }
        case 'list':
          return { type: 'marketplace', action: 'list' }
        default:
          // No action specified, show marketplace menu
          return { type: 'marketplace' }
      }
    }

    default:
      // Unknown command, show menu
      return { type: 'menu' }
  }
}
