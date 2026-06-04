/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'

export type UnifiedInstalledItem =
  | {
      type: 'plugin'
      id: string
      name: string
      description?: string
      marketplace: string
      scope: string
      isEnabled: boolean
      errorCount: number
      errors: PluginError[]
      plugin: LoadedPlugin
      pendingEnable?: boolean
      pendingUpdate?: boolean
      pendingToggle?: 'will-enable' | 'will-disable'
    }
  | {
      type: 'failed-plugin'
      id: string
      name: string
      marketplace: string
      scope: string
      errorCount: number
      errors: PluginError[]
    }
  | {
      type: 'mcp'
      id: string
      name: string
      description?: string
      scope: string
      status: string
      client: MCPServerConnection
      parentPluginId?: string
      indented?: boolean
      [key: string]: any
    }
  | {
      type: 'flagged-plugin'
      id: string
      name: string
      marketplace: string
      scope: 'flagged'
      reason: string
      text: string
      flaggedAt: string
      [key: string]: any
    }
  | {
      type: 'scope-header'
      id: string
      name: string
      scope: string
      count: number
      [key: string]: any
    }
