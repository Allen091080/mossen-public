// W122-B Agent C: production report wrapping a single run-once invocation.
//
// Calls runMemoryAgentOnce — the SOLE legitimate mutation surface of this
// report — and packages the outcome as a fixed-shape report with bilingual
// warnings, llmSkippedReason categorisation, and stable
// recommendedActions slash-command strings. Does NOT call setMemorySidecar*
// or any other primitive directly.

import type { MemoryRootOptions } from '../index.js'
import { getProjectMemoryDir } from '../index.js'
import { resolveProjectId } from '../projectId.js'
import { runMemoryAgentOnce } from '../agent/workerRunOnce.js'
import {
  getDefaultMemorySidecarConfigPath,
  hasIndependentLlmConfig,
  loadMemorySidecarConfig,
  type MemorySidecarConfig,
} from '../config/config.js'
import type { MemoryAgentJob } from '../agent/jobQueue.js'
import { redactMemoryText } from '../redaction/redact.js'

export type RunOnceLlmSkipReason =
  | 'llm-disabled'
  | 'no-llm-config'
  | 'no-llm-jobs'
  | 'used'
  | null

export type RunOnceJobDetail = {
  id: string
  type: string
  status: 'completed' | 'skipped' | 'failed' | 'pending' | 'running'
  errorClass?: string
  redactedError?: string
}

// W143-D3: aggregate run-once outcomes by job type and skip reason so
// the operator can answer "why did N jobs skip?" without scanning the
// jobsDetail tail. Backwards compatible: the field is optional and old
// readers that ignore it continue to work.
export type RunOnceTypeBreakdown = {
  type: string
  completed: number
  skipped: number
  failed: number
  pending: number
  running: number
}

export type RunOnceSkippedReason = {
  reason: string
  count: number
  examples: string[]  // up to 5 example job ids
}

export type RunOnceReport = {
  startedAt: string
  finishedAt: string
  durationMs: number
  projectId: string
  resolvedProjectId: string
  memoryDir: string
  repairedMarkers: number
  scheduledJobs: number
  completedJobs: number
  skippedJobs: number
  failedJobs: number
  // W143-D3: per-type matrix and skipped-reason summary.
  typeBreakdown?: RunOnceTypeBreakdown[]
  skippedReasonSummary?: RunOnceSkippedReason[]
  llmSkippedReason: RunOnceLlmSkipReason
  jobsDetail: RunOnceJobDetail[]
  recommendedActions: string[]
  warnings: string[]
}

const REDACTED_ERROR_MAX_LEN = 200
const JOBS_DETAIL_MAX = 50

export async function generateRunOnceReport(
  options: MemoryRootOptions,
): Promise<RunOnceReport> {
  const warnings: string[] = []
  const startMs = Date.now()
  const startedAt = new Date(startMs).toISOString()

  // 1) Resolve canonical projectId.
  const aliasResolution = await resolveProjectId({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
    aliases: [options.projectId],
    aliasReason: undefined as string | undefined,
  }))
  const effectiveProjectId = aliasResolution.projectId
  const effectiveOptions: MemoryRootOptions = {
    ...options,
    projectId: effectiveProjectId,
  }
  const memoryDir = getProjectMemoryDir(effectiveOptions)

  // 2) Load config (read-only) for llm-skip reason classification.
  let config: MemorySidecarConfig | null = null
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch {
    warnings.push(
      'config not readable / 配置文件无法解析',
    )
  }

  // 3) Run-once via the existing helper. This is the ONE allowed mutation
  //    surface — no direct setMemorySidecar* / appendArchiveEvent /
  //    appendDirtyMarker calls.
  let result: Awaited<ReturnType<typeof runMemoryAgentOnce>> | null = null
  try {
    result = await runMemoryAgentOnce({
      ...effectiveOptions,
      llmProviderConfig: effectiveOptions.llmProviderConfig ?? (
        config?.classification.llm
          ? config.classification.llmProviderConfig
          : undefined
      ),
      llmProviderConfigByJob: effectiveOptions.llmProviderConfigByJob ?? (
        config?.classification.llm
          ? config.classification.perJobProvider
          : undefined
      ),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    warnings.push(
      `run-once failed: ${redactMemoryText(message).text} / run-once 失败`,
    )
  }

  const finishMs = Date.now()
  const finishedAt = new Date(finishMs).toISOString()
  const durationMs = Math.max(0, finishMs - startMs)

  const repairedMarkers = result?.repairedMarkers ?? 0
  const scheduledJobs = result?.enqueuedJobs.length ?? 0

  // 4) Aggregate processedJobs by RUN status (entry.status reflects the
  //    outcome; entry.job.status reflects the input pre-run state).
  const processedJobs = result?.processedJobs ?? []
  let completedJobs = 0
  let skippedJobs = 0
  let failedJobs = 0
  for (const entry of processedJobs) {
    const status = entry.status
    if (status === 'completed') completedJobs += 1
    else if (status === 'skipped') skippedJobs += 1
    else if (status === 'failed') failedJobs += 1
  }

  // W143-D3: per-type breakdown and skipped-reason summary so the
  // operator sees a tidy `cargo: completed=N skipped=N failed=N` style
  // output and a "why" tally.
  const typeBuckets = new Map<string, RunOnceTypeBreakdown>()
  const skipReasonBuckets = new Map<string, RunOnceSkippedReason>()
  for (const entry of processedJobs) {
    const t = entry.job.type
    let bucket = typeBuckets.get(t)
    if (!bucket) {
      bucket = { type: t, completed: 0, skipped: 0, failed: 0, pending: 0, running: 0 }
      typeBuckets.set(t, bucket)
    }
    if (entry.status === 'completed') bucket.completed += 1
    else if (entry.status === 'skipped') bucket.skipped += 1
    else if (entry.status === 'failed') bucket.failed += 1
    else if (entry.status === 'pending') bucket.pending += 1
    else if (entry.status === 'running') bucket.running += 1

    if (entry.status === 'skipped') {
      const rawReason = (entry.error ?? entry.job.error ?? '').trim()
      // Bucket by the first 80 chars of the reason text so close-but-
      // not-identical messages aggregate. If empty, label as `(none)`
      // so it still surfaces.
      const reasonKey = rawReason ? rawReason.slice(0, 80) : '(no reason recorded)'
      let r = skipReasonBuckets.get(reasonKey)
      if (!r) {
        r = { reason: reasonKey, count: 0, examples: [] }
        skipReasonBuckets.set(reasonKey, r)
      }
      r.count += 1
      if (r.examples.length < 5) r.examples.push(entry.job.jobId)
    }
  }
  const typeBreakdown = [...typeBuckets.values()]
    .sort((a, b) => a.type.localeCompare(b.type))
  const skippedReasonSummary = [...skipReasonBuckets.values()]
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))

  // 5) jobsDetail: trim to first JOBS_DETAIL_MAX entries with redacted error.
  const jobsDetail: RunOnceJobDetail[] = processedJobs
    .slice(0, JOBS_DETAIL_MAX)
    .map(entry => {
      const job: MemoryAgentJob = entry.job
      const runStatus = entry.status
      const detail: RunOnceJobDetail = {
        id: job.jobId,
        type: job.type,
        status: runStatus,
      }
      if (runStatus === 'failed') {
        detail.errorClass = errorClassFromJobType(job.type)
        const message = entry.error ?? job.error ?? ''
        const redacted = redactMemoryText(message).text
        detail.redactedError =
          redacted.length > REDACTED_ERROR_MAX_LEN
            ? redacted.slice(0, REDACTED_ERROR_MAX_LEN)
            : redacted
      }
      return detail
    })

  // 6) llmSkippedReason classification.
  const llmEnabled = config?.classification.llm ?? false
  const independentLlm = config ? hasIndependentLlmConfig(config) : false
  const llmJobsCompleted = processedJobs.some(
    entry => entry.job.type === 'classify_llm' && entry.status === 'completed',
  )
  const llmJobsRan = processedJobs.some(entry => entry.job.type === 'classify_llm')
  const skippedLlmCount = result?.skippedLlmJobs ?? 0

  let llmSkippedReason: RunOnceLlmSkipReason
  if (!llmEnabled) {
    llmSkippedReason = 'llm-disabled'
  } else if (!independentLlm) {
    llmSkippedReason = 'no-llm-config'
  } else if (llmJobsCompleted) {
    llmSkippedReason = 'used'
  } else if (skippedLlmCount === 0 && !llmJobsRan) {
    llmSkippedReason = 'no-llm-jobs'
  } else {
    llmSkippedReason = null
  }

  // 7) Warnings.
  if (failedJobs > 0) {
    warnings.push(
      `${failedJobs} jobs failed during run-once / 本次有任务失败`,
    )
  }
  if (repairedMarkers > 0) {
    warnings.push(
      `${repairedMarkers} dirty markers repaired / 修复了缺失的 dirty 标记`,
    )
  }
  if (llmSkippedReason === 'no-llm-config') {
    warnings.push(
      'llm enabled but no independent config / 已开启但缺独立 config',
    )
  }

  // 8) Recommended actions.
  const recommendedActions: string[] = []
  recommendedActions.push('/memory-sidecar worker status')
  if (repairedMarkers > 0 || failedJobs > 0) {
    recommendedActions.push('/memory-sidecar repair')
  }
  if (llmSkippedReason === 'no-llm-config') {
    recommendedActions.push('/memory-sidecar llm enable')
  }

  return {
    startedAt,
    finishedAt,
    durationMs,
    projectId: options.projectId,
    resolvedProjectId: effectiveProjectId,
    memoryDir,
    repairedMarkers,
    scheduledJobs,
    completedJobs,
    skippedJobs,
    failedJobs,
    typeBreakdown,
    skippedReasonSummary,
    llmSkippedReason,
    jobsDetail,
    recommendedActions,
    warnings,
  }
}

function errorClassFromJobType(type: string): string {
  if (type.startsWith('classify')) return 'classify'
  if (type.startsWith('synthesize')) return 'profile'
  if (type.startsWith('detect')) return 'proposal'
  if (type.startsWith('index')) return 'index'
  const segments = type.split('_')
  return segments[0] || 'unknown'
}
