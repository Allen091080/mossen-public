import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { isNonEmptyString, isRecord } from '../schema/scope.js'
import { appendJsonlLine } from '../storage/jsonlAppend.js'
import { parseJsonlLinesTolerant } from '../storage/jsonlParse.js'

export const MEMORY_AGENT_JOB_TYPES = [
  'index_archive',
  'classify_rule',
  'classify_llm',
  'synthesize_profile',
  'detect_proposals',
] as const

export const MEMORY_AGENT_JOB_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
] as const

export type MemoryAgentJobType = (typeof MEMORY_AGENT_JOB_TYPES)[number]
export type MemoryAgentJobStatus = (typeof MEMORY_AGENT_JOB_STATUSES)[number]

export type MemoryAgentJob = {
  schemaVersion: 1
  jobId: string
  type: MemoryAgentJobType
  status: MemoryAgentJobStatus
  projectId: string
  sessionId?: string
  eventIds: string[]
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt?: string
  durationMs?: number
  result?: Record<string, unknown>
  error?: string
}

export type AppendMemoryAgentJobOptions = MemoryRootOptions & {
  job: MemoryAgentJob
}

export type MemoryAgentJobObservation = {
  totalJobs: number
  countsByStatus: Record<MemoryAgentJobStatus, number>
  countsByType: Record<MemoryAgentJobType, number>
  // W143-D1: 2D matrix `type -> status -> count` so worker status can
  // render rows like `classify_llm: completed=N skipped=N failed=N
  // pending=N running=N`. Optional in result so older readers that
  // ignore the field still work; populated by observeMemoryAgentJobs.
  countsByTypeStatus?: Record<MemoryAgentJobType, Record<MemoryAgentJobStatus, number>>
  durationsMs: {
    count: number
    min: number
    max: number
    total: number
    average: number
  }
  skippedLlmJobs: number
}

export type MemoryAgentRetryObservation = {
  activeFailedJobs: number
  retryJobs: number
  exhaustedJobs: number
  maxRetryAttempt: number
  supersededFailedJobs: number
}

export type RetryFailedMemoryAgentJobsOptions = MemoryRootOptions & {
  maxAttempts?: number
  backoffBaseMs?: number
  maxBackoffMs?: number
  markExhausted?: boolean
  now?: Date
}

const jobTypes = new Set<string>(MEMORY_AGENT_JOB_TYPES)
const jobStatuses = new Set<string>(MEMORY_AGENT_JOB_STATUSES)

export function getMemoryAgentJobQueuePath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/agent/jobs.jsonl`
}

export async function appendMemoryAgentJob(
  options: AppendMemoryAgentJobOptions,
): Promise<MemoryAgentJob> {
  if (!isMemoryAgentJob(options.job)) {
    throw new Error('job must match MemoryAgentJob schema')
  }
  if (options.job.projectId !== options.projectId) {
    throw new Error('job.projectId must match append projectId')
  }

  const jsonlPath = getMemoryAgentJobQueuePath(options)
  await mkdir(`${getProjectMemoryDir(options)}/agent`, { recursive: true })
  await appendJsonlLine(jsonlPath, options.job)
  return options.job
}

export async function listMemoryAgentJobs(
  options: MemoryRootOptions,
): Promise<MemoryAgentJob[]> {
  const contents = await readFile(getMemoryAgentJobQueuePath(options), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  return parseJsonlLinesTolerant(contents, { context: 'memory-agent-jobs' })
    .filter(isMemoryAgentJob)
}

export async function listLatestMemoryAgentJobs(
  options: MemoryRootOptions,
): Promise<MemoryAgentJob[]> {
  return latestByJobId(await listMemoryAgentJobs(options))
}

export async function listFailedMemoryAgentJobs(
  options: MemoryRootOptions,
): Promise<MemoryAgentJob[]> {
  return (await listLatestMemoryAgentJobs(options)).filter(job => job.status === 'failed')
}

export async function appendMemoryAgentJobStatus(
  options: AppendMemoryAgentJobOptions & {
    status: MemoryAgentJobStatus
    error?: string
    result?: Record<string, unknown>
    startedAt?: string
    completedAt?: string
    durationMs?: number
  },
): Promise<MemoryAgentJob> {
  const now = new Date().toISOString()
  const next: MemoryAgentJob = {
    ...options.job,
    status: options.status,
    updatedAt: now,
    startedAt: options.startedAt ?? options.job.startedAt,
    completedAt: options.completedAt ?? options.job.completedAt,
    durationMs: options.durationMs ?? options.job.durationMs,
    result: options.result ?? options.job.result,
    error: options.error,
  }

  return appendMemoryAgentJob({ ...options, job: next })
}

export function observeMemoryAgentJobs(jobs: MemoryAgentJob[]): MemoryAgentJobObservation {
  const latestJobs = latestByJobId(jobs)
  const countsByStatus = Object.fromEntries(
    MEMORY_AGENT_JOB_STATUSES.map(status => [status, 0]),
  ) as Record<MemoryAgentJobStatus, number>
  const countsByType = Object.fromEntries(
    MEMORY_AGENT_JOB_TYPES.map(type => [type, 0]),
  ) as Record<MemoryAgentJobType, number>
  const durations = latestJobs
    .map(job => job.durationMs)
    .filter((duration): duration is number => typeof duration === 'number' && duration >= 0)

  // W143-D1: build the 2D matrix in the same pass.
  const countsByTypeStatus = Object.fromEntries(
    MEMORY_AGENT_JOB_TYPES.map(type => [
      type,
      Object.fromEntries(
        MEMORY_AGENT_JOB_STATUSES.map(status => [status, 0]),
      ) as Record<MemoryAgentJobStatus, number>,
    ]),
  ) as Record<MemoryAgentJobType, Record<MemoryAgentJobStatus, number>>

  for (const job of latestJobs) {
    countsByStatus[job.status] += 1
    countsByType[job.type] += 1
    countsByTypeStatus[job.type][job.status] += 1
  }

  const total = durations.reduce((sum, duration) => sum + duration, 0)
  return {
    totalJobs: latestJobs.length,
    countsByStatus,
    countsByType,
    countsByTypeStatus,
    durationsMs: {
      count: durations.length,
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
      total,
      average: durations.length ? total / durations.length : 0,
    },
    skippedLlmJobs: latestJobs.filter(
      job => job.type === 'classify_llm' && job.status === 'skipped',
    ).length,
  }
}

export function observeMemoryAgentJobRetries(jobs: MemoryAgentJob[]): MemoryAgentRetryObservation {
  const latestJobs = latestByJobId(jobs)
  const supersededJobIds = retrySupersededJobIds(latestJobs)
  const retryJobs = latestJobs.filter(job => retryAttemptForJob(job) > 0)
  const retryAttempts = retryJobs.map(retryAttemptForJob)

  return {
    activeFailedJobs: latestJobs.filter(
      job => job.status === 'failed' && !supersededJobIds.has(job.jobId),
    ).length,
    retryJobs: retryJobs.length,
    exhaustedJobs: latestJobs.filter(isRetryExhaustedJob).length,
    maxRetryAttempt: retryAttempts.length ? Math.max(...retryAttempts) : 0,
    supersededFailedJobs: latestJobs.filter(
      job => job.status === 'failed' && supersededJobIds.has(job.jobId),
    ).length,
  }
}

export async function retryFailedMemoryAgentJobs(
  options: RetryFailedMemoryAgentJobsOptions,
): Promise<MemoryAgentJob[]> {
  const latestJobs = await listLatestMemoryAgentJobs(options)
  const supersededJobIds = retrySupersededJobIds(latestJobs)
  const failedJobs = latestJobs.filter(
    job => job.status === 'failed' && !supersededJobIds.has(job.jobId),
  )
  const retried: MemoryAgentJob[] = []
  const nowDate = options.now ?? new Date()
  const now = nowDate.toISOString()
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
  const backoffBaseMs = options.backoffBaseMs ?? 0
  const maxBackoffMs = options.maxBackoffMs ?? 5 * 60 * 1000

  for (const job of failedJobs) {
    const attempt = retryAttemptForJob(job)
    if (attempt >= maxAttempts) {
      if (options.markExhausted) {
        retried.push(await appendMemoryAgentJobStatus({
          ...options,
          job,
          status: 'skipped',
          completedAt: now,
          error: job.error,
          result: {
            ...job.result,
            retryExhausted: true,
            retryAttempts: attempt,
            retryMaxAttempts: maxAttempts,
            retryExhaustedAt: now,
          },
        }))
      }
      continue
    }

    const backoffMs = retryBackoffMs({
      attempt,
      backoffBaseMs,
      maxBackoffMs,
    })
    const retryReadyAt = new Date(
      Date.parse(job.completedAt ?? job.updatedAt ?? job.createdAt) + backoffMs,
    )
    if (retryReadyAt.getTime() > nowDate.getTime()) continue

    const retryAttempt = attempt + 1
    retried.push(await appendMemoryAgentJob({
      ...options,
      job: {
        schemaVersion: 1,
        jobId: `retry_${now.replace(/[^0-9]/g, '')}_${retryAttempt}_${job.jobId}`,
        type: job.type,
        status: 'pending',
        projectId: job.projectId,
        sessionId: job.sessionId,
        eventIds: job.eventIds,
        createdAt: now,
        result: {
          retryOf: job.jobId,
          retryAttempt,
          retryRootJobId: retryRootJobId(job),
          retryBackoffMs: backoffMs,
        },
      },
    }))
  }

  return retried
}

function retryBackoffMs(options: {
  attempt: number
  backoffBaseMs: number
  maxBackoffMs: number
}): number {
  if (options.backoffBaseMs <= 0) return 0
  const boundedAttempt = Math.max(0, options.attempt)
  return Math.min(options.maxBackoffMs, options.backoffBaseMs * (2 ** boundedAttempt))
}

function retrySupersededJobIds(jobs: MemoryAgentJob[]): Set<string> {
  const superseded = new Set<string>()
  for (const job of jobs) {
    const retryOf = stringResult(job, 'retryOf')
    if (retryOf) superseded.add(retryOf)
  }
  return superseded
}

function retryAttemptForJob(job: MemoryAgentJob): number {
  const explicitAttempt = numberResult(job, 'retryAttempt')
  if (explicitAttempt !== undefined) return explicitAttempt
  return stringResult(job, 'retryOf') ? 1 : 0
}

function retryRootJobId(job: MemoryAgentJob): string {
  return stringResult(job, 'retryRootJobId') ?? stringResult(job, 'retryOf') ?? job.jobId
}

function isRetryExhaustedJob(job: MemoryAgentJob): boolean {
  return job.status === 'skipped' && job.result?.retryExhausted === true
}

function stringResult(job: MemoryAgentJob, key: string): string | undefined {
  const value = job.result?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberResult(job: MemoryAgentJob, key: string): number | undefined {
  const value = job.result?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function latestByJobId(jobs: MemoryAgentJob[]): MemoryAgentJob[] {
  const latest = new Map<string, MemoryAgentJob>()
  for (const job of jobs) {
    latest.set(job.jobId, job)
  }
  return [...latest.values()]
}

export function isMemoryAgentJob(value: unknown): value is MemoryAgentJob {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.jobId) &&
    typeof value.type === 'string' &&
    jobTypes.has(value.type) &&
    typeof value.status === 'string' &&
    jobStatuses.has(value.status) &&
    isNonEmptyString(value.projectId) &&
    (value.sessionId === undefined || isNonEmptyString(value.sessionId)) &&
    Array.isArray(value.eventIds) &&
    value.eventIds.every(isNonEmptyString) &&
    isNonEmptyString(value.createdAt) &&
    (value.startedAt === undefined || isNonEmptyString(value.startedAt)) &&
    (value.completedAt === undefined || isNonEmptyString(value.completedAt)) &&
    (value.updatedAt === undefined || isNonEmptyString(value.updatedAt)) &&
    (value.durationMs === undefined ||
      (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs))) &&
    (value.result === undefined || isRecord(value.result)) &&
    (value.error === undefined || typeof value.error === 'string')
  )
}
