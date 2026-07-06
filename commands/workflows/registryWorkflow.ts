import { basename } from 'node:path'
import type { WorkflowAsset } from '../../tools/WorkflowTool/workflowAsset.js'
import {
  validateWorkflowTargetsForCommand,
  type WorkflowValidationCommandResult,
} from './validateWorkflow.js'

export type WorkflowRegistryArgs = {
  strict: boolean
  error?: string
}

export const WORKFLOW_REGISTRY_USAGE =
  'Usage: /workflows registry [--strict]'

export function parseWorkflowRegistryArgs(
  args: readonly string[],
): WorkflowRegistryArgs {
  const parsed: WorkflowRegistryArgs = {
    strict: false,
  }
  for (const arg of args) {
    if (arg === '--strict') {
      parsed.strict = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      parsed.error = WORKFLOW_REGISTRY_USAGE
      continue
    }
    if (arg.startsWith('--')) {
      parsed.error = `Unknown workflow registry option: ${arg}\n${WORKFLOW_REGISTRY_USAGE}`
      continue
    }
    parsed.error = `Workflow registry does not accept positional arguments.\n${WORKFLOW_REGISTRY_USAGE}`
  }
  return parsed
}

function assetName(result: WorkflowValidationCommandResult): string {
  return (
    result.validation?.asset?.name ??
    (result.target.scriptPath
      ? basename(result.target.scriptPath, '.js')
      : result.target.label.replace(/^[^:]+:/, ''))
  )
}

function statusLabel(result: WorkflowValidationCommandResult): string {
  if (!result.ok) return 'FAIL'
  return result.issues.some(issue => issue.severity === 'warning')
    ? 'WARN'
    : 'PASS'
}

function sourceLabel(result: WorkflowValidationCommandResult): string {
  return `${result.target.scope}${
    result.target.scriptPath ? ` ${result.target.scriptPath}` : ''
  }`
}

function lifecycleSummary(asset: WorkflowAsset | undefined): string {
  const lifecycle = asset?.lifecycle
  const parts = [
    `status=${lifecycle?.status ?? 'unknown'}`,
    `version=${lifecycle?.version ?? 'unknown'}`,
    `owner=${lifecycle?.owner ?? 'unknown'}`,
  ]
  if (lifecycle?.lastTestedAt) parts.push(`lastTestedAt=${lifecycle.lastTestedAt}`)
  if (lifecycle?.lastTestArtifact) {
    parts.push(`lastTestArtifact=${lifecycle.lastTestArtifact}`)
  }
  if (lifecycle?.compatibility) {
    parts.push(`compatibility=${lifecycle.compatibility}`)
  }
  return parts.join(' · ')
}

export function registryWorkflowCommand(args: readonly string[]): string {
  const parsed = parseWorkflowRegistryArgs(args)
  if (parsed.error) return parsed.error
  const results = validateWorkflowTargetsForCommand([
    '--all',
    ...(parsed.strict ? ['--strict'] : []),
  ])
  if (results.length === 0) {
    return `No workflow assets found.\n${WORKFLOW_REGISTRY_USAGE}`
  }
  const lines = [
    `Workflow registry: ${results.length} assets (${parsed.strict ? 'strict' : 'legacy-compatible'} validation).`,
  ]
  for (const result of results) {
    lines.push(
      `[${statusLabel(result)}] ${assetName(result)} (${sourceLabel(result)})`,
      `  lifecycle: ${lifecycleSummary(result.validation?.asset)}`,
    )
    for (const issue of result.issues) {
      lines.push(`  ${issue.severity} ${issue.code}: ${issue.message}`)
    }
  }
  return lines.join('\n')
}
