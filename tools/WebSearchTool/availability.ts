import { getMainLoopModel } from '../../utils/model/model.js'
import {
  getAPIProvider,
  type APIProvider,
} from '../../utils/model/providers.js'

export function isWebSearchAvailableFor(
  provider: APIProvider,
  model: string,
): boolean {
  if (provider === 'firstParty') {
    return true
  }

  if (provider === 'vertex') {
    return (
      model.includes('mossen-opus-4') ||
      model.includes('mossen-sonnet-4') ||
      model.includes('mossen-haiku-4')
    )
  }

  // Foundry only ships models that already support Web Search.
  if (provider === 'foundry') {
    return true
  }

  return false
}

export function isWebSearchAvailable(): boolean {
  return isWebSearchAvailableFor(getAPIProvider(), getMainLoopModel())
}
