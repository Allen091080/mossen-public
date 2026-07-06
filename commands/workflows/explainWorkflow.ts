import type { WorkflowAsset } from '../../tools/WorkflowTool/workflowAsset.js'
import {
  validateWorkflowTargetsForCommand,
  type WorkflowValidationCommandResult,
} from './validateWorkflow.js'

export type WorkflowExplainArgs = {
  strict: boolean
  target?: string
  error?: string
}

export const WORKFLOW_EXPLAIN_USAGE =
  'Usage: /workflows explain <name|path> [--strict]'

export function parseWorkflowExplainArgs(
  args: readonly string[],
): WorkflowExplainArgs {
  const parsed: WorkflowExplainArgs = {
    strict: false,
  }
  const positional: string[] = []
  for (const arg of args) {
    if (arg === '--strict') {
      parsed.strict = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      parsed.error = WORKFLOW_EXPLAIN_USAGE
      continue
    }
    if (arg.startsWith('--')) {
      parsed.error = `Unknown workflow explain option: ${arg}\n${WORKFLOW_EXPLAIN_USAGE}`
      continue
    }
    positional.push(arg)
  }
  if (positional.length === 0) {
    return {
      ...parsed,
      error: WORKFLOW_EXPLAIN_USAGE,
    }
  }
  return {
    ...parsed,
    target: positional.join('-'),
  }
}

function assetName(result: WorkflowValidationCommandResult): string {
  return (
    result.validation?.asset?.name ??
    result.target.label.replace(/^[^:]+:/, '')
  )
}

function formatList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : '(not declared)'
}

function formatBoolean(value: boolean | undefined): string {
  if (value === true) return 'required'
  if (value === false) return 'not required'
  return 'not declared'
}

function formatJson(value: unknown, maxLength = 1200): string {
  if (value == null) return '(not declared)'
  const text = JSON.stringify(value, null, 2)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function formatValidation(result: WorkflowValidationCommandResult): string[] {
  if (result.issues.length === 0) {
    return [`Validation: ${result.ok ? 'PASS' : 'FAIL'} (no issues)`]
  }
  return [
    `Validation: ${result.ok ? 'PASS' : 'FAIL'}`,
    ...result.issues.map(
      issue => `  ${issue.severity} ${issue.code}: ${issue.message}`,
    ),
  ]
}

function formatBudget(asset: WorkflowAsset): string[] {
  return [
    `  timeoutMs: ${asset.budgets.timeoutMs ?? '(not declared)'}`,
    `  phaseTimeoutMs: ${asset.budgets.phaseTimeoutMs ?? '(not declared)'}`,
    `  maxAgents: ${asset.budgets.maxAgents ?? '(not declared)'}`,
    `  maxParallel: ${asset.budgets.maxParallel ?? '(not declared)'}`,
    `  maxNestedWorkflows: ${
      asset.budgets.maxNestedWorkflows ?? '(not declared)'
    }`,
  ]
}

function formatLifecycle(asset: WorkflowAsset): string[] {
  const lifecycle = asset.lifecycle
  return [
    `  version: ${lifecycle?.version ?? '(not declared)'}`,
    `  owner: ${lifecycle?.owner ?? '(not declared)'}`,
    `  status: ${lifecycle?.status ?? '(not declared)'}`,
    `  lastTestedAt: ${lifecycle?.lastTestedAt ?? '(not declared)'}`,
    `  lastTestArtifact: ${lifecycle?.lastTestArtifact ?? '(not declared)'}`,
    `  compatibility: ${lifecycle?.compatibility ?? '(not declared)'}`,
  ]
}

function formatAssetExplain(result: WorkflowValidationCommandResult): string {
  const asset = result.validation?.asset
  if (!asset) {
    return [
      `Workflow: ${assetName(result)}`,
      `Source: ${result.target.scope}${
        result.target.scriptPath ? ` ${result.target.scriptPath}` : ''
      }`,
      ...formatValidation(result),
    ].join('\n')
  }
  const runHint = asset.name ? `/${asset.name} task=...` : '(not available)'
  const lines = [
    `Workflow: ${asset.name}`,
    asset.title ? `Title: ${asset.title}` : null,
    `Description: ${asset.description}`,
    asset.whenToUse ? `When to use: ${asset.whenToUse}` : null,
    `Source: ${asset.scope}${asset.scriptPath ? ` ${asset.scriptPath}` : ''}`,
    asset.model ? `Model: ${asset.model}` : null,
    asset.effort ? `Effort: ${asset.effort}` : null,
    '',
    'Lifecycle:',
    ...formatLifecycle(asset),
    '',
    'Arguments:',
    formatJson(asset.argsSchema)
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n'),
    '',
    'Budgets:',
    ...formatBudget(asset),
    '',
    'Permission policy:',
    `  allowedTools: ${formatList(asset.allowedTools)}`,
    `  allowedRoots: ${formatList(asset.allowedRoots)}`,
    `  allowedHosts: ${formatList(asset.allowedHosts)}`,
    '',
    'Phases:',
    ...(asset.phases.length > 0
      ? asset.phases.map(
          (phase, index) =>
            `  ${index + 1}. ${phase.title}${
              phase.detail ? ` - ${phase.detail}` : ''
            }${phase.model ? ` (model: ${phase.model})` : ''}`,
        )
      : ['  (not declared)']),
    '',
    'Evidence expectations:',
    `  finalReport: ${formatBoolean(asset.evidence.finalReport)}`,
    `  citations: ${formatBoolean(asset.evidence.citations)}`,
    `  realProvider: ${formatBoolean(asset.evidence.realProvider)}`,
    `  processClean: ${formatBoolean(asset.evidence.processClean)}`,
    `  validationCommands: ${formatList(asset.evidence.validationCommands)}`,
    `  artifacts: ${formatList(asset.evidence.artifacts)}`,
    '',
    ...formatValidation(result),
    '',
    `Run: ${runHint}`,
    `Validate: /workflows validate ${asset.name} --strict`,
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

export function explainWorkflowCommand(args: readonly string[]): string {
  const parsed = parseWorkflowExplainArgs(args)
  if (parsed.error || !parsed.target) return parsed.error ?? WORKFLOW_EXPLAIN_USAGE
  const validationArgs = [
    parsed.target,
    ...(parsed.strict ? ['--strict'] : []),
  ]
  const results = validateWorkflowTargetsForCommand(validationArgs)
  if (results.length === 0) {
    return `No workflow asset matched "${parsed.target}".\n${WORKFLOW_EXPLAIN_USAGE}`
  }
  if (results.length > 1) {
    return [
      `Workflow explain matched ${results.length} assets. Pick a specific workflow name or path:`,
      ...results.map(result => `  - ${assetName(result)} (${result.target.scope})`),
    ].join('\n')
  }
  return formatAssetExplain(results[0]!)
}
