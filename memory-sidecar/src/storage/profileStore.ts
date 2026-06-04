import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import type { ProfileSnapshot } from '../schema/profile'
import { isProfileSnapshot } from '../schema/profile'
import type { MemoryScope } from '../schema/scope'
import { appendJsonlLine } from './jsonlAppend'

export type AppendProfileSnapshotOptions = MemoryRootOptions & {
  profile: ProfileSnapshot
}

export type AppendProfileSnapshotsOptions = MemoryRootOptions & {
  profiles: ProfileSnapshot[]
}

export type ProfileSnapshotWithLocation = {
  profile: ProfileSnapshot
  jsonlPath: string
  byteOffset: number
  byteLength: number
}

export type ListProfileSnapshotsOptions = MemoryRootOptions & {
  scope?: MemoryScope
  projectId?: string
  sourceJobId?: string
  limit?: number
}

export type RecentProfileSnapshotsOptions = MemoryRootOptions & {
  scope?: MemoryScope
  projectId?: string
  sourceJobId?: string
  limit?: number
}

export function getProfileSnapshotsPath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/profiles.jsonl`
}

export async function appendProfileSnapshot(
  options: AppendProfileSnapshotOptions,
): Promise<ProfileSnapshotWithLocation> {
  const [result] = await appendProfileSnapshots({
    ...options,
    profiles: [options.profile],
  })

  return result
}

export async function appendProfileSnapshots(
  options: AppendProfileSnapshotsOptions,
): Promise<ProfileSnapshotWithLocation[]> {
  const jsonlPath = getProfileSnapshotsPath(options)
  await mkdir(getProjectMemoryDir(options), { recursive: true })

  const results: ProfileSnapshotWithLocation[] = []

  for (const profile of options.profiles) {
    assertProfileSnapshotForProject(profile, options.projectId)
    const { byteOffset, byteLength } = await appendJsonlLine(jsonlPath, profile)
    results.push({ profile, jsonlPath, byteOffset, byteLength })
  }

  return results
}

export async function listProfileSnapshots(
  options: ListProfileSnapshotsOptions,
): Promise<ProfileSnapshotWithLocation[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (limit <= 0) return []

  const profiles = await readProfileSnapshotsFromPath(getProfileSnapshotsPath(options))
  return profiles
    .filter(({ profile }) => matchesProfileFilter(profile, options))
    .slice(0, limit)
}

export async function recentProfileSnapshots(
  options: RecentProfileSnapshotsOptions,
): Promise<ProfileSnapshotWithLocation[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  const profiles = await readProfileSnapshotsFromPath(getProfileSnapshotsPath(options))
  return profiles
    .filter(({ profile }) => matchesProfileFilter(profile, options))
    .sort((a, b) => b.profile.generatedAt.localeCompare(a.profile.generatedAt))
    .slice(0, limit)
}

async function readProfileSnapshotsFromPath(
  jsonlPath: string,
): Promise<ProfileSnapshotWithLocation[]> {
  const contents = await readFile(jsonlPath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  const profiles: ProfileSnapshotWithLocation[] = []
  let byteOffset = 0
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trimEnd()
    const byteLength = Buffer.byteLength(`${rawLine}\n`)
    if (line.trim()) {
      const parsed = JSON.parse(line) as unknown
      if (!isProfileSnapshot(parsed)) {
        throw new Error(`invalid profile snapshot record at byte offset ${byteOffset}`)
      }
      profiles.push({
        profile: parsed,
        jsonlPath,
        byteOffset,
        byteLength,
      })
    }
    byteOffset += byteLength
  }

  return profiles
}

function assertProfileSnapshotForProject(
  profile: ProfileSnapshot,
  projectId: string,
): void {
  if (!isProfileSnapshot(profile)) {
    throw new Error('profile must match ProfileSnapshot schema')
  }

  if (profile.projectId !== projectId) {
    throw new Error('profile.projectId must match append projectId')
  }
}

function matchesProfileFilter(
  profile: ProfileSnapshot,
  options: ListProfileSnapshotsOptions,
): boolean {
  return (
    (!options.scope || profile.scope === options.scope) &&
    (!options.projectId || profile.projectId === options.projectId) &&
    (!options.sourceJobId || profile.sourceJobId === options.sourceJobId)
  )
}
