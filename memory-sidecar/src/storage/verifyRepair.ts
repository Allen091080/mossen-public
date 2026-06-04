import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import type { CorruptArchiveLine } from './jsonlArchiveStore'
import {
  getArchiveSessionReadPath,
  readArchiveEventsTolerant,
} from './jsonlArchiveStore'
import { getArchiveStoreManifest, listArchiveSessionFiles, type ArchiveStoreManifestStats } from './manifest'

export type ArchiveStoreFileVerification = {
  sessionId: string
  jsonlPath: string
  eventCount: number
  badLineCount: number
  corruptLines: CorruptArchiveLine[]
}

export type ArchiveStoreVerificationReport = {
  ok: boolean
  projectId: string
  sessionsDir: string
  stats: ArchiveStoreManifestStats
  files: ArchiveStoreFileVerification[]
}

export type RepairArchiveStoreOptions = MemoryRootOptions & {
  dryRun?: boolean
}

export const ARCHIVE_REPAIR_TOKEN_TTL_MS = 10 * 60 * 1000

export type ArchiveStoreRepairAction = {
  type: 'quarantine-corrupt-line'
  dryRun: boolean
  jsonlPath: string
  corruptPath: string
  lineNumber: number
  byteOffset: number
  byteLength: number
  reason: string
}

export type ArchiveStoreRepairReport = ArchiveStoreVerificationReport & {
  dryRun: boolean
  actions: ArchiveStoreRepairAction[]
}

export type ArchiveStoreRepairPlan = ArchiveStoreRepairReport & {
  token: string
  expiresAt: string
}

export type ExecuteRepairArchiveStorePlanOptions = MemoryRootOptions & {
  token: string
}

const repairPlans = new Map<string, {
  createdAtMs: number
  options: MemoryRootOptions
  plan: ArchiveStoreRepairPlan
}>()

export async function verifyArchiveStore(
  options: MemoryRootOptions,
): Promise<ArchiveStoreVerificationReport> {
  const memoryDir = getProjectMemoryDir(options)
  const sessionsDir = `${memoryDir}/archive/sessions`
  const sessionFiles = await listArchiveSessionFiles(sessionsDir)

  const files = await Promise.all(
    sessionFiles.map(async file => {
      const sessionId = basename(file, '.jsonl')
      const result = await readArchiveEventsTolerant({ ...options, sessionId })
      const readPath = await getArchiveSessionReadPath({ ...options, sessionId })
      return {
        sessionId,
        jsonlPath: readPath.kind === 'missing'
          ? `${sessionsDir}/${file}`
          : readPath.path,
        eventCount: result.events.length,
        badLineCount: result.corruptLines.length,
        corruptLines: result.corruptLines,
      }
    }),
  )

  const manifest = await getArchiveStoreManifest(options)
  return {
    ok: files.every(file => file.badLineCount === 0),
    projectId: options.projectId,
    sessionsDir,
    stats: manifest.stats,
    files,
  }
}

export async function repairArchiveStore(
  options: RepairArchiveStoreOptions,
): Promise<ArchiveStoreRepairReport> {
  const dryRun = options.dryRun ?? true
  if (!dryRun) {
    throw new Error('repairArchiveStore currently supports dry-run reporting only')
  }

  const report = await verifyArchiveStore(options)
  const corruptDir = `${getProjectMemoryDir(options)}/archive/corrupt`
  const actions = report.files.flatMap(file =>
    file.corruptLines.map(line => ({
      type: 'quarantine-corrupt-line' as const,
      dryRun,
      jsonlPath: file.jsonlPath,
      corruptPath: `${corruptDir}/${file.sessionId}.line-${line.lineNumber}.jsonl.corrupt`,
      lineNumber: line.lineNumber,
      byteOffset: line.byteOffset,
      byteLength: line.byteLength,
      reason: line.reason,
    })),
  )

  return {
    ...report,
    dryRun,
    actions,
  }
}

export async function createRepairArchiveStorePlan(
  options: MemoryRootOptions,
): Promise<ArchiveStoreRepairPlan> {
  const report = await repairArchiveStore({ ...options, dryRun: true })
  const token = randomBytes(4).toString('hex')
  const createdAtMs = Date.now()
  const plan: ArchiveStoreRepairPlan = {
    ...report,
    token,
    expiresAt: new Date(createdAtMs + ARCHIVE_REPAIR_TOKEN_TTL_MS).toISOString(),
  }
  repairPlans.set(token, {
    createdAtMs,
    options,
    plan,
  })
  await writeRepairPlanFile(options, token, createdAtMs, plan)
  return plan
}

export async function executeRepairArchiveStorePlan(
  options: ExecuteRepairArchiveStorePlanOptions,
): Promise<ArchiveStoreRepairReport & { token: string; executed: number }> {
  const stored = repairPlans.get(options.token) ?? await readRepairPlanFile(options, options.token)
  if (!stored) {
    throw new Error('unknown repair token')
  }
  repairPlans.delete(options.token)
  await removeRepairPlanFile(options, options.token)
  if (Date.now() - stored.createdAtMs > ARCHIVE_REPAIR_TOKEN_TTL_MS) {
    throw new Error('expired repair token')
  }
  if (stored.options.projectId !== options.projectId) {
    throw new Error('repair token project mismatch')
  }

  const report = await verifyArchiveStore(options)
  const corruptByPath = new Map<string, Set<number>>()
  for (const file of report.files) {
    corruptByPath.set(
      file.jsonlPath,
      new Set(file.corruptLines.map(line => line.lineNumber)),
    )
  }
  if ([...corruptByPath.keys()].some(path => path.endsWith('.gz'))) {
    throw new Error(
      'archive repair does not rewrite compressed shadow files; restore source JSONL or regenerate the shadow copy',
    )
  }

  let executed = 0
  for (const file of report.files) {
    const corruptLines = corruptByPath.get(file.jsonlPath)
    if (!corruptLines?.size) continue
    const contents = await readFile(file.jsonlPath, 'utf8')
    const records = splitJsonlRecords(contents)
    const kept: string[] = []
    const corrupt: string[] = []
    records.forEach((record, index) => {
      if (corruptLines.has(index + 1)) {
        corrupt.push(record)
      } else {
        kept.push(record)
      }
    })

    const corruptPath = `${getProjectMemoryDir(options)}/archive/corrupt/${file.sessionId}.repair-${Date.now()}.jsonl.corrupt`
    await mkdir(`${getProjectMemoryDir(options)}/archive/corrupt`, { recursive: true })
    await writeFile(corruptPath, corrupt.join(''), 'utf8')
    const tmpPath = `${file.jsonlPath}.repairing`
    await writeFile(tmpPath, kept.join(''), 'utf8')
    await rename(tmpPath, file.jsonlPath)
    executed += corrupt.length
  }

  const after = await repairArchiveStore({ ...options, dryRun: true })
  return {
    ...after,
    token: options.token,
    executed,
  }
}

export function _resetArchiveRepairPlanStoreForTesting(): void {
  repairPlans.clear()
}

function splitJsonlRecords(contents: string): string[] {
  if (!contents) return []

  const records: string[] = []
  let start = 0
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === '\n') {
      records.push(contents.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < contents.length) {
    records.push(contents.slice(start))
  }
  return records
}

function getRepairPlanPath(options: MemoryRootOptions, token: string): string {
  return `${getProjectMemoryDir(options)}/archive/repair-plans/${token}.json`
}

async function writeRepairPlanFile(
  options: MemoryRootOptions,
  token: string,
  createdAtMs: number,
  plan: ArchiveStoreRepairPlan,
): Promise<void> {
  const dir = `${getProjectMemoryDir(options)}/archive/repair-plans`
  await mkdir(dir, { recursive: true })
  await writeFile(
    getRepairPlanPath(options, token),
    `${JSON.stringify({ createdAtMs, options, plan }, null, 2)}\n`,
    'utf8',
  )
}

async function readRepairPlanFile(
  options: MemoryRootOptions,
  token: string,
): Promise<{
  createdAtMs: number
  options: MemoryRootOptions
  plan: ArchiveStoreRepairPlan
} | undefined> {
  const raw = await readFile(getRepairPlanPath(options, token), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as {
    createdAtMs?: unknown
    options?: unknown
    plan?: unknown
  }
  if (
    typeof parsed.createdAtMs !== 'number' ||
    !parsed.options ||
    typeof parsed.options !== 'object' ||
    !parsed.plan ||
    typeof parsed.plan !== 'object'
  ) {
    return undefined
  }
  return parsed as {
    createdAtMs: number
    options: MemoryRootOptions
    plan: ArchiveStoreRepairPlan
  }
}

async function removeRepairPlanFile(options: MemoryRootOptions, token: string): Promise<void> {
  await rm(getRepairPlanPath(options, token), { force: true })
}
