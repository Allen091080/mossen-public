import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  attachAgentSupervisorJob,
  formatAgentSupervisorLogs,
  stopAgentSupervisorJob,
} from '../management.js'
import { readAgentSupervisorRoster, upsertAgentSupervisorRosterJob } from '../roster.js'
import { createInitialAgentSupervisorJobState } from '../schema.js'
import {
  readAgentSupervisorJobState,
  writeAgentSupervisorJobState,
} from '../state.js'

async function withTempConfig<T>(fn: (configDir: string) => Promise<T>): Promise<T> {
  const previousConfigDir = process.env.MOSSEN_CONFIG_DIR
  const configDir = mkdtempSync(join(tmpdir(), 'mossen-agent-management-'))
  process.env.MOSSEN_CONFIG_DIR = configDir
  try {
    return await fn(configDir)
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.MOSSEN_CONFIG_DIR
    } else {
      process.env.MOSSEN_CONFIG_DIR = previousConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
  }
}

function captureStderr(chunks: string[]): typeof process.stderr.write {
  return ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    chunks.push(String(chunk ?? ''))
    if (typeof encodingOrCallback === 'function') encodingOrCallback()
    if (typeof callback === 'function') callback()
    return true
  }) as typeof process.stderr.write
}

describe('agent supervisor terminal job management', () => {
  test('keeps failed jobs failed and reports signal diagnostics', async () => {
    await withTempConfig(async configDir => {
      const state = createInitialAgentSupervisorJobState({
        id: 'jfailed0001',
        title: 'failed user task',
        cwd: configDir,
        promptPreview: 'failed user task',
        now: '2026-06-14T00:00:00.000Z',
      })
      state.status = 'failed'
      state.process.alive = false
      state.process.exitCode = 0
      state.process.signal = 'SIGKILL'
      state.process.lastExitedAt = '2026-06-14T00:01:00.000Z'
      state.errors.push({
        ts: '2026-06-14T00:01:00.000Z',
        source: 'test',
        message: 'Worker killed by test.',
      })

      await writeAgentSupervisorJobState(state)
      await upsertAgentSupervisorRosterJob(state)

      const stopMessage = await stopAgentSupervisorJob(state.id)
      const next = await readAgentSupervisorJobState(state.id)
      const logs = await formatAgentSupervisorLogs(state.id)
      const roster = await readAgentSupervisorRoster()
      const rosterJob = roster.jobs.find(job => job.id === state.id)

      expect(stopMessage).toContain('already failed')
      expect(stopMessage).toContain('signal=SIGKILL')
      expect(next?.status).toBe('failed')
      expect(logs).toContain('[status] failed')
      expect(logs).toContain('signal=SIGKILL')
      expect(logs).toContain('Worker killed by test.')
      expect(rosterJob?.exitCode).toBeNull()
      expect(rosterJob?.signal).toBe('SIGKILL')
    })
  })

  test('attach explains terminal failed jobs without a session', async () => {
    await withTempConfig(async configDir => {
      const state = createInitialAgentSupervisorJobState({
        id: 'jfailed0002',
        title: 'failed attach task',
        cwd: configDir,
        promptPreview: 'failed attach task',
        now: '2026-06-14T00:00:00.000Z',
      })
      state.status = 'failed'
      state.process.alive = false
      state.process.exitCode = 0
      state.process.signal = 'SIGKILL'
      await writeAgentSupervisorJobState(state)

      const stderr: string[] = []
      const priorWrite = process.stderr.write
      try {
        process.stderr.write = captureStderr(stderr)
        const code = await attachAgentSupervisorJob(state.id)
        expect(code).toBe(1)
      } finally {
        process.stderr.write = priorWrite
      }

      const message = stderr.join('')
      expect(message).toContain('failed')
      expect(message).toContain('signal=SIGKILL')
      expect(message).toContain('mossen logs')
      expect(message).toContain('mossen respawn')
    })
  })
})
