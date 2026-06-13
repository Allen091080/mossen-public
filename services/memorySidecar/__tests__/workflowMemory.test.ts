import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  createDefaultMemorySidecarConfig,
  projectIdFromCwd,
  type Observation,
  type Proposal,
} from '../../../memory-sidecar/src/index.js'
import {
  initRunArtifacts,
  workflowReportPath,
} from '../../../tools/WorkflowTool/engine/journalStore.js'
import { workflowRunToJson } from '../../../commands/workflows/workflowProgressTree.js'
import {
  buildWorkflowMemoryCandidate,
  captureWorkflowRunMemoryCandidate,
} from '../workflowMemory.js'

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as T)
}

function writeSidecarConfig(rootDir: string, enabled: boolean): void {
  mkdirSync(rootDir, { recursive: true })
  const config = createDefaultMemorySidecarConfig({
    ...process.env,
    MOSSEN_MEMORY_SIDECAR_HOME: rootDir,
  })
  config.enabled = enabled
  writeFileSync(join(rootDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

describe('workflow memory capture', () => {
  test('builds a redacted candidate without progress-log noise', () => {
    const run = workflowRunToJson({
      runId: 'wf_memory_candidate',
      workflowName: 'memory-flow',
      description: 'Remember reusable workflow shape, not transient logs.',
      phases: [{ title: 'Audit' }, { title: 'Verify' }],
      scriptPath: '/repo/.mossen/workflows/memory-flow.js',
      transcriptDir: '/repo/.mossen/subagents',
      parentGoalId: 'goal_memory_candidate',
      createdAt: new Date(0).toISOString(),
      status: 'completed',
      agentCount: 2,
      totalToolCalls: 4,
      tokensSpent: 123,
      result: JSON.stringify({
        summary: 'Reusable audit workflow passed.',
        verification: {
          commands: ['bun test services/memorySidecar/__tests__/workflowMemory.test.ts'],
          evidence: ['No unresolved failures remain. api_key=test-secret-value'],
          artifacts: ['./reports/workflow-memory.md'],
        },
        log: 'phase: noisy progress line should not be copied',
      }),
    })

    const candidate = buildWorkflowMemoryCandidate({
      run,
      projectId: 'project-memory-candidate',
      sessionId: 'session-memory-candidate',
      createdAt: new Date(0).toISOString(),
    })

    expect(candidate).not.toBeNull()
    expect(candidate?.observation.type).toBe('workflow_pattern')
    expect(candidate?.observation.lifecycle).toBe('candidate')
    expect(candidate?.observation.retrievalPolicy).toBe('candidate_only')
    expect(candidate?.proposal.type).toBe('workflow')
    expect(candidate?.proposal.status).toBe('candidate')
    expect(candidate?.observation.summary).toContain('[REDACTED_SECRET]')
    expect(candidate?.observation.summary).toContain('Parent goal: goal_memory_candidate')
    expect(candidate?.observation.summary).toContain('bun test services/memorySidecar')
    expect(candidate?.observation.summary).not.toContain('noisy progress line')
    expect(candidate?.observation.tags).toContain('goal:goal_memory_candidate')
    expect(candidate?.observation.evidenceIds).toContain('goal:goal_memory_candidate')
    expect(candidate?.proposal.evidenceEventIds).toContain('goal:goal_memory_candidate')
    expect(candidate?.observation.files).toContain(workflowReportPath(run.runId))
  })

  test('captures terminal workflow memory only when sidecar is enabled', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorSidecarHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME
    const root = mkdtempSync(join(tmpdir(), 'wf-memory-capture-'))
    const sidecarRoot = join(root, 'memory-sidecar')
    const sessionId =
      '99999999-9999-4999-8999-999999999999' as ReturnType<typeof getSessionId>

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = sidecarRoot
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_memory_capture'
      initRunArtifacts(
        runId,
        'return "memory"',
        {
          runId,
          workflowName: 'capture-flow',
          description: 'Capture useful workflow result',
          phases: [{ title: 'Plan' }, { title: 'Verify' }],
          scriptPath: '/repo/workflow.js',
          parentGoalId: 'goal_memory_capture',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          result: JSON.stringify({
            verification: {
              commands: ['bun test memory'],
              evidence: ['Workflow capture passed.'],
            },
          }),
        },
      )

      writeSidecarConfig(sidecarRoot, false)
      expect(
        await captureWorkflowRunMemoryCandidate({
          runId,
          cwd: root,
          sessionId,
        }),
      ).toMatchObject({ ok: false, reason: 'sidecar_disabled' })

      writeSidecarConfig(sidecarRoot, true)
      const captured = await captureWorkflowRunMemoryCandidate({
        runId,
        cwd: root,
        sessionId,
      })
      expect(captured.ok).toBe(true)
      if (!captured.ok) throw new Error('expected workflow memory capture')

      const projectId = projectIdFromCwd(root)
      const memoryDir = join(sidecarRoot, 'projects', projectId, 'memory')
      const observations = readJsonl<Observation>(join(memoryDir, 'observations.jsonl'))
      const proposals = readJsonl<Proposal>(join(memoryDir, 'proposals.jsonl'))
      expect(observations.at(-1)).toMatchObject({
        scope: 'project',
        projectId,
        type: 'workflow_pattern',
        lifecycle: 'candidate',
        retrievalPolicy: 'candidate_only',
        promotionStatus: 'candidate',
        tags: expect.arrayContaining(['goal:goal_memory_capture']),
        evidenceIds: expect.arrayContaining(['goal:goal_memory_capture']),
      })
      expect(observations.at(-1)?.summary).toContain('Workflow capture passed.')
      expect(proposals.at(-1)).toMatchObject({
        projectId,
        type: 'workflow',
        status: 'candidate',
        evidenceEventIds: expect.arrayContaining(['goal:goal_memory_capture']),
      })
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorSidecarHome === undefined) {
        delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      } else {
        process.env.MOSSEN_MEMORY_SIDECAR_HOME = priorSidecarHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
