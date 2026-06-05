import { describe, expect, test } from 'bun:test'
import {
  canPauseWorkflowDetail,
  canResumeWorkflowDetail,
  canStopWorkflowDetail,
} from '../WorkflowDetailDialog.js'

describe('WorkflowDetailDialog controls', () => {
  test('running workflows can pause and stop', () => {
    const workflow = { status: 'running' as const, paused: false }

    expect(canPauseWorkflowDetail(workflow)).toBe(true)
    expect(canResumeWorkflowDetail(workflow)).toBe(false)
    expect(canStopWorkflowDetail(workflow)).toBe(true)
  })

  test('paused workflows can resume and stop from the task panel', () => {
    const workflow = { status: 'paused' as const, paused: true }

    expect(canPauseWorkflowDetail(workflow)).toBe(false)
    expect(canResumeWorkflowDetail(workflow)).toBe(true)
    expect(canStopWorkflowDetail(workflow)).toBe(true)
  })

  test('completed workflows are read-only in the detail panel', () => {
    const workflow = { status: 'completed' as const, paused: false }

    expect(canPauseWorkflowDetail(workflow)).toBe(false)
    expect(canResumeWorkflowDetail(workflow)).toBe(false)
    expect(canStopWorkflowDetail(workflow)).toBe(false)
  })
})
