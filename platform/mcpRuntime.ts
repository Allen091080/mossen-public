import {
  getMcpConfigsByScope,
  shouldAllowManagedMcpServersOnly,
} from '../services/mcp/config.js'
import { isRestrictedToPluginOnly } from '../utils/settings/pluginOnlyPolicy.js'
import type { McpRuntimeSnapshot } from './runtimeTypes.js'

export function getMcpRuntimeSnapshot(): McpRuntimeSnapshot {
  const enterprise = getMcpConfigsByScope('enterprise')
  const user = getMcpConfigsByScope('user')
  const project = getMcpConfigsByScope('project')
  const local = getMcpConfigsByScope('local')

  return {
    enterpriseServers: Object.keys(enterprise.servers).length,
    userServers: Object.keys(user.servers).length,
    projectServers: Object.keys(project.servers).length,
    localServers: Object.keys(local.servers).length,
    totalErrors:
      enterprise.errors.length +
      user.errors.length +
      project.errors.length +
      local.errors.length,
    pluginOnly: isRestrictedToPluginOnly('mcp'),
    managedOnly: shouldAllowManagedMcpServersOnly(),
  }
}
