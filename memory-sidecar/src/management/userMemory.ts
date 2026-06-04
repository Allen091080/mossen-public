import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { MemorySidecarConfig } from '../config/config.js'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import type { ArchiveEvent } from '../schema/archiveEvent.js'
import { isArchiveEvent } from '../schema/archiveEvent.js'
import type { Observation } from '../schema/observation.js'
import { normalizeObservation } from '../schema/observation.js'
import type { ProfileSnapshot } from '../schema/profile.js'
import { isProfileSnapshot } from '../schema/profile.js'
import type { Proposal, ProposalStatus } from '../schema/proposal.js'
import { isProposal } from '../schema/proposal.js'
import { parseArchiveJsonl, recentArchiveEvents } from '../storage/jsonlArchiveStore.js'
import {
  getObservationsPath,
  listObservations,
  readObservation,
} from '../storage/observationStore.js'
import {
  getProfileSnapshotsPath,
  listProfileSnapshots,
} from '../storage/profileStore.js'
import {
  getProposalsPath,
  listProposals,
  reviewProposal,
} from '../storage/proposalStore.js'
import { rebuildArchiveIndex, searchArchiveEvents } from '../storage/sqliteIndex.js'
import { exportMemorySidecarData } from '../storage/maintenance.js'

export type UserMemoryPaths = {
  home: string
  root: string
  configPath: string
  projectId: string
  memoryDir: string
  sqlitePath: string
}

export type MemoryManageKind = 'archive' | 'observation' | 'profile' | 'proposal'
export type MemoryManageKindOrAll = MemoryManageKind | 'all'
export type ProposalReviewAction = 'accept' | 'reject' | 'defer'

export type UserMemoryListOptions = MemoryRootOptions & {
  kind: MemoryManageKindOrAll
  limit?: number
  status?: ProposalStatus
}

export type UserMemorySearchOptions = MemoryRootOptions & {
  kind: MemoryManageKindOrAll
  query: string
  limit?: number
}

export type UserMemoryShowOptions = MemoryRootOptions & {
  kind: MemoryManageKind
  id: string
}

export type UserMemoryExportOptions = {
  paths: UserMemoryPaths
  config: MemorySidecarConfig
  outDir: string
}

export type UserMemoryDisableDryRunOptions = {
  paths: UserMemoryPaths
  config: MemorySidecarConfig
}

export type UserMemoryConfirmDisableOptions = {
  paths: UserMemoryPaths
  token: string
  writeConfig: (config: MemorySidecarConfig) => Promise<void>
}

export type UserMemoryDeleteDryRunOptions = MemoryRootOptions & {
  paths: UserMemoryPaths
  kind: MemoryManageKind
  id: string
}

export type UserMemoryConfirmDeleteOptions = MemoryRootOptions & {
  paths: UserMemoryPaths
  token: string
}

export type UserMemoryReviewDryRunOptions = MemoryRootOptions & {
  paths: UserMemoryPaths
  proposalId: string
  action: ProposalReviewAction
  reason?: string
}

export type UserMemoryConfirmReviewOptions = MemoryRootOptions & {
  paths: UserMemoryPaths
  token: string
}

export type UserMemorySummary = {
  kind: MemoryManageKind
  id: string
  title: string
  createdAt?: string
  updatedAt?: string
  status?: string
  source?: string
  location?: string
}

export type UserMemoryDryRunResult = {
  dryRun: true
  operation: 'delete' | 'disable' | 'proposal-review'
  token: string
  expiresAt: string
  planPath: string
  targets: unknown[]
  instructions: string
}

export type UserMemoryConfirmResult = {
  dryRun: false
  operation: 'delete' | 'disable' | 'proposal-review'
  token: string
  result: unknown
}

type DeleteTarget = {
  kind: MemoryManageKind
  id: string
  path: string
  records: number
  bytes: number
}

type DeletePlan = {
  schemaVersion: 1
  operation: 'delete'
  tokenHash: string
  createdAt: string
  expiresAt: string
  root: string
  projectId: string
  kind: MemoryManageKind
  id: string
  targets: DeleteTarget[]
}

type DisablePlan = {
  schemaVersion: 1
  operation: 'disable'
  tokenHash: string
  createdAt: string
  expiresAt: string
  root: string
  projectId: string
  nextConfig: MemorySidecarConfig
  targets: Array<{ label: string; path: string }>
}

type ReviewPlan = {
  schemaVersion: 1
  operation: 'proposal-review'
  tokenHash: string
  createdAt: string
  expiresAt: string
  root: string
  projectId: string
  proposalId: string
  action: ProposalReviewAction
  status: Extract<ProposalStatus, 'accepted' | 'rejected' | 'candidate'>
  reason: string
  targets: Array<{ kind: 'proposal'; id: string; status: string }>
}

type ManagementPlan = DeletePlan | DisablePlan | ReviewPlan

const PLAN_TOKEN_PREFIX = 'w95-'
const PLAN_TTL_MS = 10 * 60 * 1000

export async function listUserMemory(
  options: UserMemoryListOptions,
): Promise<UserMemorySummary[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  const sections = await Promise.all([
    options.kind === 'all' || options.kind === 'archive'
      ? listArchiveSummaries(options, limit)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'observation'
      ? listObservationSummaries(options, limit)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'profile'
      ? listProfileSummaries(options, limit)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'proposal'
      ? listProposalSummaries(options, limit)
      : Promise.resolve([]),
  ])

  return sections
    .flat()
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
    .slice(0, limit)
}

export async function searchUserMemory(
  options: UserMemorySearchOptions,
): Promise<UserMemorySummary[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  const normalizedQuery = options.query.toLowerCase()
  const sections = await Promise.all([
    options.kind === 'all' || options.kind === 'archive'
      ? searchArchiveSummaries(options, limit)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'observation'
      ? listObservationSummaries(options, Number.POSITIVE_INFINITY)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'profile'
      ? listProfileSummaries(options, Number.POSITIVE_INFINITY)
      : Promise.resolve([]),
    options.kind === 'all' || options.kind === 'proposal'
      ? listProposalSummaries(options, Number.POSITIVE_INFINITY)
      : Promise.resolve([]),
  ])

  return sections
    .flat()
    .filter(item => item.kind === 'archive' || summarySearchText(item).includes(normalizedQuery))
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
    .slice(0, limit)
}

export async function showUserMemory(options: UserMemoryShowOptions): Promise<unknown> {
  if (options.kind === 'archive') return findArchiveEvent(options)
  if (options.kind === 'observation') {
    const result = await readObservation({ ...options, observationId: options.id })
    return result?.observation ?? null
  }
  if (options.kind === 'profile') return findProfileSnapshot(options)
  if (options.kind === 'proposal') return findLatestProposal(options)
  return null
}

export async function exportUserMemory(
  options: UserMemoryExportOptions,
): ReturnType<typeof exportMemorySidecarData> {
  return exportMemorySidecarData({
    paths: options.paths,
    config: options.config,
    outDir: options.outDir,
  })
}

export async function createDisableDryRun(
  options: UserMemoryDisableDryRunOptions,
): Promise<UserMemoryDryRunResult> {
  const nextConfig: MemorySidecarConfig = {
    ...options.config,
    enabled: false,
    adapter: {
      ...options.config.adapter,
      enabled: false,
    },
    capture: {
      ...options.config.capture,
      enabled: false,
    },
  }

  const plan = basePlan(options.paths, 'disable', {
    nextConfig,
    targets: [{ label: 'config', path: options.paths.configPath }],
  }) as DisablePlan
  const { token, planPath } = await writePlan(options.paths.root, plan)

  return dryRunResult('disable', token, plan.expiresAt, planPath, plan.targets)
}

export async function confirmDisable(
  options: UserMemoryConfirmDisableOptions,
): Promise<UserMemoryConfirmResult> {
  const plan = await readPlan<DisablePlan>(options.paths, options.token, 'disable')
  await options.writeConfig(plan.nextConfig)
  await removePlan(options.paths.root, options.token)
  return {
    dryRun: false,
    operation: 'disable',
    token: options.token,
    result: {
      configPath: options.paths.configPath,
      enabled: plan.nextConfig.enabled,
      adapter: plan.nextConfig.adapter.enabled,
      capture: plan.nextConfig.capture.enabled,
    },
  }
}

export async function createDeleteDryRun(
  options: UserMemoryDeleteDryRunOptions,
): Promise<UserMemoryDryRunResult> {
  const targets = await findDeleteTargets(options)
  const plan = basePlan(options.paths, 'delete', {
    kind: options.kind,
    id: options.id,
    targets,
  }) as DeletePlan
  const { token, planPath } = await writePlan(options.paths.root, plan)

  return dryRunResult('delete', token, plan.expiresAt, planPath, targets)
}

export async function confirmDelete(
  options: UserMemoryConfirmDeleteOptions,
): Promise<UserMemoryConfirmResult> {
  const plan = await readPlan<DeletePlan>(options.paths, options.token, 'delete')
  const deleted: DeleteTarget[] = []

  for (const target of plan.targets) {
    assertInsideRoot(target.path, options.paths.root, `${target.kind} delete target`)
    const records = await rewriteJsonlWithout(target.path, value =>
      deletePredicate(target.kind, plan.id, value),
    )
    deleted.push({ ...target, records })
  }

  if (plan.kind === 'archive') {
    await rebuildArchiveIndex({
      rootDir: options.rootDir,
      projectId: options.projectId,
    })
  }
  await removePlan(options.paths.root, options.token)

  return {
    dryRun: false,
    operation: 'delete',
    token: options.token,
    result: { kind: plan.kind, id: plan.id, deleted },
  }
}

export async function createProposalReviewDryRun(
  options: UserMemoryReviewDryRunOptions,
): Promise<UserMemoryDryRunResult> {
  const proposal = await findLatestProposal({
    rootDir: options.rootDir,
    projectId: options.projectId,
    kind: 'proposal',
    id: options.proposalId,
  })
  if (!proposal) throw new Error(`proposal not found: ${options.proposalId}`)

  const status = proposalReviewStatus(options.action)
  const reason = options.reason ?? `CLI ${options.action}`
  const plan = basePlan(options.paths, 'proposal-review', {
    proposalId: options.proposalId,
    action: options.action,
    status,
    reason,
    targets: [{ kind: 'proposal', id: options.proposalId, status }],
  }) as ReviewPlan
  const { token, planPath } = await writePlan(options.paths.root, plan)

  return dryRunResult('proposal-review', token, plan.expiresAt, planPath, plan.targets)
}

export async function confirmProposalReview(
  options: UserMemoryConfirmReviewOptions,
): Promise<UserMemoryConfirmResult> {
  const plan = await readPlan<ReviewPlan>(options.paths, options.token, 'proposal-review')
  const result = await reviewProposal({
    rootDir: options.rootDir,
    projectId: options.projectId,
    proposalId: plan.proposalId,
    status: plan.status,
    decisionReason: plan.reason,
  })
  await removePlan(options.paths.root, options.token)

  return {
    dryRun: false,
    operation: 'proposal-review',
    token: options.token,
    result,
  }
}

function memoryDirOptions(options: MemoryRootOptions): MemoryRootOptions {
  return {
    rootDir: options.rootDir,
    projectId: options.projectId,
    memoryDir: options.memoryDir ?? getProjectMemoryDir(options),
  }
}

async function listArchiveSummaries(
  options: UserMemoryListOptions,
  limit: number,
): Promise<UserMemorySummary[]> {
  const entries = await recentArchiveEvents({
    ...memoryDirOptions(options),
    limit,
  })
  return entries.map(entry => archiveSummary(entry.event, entry.jsonlPath))
}

async function searchArchiveSummaries(
  options: UserMemorySearchOptions,
  limit: number,
): Promise<UserMemorySummary[]> {
  const results = await searchArchiveEvents({
    rootDir: options.rootDir,
    projectId: options.projectId,
    query: options.query,
    scopeFilter: {
      scope: 'project',
      projectId: options.projectId,
    },
  }).catch(async error => {
    if (error?.code !== 'ENOENT') throw error
    return []
  })

  return results.slice(0, limit).map(result => archiveSummary(result.event))
}

async function listObservationSummaries(
  options: UserMemoryListOptions,
  limit: number,
): Promise<UserMemorySummary[]> {
  const entries = await listObservations({
    ...memoryDirOptions(options),
    limit,
  })
  return entries.map(entry => observationSummary(entry.observation, entry.jsonlPath))
}

async function listProfileSummaries(
  options: UserMemoryListOptions,
  limit: number,
): Promise<UserMemorySummary[]> {
  const entries = await listProfileSnapshots({
    ...memoryDirOptions(options),
    limit,
  })
  return entries.map(entry => profileSummary(entry.profile, entry.jsonlPath))
}

async function listProposalSummaries(
  options: UserMemoryListOptions,
  limit: number,
): Promise<UserMemorySummary[]> {
  const entries = await listProposals({
    ...memoryDirOptions(options),
    status: options.status,
    limit,
  })
  return latestProposalRecords(entries.map(entry => entry.proposal))
    .map(proposal => proposalSummary(proposal, getProposalsPath(options)))
}

async function findArchiveEvent(options: UserMemoryShowOptions): Promise<ArchiveEvent | null> {
  for (const entry of await readAllArchiveEvents(options)) {
    if (entry.event.eventId === options.id) return entry.event
  }
  return null
}

async function findProfileSnapshot(
  options: UserMemoryShowOptions,
): Promise<ProfileSnapshot | null> {
  const entries = await listProfileSnapshots({
    ...memoryDirOptions(options),
    limit: Number.POSITIVE_INFINITY,
  })
  return entries.find(entry => profileId(entry.profile) === options.id)?.profile ?? null
}

async function findLatestProposal(
  options: UserMemoryShowOptions,
): Promise<Proposal | null> {
  const entries = await listProposals({
    ...memoryDirOptions(options),
    limit: Number.POSITIVE_INFINITY,
  })
  const latest = latestProposalRecords(entries.map(entry => entry.proposal))
  return latest.find(proposal => proposal.proposalId === options.id) ?? null
}

async function readAllArchiveEvents(
  options: MemoryRootOptions,
): Promise<Array<{ event: ArchiveEvent; jsonlPath: string }>> {
  const sessionsDir = join(getProjectMemoryDir(options), 'archive', 'sessions')
  const files = await readdir(sessionsDir).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const all = await Promise.all(
    files
      .filter(file => file.endsWith('.jsonl'))
      .map(async file => {
        const jsonlPath = join(sessionsDir, file)
        const parsed = parseArchiveJsonl(await readFile(jsonlPath, 'utf8'), jsonlPath)
        return parsed.events.map(entry => ({ event: entry.event, jsonlPath }))
      }),
  )
  return all.flat()
}

async function findDeleteTargets(
  options: UserMemoryDeleteDryRunOptions,
): Promise<DeleteTarget[]> {
  if (options.kind === 'archive') {
    return archiveDeleteTargets(options)
  }

  const path = storePathForDelete(options)
  const records = await readJsonlRecords(path)
  const matches = records.filter(record => deletePredicate(options.kind, options.id, record.value))
  if (matches.length === 0) throw new Error(`${options.kind} not found: ${options.id}`)
  return [{
    kind: options.kind,
    id: options.id,
    path,
    records: matches.length,
    bytes: matches.reduce((sum, record) => sum + record.bytes, 0),
  }]
}

async function archiveDeleteTargets(
  options: UserMemoryDeleteDryRunOptions,
): Promise<DeleteTarget[]> {
  const byPath = new Map<string, DeleteTarget>()
  for (const entry of await readAllArchiveEvents(options)) {
    if (entry.event.eventId !== options.id) continue
    const target = byPath.get(entry.jsonlPath) ?? {
      kind: 'archive' as const,
      id: options.id,
      path: entry.jsonlPath,
      records: 0,
      bytes: 0,
    }
    target.records += 1
    target.bytes += Buffer.byteLength(`${JSON.stringify(entry.event)}\n`)
    byPath.set(entry.jsonlPath, target)
  }
  const targets = [...byPath.values()]
  if (targets.length === 0) throw new Error(`archive event not found: ${options.id}`)
  return targets
}

function storePathForDelete(options: UserMemoryDeleteDryRunOptions): string {
  if (options.kind === 'observation') return getObservationsPath(options)
  if (options.kind === 'profile') return getProfileSnapshotsPath(options)
  if (options.kind === 'proposal') return getProposalsPath(options)
  throw new Error(`unsupported delete kind: ${options.kind}`)
}

function deletePredicate(kind: MemoryManageKind, id: string, value: unknown): boolean {
  if (kind === 'archive') return isArchiveEvent(value) && value.eventId === id
  if (kind === 'observation') {
    const observation = normalizeObservation(value)
    return Boolean(observation && observation.observationId === id)
  }
  if (kind === 'profile') return isProfileSnapshot(value) && profileId(value) === id
  if (kind === 'proposal') return isProposal(value) && value.proposalId === id
  return false
}

async function readJsonlRecords(path: string): Promise<Array<{ raw: string; value: unknown; bytes: number }>> {
  const contents = await readFile(path, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  const records: Array<{ raw: string; value: unknown; bytes: number }> = []
  for (const raw of splitJsonl(contents)) {
    const line = raw.endsWith('\n') ? raw.slice(0, -1).replace(/\r$/, '') : raw
    if (!line.trim()) continue
    records.push({
      raw,
      value: JSON.parse(line),
      bytes: Buffer.byteLength(raw),
    })
  }
  return records
}

async function rewriteJsonlWithout(
  path: string,
  predicate: (value: unknown) => boolean,
): Promise<number> {
  const records = await readJsonlRecords(path)
  const kept = records.filter(record => !predicate(record.value))
  const removed = records.length - kept.length
  if (removed === 0) return 0

  const tempPath = `${path}.tmp-${Date.now()}-${randomBytes(6).toString('hex')}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, kept.map(record => record.raw).join(''), 'utf8')
  await rename(tempPath, path)
  return removed
}

function splitJsonl(contents: string): string[] {
  if (!contents) return []
  const records: string[] = []
  let start = 0
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === '\n') {
      records.push(contents.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < contents.length) records.push(contents.slice(start))
  return records
}

function archiveSummary(event: ArchiveEvent, location?: string): UserMemorySummary {
  return {
    kind: 'archive',
    id: event.eventId,
    title: compact(event.text),
    createdAt: event.createdAt,
    source: event.sessionId,
    location,
  }
}

function observationSummary(observation: Observation, location?: string): UserMemorySummary {
  return {
    kind: 'observation',
    id: observation.observationId,
    title: observation.title,
    createdAt: observation.createdAt,
    updatedAt: observation.updatedAt,
    status: `${observation.lifecycle}/${observation.retrievalPolicy}`,
    source: observation.source,
    location,
  }
}

function profileSummary(profile: ProfileSnapshot, location?: string): UserMemorySummary {
  return {
    kind: 'profile',
    id: profileId(profile),
    title: compact([
      ...profile.preferences,
      ...profile.habits,
      ...profile.constraints,
      ...profile.projectFacts,
    ].join(' '), 120) || `Profile snapshot ${profile.generatedAt}`,
    createdAt: profile.generatedAt,
    status: profile.scope,
    source: profile.sourceJobId,
    location,
  }
}

function proposalSummary(proposal: Proposal, location?: string): UserMemorySummary {
  return {
    kind: 'proposal',
    id: proposal.proposalId,
    title: proposal.title,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt ?? proposal.reviewedAt,
    status: proposal.status,
    source: proposal.type,
    location,
  }
}

function summarySearchText(summary: UserMemorySummary): string {
  return [
    summary.kind,
    summary.id,
    summary.title,
    summary.status,
    summary.source,
  ].join(' ').toLowerCase()
}

function latestProposalRecords(proposals: Proposal[]): Proposal[] {
  const latest = new Map<string, Proposal>()
  for (const proposal of proposals) {
    const current = latest.get(proposal.proposalId)
    if (!current || proposalSortKey(proposal) >= proposalSortKey(current)) {
      latest.set(proposal.proposalId, proposal)
    }
  }
  return [...latest.values()]
}

function proposalSortKey(proposal: Proposal): string {
  return proposal.updatedAt ?? proposal.reviewedAt ?? proposal.createdAt
}

function profileId(profile: ProfileSnapshot): string {
  return createHash('sha256')
    .update(`${profile.projectId}\u001f${profile.scope}\u001f${profile.generatedAt}\u001f${profile.sourceJobId}`)
    .digest('hex')
    .slice(0, 16)
}

function proposalReviewStatus(
  action: ProposalReviewAction,
): Extract<ProposalStatus, 'accepted' | 'rejected' | 'candidate'> {
  if (action === 'accept') return 'accepted'
  if (action === 'reject') return 'rejected'
  return 'candidate'
}

function compact(value: string, maxLength = 96): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`
}

function basePlan(
  paths: UserMemoryPaths,
  operation: ManagementPlan['operation'],
  fields: Record<string, unknown>,
): ManagementPlan {
  const now = Date.now()
  return {
    schemaVersion: 1,
    operation,
    tokenHash: '',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
    root: paths.root,
    projectId: paths.projectId,
    ...fields,
  } as ManagementPlan
}

async function writePlan(root: string, plan: ManagementPlan): Promise<{ token: string; planPath: string }> {
  const token = `${PLAN_TOKEN_PREFIX}${randomBytes(18).toString('base64url')}`
  const planWithHash = { ...plan, tokenHash: tokenHash(token) } as ManagementPlan
  const planPath = managementPlanPath(root, token)
  await mkdir(dirname(planPath), { recursive: true })
  await writeFile(planPath, `${JSON.stringify(planWithHash, null, 2)}\n`, 'utf8')
  return { token, planPath }
}

async function readPlan<T extends ManagementPlan>(
  paths: UserMemoryPaths,
  token: string,
  operation: T['operation'],
): Promise<T> {
  if (!token.startsWith(PLAN_TOKEN_PREFIX)) {
    throw new Error(`management confirmation token must come from memory ${operation} --dry-run`)
  }
  const planPath = managementPlanPath(paths.root, token)
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as T
  if (plan.schemaVersion !== 1 || plan.operation !== operation || plan.tokenHash !== tokenHash(token)) {
    throw new Error('management confirmation token does not match plan')
  }
  if (plan.root !== paths.root || plan.projectId !== paths.projectId) {
    throw new Error('management plan does not match current sidecar home/project')
  }
  if (Date.parse(plan.expiresAt) <= Date.now()) {
    throw new Error(`management confirmation token expired at ${plan.expiresAt}`)
  }
  return plan
}

function dryRunResult(
  operation: UserMemoryDryRunResult['operation'],
  token: string,
  expiresAt: string,
  planPath: string,
  targets: unknown[],
): UserMemoryDryRunResult {
  return {
    dryRun: true,
    operation,
    token,
    expiresAt,
    planPath,
    targets,
    instructions: `Run memory ${operationCommand(operation)} --confirm ${token} before ${expiresAt} to apply this change.`,
  }
}

function operationCommand(operation: UserMemoryDryRunResult['operation']): string {
  if (operation === 'proposal-review') return 'proposal'
  return operation
}

function managementPlanPath(root: string, token: string): string {
  return join(root, 'management', 'plans', `${tokenHash(token)}.json`)
}

async function removePlan(root: string, token: string): Promise<void> {
  await rm(managementPlanPath(root, token), { force: true })
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function assertInsideRoot(path: string, root: string, label: string): void {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error(`${label} path is outside memory sidecar home: ${path}`)
}
