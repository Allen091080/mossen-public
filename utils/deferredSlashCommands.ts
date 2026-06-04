import { isEnvTruthy } from './envUtils.js'

function envNameForCommand(name: string): string {
  return `MOSSEN_CODE_ENABLE_${name.replace(/-/g, '_').toUpperCase()}_COMMAND`
}

export function isDeferredSlashCommandEnabled(name: string): boolean {
  return (
    isEnvTruthy(process.env.MOSSEN_CODE_ENABLE_DEFERRED_SLASH_COMMANDS) ||
    isEnvTruthy(process.env[envNameForCommand(name)])
  )
}
