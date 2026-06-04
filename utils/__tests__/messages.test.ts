import { describe, expect, test } from 'bun:test'
import { createTurnDurationMessage } from '../messages.js'

describe('createTurnDurationMessage', () => {
  test('persists pending workflow count when workflow tasks remain active', () => {
    const message = createTurnDurationMessage(
      45_000,
      { tokens: 1200, limit: 1000, nudges: 1 },
      7,
      2,
    )

    expect(message.subtype).toBe('turn_duration')
    expect(message.durationMs).toBe(45_000)
    expect(message.messageCount).toBe(7)
    expect(message.pendingWorkflowCount).toBe(2)
  })

  test('omits pending workflow count when no workflow tasks remain active', () => {
    const message = createTurnDurationMessage(45_000, undefined, 7, 0)

    expect(message.pendingWorkflowCount).toBeUndefined()
  })
})
