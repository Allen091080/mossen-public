import { feature } from 'bun:bundle'
import { t } from '../../utils/i18n/index.js'
import type { Command } from '../../commands.js'
import { isWorkflowRuntimeEnabled } from '../../utils/workflowAvailability.js'

/**
 * `/workflows` — monitor workflow runs from this session and save a run as a
 * reusable named workflow. Gated on WORKFLOW_SCRIPTS (the orchestration engine
 * feature); hidden entirely when orchestration is off.
 */
const workflows: Command = {
  type: 'local-jsx',
  name: 'workflows',
  description: t('cmd.workflows.description'),
  argumentHint:
    '[<runId> | create <name> [--user] [--force] | draft <goal text> [--name <name>] [--write] | validate [--all|project|user|bundled|<name>|<path>] [--strict] | explain <name|path> [--strict] | test <name|path> [args...] [--run] | registry [--strict] | agent <runId> <agent> | pause <runId> | stop <runId> | stop-agent <runId> <agent> | restart-agent <runId> <agent> | resume-task <runId> | resume <runId> | save <runId> [name] [--user]]',
  isEnabled: () => (feature('WORKFLOW_SCRIPTS') ? isWorkflowRuntimeEnabled() : false),
  load: () => import('./workflows.js'),
}

export default workflows
