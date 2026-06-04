import {
  getLastEffectiveSystemPromptAssembly,
  getLastSystemPromptAssembly,
  setLastEffectiveSystemPromptAssembly,
  setLastSystemPromptAssembly,
} from '../bootstrap/state.js'
import type {
  SystemPromptLayerSnapshot,
  SystemPromptRuntimeSnapshot,
} from './runtimeTypes.js'

export type PlatformSystemPromptLayer = {
  layer: string
  label: string
  sectionNames: string[]
  entries: Array<string | null>
}

export function createSystemPromptLayer(
  layer: string,
  label: string,
  sectionNames: string[],
  entries: Array<string | null>,
): PlatformSystemPromptLayer {
  return { layer, label, sectionNames, entries }
}

export function flattenSystemPromptLayers(
  layers: PlatformSystemPromptLayer[],
): string[] {
  const trace: SystemPromptLayerSnapshot[] = layers.map(layer => ({
    layer: layer.layer,
    label: layer.label,
    sectionNames: layer.sectionNames,
    itemCount: layer.entries.filter(entry => entry !== null).length,
  }))
  setLastSystemPromptAssembly(trace)
  return layers.flatMap(layer =>
    layer.entries.filter((entry): entry is string => entry !== null),
  )
}

export function recordEffectiveSystemPromptAssembly(input: {
  baseSource:
    | 'default'
    | 'custom'
    | 'agent'
    | 'coordinator'
    | 'override'
    | 'unknown'
  overlaySources: string[]
  itemCount: number
}): void {
  setLastEffectiveSystemPromptAssembly(input)
}

export function getSystemPromptRuntimeSnapshot(): SystemPromptRuntimeSnapshot {
  return {
    defaultAssembly: getLastSystemPromptAssembly(),
    effectiveAssembly: getLastEffectiveSystemPromptAssembly(),
  }
}
