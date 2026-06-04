import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage, toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getPluginLspServers } from '../../utils/plugins/lspPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import type { ScopedLspServerConfig } from './types.js'
import {
  loadProjectLspConfig,
  loadUserLspConfig,
} from './userProjectConfig.js'

export type LspConfigLoadStats = {
  pluginCount: number
  userCount: number
  projectCount: number
  /** Server names where a higher-precedence source overrode a lower one. */
  overriddenByUser: string[]
  overriddenByProject: string[]
  errors: string[]
}

/**
 * Get all configured LSP servers from plugin + user + project sources.
 *
 * Precedence (later wins): plugin → user → project. Project scope is the most
 * specific, so it overrides user; user overrides plugin. This mirrors the
 * settings.json scope order used elsewhere in Mossen.
 *
 * @returns Object containing servers configuration keyed by server name and
 *          per-source counts / override list for /lsp doctor visibility.
 */
export async function getAllLspServers(): Promise<{
  servers: Record<string, ScopedLspServerConfig>
  stats: LspConfigLoadStats
}> {
  const allServers: Record<string, ScopedLspServerConfig> = {}
  const errors: string[] = []
  const overriddenByUser: string[] = []
  const overriddenByProject: string[] = []

  // 1. Plugin-provided servers (lowest precedence).
  let pluginCount = 0
  try {
    const { enabled: plugins } = await loadAllPluginsCacheOnly()

    const results = await Promise.all(
      plugins.map(async (plugin: LoadedPlugin) => {
        const pluginErrors: PluginError[] = []
        try {
          const scopedServers = await getPluginLspServers(plugin, pluginErrors)
          return { plugin, scopedServers, errors: pluginErrors }
        } catch (e) {
          logForDebugging(
            `Failed to load LSP servers for plugin ${plugin.name}: ${e}`,
            { level: 'error' },
          )
          return { plugin, scopedServers: undefined, errors: pluginErrors }
        }
      }),
    )

    for (const { plugin, scopedServers, errors: pluginErrors } of results) {
      const serverCount = scopedServers ? Object.keys(scopedServers).length : 0
      if (serverCount > 0) {
        Object.assign(allServers, scopedServers)
        pluginCount += serverCount
        logForDebugging(
          `Loaded ${serverCount} LSP server(s) from plugin: ${plugin.name}`,
        )
      }
      if (pluginErrors.length > 0) {
        logForDebugging(
          `${pluginErrors.length} error(s) loading LSP servers from plugin: ${plugin.name}`,
        )
      }
    }
  } catch (error) {
    logError(toError(error))
    errors.push(`plugin: ${errorMessage(error)}`)
    logForDebugging(`Error loading plugin LSP servers: ${errorMessage(error)}`)
  }

  // 2. User-scope servers — overlay onto plugins.
  let userCount = 0
  try {
    const userResult = await loadUserLspConfig()
    if (userResult.error !== null) {
      errors.push(`user: ${userResult.error}`)
    }
    if (userResult.loaded) {
      for (const [name, cfg] of Object.entries(userResult.servers)) {
        if (Object.prototype.hasOwnProperty.call(allServers, name)) {
          overriddenByUser.push(name)
        }
        allServers[name] = cfg
        userCount++
      }
    }
  } catch (error) {
    errors.push(`user: ${errorMessage(error)}`)
  }

  // 3. Project-scope servers — overlay onto plugin+user (highest precedence).
  let projectCount = 0
  try {
    const projectResult = await loadProjectLspConfig()
    if (projectResult.error !== null) {
      errors.push(`project: ${projectResult.error}`)
    }
    if (projectResult.loaded) {
      for (const [name, cfg] of Object.entries(projectResult.servers)) {
        if (Object.prototype.hasOwnProperty.call(allServers, name)) {
          overriddenByProject.push(name)
        }
        allServers[name] = cfg
        projectCount++
      }
    }
  } catch (error) {
    errors.push(`project: ${errorMessage(error)}`)
  }

  logForDebugging(
    `Total LSP servers loaded: ${Object.keys(allServers).length} (plugin=${pluginCount}, user=${userCount}, project=${projectCount})`,
  )

  return {
    servers: allServers,
    stats: {
      pluginCount,
      userCount,
      projectCount,
      overriddenByUser,
      overriddenByProject,
      errors,
    },
  }
}
