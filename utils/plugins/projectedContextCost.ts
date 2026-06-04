import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import type { PluginMarketplaceEntry } from './schemas.js'

function namesFromValue(value: unknown): string[] {
  if (!value) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'object') return Object.keys(value).sort()
  return []
}

/**
 * Estimate the session-context footprint a marketplace plugin is likely to add
 * after installation. This is intentionally a rough projection: marketplace
 * entries can be sparse, and remote plugin.json may add more detail at install
 * time. The estimate is still useful before install because it makes hidden
 * command/skill/MCP context cost visible to the operator.
 */
export function estimateMarketplacePluginProjectedSessionTokens(
  entry: PluginMarketplaceEntry,
): number {
  const projection = {
    name: entry.name,
    description: entry.description,
    commands: namesFromValue(entry.commands),
    agents: namesFromValue(entry.agents),
    skills: namesFromValue(entry.skills),
    hooks: namesFromValue(entry.hooks),
    mcpServers: namesFromValue(entry.mcpServers),
    lspServers: namesFromValue(entry.lspServers),
    settings: [
      ...namesFromValue(entry.settings),
      ...namesFromValue(entry.userConfig),
    ].sort(),
    dependencies: namesFromValue(entry.dependencies),
  }
  return Math.max(1, roughTokenCountEstimation(JSON.stringify(projection), 3))
}
