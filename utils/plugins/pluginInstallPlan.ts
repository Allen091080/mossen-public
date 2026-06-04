import { randomBytes } from 'crypto'
import { dirname, normalize, sep } from 'path'
import {
  type InstallableScope,
} from '../../services/plugins/pluginOperations.js'
import {
  formatDependencyCountSuffix,
  getEnabledPluginIdsForScope,
  resolveDependencyClosure,
} from './dependencyResolver.js'
import {
  formatResolutionError,
  installResolvedPlugin,
} from './pluginInstallationHelpers.js'
import { getMarketplaceCacheOnly, getPluginById } from './marketplaceManager.js'
import { parsePluginIdentifier, scopeToSettingSource } from './pluginIdentifier.js'
import { isPluginBlockedByPolicy } from './pluginPolicy.js'
import {
  PluginMarketplaceEntrySchema,
  type PluginMarketplaceEntry,
  type PluginSource,
} from './schemas.js'

export const PLUGIN_INSTALL_PLAN_TOKEN_TTL_MS = 10 * 60 * 1000

export type PluginInstallPlan = {
  token: string
  createdAt: number
  pluginId: string
  pluginName: string
  marketplaceName: string
  scope: InstallableScope
  entry: PluginMarketplaceEntry
  marketplaceInstallLocation?: string
  dependencyClosure: string[]
  depNote: string
  sourceDescription?: string
}

export type PluginInstallPlanError =
  | {
      type: 'missing_plugin'
    }
  | {
      type: 'plugin_not_found'
      plugin: string
    }
  | {
      type: 'marketplace_required'
      plugin: string
    }
  | {
      type: 'invalid_github_target'
      reason: string
    }
  | {
      type: 'invalid_scope'
      scope?: string
    }
  | {
      type: 'blocked_by_policy'
      pluginId: string
    }
  | {
      type: 'resolution_failed'
      message: string
    }
  | {
      type: 'unknown_token'
      token: string
    }
  | {
      type: 'expired_token'
      token: string
    }
  | {
      type: 'install_failed'
      message: string
    }

export type PluginInstallPlanResult =
  | {
      ok: true
      plan: PluginInstallPlan
    }
  | {
      ok: false
      error: PluginInstallPlanError
    }

const planStore = new Map<string, PluginInstallPlan>()
const GITHUB_DIRECT_MARKETPLACE = 'github-direct'

type GitHubPluginTarget = {
  owner: string
  repo: string
  ref?: string
  path: string
  original: string
}

type GitHubContentsItem = {
  type: string
  name: string
  path: string
  download_url?: string | null
}

function pruneExpiredPlans(now = Date.now()): void {
  for (const [token, plan] of planStore.entries()) {
    if (now - plan.createdAt > PLUGIN_INSTALL_PLAN_TOKEN_TTL_MS) {
      planStore.delete(token)
    }
  }
}

function createToken(): string {
  let token = randomBytes(4).toString('hex')
  while (planStore.has(token)) {
    token = randomBytes(4).toString('hex')
  }
  return token
}

function normalizeScope(scope?: string): InstallableScope | null {
  if (!scope) return 'user'
  if (scope === 'user' || scope === 'project' || scope === 'local') {
    return scope
  }
  return null
}

export async function getPluginInstallPlan(opts: {
  plugin?: string
  scope?: string
}): Promise<PluginInstallPlanResult> {
  pruneExpiredPlans()
  const requestedPlugin = opts.plugin?.trim()
  if (!requestedPlugin) {
    return { ok: false, error: { type: 'missing_plugin' } }
  }

  const scope = normalizeScope(opts.scope)
  if (!scope) {
    return { ok: false, error: { type: 'invalid_scope', scope: opts.scope } }
  }

  const githubTarget = parseGitHubPluginTarget(requestedPlugin)
  if (githubTarget) {
    return getGitHubDirectPluginInstallPlan(githubTarget, scope)
  }

  const parsed = parsePluginIdentifier(requestedPlugin)
  if (!parsed.marketplace) {
    return {
      ok: false,
      error: { type: 'marketplace_required', plugin: requestedPlugin },
    }
  }

  const info = await getPluginById(requestedPlugin)
  if (!info) {
    return { ok: false, error: { type: 'plugin_not_found', plugin: requestedPlugin } }
  }

  const pluginId = `${info.entry.name}@${parsed.marketplace}`
  if (isPluginBlockedByPolicy(pluginId)) {
    return { ok: false, error: { type: 'blocked_by_policy', pluginId } }
  }

  const allowedCrossMarketplaces = new Set(
    (await getMarketplaceCacheOnly(parsed.marketplace))
      ?.allowCrossMarketplaceDependenciesOn ?? [],
  )
  const depInfo = new Map<
    string,
    { entry: PluginMarketplaceEntry; marketplaceInstallLocation: string }
  >([[pluginId, info]])
  const resolution = await resolveDependencyClosure(
    pluginId,
    async id => {
      if (depInfo.has(id)) return depInfo.get(id)!.entry
      const found = await getPluginById(id)
      if (found) depInfo.set(id, found)
      return found?.entry ?? null
    },
    getEnabledPluginIdsForScope(scopeToSettingSource(scope)),
    allowedCrossMarketplaces,
  )
  if (resolution.ok === false) {
    return {
      ok: false,
      error: {
        type: 'resolution_failed',
        message: formatResolutionError(resolution),
      },
    }
  }

  for (const id of resolution.closure) {
    if (isPluginBlockedByPolicy(id)) {
      return { ok: false, error: { type: 'blocked_by_policy', pluginId: id } }
    }
  }

  const token = createToken()
  const plan: PluginInstallPlan = {
    token,
    createdAt: Date.now(),
    pluginId,
    pluginName: info.entry.name,
    marketplaceName: parsed.marketplace,
    scope,
    entry: info.entry,
    marketplaceInstallLocation: info.marketplaceInstallLocation,
    dependencyClosure: resolution.closure,
    depNote: formatDependencyCountSuffix(
      resolution.closure.filter(id => id !== pluginId),
    ),
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

async function getGitHubDirectPluginInstallPlan(
  parsedTarget: GitHubPluginTarget,
  scope: InstallableScope,
): Promise<PluginInstallPlanResult> {
  const target = await resolveDefaultRef(parsedTarget)
  const manifestResult = await loadGitHubPluginManifest(target)
  if (manifestResult.ok === false) {
    return {
      ok: false,
      error: { type: 'invalid_github_target', reason: manifestResult.reason },
    }
  }

  const source = buildGitHubPluginSource(target)
  const entryResult = PluginMarketplaceEntrySchema().safeParse({
    ...manifestResult.manifest,
    source,
  })
  if (!entryResult.success) {
    return {
      ok: false,
      error: {
        type: 'invalid_github_target',
        reason: entryResult.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
      },
    }
  }

  const entry = entryResult.data
  const pluginId = `${entry.name}@${GITHUB_DIRECT_MARKETPLACE}`
  if (isPluginBlockedByPolicy(pluginId)) {
    return { ok: false, error: { type: 'blocked_by_policy', pluginId } }
  }

  const resolution = await resolveDependencyClosure(
    pluginId,
    async id => {
      if (id === pluginId) return entry
      return (await getPluginById(id))?.entry ?? null
    },
    getEnabledPluginIdsForScope(scopeToSettingSource(scope)),
    new Set(),
  )
  if (resolution.ok === false) {
    return {
      ok: false,
      error: {
        type: 'resolution_failed',
        message: formatResolutionError(resolution),
      },
    }
  }

  for (const id of resolution.closure) {
    if (isPluginBlockedByPolicy(id)) {
      return { ok: false, error: { type: 'blocked_by_policy', pluginId: id } }
    }
  }

  const token = createToken()
  const plan: PluginInstallPlan = {
    token,
    createdAt: Date.now(),
    pluginId,
    pluginName: entry.name,
    marketplaceName: GITHUB_DIRECT_MARKETPLACE,
    scope,
    entry,
    dependencyClosure: resolution.closure,
    depNote: formatDependencyCountSuffix(
      resolution.closure.filter(id => id !== pluginId),
    ),
    sourceDescription: `${target.owner}/${target.repo}@${target.ref}${target.path ? `/${target.path}` : ''}`,
  }
  planStore.set(token, plan)
  return { ok: true, plan }
}

export async function executePluginInstallPlan(
  token: string,
): Promise<PluginInstallPlanResult> {
  pruneExpiredPlans()
  const plan = planStore.get(token)
  if (!plan) {
    return { ok: false, error: { type: 'unknown_token', token } }
  }

  planStore.delete(token)
  if (Date.now() - plan.createdAt > PLUGIN_INSTALL_PLAN_TOKEN_TTL_MS) {
    return { ok: false, error: { type: 'expired_token', token } }
  }

  const result = await installResolvedPlugin({
    pluginId: plan.pluginId,
    entry: plan.entry,
    scope: plan.scope,
    marketplaceInstallLocation: plan.marketplaceInstallLocation,
  })
  if (result.ok === false) {
    return {
      ok: false,
      error: {
        type: 'install_failed',
        message:
          result.reason === 'resolution-failed'
            ? formatResolutionError(result.resolution)
            : result.reason,
      },
    }
  }

  return {
    ok: true,
    plan: {
      ...plan,
      dependencyClosure: result.closure,
      depNote: result.depNote,
    },
  }
}

export function _resetPluginInstallPlanStoreForTesting(): void {
  planStore.clear()
}

function parseGitHubPluginTarget(input: string): GitHubPluginTarget | null {
  const trimmed = input.trim()
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) {
    return {
      owner: shorthand[1]!,
      repo: stripGitSuffix(shorthand[2]!),
      path: '',
      original: trimmed,
    }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const owner = parts[0]
  const repo = parts[1] ? stripGitSuffix(parts[1]) : undefined
  if (!owner || !repo) return null
  if (!parts[2]) return { owner, repo, path: '', original: trimmed }
  if (parts[2] !== 'tree' && parts[2] !== 'blob') return null

  const ref = parts[3]
  const rawPath = parts.slice(4).join('/')
  if (!ref) return null
  return {
    owner,
    repo,
    ref,
    path: pluginRootFromGitHubPath(rawPath),
    original: trimmed,
  }
}

function pluginRootFromGitHubPath(path: string): string {
  const normalized = normalizeGithubPath(path)
  if (normalized.endsWith('/.mossen-plugin/plugin.json')) {
    return normalizeGithubPath(dirname(dirname(normalized)))
  }
  if (normalized === '.mossen-plugin/plugin.json') return ''
  if (normalized.endsWith('/plugin.json')) {
    return normalizeGithubPath(dirname(normalized))
  }
  if (normalized === 'plugin.json') return ''
  return normalized
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}

async function resolveDefaultRef(
  target: GitHubPluginTarget,
): Promise<GitHubPluginTarget> {
  if (target.ref) return target
  const response = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repo}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mossen-plugin-installer',
      },
    },
  )
  if (!response.ok) return { ...target, ref: 'main' }
  const json = (await response.json()) as { default_branch?: string }
  return { ...target, ref: json.default_branch || 'main' }
}

async function loadGitHubPluginManifest(
  target: GitHubPluginTarget,
): Promise<
  | { ok: true; manifest: Record<string, unknown> }
  | { ok: false; reason: string }
> {
  const candidates = [
    joinGithubPath(target.path, '.mossen-plugin/plugin.json'),
    joinGithubPath(target.path, 'plugin.json'),
  ]
  for (const path of candidates) {
    const item = await getGitHubContents(target, path)
    if (!item || Array.isArray(item) || item.type !== 'file' || !item.download_url) {
      continue
    }
    const response = await fetch(item.download_url, {
      headers: { 'User-Agent': 'mossen-plugin-installer' },
    })
    if (!response.ok) {
      return {
        ok: false,
        reason: `Failed to fetch ${path} (${response.status})`,
      }
    }
    try {
      return { ok: true, manifest: JSON.parse(await response.text()) }
    } catch (error) {
      return {
        ok: false,
        reason: `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  return {
    ok: false,
    reason:
      'No plugin manifest found. Expected .mossen-plugin/plugin.json or plugin.json at the GitHub target.',
  }
}

async function getGitHubContents(
  target: GitHubPluginTarget,
  path: string,
): Promise<GitHubContentsItem | GitHubContentsItem[] | null> {
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const url = new URL(
    `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodedPath}`,
  )
  url.searchParams.set('ref', target.ref ?? 'main')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mossen-plugin-installer',
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub contents request failed (${response.status})`)
  }
  return (await response.json()) as GitHubContentsItem | GitHubContentsItem[]
}

function buildGitHubPluginSource(target: GitHubPluginTarget): PluginSource {
  const url = `https://github.com/${target.owner}/${target.repo}.git`
  if (target.path) {
    return {
      source: 'git-subdir',
      url,
      path: target.path,
      ref: target.ref,
    }
  }
  return {
    source: 'url',
    url,
    ref: target.ref,
  }
}

function normalizeGithubPath(path: string): string {
  if (!path.trim()) return ''
  const normalized = normalize(path).split(sep).join('/').replace(/^\.\//, '')
  return normalized === '.' ? '' : normalized
}

function joinGithubPath(root: string, child: string): string {
  return normalizeGithubPath([root, child].filter(Boolean).join('/'))
}
