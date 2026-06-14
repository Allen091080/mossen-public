import { describe, expect, test } from 'bun:test'
import {
  buildPreexistingOneShotTaskNotification,
  shouldConfirmPreexistingOneShotTask,
} from '../cronScheduler.js'
import type { CronTask } from '../cronTasks.js'

function task(overrides: Partial<CronTask> = {}): CronTask {
  return {
    id: 'deadbeef',
    cron: '* * * * *',
    prompt: 'probe normal',
    createdAt: 1_000,
    ...overrides,
  }
}

describe('scheduled task startup safety', () => {
  test('confirms file-backed one-shot tasks created before this process', () => {
    expect(shouldConfirmPreexistingOneShotTask(task(), 2_000)).toBe(true)
  })

  test('does not confirm recurring or current-process tasks', () => {
    expect(
      shouldConfirmPreexistingOneShotTask(task({ recurring: true }), 2_000),
    ).toBe(false)
    expect(shouldConfirmPreexistingOneShotTask(task({ createdAt: 3_000 }), 2_000)).toBe(false)
  })

  test('confirmation prompt tells the model not to execute before user approval', () => {
    const message = buildPreexistingOneShotTaskNotification([
      task({ prompt: 'say probe ok' }),
    ])

    expect(message).toContain('created before this Mossen session')
    expect(message).toContain('Do NOT execute')
    expect(message).toContain('AskUserQuestion')
    expect(message).toContain('say probe ok')
  })
})
