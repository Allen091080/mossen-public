// W435e — runMemoryAgentOnce empty-project happy path.
//
// Full pipeline test (with dirty markers + jobs flowing through classify_*
// + synthesize_profile + detect_proposals) requires a live classifier and
// LLM stub; covered indirectly by harness smokes. Here we lock the
// "no dirty markers -> no enqueued jobs + empty observation" contract.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { runMemoryAgentOnce } from '../workerRunOnce.js'
import { createTmpMemoryRoot, type TmpMemoryRoot } from '../../__tests__/_fixtures/tmpRoot.js'

let fixture: TmpMemoryRoot

beforeAll(async () => {
  fixture = await createTmpMemoryRoot()
})

afterAll(async () => {
  await fixture.cleanup()
})

describe('runMemoryAgentOnce', () => {
  test('empty project: enqueues 0 jobs, observation reports 0 total', async () => {
    const projectId = 'proj-runonce-empty'
    const result = await runMemoryAgentOnce({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(result.enqueuedJobs.length).toBe(0)
    expect(result.processedJobs.length).toBe(0)
    expect(result.observation.totalJobs).toBe(0)
    expect(result.dirtyMarkers).toBe(0)
    expect(result.existingJobs).toBe(0)
    expect(result.skippedLlmJobs).toBe(0)
  })

  test('reconcile report is included in result (W120 M1)', async () => {
    const projectId = 'proj-runonce-reconcile'
    const result = await runMemoryAgentOnce({
      rootDir: fixture.rootDir,
      projectId,
    })
    expect(result.reconcile).toBeDefined()
    expect(typeof result.reconcile.scannedEvents).toBe('number')
    expect(typeof result.repairedMarkers).toBe('number')
  })
})
