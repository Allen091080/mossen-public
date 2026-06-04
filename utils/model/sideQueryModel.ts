import {
  getCustomBackendModel,
  isCustomBackendEnabled,
} from '../customBackend.js'
import { isModelAlias } from './aliases.js'
import { getMainLoopModel } from './model.js'

function stripContextSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, '')
}

function isBundledMossenModel(model: string): boolean {
  return /^mossen-(?:opus|sonnet|haiku)-/i.test(stripContextSuffix(model))
}

/**
 * Resolve side-query models against the active provider.
 *
 * Side queries are internal helper calls (titles, summaries, permission
 * explanations, goal evaluators). Custom OpenAI/messages-compatible backends
 * frequently do not support Mossen's built-in fast/balanced aliases, so route
 * alias-like side-query models back to the active custom profile model.
 */
export function resolveProviderAwareSideQueryModel(model: string): string {
  const requested = model.trim()
  const activeCustomModel = isCustomBackendEnabled()
    ? getCustomBackendModel()
    : null

  if (requested === 'inherit') {
    return activeCustomModel || getMainLoopModel()
  }

  if (
    activeCustomModel &&
    (requested === '' ||
      isModelAlias(requested as Parameters<typeof isModelAlias>[0]) ||
      isBundledMossenModel(requested))
  ) {
    return activeCustomModel
  }

  return requested || activeCustomModel || getMainLoopModel()
}
