import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isUltracodeActive,
  setUltracodeActive,
} from '../../../bootstrap/state.js'
import { WORKFLOW_DISABLE_ENV } from '../../../utils/workflowAvailability.js'
import { executeEffort } from '../effort.js'

describe('/effort ultracode', () => {
  beforeEach(() => {
    delete process.env[WORKFLOW_DISABLE_ENV]
    setUltracodeActive(false)
  })

  afterEach(() => {
    delete process.env[WORKFLOW_DISABLE_ENV]
    setUltracodeActive(false)
  })

  test('turns on standing workflow orchestration and keeps effort session-only', () => {
    const result = executeEffort('ultracode')
    expect(result.effortUpdate?.value).toBe('ultracode')
    expect(isUltracodeActive()).toBe(true)
    expect(result.message).toContain('ultracode')
  })

  test('does not enable ultracode when workflows are disabled', () => {
    process.env[WORKFLOW_DISABLE_ENV] = '1'
    const result = executeEffort('ultracode')
    expect(result.effortUpdate).toBeUndefined()
    expect(isUltracodeActive()).toBe(false)
    expect(result.message).toContain('Workflow')
  })
})
