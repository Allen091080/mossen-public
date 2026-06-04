import { readAgentSupervisorRoster } from './roster.js'
import { AgentSupervisorJobIdSchema, type AgentSupervisorJobId } from './schema.js'
import { updateAgentSupervisorJobState } from './state.js'
import { upsertAgentSupervisorRosterJob } from './roster.js'

async function updateJobUi(
  rawJobId: string,
  updater: Parameters<typeof updateAgentSupervisorJobState>[1],
): Promise<void> {
  const jobId = AgentSupervisorJobIdSchema.parse(rawJobId)
  const next = await updateAgentSupervisorJobState(jobId, updater)
  await upsertAgentSupervisorRosterJob(next)
}

export async function toggleAgentSupervisorPin(rawJobId: string): Promise<boolean> {
  let pinned = false
  await updateJobUi(rawJobId, current => {
    if (!current) throw new Error(`Agent supervisor job not found: ${rawJobId}`)
    pinned = !current.ui.pinned
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      ui: {
        ...current.ui,
        pinned,
      },
    }
  })
  return pinned
}

export async function renameAgentSupervisorJob(
  rawJobId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new Error('Agent View rename title cannot be empty.')
  }
  await updateJobUi(rawJobId, current => {
    if (!current) throw new Error(`Agent supervisor job not found: ${rawJobId}`)
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      ui: {
        ...current.ui,
        renamedTitle: trimmed,
      },
    }
  })
}

export async function moveAgentSupervisorJobOrder(
  rawJobId: string,
  direction: -1 | 1,
): Promise<void> {
  const jobId = AgentSupervisorJobIdSchema.parse(rawJobId)
  const roster = await readAgentSupervisorRoster()
  const jobs = [...roster.jobs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)
  })
  const index = jobs.findIndex(job => job.id === jobId)
  const swapIndex = index + direction
  if (index < 0 || swapIndex < 0 || swapIndex >= jobs.length) return

  const idsAndOrders = jobs.map((job, order) => ({ id: job.id, order }))
  const current = idsAndOrders[index]!
  const target = idsAndOrders[swapIndex]!
  const currentOrder = current.order
  current.order = target.order
  target.order = currentOrder

  for (const item of [current, target]) {
    await updateJobUi(item.id as AgentSupervisorJobId, state => {
      if (!state) throw new Error(`Agent supervisor job not found: ${item.id}`)
      return {
        ...state,
        updatedAt: new Date().toISOString(),
        ui: {
          ...state.ui,
          order: item.order,
        },
      }
    })
  }
}
