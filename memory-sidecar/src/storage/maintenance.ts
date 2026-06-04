import { createHash, randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { MemorySidecarConfig } from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { getAdapterDeadLetterPath } from '../adapter/deadLetterStore.js'
import { getMemoryAgentJobQueuePath } from '../agent/jobQueue.js'
import { getArchiveStoreManifest } from './manifest.js'

export type MaintenancePaths = {
  home: string
  root: string
  configPath: string
  projectId: string
  memoryDir: string
  sqlitePath: string
}

export type MaintenanceStatusReport = {
  generatedAt: string
  home: string
  root: string
  projectId: string
  memoryDir: string
  configPath: string
  sqlitePath: string
  config: {
    enabled: boolean
    capture: boolean
    adapter: boolean
    vector: boolean
    llm: boolean
    team: boolean
  }
  archive: Awaited<ReturnType<typeof getArchiveStoreManifest>>
  files: Array<{
    label: string
    path: string
    exists: boolean
    bytes: number
  }>
  cleanupCandidates: CleanupCandidate[]
}

export type ExportMemorySidecarOptions = {
  paths: MaintenancePaths
  config: MemorySidecarConfig
  outDir: string
}

export type ExportMemorySidecarResult = {
  outDir: string
  manifestPath: string
  copied: Array<{
    label: string
    source: string
    destination: string
    bytes: number
  }>
  skipped: Array<{
    label: string
    source: string
    reason: 'missing'
  }>
}

export type CleanupScope = 'dead-letter' | 'jobs' | 'all'

export type CleanupCandidate = {
  scope: Exclude<CleanupScope, 'all'>
  path: string
  exists: boolean
  bytes: number
  records: number
}

export type CleanupPlan = {
  schemaVersion: 1
  token: string
  tokenHash: string
  createdAt: string
  expiresAt: string
  root: string
  projectId: string
  scope: CleanupScope
  targets: CleanupCandidate[]
}

export type CleanupDryRunResult = {
  dryRun: true
  token: string
  expiresAt: string
  planPath: string
  root: string
  projectId: string
  scope: CleanupScope
  targets: CleanupCandidate[]
  instructions: string
}

export type CleanupConfirmResult = {
  dryRun: false
  token: string
  root: string
  projectId: string
  scope: CleanupScope
  deleted: Array<{
    scope: Exclude<CleanupScope, 'all'>
    path: string
    bytes: number
    records: number
  }>
}

const CLEANUP_TOKEN_TTL_MS = 10 * 60 * 1000

export async function createMaintenanceStatusReport(
  paths: MaintenancePaths,
  config: MemorySidecarConfig,
): Promise<MaintenanceStatusReport> {
  const options = memoryOptions(paths)
  const files = await Promise.all([
    describePath('config', paths.configPath),
    describePath('archive', join(paths.memoryDir, 'archive')),
    describePath('observations', join(paths.memoryDir, 'observations.jsonl')),
    describePath('profiles', join(paths.memoryDir, 'profiles.jsonl')),
    describePath('proposals', join(paths.memoryDir, 'proposals.jsonl')),
    describePath('sqlite', paths.sqlitePath),
    describePath('deadLetter', getAdapterDeadLetterPath(options)),
    describePath('jobs', getMemoryAgentJobQueuePath(options)),
  ])

  return {
    generatedAt: new Date().toISOString(),
    home: paths.home,
    root: paths.root,
    projectId: paths.projectId,
    memoryDir: paths.memoryDir,
    configPath: paths.configPath,
    sqlitePath: paths.sqlitePath,
    config: {
      enabled: config.enabled,
      capture: config.capture.enabled,
      adapter: config.adapter.enabled,
      vector: config.index.vector,
      llm: config.classification.llm,
      team: config.team.enabled,
    },
    archive: await getArchiveStoreManifest(options),
    files,
    cleanupCandidates: await listCleanupCandidates(paths, 'all'),
  }
}

export async function exportMemorySidecarData(
  options: ExportMemorySidecarOptions,
): Promise<ExportMemorySidecarResult> {
  const outDir = resolve(options.outDir)
  const exportRoot = join(
    outDir,
    `memory-sidecar-${safeStamp(new Date().toISOString())}-${safeSegment(options.paths.projectId)}`,
  )
  assertOutsideSidecarRoot(exportRoot, options.paths.root, 'export output')
  await mkdir(exportRoot, { recursive: true })

  const sources = [
    { label: 'archive', source: join(options.paths.memoryDir, 'archive'), destination: 'archive' },
    {
      label: 'observations',
      source: join(options.paths.memoryDir, 'observations.jsonl'),
      destination: 'observations.jsonl',
    },
    {
      label: 'profiles',
      source: join(options.paths.memoryDir, 'profiles.jsonl'),
      destination: 'profiles.jsonl',
    },
    {
      label: 'proposals',
      source: join(options.paths.memoryDir, 'proposals.jsonl'),
      destination: 'proposals.jsonl',
    },
  ]
  const copied: ExportMemorySidecarResult['copied'] = []
  const skipped: ExportMemorySidecarResult['skipped'] = []

  for (const item of sources) {
    assertInsideSidecarRoot(item.source, options.paths.root, item.label)
    const info = await stat(item.source).catch(error => {
      if (error?.code === 'ENOENT') return undefined
      throw error
    })
    if (!info) {
      skipped.push({ label: item.label, source: item.source, reason: 'missing' })
      continue
    }
    const destination = join(exportRoot, item.destination)
    await mkdir(dirname(destination), { recursive: true })
    await cp(item.source, destination, { recursive: true })
    copied.push({
      label: item.label,
      source: item.source,
      destination,
      bytes: await pathSize(destination),
    })
  }

  const configMetadataPath = join(exportRoot, 'config.metadata.json')
  await writeFile(
    configMetadataPath,
    `${JSON.stringify(configMetadata(options.config), null, 2)}\n`,
    'utf8',
  )
  copied.push({
    label: 'configMetadata',
    source: options.paths.configPath,
    destination: configMetadataPath,
    bytes: Buffer.byteLength(JSON.stringify(configMetadata(options.config), null, 2)) + 1,
  })

  const manifestPath = join(exportRoot, 'export-manifest.json')
  const result: ExportMemorySidecarResult = {
    outDir: exportRoot,
    manifestPath,
    copied,
    skipped,
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projectId: options.paths.projectId,
      root: options.paths.root,
      copied,
      skipped,
    }, null, 2)}\n`,
    'utf8',
  )

  return result
}

export async function createCleanupDryRun(
  paths: MaintenancePaths,
  scope: CleanupScope,
): Promise<CleanupDryRunResult> {
  assertInsideSidecarRoot(paths.root, paths.root, 'sidecar root')
  const targets = (await listCleanupCandidates(paths, scope)).filter(target => target.exists)
  const token = `w90-${randomBytes(18).toString('base64url')}`
  const now = Date.now()
  const plan: CleanupPlan = {
    schemaVersion: 1,
    token,
    tokenHash: tokenHash(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CLEANUP_TOKEN_TTL_MS).toISOString(),
    root: paths.root,
    projectId: paths.projectId,
    scope,
    targets,
  }
  const planPath = cleanupPlanPath(paths.root, token)
  await mkdir(dirname(planPath), { recursive: true })
  await writeFile(planPath, `${JSON.stringify({ ...plan, token: undefined }, null, 2)}\n`, 'utf8')

  return {
    dryRun: true,
    token,
    expiresAt: plan.expiresAt,
    planPath,
    root: paths.root,
    projectId: paths.projectId,
    scope,
    targets,
    instructions: `Run cleanup --confirm ${token} before ${plan.expiresAt} to delete these targets.`,
  }
}

export async function confirmCleanup(
  paths: MaintenancePaths,
  token: string,
): Promise<CleanupConfirmResult> {
  if (!token.startsWith('w90-')) {
    throw new Error('cleanup confirmation token must come from cleanup --dry-run')
  }
  const planPath = cleanupPlanPath(paths.root, token)
  const parsed = JSON.parse(await readFile(planPath, 'utf8')) as Omit<CleanupPlan, 'token'>
  const plan: CleanupPlan = { ...parsed, token }
  if (plan.schemaVersion !== 1 || plan.tokenHash !== tokenHash(token)) {
    throw new Error('cleanup confirmation token does not match plan')
  }
  if (plan.root !== paths.root || plan.projectId !== paths.projectId) {
    throw new Error('cleanup plan does not match current sidecar home/project')
  }
  if (Date.parse(plan.expiresAt) <= Date.now()) {
    throw new Error(`cleanup confirmation token expired at ${plan.expiresAt}`)
  }

  const deleted: CleanupConfirmResult['deleted'] = []
  for (const target of plan.targets) {
    assertInsideSidecarRoot(target.path, paths.root, target.scope)
    await rm(target.path, { force: true, recursive: false })
    deleted.push({
      scope: target.scope,
      path: target.path,
      bytes: target.bytes,
      records: target.records,
    })
  }
  await rm(planPath, { force: true })

  return {
    dryRun: false,
    token,
    root: paths.root,
    projectId: paths.projectId,
    scope: plan.scope,
    deleted,
  }
}

async function listCleanupCandidates(
  paths: MaintenancePaths,
  scope: CleanupScope,
): Promise<CleanupCandidate[]> {
  const options = memoryOptions(paths)
  const candidates = [
    {
      scope: 'dead-letter' as const,
      path: getAdapterDeadLetterPath(options),
    },
    {
      scope: 'jobs' as const,
      path: getMemoryAgentJobQueuePath(options),
    },
  ].filter(candidate => scope === 'all' || candidate.scope === scope)

  return Promise.all(candidates.map(async candidate => {
    assertInsideSidecarRoot(candidate.path, paths.root, candidate.scope)
    const info = await describePath(candidate.scope, candidate.path)
    return {
      scope: candidate.scope,
      path: candidate.path,
      exists: info.exists,
      bytes: info.bytes,
      records: info.exists ? await countJsonlRecords(candidate.path) : 0,
    }
  }))
}

function cleanupPlanPath(root: string, token: string): string {
  return join(root, 'maintenance', 'cleanup-plans', `${tokenHash(token)}.json`)
}

function memoryOptions(paths: MaintenancePaths): MemoryRootOptions {
  return {
    rootDir: paths.root,
    projectId: paths.projectId,
    memoryDir: getProjectMemoryDir({
      rootDir: paths.root,
      projectId: paths.projectId,
    }),
  }
}

async function describePath(label: string, path: string): Promise<{
  label: string
  path: string
  exists: boolean
  bytes: number
}> {
  const info = await stat(path).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  return {
    label,
    path,
    exists: Boolean(info),
    bytes: info ? await pathSize(path) : 0,
  }
}

async function pathSize(path: string): Promise<number> {
  const info = await stat(path).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (!info) return 0
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(entries.map(entry => pathSize(join(path, entry.name))))
  return sizes.reduce((sum, size) => sum + size, 0)
}

async function countJsonlRecords(path: string): Promise<number> {
  const contents = await readFile(path, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  return contents.split('\n').filter(line => line.trim()).length
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeStamp(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, '').slice(0, 15)
}

function safeSegment(value: string): string {
  return basename(value.replace(/[^0-9A-Za-z._-]+/g, '-')) || 'project'
}

function configMetadata(config: MemorySidecarConfig): Record<string, unknown> {
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    homeDir: config.homeDir,
    configPath: config.configPath,
    capture: config.capture,
    adapter: {
      enabled: config.adapter.enabled,
      maxPayloadBytes: config.adapter.maxPayloadBytes,
      maxTextChars: config.adapter.maxTextChars,
      rejectToolPayloads: config.adapter.rejectToolPayloads,
      deadLetter: config.adapter.deadLetter,
    },
    index: config.index,
    classification: {
      ruleBased: config.classification.ruleBased,
      llm: config.classification.llm,
      llmProvider: config.classification.llmProvider,
      llmProviderConfigured: Boolean(config.classification.llmProviderConfig),
    },
    retrieval: config.retrieval,
    agent: config.agent,
    team: config.team,
  }
}

function assertInsideSidecarRoot(path: string, root: string, label: string): void {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error(`${label} path is outside memory sidecar home: ${path}`)
}

function assertOutsideSidecarRoot(path: string, root: string, label: string): void {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`${label} must be outside memory sidecar home`)
  }
}
