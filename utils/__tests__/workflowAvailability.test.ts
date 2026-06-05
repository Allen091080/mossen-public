import { afterEach, describe, expect, test } from 'bun:test'
import {
  UPSTREAM_WORKFLOW_DISABLE_ENV,
  WORKFLOW_DISABLE_ENV,
  WORKFLOW_ENABLE_ENV,
  isWorkflowKeywordTriggerEnabled,
  isWorkflowRuntimeEnabled,
} from '../workflowAvailability.js'

function clearWorkflowEnv(): void {
  delete process.env[UPSTREAM_WORKFLOW_DISABLE_ENV]
  delete process.env[WORKFLOW_DISABLE_ENV]
  delete process.env[WORKFLOW_ENABLE_ENV]
}

describe('workflowAvailability', () => {
  afterEach(() => {
    clearWorkflowEnv()
  })

  test('defaults to enabled when no runtime setting is present', () => {
    expect(isWorkflowRuntimeEnabled({})).toBe(true)
  })

  test('disableWorkflows setting turns workflows off', () => {
    expect(isWorkflowRuntimeEnabled({ disableWorkflows: true })).toBe(false)
  })

  test('enableWorkflows setting can explicitly turn workflows off', () => {
    expect(isWorkflowRuntimeEnabled({ enableWorkflows: false })).toBe(false)
  })

  test('env disable has highest precedence', () => {
    process.env[WORKFLOW_DISABLE_ENV] = '1'
    process.env[WORKFLOW_ENABLE_ENV] = '1'
    expect(isWorkflowRuntimeEnabled({ enableWorkflows: true })).toBe(false)
  })

  test('upstream-compatible env disable has highest precedence', () => {
    process.env[UPSTREAM_WORKFLOW_DISABLE_ENV] = '1'
    process.env[WORKFLOW_ENABLE_ENV] = '1'
    expect(isWorkflowRuntimeEnabled({ enableWorkflows: true })).toBe(false)
  })

  test('env enable overrides settings disable', () => {
    process.env[WORKFLOW_ENABLE_ENV] = '1'
    expect(isWorkflowRuntimeEnabled({ disableWorkflows: true })).toBe(true)
  })

  test('keyword trigger can be disabled independently', () => {
    expect(
      isWorkflowKeywordTriggerEnabled({
        workflowKeywordTriggerEnabled: false,
      }),
    ).toBe(false)
  })
})
