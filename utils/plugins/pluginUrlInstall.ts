import { createHash } from 'crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { errorMessage } from '../errors.js'
import { getSettingsForSource, updateSettingsForSource } from '../settings/settings.js'
import { jsonParse } from '../slowOperations.js'
import { parseZipModes, unzipFile, isPathSafe } from '../dxt/zip.js'
import { clearAllCaches } from './cacheUtils.js'
import { loadInstalledPluginsV2 } from './installedPluginsManager.js'
import { buildPluginId, scopeToSettingSource } from './pluginIdentifier.js'
import {
  PluginManifestSchema,
  type PluginManifest,
  type PluginMarketplaceEntry,
} from './schemas.js'
import {
  formatResolutionError,
  installResolvedPlugin,
  isFailedInstallCoreResult,
} from './pluginInstallationHelpers.js'
import { validatePluginManifest, type ValidationWarning } from './validatePlugin.js'
import { getSessionPluginCachePath } from './zipCache.js'

export const PLUGIN_URL_INSTALL_MARKETPLACE = 'url-install'
const PLUGIN_URL_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024
const PLUGIN_MANIFEST_RELATIVE_PATH = '.mossen-plugin/plugin.json'

type InstallableScope = 'user' | 'project' | 'local'
export type PluginLoadErrorCode =
  | 'MANIFEST_NOT_FOUND'
  | 'JSON_PARSE_ERROR'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'URL_FETCH_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'UNSUPPORTED_PATH'
  | 'ZIP_EXTRACT_FAILED'
  | 'PATH_TRAVERSAL_DETECTED'

export class PluginLoadError extends Error {
  constructor(
    public readonly code: PluginLoadErrorCode,
    message: string,
    public readonly detail?: { path?: string; field?: string; hint?: string },
  ) {
    super(message)
    this.name = 'PluginLoadError'
  }
}

type FetchResponseLike = {
  ok: boolean
  status: number
  statusText?: string
  headers?: {
    get(name: string): string | null
  }
  arrayBuffer(): Promise<ArrayBuffer>
}

export type PluginUrlFetch = (url: string) => Promise<FetchResponseLike>

export type PluginUrlInstallResult = {
  pluginId: string
  pluginName: string
  version: string
  scope: InstallableScope
  hookAutoEnableSuppressed: boolean
  warnings: string[]
}

export type PluginUrlSessionStageResult = {
  pluginRoot: string
  pluginName: string
  version: string
  warnings: string[]
}

export function assertHttpsPluginZipUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new PluginLoadError('UNSUPPORTED_PATH', `Invalid plugin URL: ${rawUrl}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new PluginLoadError(
      'UNSUPPORTED_PATH',
      'Plugin URL installs require an HTTPS URL',
    )
  }

  return parsed.toString()
}

function getExpectedSha256(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const params = new URLSearchParams(fragment)
  const expected = params.get('sha256')
  if (!expected) return null
  return /^[a-fA-F0-9]{64}$/.test(expected) ? expected.toLowerCase() : null
}

function verifyPluginZipSha256(zipData: Buffer, rawUrl: string): void {
  const expected = getExpectedSha256(rawUrl)
  if (!expected) return
  const actual = createHash('sha256').update(zipData).digest('hex')
  if (actual !== expected) {
    throw new PluginLoadError(
      'CHECKSUM_MISMATCH',
      `Plugin URL checksum mismatch: expected sha256=${expected}, got ${actual}`,
    )
  }
}

function warningMessages(warnings: ValidationWarning[]): string[] {
  return warnings.map(warning => `${warning.path}: ${warning.message}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function downloadPluginZip(
  url: string,
  fetchImpl?: PluginUrlFetch,
): Promise<Buffer> {
  const fetcher = fetchImpl ?? (globalThis.fetch as unknown as PluginUrlFetch)
  if (typeof fetcher !== 'function') {
    throw new PluginLoadError(
      'URL_FETCH_FAILED',
      'This runtime does not provide fetch for plugin URL installs',
    )
  }

  const response = await fetcher(url)
  if (!response.ok) {
    throw new PluginLoadError(
      'URL_FETCH_FAILED',
      `Plugin URL download failed: HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ''
      }`,
    )
  }

  const contentLength = response.headers?.get('content-length')
  if (contentLength) {
    const parsedLength = Number(contentLength)
    if (
      Number.isFinite(parsedLength) &&
      parsedLength > PLUGIN_URL_ARCHIVE_MAX_BYTES
    ) {
      throw new PluginLoadError(
        'ZIP_EXTRACT_FAILED',
        `Plugin URL archive is too large: ${Math.round(
          parsedLength / 1024 / 1024,
        )}MB`,
      )
    }
  }

  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > PLUGIN_URL_ARCHIVE_MAX_BYTES) {
    throw new PluginLoadError(
      'ZIP_EXTRACT_FAILED',
      `Plugin URL archive is too large: ${Math.round(
        body.length / 1024 / 1024,
      )}MB`,
    )
  }
  return body
}

function findPluginRootRelativePath(entries: string[]): string {
  const manifestEntries = entries.filter(entry =>
    entry.endsWith(PLUGIN_MANIFEST_RELATIVE_PATH),
  )
  if (manifestEntries.length === 0) {
    throw new PluginLoadError(
      'MANIFEST_NOT_FOUND',
      'Plugin URL archive does not contain .mossen-plugin/plugin.json',
    )
  }
  const roots = new Set(
    manifestEntries.map(entry =>
      entry.slice(0, -PLUGIN_MANIFEST_RELATIVE_PATH.length).replace(/\/$/, ''),
    ),
  )
  if (roots.size > 1) {
    throw new PluginLoadError(
      'SCHEMA_VALIDATION_FAILED',
      'Plugin URL archive contains multiple plugin manifests',
    )
  }
  return roots.values().next().value ?? ''
}

async function readValidatedManifest(
  pluginRoot: string,
): Promise<{ manifest: PluginManifest; warnings: string[] }> {
  const manifestPath = join(pluginRoot, PLUGIN_MANIFEST_RELATIVE_PATH)
  const validation = await validatePluginManifest(manifestPath)
  if (!validation.success) {
    throw new PluginLoadError(
      'SCHEMA_VALIDATION_FAILED',
      `Plugin URL manifest validation failed: ${validation.errors
        .map(error => `${error.path}: ${error.message}`)
        .join('; ')}`,
    )
  }

  const raw = jsonParse(await readFile(manifestPath, { encoding: 'utf-8' }))
  const parsed = PluginManifestSchema().safeParse(raw)
  if (!parsed.success) {
    throw new PluginLoadError(
      'SCHEMA_VALIDATION_FAILED',
      `Plugin URL manifest failed runtime schema validation`,
    )
  }
  if (!parsed.data.name) {
    throw new PluginLoadError(
      'SCHEMA_VALIDATION_FAILED',
      'Plugin URL manifest must declare a non-empty name',
    )
  }
  if (!parsed.data.version) {
    throw new PluginLoadError(
      'SCHEMA_VALIDATION_FAILED',
      'Plugin URL manifest must declare a version',
    )
  }

  return {
    manifest: parsed.data,
    warnings: warningMessages(validation.warnings),
  }
}

async function archiveDeclaresHooks(
  pluginRoot: string,
  manifest: PluginManifest,
): Promise<boolean> {
  if (manifest.hooks) {
    return true
  }
  return pathExists(join(pluginRoot, 'hooks', 'hooks.json'))
}

export async function extractPluginUrlArchiveToStaging(
  zipData: Buffer,
  stagingDir: string,
): Promise<{
  pluginRoot: string
  manifest: PluginManifest
  warnings: string[]
  declaresHooks: boolean
}> {
  const files = await unzipFile(zipData)
  const modes = parseZipModes(zipData)
  const entries = Object.keys(files)

  for (const relPath of entries) {
    if (!isPathSafe(relPath)) {
      throw new PluginLoadError(
        'PATH_TRAVERSAL_DETECTED',
        `Unsafe plugin URL archive path: ${relPath}`,
        { path: relPath },
      )
    }
    if (relPath.endsWith('/')) {
      await mkdir(join(stagingDir, relPath), { recursive: true })
      continue
    }
    const fullPath = join(stagingDir, relPath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, files[relPath]!)
    const mode = modes[relPath]
    if (mode && mode & 0o111) {
      await chmod(fullPath, mode & 0o777).catch(() => {})
    }
  }

  const rootRelPath = findPluginRootRelativePath(entries)
  const pluginRoot = rootRelPath ? join(stagingDir, rootRelPath) : stagingDir
  const { manifest, warnings } = await readValidatedManifest(pluginRoot)
  return {
    pluginRoot,
    manifest,
    warnings,
    declaresHooks: await archiveDeclaresHooks(pluginRoot, manifest),
  }
}

function assertNoExistingUrlInstall(pluginId: string): void {
  const installed = loadInstalledPluginsV2()
  if ((installed.plugins[pluginId]?.length ?? 0) > 0) {
    throw new Error(
      `Plugin "${pluginId}" is already installed from URL. Uninstall it before installing a replacement.`,
    )
  }

  for (const scope of ['user', 'project', 'local'] as const) {
    const settingSource = scopeToSettingSource(scope)
    const value = getSettingsForSource(settingSource)?.enabledPlugins?.[pluginId]
    if (value !== undefined) {
      throw new Error(
        `Plugin "${pluginId}" already has ${scope} settings. Uninstall or remove that entry before installing a replacement.`,
      )
    }
  }
}

export async function installPluginFromUrlOp({
  url,
  scope = 'user',
  fetchImpl,
}: {
  url: string
  scope?: InstallableScope
  fetchImpl?: PluginUrlFetch
}): Promise<PluginUrlInstallResult> {
  const safeUrl = assertHttpsPluginZipUrl(url)
  const stagingDir = await mkdtemp(join(tmpdir(), 'mossen-plugin-url-'))

  try {
    const zipData = await downloadPluginZip(safeUrl, fetchImpl)
    verifyPluginZipSha256(zipData, safeUrl)
    const { pluginRoot, manifest, warnings, declaresHooks } =
      await extractPluginUrlArchiveToStaging(zipData, stagingDir)
    const pluginId = buildPluginId(
      manifest.name,
      PLUGIN_URL_INSTALL_MARKETPLACE,
    )

    assertNoExistingUrlInstall(pluginId)

    const entry: PluginMarketplaceEntry = {
      ...manifest,
      name: manifest.name,
      version: manifest.version,
      source: './',
      strict: true,
    }

    const result = await installResolvedPlugin({
      pluginId,
      entry,
      scope,
      marketplaceInstallLocation: pluginRoot,
    })

    if (isFailedInstallCoreResult(result)) {
      switch (result.reason) {
        case 'local-source-no-location':
          throw new Error(
            `Cannot install URL plugin "${result.pluginName}" without staging location`,
          )
        case 'settings-write-failed':
          throw new Error(`Failed to update settings: ${result.message}`)
        case 'resolution-failed':
          throw new Error(formatResolutionError(result.resolution))
        case 'blocked-by-policy':
          throw new Error(
            `Plugin "${result.pluginName}" is blocked by policy and cannot be installed`,
          )
        case 'dependency-blocked-by-policy':
          throw new Error(
            `Cannot install "${result.pluginName}": dependency "${result.blockedDependency}" is blocked by policy`,
          )
      }
    }

    let hookAutoEnableSuppressed = false
    if (declaresHooks) {
      const settingSource = scopeToSettingSource(scope)
      const current = getSettingsForSource(settingSource)?.enabledPlugins ?? {}
      const { error } = updateSettingsForSource(settingSource, {
        enabledPlugins: {
          ...current,
          [pluginId]: false,
        },
      })
      if (error) {
        throw new Error(`Failed to disable URL plugin hooks by default: ${error.message}`)
      }
      hookAutoEnableSuppressed = true
      clearAllCaches()
    }

    return {
      pluginId,
      pluginName: manifest.name,
      version: manifest.version,
      scope,
      hookAutoEnableSuppressed,
      warnings,
    }
  } catch (error) {
    if (error instanceof PluginLoadError) {
      throw error
    }
    throw new Error(`Plugin URL install failed: ${errorMessage(error)}`)
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function stagePluginUrlForSession({
  url,
  fetchImpl,
}: {
  url: string
  fetchImpl?: PluginUrlFetch
}): Promise<PluginUrlSessionStageResult> {
  const safeUrl = assertHttpsPluginZipUrl(url)
  const sessionCacheDir = await getSessionPluginCachePath()
  const stagingDir = await mkdtemp(join(sessionCacheDir, 'url-'))
  try {
    const zipData = await downloadPluginZip(safeUrl, fetchImpl)
    verifyPluginZipSha256(zipData, safeUrl)
    const { pluginRoot, manifest, warnings } =
      await extractPluginUrlArchiveToStaging(zipData, stagingDir)
    return {
      pluginRoot,
      pluginName: manifest.name,
      version: manifest.version,
      warnings,
    }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
