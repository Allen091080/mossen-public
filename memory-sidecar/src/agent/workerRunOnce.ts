import type { MemoryRootOptions } from '../index.js'
import {
  appendDirtyCheckpoint,
  listUnconsumedDirtyMarkers,
} from './dirtyQueue.js'
import {
  appendMemoryAgentJob,
  listMemoryAgentJobs,
  observeMemoryAgentJobs,
  type MemoryAgentJob,
  type MemoryAgentJobObservation,
} from './jobQueue.js'
import { runPendingMemoryAgentJobs, type MemoryAgentJobRunResult } from './jobRunner.js'
import {
  repairMissingDirtyMarkers,
  type ArchiveDirtyReconcileReport,
} from './reconcile.js'

export type MemoryAgentRunOnceResult = {
  dirtyMarkers: number
  existingJobs: number
  enqueuedJobs: MemoryAgentJob[]
  skippedLlmJobs: number
  processedJobs: MemoryAgentJobRunResult[]
  observation: MemoryAgentJobObservation
  // W120 M1: archive/dirty reconciliation pass executed before the
  // worker drains its queue. `repairedMarkers` counts markers that the
  // worker had to re-emit because the original ingest never reached
  // dirtyQueue. `report.scanWindow` is exposed so tests / trial-report
  // can confirm the default 200 is in effect.
  reconcile: ArchiveDirtyReconcileReport
  repairedMarkers: number
}

export async function runMemoryAgentOnce(
  options: MemoryRootOptions,
): Promise<MemoryAgentRunOnceResult> {
  // W120 M1: scan recent archive events and repair any that are missing
  // a dirty marker BEFORE the worker reads its queue. Without this,
  // events lost to a mid-write crash would never be classified.
  const repair = await repairMissingDirtyMarkers(options).catch(error => ({
    report: {
      scanWindow: 0,
      scannedEvents: 0,
      coveredEventIds: 0,
      missing: [],
    },
    appendedMarkers: [],
    error,
  }))

  const dirtyMarkers = await listUnconsumedDirtyMarkers(options)
  const existingJobs = await listMemoryAgentJobs(options)
  const existingKeys = new Set(existingJobs.map(jobKey))
  const enqueuedJobs: MemoryAgentJob[] = []

  for (const marker of dirtyMarkers) {
    for (const type of [
      'index_archive',
      'classify_rule',
      'classify_llm',
      'synthesize_profile',
      'detect_proposals',
    ] as const) {
      const job: MemoryAgentJob = {
        schemaVersion: 1,
        jobId: `job_${type}_${marker.dirtyId}`,
        type,
        status: 'pending',
        projectId: marker.projectId,
        sessionId: marker.sessionId,
        eventIds: marker.eventIds,
        createdAt: new Date().toISOString(),
      }
      const key = jobKey(job)
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      enqueuedJobs.push(await appendMemoryAgentJob({ ...options, job }))
    }
  }

  const { processedJobs } = await runPendingMemoryAgentJobs(options)
  const jobsAfterRun = await listMemoryAgentJobs(options)
  const observation = observeMemoryAgentJobs(jobsAfterRun)
  const processedJobIds = new Set(processedJobs.map(result => result.job.jobId))

  for (const marker of dirtyMarkers) {
    const expectedJobIds = [
      'index_archive',
      'classify_rule',
      'classify_llm',
      'synthesize_profile',
      'detect_proposals',
    ].map(type => `job_${type}_${marker.dirtyId}`)
    if (!expectedJobIds.every(jobId => processedJobIds.has(jobId))) continue
    await appendDirtyCheckpoint({
      ...options,
      checkpoint: {
        schemaVersion: 1,
        dirtyId: marker.dirtyId,
        projectId: marker.projectId,
        consumedAt: new Date().toISOString(),
        reason: 'worker_completed',
      },
    })
  }

  return {
    dirtyMarkers: dirtyMarkers.length,
    existingJobs: existingJobs.length,
    enqueuedJobs,
    skippedLlmJobs: observation.skippedLlmJobs,
    processedJobs,
    observation,
    reconcile: repair.report,
    repairedMarkers: repair.appendedMarkers.length,
  }
}

function jobKey(job: MemoryAgentJob): string {
  return [
    job.type,
    job.projectId,
    job.sessionId ?? '',
    ...job.eventIds.slice().sort(),
  ].join('\u001f')
}
