/**
 * Agent View supervisor lifecycle command handlers.
 */
/* eslint-disable no-console -- CLI subcommand handlers intentionally write user-visible output. */

import {
  attachAgentSupervisorJob,
  gcAgentSupervisorJobs,
  formatAgentSupervisorLogs,
  killAgentSupervisorJob,
  purgeAgentSupervisorJob,
  removeAgentSupervisorJob,
  respawnAgentSupervisorJob,
  respawnAllAgentSupervisorJobs,
  stopAgentSupervisorJob,
  waitAgentSupervisorJob,
  waitAllAgentSupervisorJobs,
} from '../../services/agentSupervisor/management.js'

export async function agentSupervisorLogsHandler(
  id: string,
  options: { limit?: string } = {},
): Promise<void> {
  const limit =
    typeof options.limit === 'string' ? Number.parseInt(options.limit, 10) : 80
  console.log(await formatAgentSupervisorLogs(id, { limit }))
}

export async function agentSupervisorStopHandler(id: string): Promise<void> {
  console.log(await stopAgentSupervisorJob(id))
}

export async function agentSupervisorKillHandler(id: string): Promise<void> {
  console.log(await killAgentSupervisorJob(id))
}

export async function agentSupervisorRemoveHandler(
  id: string,
  options: {
    cleanupWorktree?: boolean
    purge?: boolean
    dryRun?: boolean
    confirm?: string
  } = {},
): Promise<void> {
  if (options.purge) {
    console.log(
      await purgeAgentSupervisorJob(id, {
        dryRun: options.dryRun,
        confirm: options.confirm,
      }),
    )
    return
  }
  console.log(await removeAgentSupervisorJob(id, options))
}

export async function agentSupervisorGcHandler(options: {
  before?: string
  dryRun?: boolean
  confirm?: string
}): Promise<void> {
  if (!options.before) {
    throw new Error('Usage: mossen agents --gc --before <date> --dry-run')
  }
  console.log(
    await gcAgentSupervisorJobs({
      before: options.before,
      dryRun: options.dryRun,
      confirm: options.confirm,
    }),
  )
}

export async function agentSupervisorRespawnHandler(
  id: string | undefined,
  options: { all?: boolean; supervisorTestJob?: boolean } = {},
): Promise<void> {
  if (options.all) {
    const messages = await respawnAllAgentSupervisorJobs({
      testMode: options.supervisorTestJob,
    })
    if (messages.length === 0) {
      console.log('No terminal Agent View supervisor jobs to respawn.')
      return
    }
    console.log(messages.join('\n'))
    return
  }

  if (!id) {
    throw new Error('Usage: mossen respawn <id> or mossen respawn --all')
  }
  const result = await respawnAgentSupervisorJob(id, {
    testMode: options.supervisorTestJob,
  })
  console.log(result.message)
}

function parseOptionalInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

export async function agentSupervisorWaitHandler(
  id: string | undefined,
  options: { all?: boolean; timeoutMs?: string; pollMs?: string } = {},
): Promise<void> {
  const waitOptions = {
    timeoutMs: parseOptionalInteger(options.timeoutMs, '--timeout-ms'),
    pollMs: parseOptionalInteger(options.pollMs, '--poll-ms'),
  }
  if (options.all) {
    const result = await waitAllAgentSupervisorJobs(waitOptions)
    console.log(result.messages.join('\n'))
    process.exitCode = result.exitCode
    return
  }
  if (!id) {
    throw new Error('Usage: mossen wait <id> or mossen wait --all')
  }
  const result = await waitAgentSupervisorJob(id, waitOptions)
  console.log(result.message)
  process.exitCode = result.exitCode
}

export async function agentSupervisorAttachHandler(id: string): Promise<void> {
  const code = await attachAgentSupervisorJob(id)
  if (code !== 0) {
    process.exitCode = code
  }
}
