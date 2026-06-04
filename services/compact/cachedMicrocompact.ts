import { getFeatureValue_CACHED_MAY_BE_STALE } from '../config/dynamicConfig.js'

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  toolMessageGroups: string[][]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
}

export type CachedMCConfig = {
  enabled: boolean
  supportedModels: string[]
  triggerThreshold: number
  keepRecent: number
}

const DEFAULT_CONFIG: CachedMCConfig = {
  enabled: false,
  supportedModels: [],
  triggerThreshold: 16,
  keepRecent: 4,
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    toolMessageGroups: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
  }
}

export function getCachedMCConfig(): CachedMCConfig {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'mossen.compact.cachedMicrocompactConfig',
    DEFAULT_CONFIG,
  )
}

export function isCachedMicrocompactEnabled(): boolean {
  return getCachedMCConfig().enabled
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  const supported = getCachedMCConfig().supportedModels
  return supported.includes('*') || supported.includes(model)
}

export function registerToolResult(state: CachedMCState, toolUseId: string): void {
  state.registeredTools.add(toolUseId)
  state.toolOrder.push(toolUseId)
}

export function registerToolMessage(
  state: CachedMCState,
  toolUseIds: string[],
): void {
  if (toolUseIds.length > 0) {
    state.toolMessageGroups.push(toolUseIds)
  }
}

export function getToolResultsToDelete(state: CachedMCState): string[] {
  const config = getCachedMCConfig()
  const live = state.toolOrder.filter(id => !state.deletedRefs.has(id))
  if (live.length <= config.triggerThreshold) {
    return []
  }
  return live.slice(0, Math.max(0, live.length - config.keepRecent))
}

export function createCacheEditsBlock(
  state: CachedMCState,
  toolUseIds: string[],
): CacheEditsBlock | null {
  const edits = toolUseIds
    .filter(id => !state.deletedRefs.has(id))
    .map(id => {
      state.deletedRefs.add(id)
      return { type: 'delete' as const, cache_reference: id }
    })
  return edits.length > 0 ? { type: 'cache_edits', edits } : null
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder.length = 0
  state.toolMessageGroups.length = 0
  state.deletedRefs.clear()
  state.pinnedEdits.length = 0
}
