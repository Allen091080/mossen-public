import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { reconcileDeadSupervisorJobs } from '../recovery.js'
import { readAgentSupervisorRoster, upsertAgentSupervisorRosterJob } from '../roster.js'
import { createInitialAgentSupervisorJobState } from '../schema.js'
import {
  readAgentSupervisorJobState,
  writeAgentSupervisorJobState,
} from '../state.js'

describe('reconcileDeadSupervisorJobs', () => {
  test('marks historical non-terminal rows with no live process as failed', async () => {
    const previousConfigDir = process.env.MOSSEN_CONFIG_DIR
    const configDir = mkdtempSync(join(tmpdir(), 'mossen-agent-recovery-'))
    process.env.MOSSEN_CONFIG_DIR = configDir
    try {
      const state = createInitialAgentSupervisorJobState({
        id: 'jstale000001',
        title: 'historical working row',
        cwd: configDir,
        promptPreview: 'historical working row',
        now: '2026-06-09T00:00:00.000Z',
      })
      state.status = 'working'
      state.process.alive = false
      await writeAgentSupervisorJobState(state)
      await upsertAgentSupervisorRosterJob(state)

      const summary = await reconcileDeadSupervisorJobs()
      const next = await readAgentSupervisorJobState(state.id)
      const roster = await readAgentSupervisorRoster()
      const rosterJob = roster.jobs.find(job => job.id === state.id)

      expect(summary.jobsMarkedDead).toBe(1)
      expect(next?.status).toBe('failed')
      expect(next?.process.signal).toBe('reconciled_inactive_nonterminal')
      expect(rosterJob?.status).toBe('failed')
      expect(rosterJob?.processAlive).toBe(false)
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = previousConfigDir
      }
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
