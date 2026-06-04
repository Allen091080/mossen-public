import { feature } from 'bun:bundle'
import { getKairosActive } from '../bootstrap/state.js'
import { loadMemoryPrompt, ENTRYPOINT_NAME } from '../memdir/memdir.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../memdir/paths.js'
import type { MemoryRuntimeSnapshot } from './runtimeTypes.js'

export async function getMemoryRuntimeSnapshot(): Promise<MemoryRuntimeSnapshot> {
  const enabled = isAutoMemoryEnabled()
  const prompt = await loadMemoryPrompt()
  const dailyLogMode = feature('KAIROS') ? getKairosActive() : false

  return {
    enabled,
    autoMemoryPath: enabled ? getAutoMemPath() : null,
    promptLoaded: prompt !== null,
    entrypoint: ENTRYPOINT_NAME,
    dailyLogMode,
  }
}
