import type { MemoryRootOptions } from '../index.js'
import { redactMemoryText } from '../redaction/redact.js'
import { classifyArchiveEventsWithLlm } from '../classify/llmClassifier.js'
import { classifyArchiveEventsWithRules } from '../classify/ruleClassifier.js'
import { refineRuleObservationCandidates } from '../classify/refineObservations.js'
import { detectProposals } from '../proposal/detectProposals.js'
import { synthesizeProfileSnapshot } from '../profile/synthesizeProfile.js'
import { readArchiveEvents } from '../storage/jsonlArchiveStore.js'
import { appendObservations } from '../storage/observationStore.js'
import { recentObservations } from '../storage/observationStore.js'
import { appendProfileSnapshot, recentProfileSnapshots } from '../storage/profileStore.js'
import { appendProposals } from '../storage/proposalStore.js'
import { rebuildArchiveIndex } from '../storage/sqliteIndex.js'
import {
  appendMemoryAgentJobStatus,
  listLatestMemoryAgentJobs,
  observeMemoryAgentJobs,
  type MemoryAgentJob,
  type MemoryAgentJobObservation,
} from './jobQueue.js'

export type MemoryAgentJobRunResult = {
  job: MemoryAgentJob
  status: MemoryAgentJob['status']
  durationMs: number
  result?: Record<string, unknown>
  error?: string
}

export type RunPendingMemoryAgentJobsResult = {
  processedJobs: MemoryAgentJobRunResult[]
  observation: MemoryAgentJobObservation
}

export async function runPendingMemoryAgentJobs(
  options: MemoryRootOptions,
): Promise<RunPendingMemoryAgentJobsResult> {
  const pendingJobs = (await listLatestMemoryAgentJobs(options)).filter(
    job => job.status === 'pending',
  )
  const processedJobs: MemoryAgentJobRunResult[] = []

  for (const job of pendingJobs) {
    processedJobs.push(await runMemoryAgentJob({ ...options, job }))
  }

  return {
    processedJobs,
    observation: observeMemoryAgentJobs(await listLatestMemoryAgentJobs(options)),
  }
}

export async function runMemoryAgentJob(
  options: MemoryRootOptions & { job: MemoryAgentJob },
): Promise<MemoryAgentJobRunResult> {
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const running = await appendMemoryAgentJobStatus({
    ...options,
    job: options.job,
    status: 'running',
    startedAt,
  })

  try {
    const result = await executeMemoryAgentJob({ ...options, job: running })
    const completedAt = new Date().toISOString()
    const durationMs = Date.now() - startMs
    // W119 H7: redact secret-like substrings from job error before it lands
    // on disk. Belt-and-braces — the provider already redacts at source,
    // but unrelated errors (sqlite, fs, etc.) may also embed paths/tokens.
    const redactedError = redactJobError(result.error)
    const completed = await appendMemoryAgentJobStatus({
      ...options,
      job: running,
      status: result.status,
      completedAt,
      durationMs,
      result: result.result,
      error: redactedError,
    })

    return {
      job: completed,
      status: completed.status,
      durationMs,
      result: completed.result,
      error: completed.error,
    }
  } catch (error) {
    const completedAt = new Date().toISOString()
    const durationMs = Date.now() - startMs
    const message = error instanceof Error ? error.message : String(error)
    // W119 H7: same redaction for thrown errors that bypassed result.error.
    const redactedMessage = redactJobError(message) ?? message
    const failed = await appendMemoryAgentJobStatus({
      ...options,
      job: running,
      status: 'failed',
      completedAt,
      durationMs,
      error: redactedMessage,
    })

    return {
      job: failed,
      status: 'failed',
      durationMs,
      error: redactedMessage,
    }
  }
}

function redactJobError(error: string | undefined): string | undefined {
  if (!error) return error
  return redactMemoryText(error).text
}

async function executeMemoryAgentJob(
  options: MemoryRootOptions & { job: MemoryAgentJob },
): Promise<Pick<MemoryAgentJobRunResult, 'status' | 'result' | 'error'>> {
  if (options.job.type === 'index_archive') {
    const result = await rebuildArchiveIndex(options)
    return { status: 'completed', result }
  }

  if (options.job.type === 'classify_rule') {
    const events = await readJobArchiveEvents(options)
    const observations = refineRuleObservationCandidates(classifyArchiveEventsWithRules(
      events.map(({ event }) => event),
    ))
    const appendResults = await appendObservations({ ...options, observations })
    return {
      status: 'completed',
      result: {
        eventsRead: events.length,
        observationsGenerated: observations.length,
        observationsAppended: appendResults.filter(result => !result.skipped).length,
        observationsSkipped: appendResults.filter(result => result.skipped).length,
      },
    }
  }

  if (options.job.type === 'classify_llm') {
    const events = await readJobArchiveEvents(options)
    const candidateObservations = refineRuleObservationCandidates(classifyArchiveEventsWithRules(
      events.map(({ event }) => event),
    ))
    const llmResult = await classifyArchiveEventsWithLlm(
      events.map(({ event }) => event),
      {
        providerConfig: providerConfigForJob(options, 'classify_llm'),
        candidateObservations,
      },
    )
    if (llmResult.status !== 'completed') {
      return {
        status: 'skipped',
        error: llmResult.reason,
        result: {
          providerKind: llmResult.providerKind,
          observationsGenerated: 0,
        },
      }
    }
    const appendResults = await appendObservations({
      ...options,
      observations: llmResult.observations,
    })
    return {
      status: 'completed',
      result: {
        providerKind: llmResult.providerKind,
        observationsGenerated: llmResult.observations.length,
        observationsAppended: appendResults.filter(result => !result.skipped).length,
        observationsSkipped: appendResults.filter(result => result.skipped).length,
      },
    }
  }

  if (options.job.type === 'synthesize_profile') {
    return synthesizeAndAppendProfile(options)
  }

  return detectAndAppendProposals(options)
}

function providerConfigForJob(
  options: MemoryRootOptions,
  jobType: 'classify_llm' | 'synthesize_profile' | 'detect_proposals',
): MemoryRootOptions['llmProviderConfig'] {
  return options.llmProviderConfigByJob?.[jobType] ?? options.llmProviderConfig
}

async function readJobArchiveEvents(
  options: MemoryRootOptions & { job: MemoryAgentJob },
) {
  if (!options.job.sessionId) return []

  const eventIds = new Set(options.job.eventIds)
  const events = await readArchiveEvents({ ...options, sessionId: options.job.sessionId })
  if (!eventIds.size) return events
  return events.filter(({ event }) => eventIds.has(event.eventId))
}

async function synthesizeAndAppendProfile(
  options: MemoryRootOptions & { job: MemoryAgentJob },
): Promise<Pick<MemoryAgentJobRunResult, 'status' | 'result' | 'error'>> {
  const events = await readJobArchiveEvents(options)
  const observations = (await recentObservations({
    ...options,
    sessionId: options.job.sessionId,
    limit: 200,
  })).map(entry => entry.observation)
  const profile = synthesizeProfileSnapshot({
    events: events.map(({ event }) => event),
    observations,
  }, {
    projectId: options.projectId,
    sourceJobId: options.job.jobId,
    generatedAt: new Date().toISOString(),
  })

  // D: Profile snapshot dedup — skip if content-identical to latest
  const latestSnapshots = await recentProfileSnapshots({
    ...options,
    limit: 1,
  })
  if (latestSnapshots.length > 0) {
    const latest = latestSnapshots[0].profile
    if (profileContentHash(profile) === profileContentHash(latest)) {
      return {
        status: 'completed',
        result: {
          preferences: profile.preferences.length,
          habits: profile.habits.length,
          constraints: profile.constraints.length,
          projectFacts: profile.projectFacts.length,
          confidence: profile.confidence,
          skippedDuplicate: true,
        },
      }
    }
  }

  const result = await appendProfileSnapshot({ ...options, profile })

  return {
    status: 'completed',
    result: {
      preferences: profile.preferences.length,
      habits: profile.habits.length,
      constraints: profile.constraints.length,
      projectFacts: profile.projectFacts.length,
      confidence: profile.confidence,
      jsonlPath: result.jsonlPath,
    },
  }
}

function profileContentHash(
  profile: { preferences: string[]; habits: string[]; constraints: string[]; projectFacts: string[] },
): string {
  const parts = [
    profile.preferences.join('|'),
    profile.habits.join('|'),
    profile.constraints.join('|'),
    profile.projectFacts.join('|'),
  ]
  let hash = 5381
  const raw = parts.join('\0')
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(index)
  }
  return Math.abs(hash).toString(36)
}

async function detectAndAppendProposals(
  options: MemoryRootOptions & { job: MemoryAgentJob },
): Promise<Pick<MemoryAgentJobRunResult, 'status' | 'result' | 'error'>> {
  const events = await readJobArchiveEvents(options)
  const observations = (await recentObservations({
    ...options,
    sessionId: options.job.sessionId,
    limit: 200,
  })).map(entry => entry.observation)
  const proposals = detectProposals({
    events: events.map(({ event }) => event),
    observations,
  }, {
    projectId: options.projectId,
    createdAt: new Date().toISOString(),
  })
  const result = await appendProposals({ ...options, proposals })

  return {
    status: 'completed',
    result: {
      proposalsGenerated: proposals.length,
      proposalsAppended: result.filter(item => !item.skipped).length,
      proposalsSkipped: result.filter(item => item.skipped).length,
    },
  }
}
