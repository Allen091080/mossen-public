import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { isInBundledMode } from '../../utils/bundledMode.js'

export type AgentSupervisorSelfCommand = {
  command: string
  argsPrefix: string[]
}

function getSourceRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export function getAgentSupervisorSelfCommand(): AgentSupervisorSelfCommand {
  if (isInBundledMode()) {
    return { command: process.execPath, argsPrefix: [] }
  }

  const root = getSourceRoot()
  return {
    command: resolve(root, 'run-bun-featured.sh'),
    argsPrefix: [resolve(root, 'entrypoints', 'cli.tsx')],
  }
}
