// W435d — Memory agent job queue tests.
//
// Mix of pure observers (observeMemoryAgentJobs / observeMemoryAgentJobRetries)
// and IO operations (appendMemoryAgentJob / listMemoryAgentJobs) using the
// shared tmp fixture.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  appendMemoryAgentJob,
  appendMemoryAgentJobStatus,
  getMemoryAgentJobQueuePath,
  listLatestMemoryAgentJobs,
  listMemoryAgentJobs,
  observeMemoryAgentJobs,
  type MemoryAgentJob,
} from '../jobQueue.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

function job(overrides: Partial<MemoryAgentJob> = {}): MemoryAgentJob {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    type: 'index_archive',
    status: 'pending',
    projectId: 'proj-jq',
    eventIds: ['e1'],
    createdAt: '2026-05-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('getMemoryAgentJobQueuePath', () => {
  test('points at agent/jobs.jsonl', () => {
    const p = getMemoryAgentJobQueuePath({ rootDir: '/tmp/x', projectId: 'p1' })
    expect(p).toBe('/tmp/x/projects/p1/memory/agent/jobs.jsonl')
  })
})

describe('appendMemoryAgentJob', () => {
  test('writes JSONL line at expected path', async () => {
    const projectId = 'proj-jq-write'
    const result = await appendMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      job: job({ projectId, jobId: 'jq_1' }),
    })
    expect(result.jobId).toBe('jq_1')
    expect(existsSync(getMemoryAgentJobQueuePath({ rootDir: fixture.rootDir, projectId }))).toBe(true)
  })

  test('rejects malformed job', async () => {
    await expect(
      appendMemoryAgentJob({
        rootDir: fixture.rootDir,
        projectId: 'proj-jq',
        job: { schemaVersion: 1, jobId: 'bad' } as MemoryAgentJob,
      }),
    ).rejects.toThrow(/job must match MemoryAgentJob schema/)
  })

  test('rejects projectId mismatch', async () => {
    await expect(
      appendMemoryAgentJob({
        rootDir: fixture.rootDir,
        projectId: 'proj-a',
        job: job({ projectId: 'proj-b' }),
      }),
    ).rejects.toThrow(/projectId must match/)
  })

  test('rejects unknown job type', async () => {
    await expect(
      appendMemoryAgentJob({
        rootDir: fixture.rootDir,
        projectId: 'proj-jq',
        job: job({ type: 'unknown_type' as MemoryAgentJob['type'] }),
      }),
    ).rejects.toThrow(/job must match MemoryAgentJob schema/)
  })
})

describe('listMemoryAgentJobs + listLatestMemoryAgentJobs', () => {
  test('list returns all appended jobs in file order', async () => {
    const projectId = 'proj-jq-list'
    await appendMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      job: job({ projectId, jobId: 'jq_a', status: 'pending' }),
    })
    await appendMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      job: job({ projectId, jobId: 'jq_b', status: 'pending' }),
    })

    const all = await listMemoryAgentJobs({ rootDir: fixture.rootDir, projectId })
    expect(all.map(j => j.jobId)).toEqual(['jq_a', 'jq_b'])
  })

  test('listLatest keeps only the latest entry per jobId', async () => {
    const projectId = 'proj-jq-latest'
    await appendMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      job: job({ projectId, jobId: 'jq_x', status: 'pending' }),
    })
    await appendMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      job: job({
        projectId,
        jobId: 'jq_x',
        status: 'completed',
        completedAt: '2026-05-19T10:05:00.000Z',
        updatedAt: '2026-05-19T10:05:00.000Z',
      }),
    })

    const latest = await listLatestMemoryAgentJobs({ rootDir: fixture.rootDir, projectId })
    expect(latest.length).toBe(1)
    expect(latest[0]!.status).toBe('completed')
  })

  test('missing file returns []', async () => {
    const all = await listMemoryAgentJobs({
      rootDir: fixture.rootDir,
      projectId: 'proj-jq-missing',
    })
    expect(all).toEqual([])
  })
})

describe('appendMemoryAgentJobStatus', () => {
  test('appends a status update keyed to same jobId', async () => {
    const projectId = 'proj-jq-status'
    const base = job({ projectId, jobId: 'jq_status' })
    await appendMemoryAgentJob({ rootDir: fixture.rootDir, projectId, job: base })

    await appendMemoryAgentJobStatus({
      rootDir: fixture.rootDir,
      projectId,
      job: base,
      status: 'completed',
      durationMs: 1234,
      result: { indexed: 5 },
    })

    const latest = await listLatestMemoryAgentJobs({ rootDir: fixture.rootDir, projectId })
    const target = latest.find(j => j.jobId === 'jq_status')!
    expect(target.status).toBe('completed')
    expect(target.durationMs).toBe(1234)
    expect(target.result).toEqual({ indexed: 5 })
    expect(target.updatedAt).toBeDefined()
  })
})

describe('observeMemoryAgentJobs (pure)', () => {
  test('empty input -> zero counts everywhere', () => {
    const obs = observeMemoryAgentJobs([])
    expect(obs.totalJobs).toBe(0)
    expect(obs.durationsMs.count).toBe(0)
    expect(obs.skippedLlmJobs).toBe(0)
  })

  test('counts by status + type + 2D matrix', () => {
    const jobs: MemoryAgentJob[] = [
      job({ jobId: 'a', type: 'index_archive', status: 'completed', durationMs: 100 }),
      job({ jobId: 'b', type: 'classify_rule', status: 'completed', durationMs: 200 }),
      job({ jobId: 'c', type: 'classify_llm', status: 'skipped' }),
      job({ jobId: 'd', type: 'index_archive', status: 'failed' }),
    ]
    const obs = observeMemoryAgentJobs(jobs)
    expect(obs.totalJobs).toBe(4)
    expect(obs.countsByStatus.completed).toBe(2)
    expect(obs.countsByStatus.failed).toBe(1)
    expect(obs.countsByStatus.skipped).toBe(1)
    expect(obs.countsByType.index_archive).toBe(2)
    expect(obs.countsByType.classify_llm).toBe(1)
    expect(obs.skippedLlmJobs).toBe(1)
    expect(obs.durationsMs.count).toBe(2)
    expect(obs.durationsMs.min).toBe(100)
    expect(obs.durationsMs.max).toBe(200)
    expect(obs.durationsMs.average).toBe(150)
    // 2D matrix
    expect(obs.countsByTypeStatus!.index_archive.completed).toBe(1)
    expect(obs.countsByTypeStatus!.index_archive.failed).toBe(1)
    expect(obs.countsByTypeStatus!.classify_llm.skipped).toBe(1)
  })

  test('latest-by-jobId is used so superseded statuses do not double count', () => {
    const jobs: MemoryAgentJob[] = [
      job({ jobId: 'a', status: 'pending' }),
      job({ jobId: 'a', status: 'running', updatedAt: '2026-05-19T10:02:00.000Z' }),
      job({ jobId: 'a', status: 'completed', updatedAt: '2026-05-19T10:05:00.000Z' }),
    ]
    const obs = observeMemoryAgentJobs(jobs)
    expect(obs.totalJobs).toBe(1)
    expect(obs.countsByStatus.completed).toBe(1)
    expect(obs.countsByStatus.pending).toBe(0)
    expect(obs.countsByStatus.running).toBe(0)
  })
})
