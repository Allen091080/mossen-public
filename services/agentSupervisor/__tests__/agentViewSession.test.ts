import { describe, expect, test } from 'bun:test'
import {
  requestAgentViewAttach,
  requestAgentViewExit,
  waitForAgentViewSessionEvent,
} from '../agentViewSession.js'

async function withTimeout<T>(promise: Promise<T>, ms = 500): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    }),
  ])
}

describe('agentViewSession event bridge', () => {
  test('resolves attach requests for the shell-side loop', async () => {
    const pending = waitForAgentViewSessionEvent()
    requestAgentViewAttach({
      jobId: 'j123456789abc',
      socketPath: '/tmp/mossen-agent.sock',
    })

    await expect(withTimeout(pending)).resolves.toEqual({
      kind: 'attach',
      req: {
        jobId: 'j123456789abc',
        socketPath: '/tmp/mossen-agent.sock',
      },
    })
  })

  test('resolves exit requests once', async () => {
    const pending = waitForAgentViewSessionEvent()
    requestAgentViewExit()

    await expect(withTimeout(pending)).resolves.toEqual({ kind: 'exit' })
  })
})
