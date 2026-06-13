import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, test } from 'bun:test'
import type {
  AgentSupervisorRoster,
  AgentSupervisorRosterJob,
} from '../../../services/agentSupervisor/schema.js'
import {
  AGENT_VIEW_STAGE_ORDER,
  agentViewRowsToJson,
  buildAgentViewSnapshot,
  formatAgentViewCounts,
  getAgentViewMachineState,
  getAgentViewStage,
} from '../agentViewModel.js'

function job(
  id: string,
  overrides: Partial<AgentSupervisorRosterJob> = {},
): AgentSupervisorRosterJob {
  return {
    id,
    title: id,
    cwd: '/tmp',
    status: 'queued',
    lastUpdatedAt: '2026-06-09T08:00:00.000Z',
    lastSummaryLine: null,
    promptPreview: null,
    pinned: false,
    order: 0,
    collapsed: false,
    agent: null,
    processAlive: false,
    ...overrides,
  }
}

function roster(jobs: AgentSupervisorRosterJob[]): AgentSupervisorRoster {
  return {
    schemaVersion: 1,
    updatedAt: '2026-06-09T08:00:00.000Z',
    jobs,
  }
}

describe('getAgentViewStage', () => {
  test('collapses supervisor statuses into user-facing decisions', () => {
    expect(AGENT_VIEW_STAGE_ORDER).toEqual([
      'needs_input',
      'working',
      'ready_for_review',
      'completed',
      'stopped_failed',
    ])
    expect(getAgentViewStage(job('needs', { status: 'needs_input' }))).toBe(
      'needs_input',
    )
    expect(getAgentViewStage(job('queued', { status: 'queued' }))).toBe(
      'working',
    )
    expect(getAgentViewStage(job('idle', { status: 'idle' }))).toBe('working')
    expect(
      getAgentViewStage(
        job('ready', { status: 'completed', resultSummary: 'PR #77 ready' }),
      ),
    ).toBe('ready_for_review')
    expect(getAgentViewStage(job('done', { status: 'completed' }))).toBe(
      'completed',
    )
    expect(getAgentViewStage(job('failed', { status: 'failed' }))).toBe(
      'stopped_failed',
    )
    expect(
      getAgentViewMachineState(
        job('dead-working', { status: 'working', processAlive: false }),
      ),
    ).toBe('stale')
    expect(
      getAgentViewMachineState(
        job('live-working', { status: 'working', processAlive: true }),
      ),
    ).toBe('working')
  })
})

describe('buildAgentViewSnapshot', () => {
  test('filters by cwd and sorts by user-facing stage before pinned state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mossen-agent-view-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'mossen-agent-view-outside-'))
    try {
      const snapshot = await buildAgentViewSnapshot(
        roster([
          job('ready', {
            cwd: root,
            status: 'completed',
            resultSummary: 'PR #12 ready',
            pinned: true,
          }),
          job('needs', {
            cwd: root,
            status: 'needs_input',
            lastQuestionText: 'Approve the migration?',
            lastQuestionOptionCount: 2,
          }),
          job('working', { cwd: join(root, 'packages/app'), status: 'working' }),
          job('workflow-child', {
            cwd: root,
            status: 'working',
            parentWorkflowId: 'wf_snapshot',
            parentGoalId: 'goal_snapshot',
          }),
          job('done', { cwd: root, status: 'completed' }),
          job('failed', { cwd: root, status: 'failed' }),
          job('outside', { cwd: outside, status: 'needs_input' }),
        ]),
        {
          cwd: root,
          dispatchDefaults: { model: 'mossen-fast', permissionMode: 'acceptEdits' },
          generatedAt: '2026-06-09T09:00:00.000Z',
        },
      )

      expect(snapshot.rows.map(row => row.id)).toEqual([
        'needs',
        'working',
        'workflow-child',
        'ready',
        'done',
        'failed',
      ])
      expect(
        snapshot.rows.find(row => row.id === 'workflow-child'),
      ).toMatchObject({
        parentWorkflowId: 'wf_snapshot',
        parentGoalId: 'goal_snapshot',
      })
      expect(snapshot.counts).toMatchObject({
        awaitingInput: 1,
        working: 2,
        readyForReview: 1,
        completed: 1,
        stoppedFailed: 1,
        total: 6,
      })
      expect(formatAgentViewCounts(snapshot.counts)).toBe(
        '1 awaiting input · 2 working · 2 completed',
      )
      expect(snapshot.groups.map(group => group.stage)).toEqual([
        'needs_input',
        'working',
        'ready_for_review',
        'completed',
        'stopped_failed',
      ])
      expect(snapshot.dispatchDefaults.model).toBe('mossen-fast')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('can include jobs outside cwd for machine protocol callers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mossen-agent-view-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'mossen-agent-view-outside-'))
    try {
      const filtered = await buildAgentViewSnapshot(
        roster([
          job('inside', { cwd: root }),
          job('outside', { cwd: outside }),
        ]),
        { cwd: root, generatedAt: '2026-06-09T09:00:00.000Z' },
      )
      const all = await buildAgentViewSnapshot(
        roster([
          job('inside', { cwd: root }),
          job('outside', { cwd: outside }),
        ]),
        {
          cwd: root,
          generatedAt: '2026-06-09T09:00:00.000Z',
          includeAllCwds: true,
        },
      )

      expect(filtered.rows.map(row => row.id)).toEqual(['inside'])
      expect(all.rows.map(row => row.id).sort()).toEqual(['inside', 'outside'])
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('projects JSON rows as the stable workbench protocol', () => {
    const rows = agentViewRowsToJson([
      {
        id: 'needs',
        kind: 'supervisor_agent',
        state: 'needs_input',
        statusContext: 'needs_input',
        title: 'answer question',
        status: 'needs_input',
        stage: 'needs_input',
        cwd: '/repo',
        branch: 'main',
        model: 'mossen-fast',
        provider: null,
        profile: null,
        permissionMode: 'acceptEdits',
        effort: null,
        agent: 'reviewer',
        processAlive: true,
        sessionId: 'session-1',
        parentWorkflowId: 'wf_parent_1',
        parentGoalId: 'goal_parent_1',
        pinned: false,
        order: 0,
        promptSummary: 'private prompt text',
        promptPreview: 'private prompt text',
        lastActivity: null,
        createdAt: '2026-06-09T08:59:00.000Z',
        lastHeartbeatAt: null,
        lastStartedAt: '2026-06-09T08:59:10.000Z',
        lastExitedAt: null,
        exitCode: null,
        signal: null,
        error: null,
        lastQuestion: {
          text: 'private blocker text',
          optionCount: 2,
          suggestedReply: null,
        },
        result: {
          summary: null,
          artifacts: [],
          artifactCount: 0,
          riskCount: 0,
          nextActionCount: 0,
        },
        tokenUsage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
        worktree: {
          path: '/repo/.worktrees/needs',
          branch: 'main',
          baseRepo: '/repo',
          dirty: false,
          cleanupEligible: true,
          cleanupState: 'eligible',
          ownedByMossen: true,
          isolationReason: null,
        },
        primaryAction: { kind: 'reply', label: 'reply', shortcut: 'r' },
        secondaryActions: [],
        updatedAt: '2026-06-09T09:00:00.000Z',
      },
    ])

    expect(rows).toEqual([
      {
        id: 'needs',
        kind: 'supervisor_agent',
        state: 'needs_input',
        statusContext: 'needs_input',
        title: 'answer question',
        status: 'needs_input',
        stage: 'needs_input',
        cwd: '/repo',
        branch: 'main',
        model: 'mossen-fast',
        provider: null,
        profile: null,
        permissionMode: 'acceptEdits',
        effort: null,
        agent: 'reviewer',
        processAlive: true,
        sessionId: 'session-1',
        parentWorkflowId: 'wf_parent_1',
        parentGoalId: 'goal_parent_1',
        pinned: false,
        promptSummary: 'private prompt text',
        question: {
          text: 'private blocker text',
          optionCount: 2,
          suggestedReply: null,
        },
        worktree: {
          path: '/repo/.worktrees/needs',
          branch: 'main',
          dirty: false,
          cleanupEligible: true,
        },
        result: {
          summary: null,
          artifacts: [],
          artifactCount: 0,
          riskCount: 0,
          nextActionCount: 0,
        },
        resultSummary: null,
        artifacts: [],
        error: null,
        exitCode: null,
        signal: null,
        tokenUsage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
        createdAt: '2026-06-09T08:59:00.000Z',
        updatedAt: '2026-06-09T09:00:00.000Z',
        lastHeartbeatAt: null,
        lastStartedAt: '2026-06-09T08:59:10.000Z',
        lastExitedAt: null,
      },
    ])
  })
})
