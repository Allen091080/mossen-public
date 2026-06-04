import { readFile } from 'fs/promises'
import {
  ensureAgentSupervisorBaseDirs,
  getAgentSupervisorRosterPath,
} from './paths.js'
import { atomicWriteSupervisorJsonFile } from './state.js'
import {
  AGENT_SUPERVISOR_SCHEMA_VERSION,
  AgentSupervisorRosterSchema,
  type AgentSupervisorJobState,
  type AgentSupervisorRoster,
  type AgentSupervisorRosterJob,
} from './schema.js'

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

export function createEmptyAgentSupervisorRoster(
  now = new Date().toISOString(),
): AgentSupervisorRoster {
  return {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    updatedAt: now,
    jobs: [],
  }
}

export async function readAgentSupervisorRoster(): Promise<AgentSupervisorRoster> {
  const path = getAgentSupervisorRosterPath()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isENOENT(error)) return createEmptyAgentSupervisorRoster()
    throw error
  }

  try {
    const parsed = AgentSupervisorRosterSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // Corrupt roster is non-authoritative and can be regenerated from state.
  }
  return createEmptyAgentSupervisorRoster()
}

export async function writeAgentSupervisorRoster(
  roster: AgentSupervisorRoster,
): Promise<void> {
  await ensureAgentSupervisorBaseDirs()
  await atomicWriteSupervisorJsonFile(
    getAgentSupervisorRosterPath(),
    AgentSupervisorRosterSchema.parse(roster),
  )
}

export function rosterJobFromState(
  state: AgentSupervisorJobState,
): AgentSupervisorRosterJob {
  return {
    id: state.id,
    title: state.ui.renamedTitle ?? state.title,
    cwd: state.cwd,
    status: state.status,
    lastUpdatedAt: state.updatedAt,
    lastSummaryLine:
      state.lastQuestion?.text ?? state.summary ?? state.promptPreview ?? null,
    pinned: state.ui.pinned,
    order: state.ui.order,
    collapsed: state.ui.collapsed,
    agent: state.agent,
    processAlive: state.process.alive,
  }
}

export async function upsertAgentSupervisorRosterJob(
  state: AgentSupervisorJobState,
): Promise<AgentSupervisorRoster> {
  const roster = await readAgentSupervisorRoster()
  const job = rosterJobFromState(state)
  const jobs = roster.jobs.filter(item => item.id !== job.id)
  jobs.push(job)
  jobs.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)
  })
  const next: AgentSupervisorRoster = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    jobs,
  }
  await writeAgentSupervisorRoster(next)
  return next
}

export async function removeAgentSupervisorRosterJob(
  jobId: string,
): Promise<AgentSupervisorRoster> {
  const roster = await readAgentSupervisorRoster()
  const next: AgentSupervisorRoster = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    jobs: roster.jobs.filter(item => item.id !== jobId),
  }
  await writeAgentSupervisorRoster(next)
  return next
}
