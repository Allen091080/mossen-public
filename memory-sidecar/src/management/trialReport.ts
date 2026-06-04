import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import { getArchiveStoreManifest } from '../storage/manifest'
import { listDirtyCheckpoints, listDirtyMarkers } from '../agent/dirtyQueue'
import {
  listMemoryAgentJobs,
  observeMemoryAgentJobs,
  observeMemoryAgentJobRetries,
} from '../agent/jobQueue'
import { getMemoryWorkerStatus } from '../agent/workerLoop'
import { detectArchiveEventsMissingDirty } from '../agent/reconcile'
import { recentObservations } from '../storage/observationStore'
import { recentProfileSnapshots } from '../storage/profileStore'
import { recentProposals } from '../storage/proposalStore'
import { memorySearch } from '../retrieval/search'

export type TrialReportOptions = MemoryRootOptions & {
  query?: string
  limit?: number
}

export type TrialReportObservationRecentItem = {
  id: string
  scope: string
  type: string
  domain: string
  updatedAt: string
  retrievalPolicy: string
}

export type TrialReportProfileSummary = {
  preferences: number
  constraints: number
  habits: number
  projectFacts: number
}

export type TrialReportProposalRecentItem = {
  id: string
  type: string
  status: string
  updatedAt: string
}

export type TrialReportRetrievalItem = {
  id: string
  source: string
  score: number
  scope: string
  tokenEstimate: number
}

export type TrialReport = {
  projectId: string
  generatedAt: string
  paths: {
    root: string
    memoryDir: string
    sqlitePath: string
  }
  archive: {
    events: number
    sessions: number
    lastEventAt: string | null
    estimatedTokens: number
  }
  worker: {
    lockHeld: boolean
    lockStale: boolean
    dirtyTotal: number
    dirtyConsumed: number
    dirtyUnconsumed: number
    jobs: {
      total: number
      pending: number
      running: number
      completed: number
      failed: number
      skipped: number
      // W143-D1: per-type / per-status matrix. Optional so older
      // readers that ignore it still work; populated from
      // observeMemoryAgentJobs.countsByTypeStatus.
      countsByTypeStatus?: Record<string, Record<string, number>>
    }
    retries: {
      activeFailedJobs: number
      retryJobs: number
      exhaustedJobs: number
      maxRetryAttempt: number
    }
    // W120 M1: archive/dirty reconciliation snapshot. scanWindow is the
    // number of recent archive events compared against active+consumed
    // dirty markers; missing > 0 means worker run-once will re-emit
    // markers on its next start.
    reconcile: {
      scanWindow: number
      scannedEvents: number
      missing: number
    }
  }
  observations: {
    total: number
    byScope: Record<string, number>
    byType: Record<string, number>
    byDomain: Record<string, number>
    recent: TrialReportObservationRecentItem[]
  }
  profile: {
    snapshots: number
    latestAt: string | null
    latestSummary: TrialReportProfileSummary | null
  }
  proposals: {
    total: number
    candidate: number
    accepted: number
    rejected: number
    deferred: number
    recent: TrialReportProposalRecentItem[]
  }
  retrievalProbe: {
    query: string
    limit: number
    results: number
    estimatedTokens: number
    items: TrialReportRetrievalItem[]
  }
  warnings: string[]
}

export async function generateTrialReport(
  options: TrialReportOptions,
): Promise<TrialReport> {
  const memoryDir = getProjectMemoryDir(options)
  const sqlitePath = `${memoryDir}/memory.db`
  const generatedAt = new Date().toISOString()
  const query = options.query ?? 'mossen旁路记忆'
  const limit = options.limit ?? 5
  const warnings: string[] = []

  // Archive stats
  const manifest = await getArchiveStoreManifest(options).catch(() => null)
  const archiveEvents = manifest?.stats.archiveEventCount ?? 0
  const archiveSessions = manifest?.stats.sessionFileCount ?? 0
  const archiveLastEvent = manifest?.stats.lastEventAt ?? null

  // Estimate archive tokens from manifest count (bounded, no full text read)
  const archiveEstimatedTokens = manifest
    ? archiveEvents * 80 // rough average per event
    : 0

  if (archiveEvents === 0) {
    warnings.push('no archive events')
  }

  let hasStaleLock = false

  // Worker status
  const workerStatus = await getMemoryWorkerStatus(options).catch(() => null)
  const lockHeld = workerStatus?.lock.held ?? false
  const lockStale = workerStatus?.lock.stale ?? false
  const dirtyTotal = workerStatus?.dirty.total ?? 0
  const dirtyConsumed = workerStatus?.dirty.consumed ?? 0
  const dirtyUnconsumed = workerStatus?.dirty.unconsumed ?? 0

  // Fallback: read dirty data directly if workerStatus failed
  let finalDirtyTotal = dirtyTotal
  let finalDirtyConsumed = dirtyConsumed
  let finalDirtyUnconsumed = dirtyUnconsumed
  if (!workerStatus) {
    const markers = await listDirtyMarkers(options).catch(() => [])
    const checkpoints = await listDirtyCheckpoints(options).catch(() => [])
    const consumedSet = new Set(checkpoints.map(c => c.dirtyId))
    finalDirtyTotal = markers.length
    finalDirtyConsumed = consumedSet.size
    finalDirtyUnconsumed = markers.filter(m => !consumedSet.has(m.dirtyId)).length
  }

  // Jobs
  const allJobs = await listMemoryAgentJobs(options).catch(() => [])
  const jobObs = observeMemoryAgentJobs(allJobs)
  const retryObs = observeMemoryAgentJobRetries(allJobs)

  if (retryObs.activeFailedJobs > 0) {
    warnings.push(`${retryObs.activeFailedJobs} active failed jobs`)
  }
  if (retryObs.exhaustedJobs > 0) {
    warnings.push(`${retryObs.exhaustedJobs} exhausted retry jobs`)
  }
  if (retryObs.retryJobs > 0) {
    warnings.push(`${retryObs.retryJobs} jobs in retry`)
  }
  if (lockStale) {
    warnings.push('stale worker lock')
    hasStaleLock = true
  }
  // W144: dirty.unconsumed is a raw queue counter that legitimately
  // stays positive after every job has finished — markers are retained
  // for audit. Only warn when there's actually runnable work; otherwise
  // a long-running project would constantly see a misleading "worker
  // may need to run" hint when the worker has nothing to do.
  // running counts only if the lock is held (otherwise it's a residual
  // record from a crashed worker that died without flipping its row).
  const _runningCount = lockHeld ? jobObs.countsByStatus.running : 0
  const _hasRunnableWork =
    jobObs.countsByStatus.pending > 0 ||
    _runningCount > 0 ||
    retryObs.activeFailedJobs > 0 ||
    retryObs.retryJobs > 0 ||
    retryObs.exhaustedJobs > 0
  if (finalDirtyUnconsumed > 0 && _hasRunnableWork) {
    warnings.push(`${finalDirtyUnconsumed} unconsumed dirty markers with runnable work`)
  }
  if (archiveEvents > 0 && finalDirtyUnconsumed > 0 && _hasRunnableWork) {
    warnings.push('archive has events and runnable jobs are pending — worker may need to run')
  }

  // W120 M1: archive/dirty reconciliation diagnostic. Read-only — this
  // does NOT append markers (only worker run-once does); it just
  // surfaces the gap so trial-report users can see how many events
  // crashed mid-write before the worker repairs them.
  const reconcileReport = await detectArchiveEventsMissingDirty(options).catch(() => ({
    scanWindow: 0,
    scannedEvents: 0,
    coveredEventIds: 0,
    missing: [] as Array<{ eventId: string }>,
  }))
  if (reconcileReport.missing.length > 0) {
    warnings.push(
      `${reconcileReport.missing.length} archive events missing dirty markers (scanWindow=${reconcileReport.scanWindow}) — will repair on next worker run`,
    )
  }

  // Observations
  const obsEntries = await recentObservations({
    ...options,
    limit: 100,
  }).catch(() => [])
  const obsTotal = obsEntries.length
  const obsByScope: Record<string, number> = {}
  const obsByType: Record<string, number> = {}
  const obsByDomain: Record<string, number> = {}

  for (const { observation } of obsEntries) {
    obsByScope[observation.scope] = (obsByScope[observation.scope] ?? 0) + 1
    obsByType[observation.type] = (obsByType[observation.type] ?? 0) + 1
    if (observation.domain) {
      obsByDomain[observation.domain] = (obsByDomain[observation.domain] ?? 0) + 1
    }
  }

  const recentObs: TrialReportObservationRecentItem[] = obsEntries
    .slice(0, 5)
    .map(({ observation }) => ({
      id: observation.observationId,
      scope: observation.scope,
      type: observation.type,
      domain: observation.domain ?? '',
      updatedAt: observation.updatedAt ?? observation.createdAt,
      retrievalPolicy: observation.retrievalPolicy ?? 'auto',
    }))

  if (obsTotal === 0 && archiveEvents === 0) {
    warnings.push('no observations')
  } else if (obsTotal === 0 && archiveEvents > 0) {
    warnings.push('archive has events but no observations generated — classification may not have run or precision gate filtered all candidates')
  }

  // Profiles
  const profileEntries = await recentProfileSnapshots({
    ...options,
    limit: 10,
  }).catch(() => [])
  const latestProfile = profileEntries.length > 0 ? profileEntries[0].profile : null

  if (profileEntries.length === 0) {
    // Not a warning — profiles may not exist yet in trial
  }

  // D: Profile redundancy check — warn if snapshots/events ratio seems high
  if (profileEntries.length > 1 && archiveEvents > 0) {
    const ratio = profileEntries.length / archiveEvents
    if (ratio > 0.8) {
      warnings.push(`profile snapshot redundancy: ${profileEntries.length} snapshots for ${archiveEvents} events (dedup may be needed)`)
    }
  }

  const profileSummary: TrialReportProfileSummary | null = latestProfile
    ? {
        preferences: latestProfile.preferences.length,
        constraints: latestProfile.constraints.length,
        habits: latestProfile.habits.length,
        projectFacts: latestProfile.projectFacts.length,
      }
    : null

  // Proposals
  const proposalEntries = await recentProposals({
    ...options,
    limit: 50,
  }).catch(() => [])

  // Count by status
  const proposalByStatus: Record<string, number> = {}
  for (const { proposal } of proposalEntries) {
    proposalByStatus[proposal.status] = (proposalByStatus[proposal.status] ?? 0) + 1
  }

  const recentProposalItems: TrialReportProposalRecentItem[] = proposalEntries
    .slice(0, 5)
    .map(({ proposal }) => ({
      id: proposal.proposalId,
      type: proposal.type,
      status: proposal.status,
      updatedAt: proposal.updatedAt ?? proposal.createdAt,
    }))

  // Retrieval probe
  let retrievalResults: TrialReportRetrievalItem[] = []
  let retrievalEstimatedTokens = 0
  try {
    const searchResults = await memorySearch({
      ...options,
      query,
      scopeFilter: {
        scope: 'project',
        projectId: options.projectId,
      },
      limit,
    })
    retrievalResults = searchResults.map(r => ({
      id: r.id,
      source: r.source,
      score: Math.round(r.score * 100) / 100,
      scope: r.scope,
      tokenEstimate: r.tokenEstimate,
    }))
    retrievalEstimatedTokens = searchResults.reduce(
      (sum, r) => sum + r.tokenEstimate,
      0,
    )
  } catch {
    // sqlite index may not exist
    warnings.push('sqlite index not available for retrieval probe')
  }

  if (retrievalResults.length === 0 && !warnings.some(w => w.includes('sqlite'))) {
    if (archiveEvents === 0) {
      warnings.push('retrieval probe returned no results — no archive events to search')
    } else {
      warnings.push('retrieval probe returned no results — index may need rebuild')
    }
  }

  // Proposals pending review
  const proposalCandidateCount = proposalByStatus['candidate'] ?? 0
  if (proposalCandidateCount > 0) {
    warnings.push(`${proposalCandidateCount} candidate proposals pending review`)
  }

  // Stale lock follow-up
  if (hasStaleLock) {
    warnings.push('stale lock may indicate a crashed worker — consider manual cleanup if no worker is running')
  }

  return {
    projectId: options.projectId,
    generatedAt,
    paths: {
      root: options.rootDir ?? `${process.env.HOME ?? '.'}/.mossen`,
      memoryDir,
      sqlitePath,
    },
    archive: {
      events: archiveEvents,
      sessions: archiveSessions,
      lastEventAt: archiveLastEvent,
      estimatedTokens: archiveEstimatedTokens,
    },
    worker: {
      lockHeld,
      lockStale,
      dirtyTotal: finalDirtyTotal,
      dirtyConsumed: finalDirtyConsumed,
      dirtyUnconsumed: finalDirtyUnconsumed,
      jobs: {
        total: jobObs.totalJobs,
        pending: jobObs.countsByStatus.pending,
        running: jobObs.countsByStatus.running,
        completed: jobObs.countsByStatus.completed,
        failed: jobObs.countsByStatus.failed,
        skipped: jobObs.countsByStatus.skipped,
        countsByTypeStatus: jobObs.countsByTypeStatus,
      },
      retries: {
        activeFailedJobs: retryObs.activeFailedJobs,
        retryJobs: retryObs.retryJobs,
        exhaustedJobs: retryObs.exhaustedJobs,
        maxRetryAttempt: retryObs.maxRetryAttempt,
      },
      reconcile: {
        scanWindow: reconcileReport.scanWindow,
        scannedEvents: reconcileReport.scannedEvents,
        missing: reconcileReport.missing.length,
      },
    },
    observations: {
      total: obsTotal,
      byScope: obsByScope,
      byType: obsByType,
      byDomain: obsByDomain,
      recent: recentObs,
    },
    profile: {
      snapshots: profileEntries.length,
      latestAt: latestProfile?.generatedAt ?? null,
      latestSummary: profileSummary,
    },
    proposals: {
      total: proposalEntries.length,
      candidate: proposalByStatus['candidate'] ?? 0,
      accepted: proposalByStatus['accepted'] ?? 0,
      rejected: proposalByStatus['rejected'] ?? 0,
      deferred: proposalByStatus['superseded'] ?? 0,
      recent: recentProposalItems,
    },
    retrievalProbe: {
      query,
      limit,
      results: retrievalResults.length,
      estimatedTokens: retrievalEstimatedTokens,
      items: retrievalResults,
    },
    warnings,
  }
}
