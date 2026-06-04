import type { ReactNode } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  getCustomBackendName,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { runExtraUsage } from './extra-usage-core.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<ReactNode | null> {
  const result = await runExtraUsage()

  if (result.type === 'message') {
    onDone(result.value)
    return null
  }

  const backendName = isCustomBackendEnabled()
    ? getCustomBackendName()
    : 'Mossen backend'
  onDone(
    result.opened
      ? `Opened usage controls for ${backendName}: ${result.url}`
      : `Open usage controls for ${backendName}: ${result.url}`,
  )
  return null
}
