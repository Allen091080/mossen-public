import { createHash } from 'node:crypto'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getAdapterDeadLetterPath } from '../adapter/deadLetterStore.js'
import { getMemoryAgentJobQueuePath } from '../agent/jobQueue.js'
import type { MemoryRootOptions } from '../index.js'
import type { MaintenancePaths } from '../storage/maintenance.js'

export type MemoryRetentionTarget = {
  id: 'dead-letter' | 'jobs'
  path: string
  exists: boolean
  bytes: number
  records: number
  safeToDelete: true
}

export type MemoryRetentionBlockedTarget = {
  id: 'archive-source-prune' | 'derived-memory-rewrite'
  safeToDelete: false
  reason: string
}

export type MemoryRetentionDryRun = {
  dryRun: true
  token: string
  generatedAt: string
  root: string
  projectId: string
  targets: MemoryRetentionTarget[]
  blocked: MemoryRetentionBlockedTarget[]
  instructions: string
}

export type MemoryRetentionConfirm = {
  dryRun: false
  token: string
  root: string
  projectId: string
  deleted: Array<Pick<MemoryRetentionTarget, 'id' | 'path' | 'bytes' | 'records'>>
  blocked: MemoryRetentionBlockedTarget[]
}

export async function createMemoryRetentionDryRun(
  paths: MaintenancePaths,
): Promise<MemoryRetentionDryRun> {
  const targets = await collectRetentionTargets(paths)
  const blocked = blockedRetentionTargets()
  const token = retentionToken(paths, targets)
  return {
    dryRun: true,
    token,
    generatedAt: new Date().toISOString(),
    root: paths.root,
    projectId: paths.projectId,
    targets,
    blocked,
    instructions: `/memory-sidecar retention --confirm ${token}`,
  }
}

export async function confirmMemoryRetention(
  paths: MaintenancePaths,
  token: string,
): Promise<MemoryRetentionConfirm> {
  if (!/^[0-9a-f]{8}$/.test(token)) {
    throw new Error('retention confirmation token must be 8 hex chars')
  }
  const dryRun = await createMemoryRetentionDryRun(paths)
  if (dryRun.token !== token) {
    throw new Error('retention confirmation token does not match the current plan')
  }

  const deleted: MemoryRetentionConfirm['deleted'] = []
  for (const target of dryRun.targets.filter(target => target.exists)) {
    assertInsideSidecarRoot(target.path, paths.root, target.id)
    await rm(target.path, { force: true, recursive: false })
    deleted.push({
      id: target.id,
      path: target.path,
      bytes: target.bytes,
      records: target.records,
    })
  }

  return {
    dryRun: false,
    token,
    root: paths.root,
    projectId: paths.projectId,
    deleted,
    blocked: dryRun.blocked,
  }
}

async function collectRetentionTargets(
  paths: MaintenancePaths,
): Promise<MemoryRetentionTarget[]> {
  const options: MemoryRootOptions = {
    rootDir: paths.root,
    projectId: paths.projectId,
  }
  const specs = [
    { id: 'dead-letter' as const, path: getAdapterDeadLetterPath(options) },
    { id: 'jobs' as const, path: getMemoryAgentJobQueuePath(options) },
  ]
  return Promise.all(specs.map(async spec => {
    assertInsideSidecarRoot(spec.path, paths.root, spec.id)
    const exists = await pathExists(spec.path)
    return {
      id: spec.id,
      path: spec.path,
      exists,
      bytes: exists ? await pathSize(spec.path) : 0,
      records: exists ? await countJsonlRecords(spec.path) : 0,
      safeToDelete: true,
    }
  }))
}

function blockedRetentionTargets(): MemoryRetentionBlockedTarget[] {
  return [
    {
      id: 'archive-source-prune',
      safeToDelete: false,
      reason: 'archive JSONL is the source of truth; source prune requires a separate restore-proof wave',
    },
    {
      id: 'derived-memory-rewrite',
      safeToDelete: false,
      reason: 'observations/profiles/proposals use governance apply, not retention cleanup',
    },
  ]
}

function retentionToken(
  paths: MaintenancePaths,
  targets: MemoryRetentionTarget[],
): string {
  const payload = {
    schemaVersion: 1,
    root: resolve(paths.root),
    projectId: paths.projectId,
    targets: targets
      .filter(target => target.exists)
      .map(target => ({
        id: target.id,
        path: resolve(target.path),
        bytes: target.bytes,
        records: target.records,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 8)
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }))
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

function assertInsideSidecarRoot(path: string, root: string, label: string): void {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error(`${label} path is outside memory sidecar home: ${path}`)
}
