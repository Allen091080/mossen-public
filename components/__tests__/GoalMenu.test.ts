import { describe, expect, test } from 'bun:test'
import {
  buildGoalMenuItems,
  filterGoalMenuItems,
} from '../GoalMenu.js'
import type { MossenGoalState } from '../../bootstrap/state.js'

function goal(overrides: Partial<MossenGoalState> = {}): MossenGoalState {
  return {
    id: 'goal_menu_test',
    text: 'ship the goal menu',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    evaluatorModel: 'haiku',
    turnBudget: 20,
    turnCount: 2,
    recentEvidence: [],
    negativeEvidence: [],
    blockerHistory: [],
    evaluationFailureCount: 0,
    status: 'active',
    ...overrides,
  }
}

describe('buildGoalMenuItems', () => {
  test('active goals expose operational command shortcuts', () => {
    const items = buildGoalMenuItems(goal(), false)
    const ids = items.map(item => item.id)

    expect(ids).toContain('status')
    expect(ids).toContain('why')
    expect(ids).toContain('show-overlay')
    expect(ids).toContain('pause')
    expect(ids).toContain('done')
    expect(ids).toContain('clear')
    expect(items.find(item => item.id === 'done')?.command).toBe('/goal done')
  })

  test('paused and blocked goals expose resume instead of done', () => {
    for (const status of ['paused', 'blocked', 'budget_limited'] as const) {
      const ids = buildGoalMenuItems(goal({ status }), true).map(item => item.id)
      expect(ids).toContain('resume')
      expect(ids).not.toContain('done')
    }
  })

  test('overlay item reflects current visibility', () => {
    expect(buildGoalMenuItems(goal(), false).map(item => item.id)).toContain('show-overlay')
    expect(buildGoalMenuItems(goal(), true).map(item => item.id)).toContain('hide-overlay')
  })
})

describe('filterGoalMenuItems', () => {
  test('matches labels, keywords, and slash commands', () => {
    const items = buildGoalMenuItems(goal(), false)

    expect(filterGoalMenuItems(items, 'resume')).toHaveLength(0)
    expect(filterGoalMenuItems(items, 'done').map(item => item.id)).toEqual(['done'])
    expect(filterGoalMenuItems(items, '/goal why').map(item => item.id)).toEqual(['why'])
    expect(filterGoalMenuItems(items, '预算').map(item => item.id)).toEqual(['budget'])
  })
})
