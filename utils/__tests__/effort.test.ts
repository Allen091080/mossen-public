import { describe, expect, test } from 'bun:test'
import {
  convertEffortValueToLevel,
  getEffortValueDescription,
  isEffortLevel,
  resolveAppliedEffort,
  toPersistableEffort,
} from '../effort.js'

describe('effort levels', () => {
  test('recognizes xhigh as a first-class effort level', () => {
    expect(isEffortLevel('xhigh')).toBe(true)
    expect(toPersistableEffort('xhigh')).toBe('xhigh')
  })

  test('keeps ultracode session-only and displays it as xhigh', () => {
    expect(toPersistableEffort('ultracode')).toBeUndefined()
    expect(convertEffortValueToLevel('ultracode')).toBe('xhigh')
    expect(getEffortValueDescription('ultracode')).toContain('Workflow')
  })

  test('resolves ultracode to xhigh for xhigh-capable models', () => {
    expect(resolveAppliedEffort('opus-4-6', 'ultracode')).toBe('xhigh')
  })
})
