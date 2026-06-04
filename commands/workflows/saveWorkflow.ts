import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectRoot } from '../../bootstrap/state.js'
import { t } from '../../utils/i18n/index.js'
import {
  listWorkflowRuns,
  loadRunScript,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
} from '../../tools/WorkflowTool/savedWorkflows.js'

export function deriveWorkflowSaveName(params: {
  runId: string
  explicit?: string
  metaName?: string
}): string {
  const rawName = params.explicit || params.metaName || params.runId
  return rawName.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Save a run's script as a reusable named workflow.
 * `save <runId> [name] [--user]` writes to project scope by default, or user
 * scope when `--user` is present. The saved file becomes a slash command on the
 * next command load.
 */
export function saveRun(args: string[]): string {
  const useUser = args.includes('--user')
  const positional = args.filter(a => a !== '--user')
  const runId = positional[0]
  if (!runId) return t('cmd.workflows.saveUsage')
  const script = loadRunScript(runId)
  if (script == null) return t('cmd.workflows.notFound', { runId })

  const explicit = positional[1]
  const metaName = listWorkflowRuns().find(r => r.runId === runId)?.workflowName
  const name = deriveWorkflowSaveName({ runId, explicit, metaName })
  if (!name) return t('cmd.workflows.saveBadName')

  const dir = useUser
    ? getUserWorkflowsDir()
    : getProjectWorkflowsDir(getProjectRoot())
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${name}.js`)
    writeFileSync(dest, script, 'utf8')
    return t('cmd.workflows.saved', {
      name,
      scope: useUser ? 'user' : 'project',
      path: dest,
    })
  } catch (err) {
    return t('cmd.workflows.saveFailed', { error: (err as Error).message })
  }
}
