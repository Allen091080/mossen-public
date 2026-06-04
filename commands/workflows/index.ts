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
  argumentHint: '[<runId> | save <runId> [name] [--user]]',
  isEnabled: () => (feature('WORKFLOW_SCRIPTS') ? isWorkflowRuntimeEnabled() : false),
  load: () => import('./workflows.js'),
}

export default workflows
