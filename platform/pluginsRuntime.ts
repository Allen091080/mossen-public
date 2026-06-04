import { loadAllPluginsCacheOnly } from '../utils/plugins/pluginLoader.js'
import type { PluginsRuntimeSnapshot } from './runtimeTypes.js'

export async function getPluginsRuntimeSnapshot(): Promise<PluginsRuntimeSnapshot> {
  const result = await loadAllPluginsCacheOnly()

  return {
    enabled: result.enabled.length,
    disabled: result.disabled.length,
    errors: result.errors.length,
  }
}
