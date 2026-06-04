import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import type {
  AgentSupervisorRoster,
  AgentSupervisorRosterJob,
  AgentSupervisorStatus,
} from '../../../services/agentSupervisor/schema.js'
import {
  deriveSupervisorAgentViewItems,
  filterSupervisorAgentViewItems,
  getSupervisorAgentGroupStage,
  getSupervisorAgentPrStatus,
  groupSupervisorAgentViewItems,
  type SupervisorAgentGroupStage,
} from '../agentSupervisorViewModel.js'

function job(
  index: number,
  overrides: Partial<AgentSupervisorRosterJob> = {},
): AgentSupervisorRosterJob {
  return {
    id: `j00000000000${index}` as AgentSupervisorRosterJob['id'],
    title: `job ${index}`,
    cwd: '/tmp',
    status: 'queued',
    lastUpdatedAt: '2026-06-04T06:00:00.000Z',
    lastSummaryLine: null,
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
    updatedAt: '2026-06-04T06:00:00.000Z',
    jobs,
  }
}

describe('getSupervisorAgentGroupStage', () => {
  test('maps statuses to dashboard stages', () => {
    const cases: [AgentSupervisorStatus, SupervisorAgentGroupStage][] = [
      ['needs_input', 'needs_input'],
      ['idle', 'ready_for_review'],
      ['working', 'working'],
      ['queued', 'working'],
      ['completed', 'completed'],
      ['failed', 'stopped_failed'],
      ['stopped', 'stopped_failed'],
    ]
    for (const [status, expected] of cases) {
      expect(getSupervisorAgentGroupStage(status)).toBe(expected)
    }
  })
})

describe('deriveSupervisorAgentViewItems', () => {
  test('sorts pinned rows before ordered/status/date rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mossen-agent-view-model-'))
    try {
      const items = deriveSupervisorAgentViewItems(roster([
        job(1, {
          title: 'completed newer',
          cwd: dir,
          status: 'completed',
          lastUpdatedAt: '2026-06-04T07:00:00.000Z',
        }),
        job(2, {
          title: 'pinned',
          cwd: dir,
          status: 'completed',
          pinned: true,
          order: 10,
        }),
        job(3, {
          title: 'needs input',
          cwd: dir,
          status: 'needs_input',
        }),
      ]))

      expect(items.map(item => item.label)).toEqual([
        'pinned',
        'needs input',
        'completed newer',
      ])
      expect(items.every(item => item.cwdAvailable)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('marks missing cwd in display directory name', () => {
    const items = deriveSupervisorAgentViewItems(roster([
      job(1, { cwd: '/tmp/mossen-definitely-missing-agent-view-test' }),
    ]))
    expect(items[0]?.cwdAvailable).toBe(false)
    expect(items[0]?.directoryName).toContain('(missing)')
  })

  test('carries dashboard metadata and derives row actions', () => {
    const items = deriveSupervisorAgentViewItems(roster([
      job(1, {
        title: 'answer review question',
        status: 'needs_input',
        lastQuestionText: 'Approve deployment?',
        lastQuestionOptionCount: 2,
        model: 'mossen-large',
        permissionMode: 'acceptEdits',
        agent: 'reviewer',
      }),
      job(2, {
        title: 'ship result',
        status: 'completed',
        resultSummary: 'PR #77 ready for review',
        resultArtifactCount: 1,
        resultRiskCount: 1,
        resultNextActionCount: 2,
      }),
      job(3, {
        title: 'running refactor',
        status: 'working',
        model: 'mossen-fast',
      }),
    ]))

    const needsInput = items.find(item => item.label === 'answer review question')!
    expect(needsInput.primaryAction).toMatchObject({
      kind: 'reply',
      shortcut: 'Space',
    })
    expect(needsInput.secondaryAction).toMatchObject({
      kind: 'attach',
      shortcut: 'Enter/→',
    })
    expect(needsInput.statusContext).toBe('blocked_question')
    expect(needsInput.lastQuestionText).toBe('Approve deployment?')
    expect(needsInput.model).toBe('mossen-large')

    const completed = items.find(item => item.label === 'ship result')!
    expect(completed.primaryAction).toMatchObject({
      kind: 'review',
      shortcut: 'Space',
    })
    expect(completed.statusContext).toBe('ready_result')
    expect(completed.resultBadge).toBe('result · 1 artifact · 1 risk · 2 next')

    const working = items.find(item => item.label === 'running refactor')!
    expect(working.primaryAction).toMatchObject({
      kind: 'attach',
      shortcut: 'Enter/→',
    })
    expect(working.secondaryAction).toMatchObject({
      kind: 'peek',
      shortcut: 'Space',
    })
  })
})

describe('filter and grouping helpers', () => {
  test('filters by agent, status alias, cwd, and text', () => {
    const items = deriveSupervisorAgentViewItems(roster([
      job(1, {
        title: 'fix checkout flow',
        cwd: '/tmp/shop',
        status: 'needs_input',
        agent: 'reviewer',
        lastSummaryLine: 'blocked on PR #42',
      }),
      job(2, {
        title: 'update docs',
        cwd: '/tmp/docs',
        status: 'working',
        agent: 'writer',
      }),
    ]))

    expect(filterSupervisorAgentViewItems(items, 'agent:review status:blocked shop checkout')).toHaveLength(1)
    expect(filterSupervisorAgentViewItems(items, '#42')).toHaveLength(1)
    expect(filterSupervisorAgentViewItems(items, 'agent:writer')).toHaveLength(1)
  })

  test('filters by dashboard metadata surfaced from roster rows', () => {
    const items = deriveSupervisorAgentViewItems(roster([
      job(1, {
        title: 'release candidate',
        status: 'completed',
        model: 'mossen-large',
        permissionMode: 'acceptEdits',
        resultSummary: 'release PR is ready',
        resultArtifactCount: 2,
      }),
      job(2, {
        title: 'background cleanup',
        status: 'working',
        model: 'mossen-fast',
      }),
    ]))

    expect(filterSupervisorAgentViewItems(items, 'mossen-large release')).toHaveLength(1)
    expect(filterSupervisorAgentViewItems(items, 'acceptedits')).toHaveLength(1)
    expect(filterSupervisorAgentViewItems(items, 'artifact')).toHaveLength(1)
  })

  test('groups by stage/date/cwd and extracts PR status', () => {
    const now = Date.parse('2026-06-04T08:00:00.000Z')
    const items = deriveSupervisorAgentViewItems(roster([
      job(1, {
        title: 'ship PR #123',
        cwd: '/tmp/project',
        status: 'working',
        lastSummaryLine: 'ready in https://example.test/repo/pull/123',
      }),
    ]))

    const groups = groupSupervisorAgentViewItems(items, now)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.stage).toBe('working')
    expect(groups[0]?.dateBucket).toBe('today')
    expect(getSupervisorAgentPrStatus(items[0]!)).toBe('PR #123')
  })
})
