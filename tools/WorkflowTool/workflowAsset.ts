import { extractMeta } from './engine/meta.js'
import type {
  WorkflowBudgetMeta,
  WorkflowEvidenceMeta,
  WorkflowLifecycleMeta,
  WorkflowMeta,
  WorkflowPhaseMeta,
} from './engine/types.js'

export type WorkflowAssetScope =
  | 'inline'
  | 'scriptPath'
  | 'project'
  | 'user'
  | 'plugin'
  | 'bundled'
  | 'published'
  | 'task'

export type WorkflowAssetIssueSeverity = 'error' | 'warning'

export type WorkflowAssetIssue = {
  severity: WorkflowAssetIssueSeverity
  code: string
  message: string
}

export type WorkflowAsset = {
  version: 1
  name: string
  description: string
  title?: string
  whenToUse?: string
  scope: WorkflowAssetScope
  scriptPath?: string
  argsSchema?: Record<string, unknown>
  phases: WorkflowPhaseMeta[]
  budgets: WorkflowBudgetMeta
  allowedTools: string[]
  allowedRoots: string[]
  allowedHosts: string[]
  model?: string
  effort?: string
  evidence: WorkflowEvidenceMeta
  lifecycle?: WorkflowLifecycleMeta
}

export type WorkflowAssetValidationOptions = {
  scope?: WorkflowAssetScope
  scriptPath?: string
  requirePhases?: boolean
  requireBoundedBudgets?: boolean
  legacyCompatible?: boolean
}

export type WorkflowAssetValidationResult = {
  ok: boolean
  asset?: WorkflowAsset
  issues: WorkflowAssetIssue[]
}

const REQUIRED_BUDGET_FIELDS = [
  'timeoutMs',
  'phaseTimeoutMs',
  'maxAgents',
  'maxParallel',
  'maxNestedWorkflows',
] as const

function issue(
  severity: WorkflowAssetIssueSeverity,
  code: string,
  message: string,
): WorkflowAssetIssue {
  return { severity, code, message }
}

function compactBudget(meta: WorkflowMeta): WorkflowBudgetMeta {
  const budgets = meta.budgets ?? {}
  return {
    ...(budgets.timeoutMs !== undefined ? { timeoutMs: budgets.timeoutMs } : {}),
    ...(budgets.phaseTimeoutMs !== undefined
      ? { phaseTimeoutMs: budgets.phaseTimeoutMs }
      : {}),
    ...(budgets.maxAgents !== undefined ? { maxAgents: budgets.maxAgents } : {}),
    ...(budgets.maxParallel !== undefined
      ? { maxParallel: budgets.maxParallel }
      : {}),
    ...(budgets.maxNestedWorkflows !== undefined
      ? { maxNestedWorkflows: budgets.maxNestedWorkflows }
      : {}),
  }
}

function compactEvidence(meta: WorkflowMeta): WorkflowEvidenceMeta {
  const evidence = meta.evidence ?? {}
  return {
    ...(evidence.finalReport !== undefined
      ? { finalReport: evidence.finalReport }
      : {}),
    ...(evidence.citations !== undefined ? { citations: evidence.citations } : {}),
    ...(evidence.realProvider !== undefined
      ? { realProvider: evidence.realProvider }
      : {}),
    ...(evidence.processClean !== undefined
      ? { processClean: evidence.processClean }
      : {}),
    ...(evidence.validationCommands !== undefined
      ? { validationCommands: evidence.validationCommands }
      : {}),
    ...(evidence.artifacts !== undefined ? { artifacts: evidence.artifacts } : {}),
  }
}

function compactLifecycle(meta: WorkflowMeta): WorkflowLifecycleMeta | undefined {
  const lifecycle = meta.lifecycle
  if (!lifecycle) return undefined
  return {
    ...(lifecycle.version !== undefined ? { version: lifecycle.version } : {}),
    ...(lifecycle.owner !== undefined ? { owner: lifecycle.owner } : {}),
    ...(lifecycle.status !== undefined ? { status: lifecycle.status } : {}),
    ...(lifecycle.lastTestedAt !== undefined
      ? { lastTestedAt: lifecycle.lastTestedAt }
      : {}),
    ...(lifecycle.lastTestArtifact !== undefined
      ? { lastTestArtifact: lifecycle.lastTestArtifact }
      : {}),
    ...(lifecycle.compatibility !== undefined
      ? { compatibility: lifecycle.compatibility }
      : {}),
  }
}

export function workflowAssetFromMeta(
  meta: WorkflowMeta,
  options: WorkflowAssetValidationOptions = {},
): WorkflowAsset {
  const lifecycle = compactLifecycle(meta)
  return {
    version: 1,
    name: meta.name,
    description: meta.description,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
    scope: options.scope ?? 'inline',
    ...(options.scriptPath ? { scriptPath: options.scriptPath } : {}),
    ...(meta.argsSchema ? { argsSchema: meta.argsSchema } : {}),
    phases: meta.phases ?? [],
    budgets: compactBudget(meta),
    allowedTools: meta.allowedTools ?? [],
    allowedRoots: meta.allowedRoots ?? [],
    allowedHosts: meta.allowedHosts ?? [],
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.effort ? { effort: meta.effort } : {}),
    evidence: compactEvidence(meta),
    ...(lifecycle ? { lifecycle } : {}),
  }
}

function collectContractIssues(
  asset: WorkflowAsset,
  options: WorkflowAssetValidationOptions,
): WorkflowAssetIssue[] {
  const issues: WorkflowAssetIssue[] = []
  const missingPhases = asset.phases.length === 0
  const missingBudgetFields = REQUIRED_BUDGET_FIELDS.filter(
    field => asset.budgets[field] === undefined,
  )

  if (options.requirePhases && missingPhases) {
    issues.push(
      issue(
        'error',
        'missing-phases',
        'Workflow assets in this scope must declare phase metadata.',
      ),
    )
  } else if (options.legacyCompatible && missingPhases) {
    issues.push(
      issue(
        'warning',
        'legacy-missing-phases',
        'Legacy saved workflow has no phase metadata.',
      ),
    )
  }

  if (options.requireBoundedBudgets && missingBudgetFields.length > 0) {
    issues.push(
      issue(
        'error',
        'missing-bounded-budgets',
        `Workflow assets in this scope must declare budgets: ${missingBudgetFields.join(', ')}.`,
      ),
    )
  } else if (options.legacyCompatible && missingBudgetFields.length > 0) {
    issues.push(
      issue(
        'warning',
        'legacy-missing-budgets',
        `Legacy saved workflow has no bounded budgets for: ${missingBudgetFields.join(', ')}.`,
      ),
    )
  }

  return issues
}

export function validateWorkflowAssetSource(
  source: string,
  options: WorkflowAssetValidationOptions = {},
): WorkflowAssetValidationResult {
  try {
    const { meta } = extractMeta(source)
    const asset = workflowAssetFromMeta(meta, options)
    const issues = collectContractIssues(asset, options)
    return {
      ok: issues.every(current => current.severity !== 'error'),
      asset,
      issues,
    }
  } catch (err) {
    return {
      ok: false,
      issues: [
        issue(
          'error',
          'invalid-meta',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    }
  }
}

export function validateWorkflowAssetSources(
  sources: readonly {
    source: string
    scope?: WorkflowAssetScope
    scriptPath?: string
  }[],
  options: Omit<WorkflowAssetValidationOptions, 'scope' | 'scriptPath'> = {},
): WorkflowAssetValidationResult[] {
  return sources.map(source =>
    validateWorkflowAssetSource(source.source, {
      ...options,
      scope: source.scope,
      scriptPath: source.scriptPath,
    }),
  )
}
