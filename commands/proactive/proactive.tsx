import {
  activateProactive,
  deactivateProactive,
  isProactiveActive,
} from '../../proactive/index.js'
import type { LocalCommandCall, LocalCommandModule } from '../../types/command.js'

export const call: LocalCommandCall = async args => {
  const normalized = args.trim().toLowerCase()

  if (normalized === 'on' || normalized === 'enable') {
    activateProactive('command')
    return { type: 'text', value: 'Proactive mode enabled.' }
  }

  if (normalized === 'off' || normalized === 'disable') {
    deactivateProactive()
    return { type: 'text', value: 'Proactive mode disabled.' }
  }

  if (isProactiveActive()) {
    deactivateProactive()
    return { type: 'text', value: 'Proactive mode disabled.' }
  }

  activateProactive('command')
  return { type: 'text', value: 'Proactive mode enabled.' }
}

const command: LocalCommandModule = { call }

export default command
