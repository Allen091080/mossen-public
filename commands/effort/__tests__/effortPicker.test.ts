import { describe, expect, test } from 'bun:test'
import { getEffortPickerChoices } from '../EffortPicker.js'

describe('/effort picker choices', () => {
  test('offers ultracode only when workflows are enabled and the model supports xhigh', () => {
    expect(
      getEffortPickerChoices({ supportsMax: true, workflowsEnabled: true }),
    ).toContain('ultracode')
    expect(
      getEffortPickerChoices({ supportsMax: true, workflowsEnabled: false }),
    ).not.toContain('ultracode')
    expect(
      getEffortPickerChoices({ supportsMax: false, workflowsEnabled: true }),
    ).not.toContain('ultracode')
  })

  test('keeps standard effort levels available when ultracode is hidden', () => {
    expect(
      getEffortPickerChoices({ supportsMax: false, workflowsEnabled: false }),
    ).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})
