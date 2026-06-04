import { feature } from 'bun:bundle'
import {
  getTeamMemEntrypoint,
  getTeamMemPath,
  isTeamMemoryEnabled,
} from '../memdir/teamMemPaths.js'
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/config/dynamicConfig.js'
import { isTeamMemorySyncAvailable } from '../services/teamMemorySync/index.js'
import type { TeamMemoryRuntimeSnapshot } from './runtimeTypes.js'

export function getTeamMemoryRuntimeSnapshot(): TeamMemoryRuntimeSnapshot {
  const buildEnabled = feature('TEAMMEM') ? true : false
  const autoMemoryEnabled = isAutoMemoryEnabled()
  const rolloutEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'mossen.memory.teamMemoryEnabled',
    false,
  )
  const enabled = isTeamMemoryEnabled()
  const syncAvailable = enabled ? isTeamMemorySyncAvailable() : false

  let statusReason: string | null = null
  if (!buildEnabled) {
    statusReason = 'Team memory build flag is disabled in the current runtime.'
  } else if (!autoMemoryEnabled) {
    statusReason = 'Team memory depends on auto memory, which is currently disabled.'
  } else if (!rolloutEnabled) {
    statusReason = 'Team memory is disabled by runtime gate (mossen.memory.teamMemoryEnabled). Auto memory remains enabled.'
  } else if (!syncAvailable) {
    statusReason =
      'Team memory sync requires the hosted sync service and is unavailable on the current provider/auth path.'
  }

  return {
    buildEnabled,
    enabled,
    syncAvailable,
    autoMemoryEnabled,
    rolloutEnabled,
    path: enabled ? getTeamMemPath() : null,
    entrypoint: enabled ? getTeamMemEntrypoint() : null,
    statusReason,
  }
}
