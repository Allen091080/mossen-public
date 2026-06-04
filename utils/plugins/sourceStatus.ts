import {
  getDeclaredMarketplaces,
  getMarketplacesCacheDir,
  loadKnownMarketplacesConfigSafe,
} from './marketplaceManager.js'
import { getMarketplaceSourceDisplay } from './marketplaceHelpers.js'
import {
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_SOURCE,
} from './officialMarketplace.js'
import {
  getPluginSeedDirs,
  getPluginsDirectory,
} from './pluginDirectories.js'

export type PluginSourceStatusEntry = {
  name: string
  declared: boolean
  known: boolean
  sourceDisplay: string
  installLocation?: string
  autoUpdate?: boolean
  isOfficial: boolean
  sourceIsFallback?: boolean
}

export type PluginSourceStatus = {
  pluginRoot: string
  marketplaceCacheDir: string
  seedDirs: string[]
  officialMarketplace: {
    name: string
    sourceDisplay: string
    declared: boolean
    known: boolean
  }
  entries: PluginSourceStatusEntry[]
  suggestedCommands: string[]
}

export async function describePluginSources(): Promise<PluginSourceStatus> {
  const declared = getDeclaredMarketplaces()
  const known = await loadKnownMarketplacesConfigSafe()
  const names = Array.from(
    new Set([
      OFFICIAL_MARKETPLACE_NAME,
      ...Object.keys(declared),
      ...Object.keys(known),
    ]),
  ).sort()

  const entries = names.map(name => {
    const declaredEntry = declared[name]
    const knownEntry = known[name]
    const source = knownEntry?.source ?? declaredEntry?.source
    return {
      name,
      declared: Boolean(declaredEntry),
      known: Boolean(knownEntry),
      sourceDisplay: source ? getMarketplaceSourceDisplay(source) : '(unknown)',
      installLocation: knownEntry?.installLocation,
      autoUpdate: knownEntry?.autoUpdate ?? declaredEntry?.autoUpdate,
      isOfficial: name === OFFICIAL_MARKETPLACE_NAME,
      sourceIsFallback: declaredEntry?.sourceIsFallback,
    } satisfies PluginSourceStatusEntry
  })

  const official = entries.find(item => item.name === OFFICIAL_MARKETPLACE_NAME)

  return {
    pluginRoot: getPluginsDirectory(),
    marketplaceCacheDir: getMarketplacesCacheDir(),
    seedDirs: getPluginSeedDirs(),
    officialMarketplace: {
      name: OFFICIAL_MARKETPLACE_NAME,
      sourceDisplay: getMarketplaceSourceDisplay(OFFICIAL_MARKETPLACE_SOURCE),
      declared: official?.declared ?? false,
      known: official?.known ?? false,
    },
    entries,
    suggestedCommands: [
      '/plugin marketplace list',
      '/plugin install <plugin>@<marketplace>',
      `/plugin install <plugin>@${OFFICIAL_MARKETPLACE_NAME}`,
      '/plugin validate <path>',
      '/plugin status',
    ],
  }
}
