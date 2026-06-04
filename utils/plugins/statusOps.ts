import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { logForDebugging } from '../debug.js'
import { getMossenConfigHomeDir } from '../envUtils.js'
import { summarizePluginCache, type PluginCacheSummary } from './cacheUtils.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'
import { getMarketplacesCacheDir } from './marketplaceManager.js'
import { loadPluginMcpServers } from './mcpPluginIntegration.js'
import { loadPluginLspServers } from './lspPluginIntegration.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import { redactErrorMessage } from '../../memory-sidecar/src/redaction/redactPaths.js'
import type { McpServerConfig } from '../../services/mcp/types.js'
import type { LspServerConfig } from '../../services/lsp/types.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import {
  getSettingSourceName,
  SETTING_SOURCES,
} from '../settings/constants.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'

// ---------------------------------------------------------------------------
// W56 read-only /plugin status summary. Pure metadata: no .orphaned_at write,
// no cache modification, no installed registry mutation. Wraps the W55 R1
// orphan classifier (summarizePluginCache) and adds installed-registry plus
// marketplace metadata.
// ---------------------------------------------------------------------------

export type PluginStatusSummary = {
  /** ~/.mossen/plugins/ root. */
  pluginRootPath: string
  /** Whether ~/.mossen/plugins/ exists on disk. */
  pluginRootExists: boolean
  /** Cache summary from cacheUtils.summarizePluginCache (W55 R1 helper). */
  cache: PluginCacheSummary
  /** ~/.mossen/plugins/marketplaces/. */
  marketplacesDir: string
  /** Whether marketplaces dir exists. */
  marketplacesDirExists: boolean
  /** Number of plugin records loaded from installed_plugins.json. */
  installedRecordCount: number
  /** Sum across all plugins of installed-version count. */
  installedVersionCount: number
  /** True iff loading installed_plugins.json succeeded. */
  installedRegistryLoadable: boolean
  /** Path to installed_plugins.json (best-effort; resolved by manager). */
  installedRegistryPath: string
  /** True iff there is at least one cached version that is not in registry. */
  pruneEligible: boolean
  /** Suggested next command for the user. */
  suggestedCommand: string
  /**
   * W146.4 P1-2: plugin load errors surfaced to the operator.
   *
   * Pre-W146.4 these errors were collected by `loadAllPluginsCacheOnly()`
   * and silently dropped — `pluginsRuntime.ts` only counted them. Now
   * `/plugin status` exposes the count plus up to 3 short, sanitized
   * one-liner summaries so an operator can see *why* a plugin command
   * is missing instead of guessing. Long stacks, absolute HOME paths,
   * and token-shaped substrings are stripped before they reach the UI.
   * `count === summaries.length + remaining` only when count > 3.
   */
  loadErrors: {
    /** Total number of plugin load errors recorded by the cache-only loader. */
    count: number
    /** Sanitized one-liner summaries; capped at 3. May be empty when count=0. */
    summaries: string[]
  }
  /**
   * W154-B: plugins explicitly disabled in `settings.enabledPlugins`
   * (entries set to literal `false`). Distinct from absent installs —
   * a disabled plugin's installation record stays put but its commands
   * won't load. `/plugin status` surfaces this so an operator chasing
   * a missing command can immediately see whether the plugin was
   * disabled vs. genuinely failed to load.
   *
   * `disabledPluginIds` is capped at 10; `disabledPluginCount` is the
   * authoritative total (sliced shape mirrors `loadErrors`).
   */
  disabledPluginCount: number
  disabledPluginIds: string[]
  shadowedEnabledPluginSettings: string[]
  ignoredFolderWarnings: string[]
  componentInventory: PluginComponentInventory
}

export type PluginComponentInventory = {
  pluginCount: number
  commandCount: number
  skillCount: number
  hookEventNames: string[]
  mcpServerNames: string[]
  mcpServerSummaries: string[]
  lspServerNames: string[]
  lspServerSummaries: string[]
  settingsKeys: string[]
  projectedSessionTokens: number
  pluginSummaries: string[]
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isDirectory()
  } catch {
    return false
  }
}

// W154-B: route both path scrubbing and token redaction through the
// shared W148-A helper (memory-sidecar/src/redaction/redactPaths). Pre-W154-B
// statusOps owned a local `shortenPathForDisplay` + `stripTokenLike` pair
// that drifted from the doctor / governance redactors (e.g. /opt/, Windows
// drive paths, /var/folders/, /tmp/ were missed). Centralizing here means a
// future provider/library leak gets fixed in one place and downstream
// surfaces (lsp doctor, governance plan, plugin status) all benefit.
function shortenPathForDisplay(raw: string): string {
  if (!raw) return ''
  return redactErrorMessage(raw)
}

function stripTokenLike(value: string): string {
  return redactErrorMessage(value)
}

const ERROR_SUMMARY_MAX_LEN = 220

function trimSummary(value: string): string {
  if (value.length <= ERROR_SUMMARY_MAX_LEN) return value
  return value.slice(0, ERROR_SUMMARY_MAX_LEN - 1) + '…'
}

function basenameWithoutMarkdown(path: string): string {
  const name = basename(path)
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile()
  } catch {
    return false
  }
}

async function listNamesFromDir(
  dir: string | undefined,
  mode: 'markdown-files' | 'directories',
): Promise<string[]> {
  if (!dir) return []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(entry =>
        mode === 'directories'
          ? entry.isDirectory()
          : entry.isFile() && entry.name.endsWith('.md'),
      )
      .map(entry => basenameWithoutMarkdown(entry.name))
      .sort()
  } catch {
    return []
  }
}

function addUnique(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    if (value) target.add(value)
  }
}

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : []
}

function safeMcpUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return stripTokenLike(url.split('?')[0] ?? url)
  }
}

export function summarizePluginMcpServerConfig(
  name: string,
  config: McpServerConfig,
): string {
  const type = config.type ?? 'stdio'
  if (type === 'stdio' || config.type === undefined) {
    const stdio = config as Extract<McpServerConfig, { type?: 'stdio' }>
    const envKeys = Object.keys(stdio.env ?? {}).sort()
    return `${name} (stdio command=${stripTokenLike(stdio.command)} env=${envKeys.length ? envKeys.join(',') : 'none'})`
  }
  if (type === 'http' || type === 'sse' || type === 'ws') {
    const remote = config as Extract<McpServerConfig, { type: 'http' | 'sse' | 'ws' }>
    const headerKeys = Object.keys(remote.headers ?? {}).sort()
    return `${name} (${type} url=${safeMcpUrlForDisplay(remote.url)} headers=${headerKeys.length ? headerKeys.join(',') : 'none'})`
  }
  if (type === 'hosted-proxy') {
    const hosted = config as Extract<McpServerConfig, { type: 'hosted-proxy' }>
    return `${name} (hosted-proxy id=${stripTokenLike(hosted.id)})`
  }
  if (type === 'sdk') {
    const sdk = config as Extract<McpServerConfig, { type: 'sdk' }>
    return `${name} (sdk name=${stripTokenLike(sdk.name)})`
  }
  return `${name} (${type})`
}

export function summarizePluginLspServerConfig(
  name: string,
  config: LspServerConfig,
): string {
  const extensions = Object.keys(config.extensionToLanguage ?? {}).sort()
  const transport = config.transport ?? 'stdio'
  return `${name} (${transport} command=${stripTokenLike(config.command)} extensions=${extensions.length ? extensions.join(',') : 'none'})`
}

async function listPluginSkillNames(plugin: LoadedPlugin): Promise<string[]> {
  const skillNames = [...(plugin.skillsPaths ?? []).map(path => basename(path))]
  if (plugin.skillsPath) {
    const directSkillPath = join(plugin.skillsPath, 'SKILL.md')
    if (await fileExists(directSkillPath)) {
      skillNames.push(plugin.skillsPath === plugin.path ? plugin.name : basename(plugin.skillsPath))
    } else {
      skillNames.push(...(await listNamesFromDir(plugin.skillsPath, 'directories')))
    }
  }
  return [...new Set(skillNames)].sort()
}

function estimatePluginSessionTokens({
  plugin,
  commandNames,
  skillNames,
  hookEventNames,
  mcpServerNames,
  lspServerNames,
  settingsKeys,
}: {
  plugin: LoadedPlugin
  commandNames: string[]
  skillNames: string[]
  hookEventNames: string[]
  mcpServerNames: string[]
  lspServerNames: string[]
  settingsKeys: string[]
}): number {
  const projection = {
    name: plugin.name,
    description: plugin.manifest.description,
    commands: commandNames,
    skills: skillNames,
    hooks: hookEventNames,
    mcpServers: mcpServerNames,
    lspServers: lspServerNames,
    settings: settingsKeys,
    commandMetadata: plugin.commandsMetadata ?? plugin.manifest.commands ?? {},
  }
  return Math.max(1, roughTokenCountEstimation(JSON.stringify(projection), 3))
}

export async function summarizeLoadedPlugin(plugin: LoadedPlugin): Promise<{
  commandNames: string[]
  skillNames: string[]
  hookEventNames: string[]
  mcpServerNames: string[]
  mcpServerSummaries: string[]
  lspServerNames: string[]
  lspServerSummaries: string[]
  settingsKeys: string[]
  installer?: { displayName?: string; homepage?: string; supportContact?: string }
  projectedSessionTokens: number
  summary: string
}> {
  const commandNames = [
    ...keysOf(plugin.commandsMetadata),
    ...(plugin.commandsPaths ?? []).map(basenameWithoutMarkdown),
    ...(await listNamesFromDir(plugin.commandsPath, 'markdown-files')),
  ].sort()
  const skillNames = await listPluginSkillNames(plugin)
  const hookEventNames = keysOf(plugin.hooksConfig)
  const mcpServers = plugin.mcpServers || (await loadPluginMcpServers(plugin))
  const mcpServerNames = keysOf(mcpServers)
  const mcpServerSummaries = Object.entries(mcpServers ?? {})
    .map(([name, config]) => summarizePluginMcpServerConfig(name, config))
    .sort()
  const lspServers = plugin.lspServers || (await loadPluginLspServers(plugin))
  const lspServerNames = keysOf(lspServers)
  const lspServerSummaries = Object.entries(lspServers ?? {})
    .map(([name, config]) => summarizePluginLspServerConfig(name, config))
    .sort()
  const settingsKeys = [
    ...keysOf(plugin.manifest.settings),
    ...keysOf(plugin.manifest.userConfig),
  ].sort()

  const parts: string[] = []
  if (commandNames.length) parts.push(`commands=${commandNames.slice(0, 5).join(',')}`)
  if (skillNames.length) parts.push(`skills=${skillNames.slice(0, 5).join(',')}`)
  if (hookEventNames.length) parts.push(`hooks=${hookEventNames.join(',')}`)
  if (mcpServerNames.length) parts.push(`mcp=${mcpServerNames.join(',')}`)
  if (lspServerNames.length) parts.push(`lsp=${lspServerNames.join(',')}`)
  if (settingsKeys.length) parts.push(`settings=${settingsKeys.join(',')}`)
  const projectedSessionTokens = estimatePluginSessionTokens({
    plugin,
    commandNames,
    skillNames,
    hookEventNames,
    mcpServerNames,
    lspServerNames,
    settingsKeys,
  })

  return {
    commandNames,
    skillNames,
    hookEventNames,
    mcpServerNames,
    mcpServerSummaries,
    lspServerNames,
    lspServerSummaries,
    settingsKeys,
    installer: plugin.manifest.installer,
    projectedSessionTokens,
    summary: `${plugin.name}: ${parts.length ? parts.join('; ') : 'no declared components'}; ~${projectedSessionTokens} tokens/session`,
  }
}

async function buildPluginComponentInventory(
  plugins: LoadedPlugin[],
): Promise<PluginComponentInventory> {
  const commandNames = new Set<string>()
  const skillNames = new Set<string>()
  const hookEventNames = new Set<string>()
  const mcpServerNames = new Set<string>()
  const mcpServerSummaries = new Set<string>()
  const lspServerNames = new Set<string>()
  const lspServerSummaries = new Set<string>()
  const settingsKeys = new Set<string>()
  const pluginSummaries: string[] = []
  let projectedSessionTokens = 0

  for (const plugin of plugins) {
    const summary = await summarizeLoadedPlugin(plugin)
    addUnique(commandNames, summary.commandNames)
    addUnique(skillNames, summary.skillNames)
    addUnique(hookEventNames, summary.hookEventNames)
    addUnique(mcpServerNames, summary.mcpServerNames)
    addUnique(mcpServerSummaries, summary.mcpServerSummaries)
    addUnique(lspServerNames, summary.lspServerNames)
    addUnique(lspServerSummaries, summary.lspServerSummaries)
    addUnique(settingsKeys, summary.settingsKeys)
    projectedSessionTokens += summary.projectedSessionTokens
    if (pluginSummaries.length < 5) pluginSummaries.push(summary.summary)
  }

  return {
    pluginCount: plugins.length,
    commandCount: commandNames.size,
    skillCount: skillNames.size,
    hookEventNames: [...hookEventNames].sort().slice(0, 12),
    mcpServerNames: [...mcpServerNames].sort().slice(0, 12),
    mcpServerSummaries: [...mcpServerSummaries].sort().slice(0, 8),
    lspServerNames: [...lspServerNames].sort().slice(0, 12),
    lspServerSummaries: [...lspServerSummaries].sort().slice(0, 8),
    settingsKeys: [...settingsKeys].sort().slice(0, 12),
    projectedSessionTokens,
    pluginSummaries,
  }
}

function buildIgnoredFolderWarnings(cache: PluginCacheSummary): string[] {
  if (cache.zipCacheMode) return []
  const ignoredCount =
    cache.expiredOrphanCount +
    cache.unmarkedOrphanCount +
    cache.freshOrphanCount
  if (ignoredCount === 0) return []
  return [
    `ignored plugin cache folders: ${ignoredCount} (${cache.expiredOrphanCount} expired, ${cache.unmarkedOrphanCount} unmarked, ${cache.freshOrphanCount} fresh); run /plugin prune for a dry-run cleanup plan`,
  ]
}

function formatPluginSettingValue(value: unknown): string {
  if (value === true) return 'enabled'
  if (value === false) return 'disabled'
  return 'unset'
}

function getShadowedEnabledPluginSettings(): string[] {
  const seen = new Map<string, { source: string; value: unknown }>()
  const shadowed: string[] = []
  for (const source of SETTING_SOURCES) {
    const settings = getSettingsForSource(source)
    for (const [pluginId, value] of Object.entries(
      settings?.enabledPlugins ?? {},
    )) {
      if (!pluginId.includes('@')) continue
      const sourceName = getSettingSourceName(source)
      const previous = seen.get(pluginId)
      if (previous && previous.value !== value) {
        shadowed.push(
          `${pluginId}: ${previous.source}=${formatPluginSettingValue(
            previous.value,
          )} shadowed by ${sourceName}=${formatPluginSettingValue(value)}`,
        )
      }
      seen.set(pluginId, { source: sourceName, value })
    }
  }
  return shadowed.slice(0, 10)
}

// W146.4 P1-2: convert a structured PluginError to a short, redacted
// one-liner. The discriminated-union shape carries a `type` plus error-
// specific fields (path, manifest path, marketplace, validation errors,
// etc.). We hand-pick *small* fields, sanitize them, and never include
// raw stack traces or auth-shaped strings.
// W154-B: per-error suggested fix hints. Operators chasing a missing
// /<plugin-cmd> or a marketplace that won't load now get a single short
// next-step instead of having to grep through docs. Hints are
// deliberately *generic* and never reference specific plugin names so
// the same string is safe to surface across projects. Unknown types fall
// through with no fix hint (better than a misleading suggestion).
function suggestedFixForError(type: PluginError['type']): string {
  switch (type) {
    case 'path-not-found':
      return 'reinstall via /plugin install or check the marketplace cache'
    case 'git-auth-failed':
      return 'verify git credentials or re-run with a fresh token'
    case 'git-timeout':
    case 'network-error':
      return 'retry once network is reachable'
    case 'manifest-parse-error':
    case 'manifest-validation-error':
    case 'mcpb-invalid-manifest':
      return 'inspect the manifest with --debug; report upstream if vendored'
    case 'plugin-not-found':
    case 'marketplace-not-found':
      return 'run /plugin marketplace add (or refresh) before /plugin install'
    case 'marketplace-load-failed':
      return 'check marketplace cache; rerun /plugin marketplace refresh'
    case 'marketplace-blocked-by-policy':
      return 'review allowlist policy in settings or contact the policy owner'
    case 'mcp-config-invalid':
    case 'lsp-config-invalid':
      return 'fix the offending entry in plugin.json or .mossen/settings.json'
    case 'mcp-server-suppressed-duplicate':
      return 'remove the duplicate server entry or rename one'
    case 'hook-load-failed':
    case 'component-load-failed':
      return 'check plugin source for a runtime error; rerun with --debug'
    case 'mcpb-download-failed':
    case 'mcpb-extract-failed':
      return 'clear the mcpb cache and re-run /plugin install'
    case 'lsp-server-start-failed':
    case 'lsp-server-crashed':
      return 'check LSP server binary install; rerun /lsp doctor'
    case 'lsp-request-timeout':
    case 'lsp-request-failed':
      return 'rerun /lsp restart <server>; check workspace size'
    case 'dependency-unsatisfied':
      return 'run /plugin install to satisfy the missing dependency'
    case 'plugin-cache-miss':
      return 'rerun /plugin install to repopulate cache'
    case 'generic-error':
      return 'rerun with --debug for full details'
    default:
      return ''
  }
}

function summarizePluginError(error: PluginError): string {
  const type = error.type
  const source = stripTokenLike(error.source ?? '')
  // `plugin` is not present on every variant; access defensively.
  const plugin =
    'plugin' in error && typeof error.plugin === 'string'
      ? stripTokenLike(error.plugin)
      : undefined
  const id = plugin ? `${plugin}@${source}` : source

  let detail = ''
  switch (type) {
    case 'path-not-found':
      detail = `path missing: ${shortenPathForDisplay(error.path)}`
      break
    case 'git-auth-failed':
      detail = `git ${error.authType} auth failed`
      break
    case 'git-timeout':
      detail = `git ${error.operation} timed out`
      break
    case 'network-error':
      detail = 'network error'
      break
    case 'manifest-parse-error':
      detail = `manifest parse error at ${shortenPathForDisplay(
        error.manifestPath,
      )}`
      break
    case 'manifest-validation-error':
      detail = `manifest invalid (${error.validationErrors.length} issue${
        error.validationErrors.length === 1 ? '' : 's'
      })`
      break
    case 'plugin-not-found':
      detail = 'plugin not found in marketplace'
      break
    case 'marketplace-not-found':
      detail = `marketplace ${error.marketplace} missing`
      break
    case 'marketplace-load-failed':
      detail = `marketplace ${error.marketplace} load failed`
      break
    case 'mcp-config-invalid':
      detail = `mcp ${error.serverName} invalid`
      break
    case 'mcp-server-suppressed-duplicate':
      detail = `mcp ${error.serverName} suppressed (duplicate)`
      break
    case 'lsp-config-invalid':
      detail = `lsp ${error.serverName} invalid`
      break
    case 'hook-load-failed':
      detail = 'hook load failed'
      break
    case 'component-load-failed':
      detail = `${error.component} component load failed`
      break
    case 'mcpb-download-failed':
      detail = 'mcpb download failed'
      break
    case 'mcpb-extract-failed':
      detail = 'mcpb extract failed'
      break
    case 'mcpb-invalid-manifest':
      detail = 'mcpb manifest invalid'
      break
    case 'lsp-server-start-failed':
      detail = 'lsp server start failed'
      break
    default:
      detail = String(type)
      break
  }
  const fix = suggestedFixForError(type)
  const head = `[${type}] ${id}: ${detail}`
  const withFix = fix ? `${head} — fix: ${fix}` : head
  return trimSummary(stripTokenLike(withFix))
}

/**
 * Read-only summary for /plugin status. Never modifies disk state.
 *
 * Reuses summarizePluginCache (W55 R1 helper) for orphan classification —
 * this avoids drift between the prune surface and the status surface.
 */
export async function describePluginStatus(): Promise<PluginStatusSummary> {
  const configHome = getMossenConfigHomeDir()
  const pluginRootPath = join(configHome, 'plugins')
  const pluginRootExists = await dirExists(pluginRootPath)

  const cache = await summarizePluginCache()
  const marketplacesDir = getMarketplacesCacheDir()
  const marketplacesDirExists = await dirExists(marketplacesDir)

  let installedRecordCount = 0
  let installedVersionCount = 0
  let installedRegistryLoadable = true
  let installedRegistryPath = join(pluginRootPath, 'installed_plugins.json')
  try {
    const data = loadInstalledPluginsFromDisk()
    installedRecordCount = Object.keys(data.plugins).length
    for (const installations of Object.values(data.plugins)) {
      installedVersionCount += installations.length
    }
  } catch (error) {
    logForDebugging(`statusOps: failed to load installed_plugins: ${String(error)}`)
    installedRegistryLoadable = false
  }

  const pruneEligible =
    !cache.zipCacheMode &&
    (cache.expiredOrphanCount > 0 || cache.unmarkedOrphanCount > 0)
  const suggestedCommand = cache.zipCacheMode
    ? '(zip-cache mode active — /plugin prune does not apply)'
    : pruneEligible
      ? '/plugin prune'
      : '(no orphans — /plugin prune would no-op)'

  // W146.4 P1-2: surface plugin load errors. Run the cache-only loader
  // (zero network, no disk mutation) and emit at most 3 sanitized summaries.
  // Loader failure itself is non-fatal — fall through with zero errors so
  // the rest of /plugin status still renders.
  let loadErrors: PluginStatusSummary['loadErrors'] = { count: 0, summaries: [] }
  let componentInventory: PluginComponentInventory = {
    pluginCount: 0,
    commandCount: 0,
    skillCount: 0,
    hookEventNames: [],
    mcpServerNames: [],
    mcpServerSummaries: [],
    lspServerNames: [],
    lspServerSummaries: [],
    settingsKeys: [],
    projectedSessionTokens: 0,
    pluginSummaries: [],
  }
  try {
    const result = await loadAllPluginsCacheOnly()
    componentInventory = await buildPluginComponentInventory([
      ...result.enabled,
      ...result.disabled,
    ])
    if (result.errors.length > 0) {
      loadErrors = {
        count: result.errors.length,
        summaries: result.errors.slice(0, 3).map(summarizePluginError),
      }
    }
  } catch (error) {
    logForDebugging(`statusOps: plugin load probe failed: ${String(error)}`)
  }

  // W154-B: surface explicitly-disabled plugins. enabledPlugins[id] === false
  // means the operator turned the plugin off; that's distinct from an
  // uninstall (record gone) or a load failure (loadErrors above). Settings
  // read failure is non-fatal — fall through with zero disabled.
  let disabledPluginCount = 0
  let disabledPluginIds: string[] = []
  let shadowedEnabledPluginSettings: string[] = []
  try {
    const settings = getSettings_DEPRECATED()
    const enabled = settings.enabledPlugins ?? {}
    const disabled: string[] = []
    for (const [id, value] of Object.entries(enabled)) {
      if (value === false) disabled.push(id)
    }
    disabledPluginCount = disabled.length
    disabledPluginIds = disabled.slice(0, 10)
    shadowedEnabledPluginSettings = getShadowedEnabledPluginSettings()
  } catch (error) {
    logForDebugging(`statusOps: enabledPlugins read failed: ${String(error)}`)
  }

  return {
    pluginRootPath,
    pluginRootExists,
    cache,
    marketplacesDir,
    marketplacesDirExists,
    installedRecordCount,
    installedVersionCount,
    installedRegistryLoadable,
    installedRegistryPath,
    pruneEligible,
    suggestedCommand,
    loadErrors,
    disabledPluginCount,
    disabledPluginIds,
    shadowedEnabledPluginSettings,
    ignoredFolderWarnings: buildIgnoredFolderWarnings(cache),
    componentInventory,
  }
}
