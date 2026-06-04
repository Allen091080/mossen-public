// W435d — Job runner integration test (single empty case).
//
// runPendingMemoryAgentJobs on a project with NO pending jobs should:
//   - process 0 jobs
//   - observation.totalJobs === 0
// This is the only branch testable without full classifier/LLM mocking;
// real job execution (classify_rule, classify_llm, synthesize_profile,
// etc.) requires a live classification pipeline + LLM stub.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { runMemoryAgentJob, runPendingMemoryAgentJobs } from '../jobRunner.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'
import { appendArchiveEvent } from '../../storage/jsonlArchiveStore.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../schema/scope.js'
import type { ArchiveEvent } from '../../schema/archiveEvent.js'
import type { MemoryAgentJob } from '../jobQueue.js'

let fixture: TmpMemoryRoot
const START = '2026-06-02T05:00:00.000Z'

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

describe('runPendingMemoryAgentJobs', () => {
  test('empty project: processes 0 jobs', async () => {
    const projectId = 'proj-jr-empty'
    const result = await runPendingMemoryAgentJobs({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(result.processedJobs).toEqual([])
    expect(result.observation.totalJobs).toBe(0)
  })

  test('classify_llm uses per-job provider before global provider', async () => {
    const projectId = 'proj-jr-per-job-provider'
    const sessionId = 'sess-jr-per-job-provider'
    const event = archiveEvent(projectId, sessionId)
    await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event,
    })

    const result = await runMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      llmProviderConfig: { kind: 'disabled', reason: 'global disabled' },
      llmProviderConfigByJob: {
        classify_llm: {
          kind: 'openai-compatible',
          baseUrl: 'https://memory.example.test/v1',
          model: 'cheap-classifier',
          apiKeyEnv: 'MOSSEN_MISSING_PER_JOB_KEY',
        },
      },
      job: classifyLlmJob(projectId, sessionId, [event.eventId]),
    })

    expect(result.status).toBe('skipped')
    expect(result.result?.providerKind).toBe('openai-compatible')
    expect(result.error).toContain('MOSSEN_MISSING_PER_JOB_KEY')
  })

  test('classify_llm falls back to global provider when per-job provider is absent', async () => {
    const projectId = 'proj-jr-global-provider'
    const sessionId = 'sess-jr-global-provider'
    const event = archiveEvent(projectId, sessionId)
    await appendArchiveEvent({
      rootDir: fixture.rootDir,
      projectId,
      event,
    })

    const result = await runMemoryAgentJob({
      rootDir: fixture.rootDir,
      projectId,
      llmProviderConfig: { kind: 'disabled', reason: 'global disabled' },
      job: classifyLlmJob(projectId, sessionId, [event.eventId]),
    })

    expect(result.status).toBe('skipped')
    expect(result.result?.providerKind).toBe('disabled')
    expect(result.error).toBe('global disabled')
  })
})

function classifyLlmJob(
  projectId: string,
  sessionId: string,
  eventIds: string[],
): MemoryAgentJob {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    jobId: `job-classify-llm-${projectId}`,
    type: 'classify_llm',
    status: 'pending',
    projectId,
    sessionId,
    eventIds,
    createdAt: START,
  }
}

function archiveEvent(projectId: string, sessionId: string): ArchiveEvent {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    eventId: `evt-${projectId}`,
    source: 'mossen',
    sourceEventId: `job-runner:${projectId}`,
    scope: 'project',
    visibility: 'project',
    owner: { projectId, sessionId },
    projectId,
    sessionId,
    role: 'user',
    kind: 'message',
    text: 'Remember that classify_llm should use the cheap sidecar classifier provider.',
    textHash: `sha256:${projectId}`,
    tokenEstimate: 18,
    createdAt: START,
    redaction: { applied: false, version: 1, notes: [] },
  }
}
