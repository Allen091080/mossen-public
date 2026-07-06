import {
  existsSync,
  readdirSync,
} from 'node:fs'
import {
  basename,
  join,
  resolve,
} from 'node:path'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  validateWorkflowAssetSource,
  type WorkflowAssetIssue,
  type WorkflowAssetScope,
  type WorkflowAssetValidationResult,
} from '../../tools/WorkflowTool/workflowAsset.js'
import { readWorkflowScriptFile } from '../../tools/WorkflowTool/scriptFile.js'
import {
  getLegacyProjectWorkflowsDir,
  getLegacyUserWorkflowsDir,
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
  loadBundledWorkflowRefs,
} from '../../tools/WorkflowTool/savedWorkflows.js'

export type WorkflowValidateArgs = {
  all: boolean
  strict: boolean
  target?: string
  error?: string
}

export type WorkflowValidationTarget = {
  label: string
  scope: WorkflowAssetScope
  source?: string
  scriptPath?: string
}

export type WorkflowValidationCommandResult = {
  target: WorkflowValidationTarget
  ok: boolean
  validation?: WorkflowAssetValidationResult
  issues: WorkflowAssetIssue[]
}

export const WORKFLOW_VALIDATE_USAGE =
  'Usage: /workflows validate [--all|project|user|bundled|<name>|<path>] [--strict]'

function workflowIssue(
  severity: WorkflowAssetIssue['severity'],
  code: string,
  message: string,
): WorkflowAssetIssue {
  return { severity, code, message }
}

export function parseWorkflowValidateArgs(
  args: readonly string[],
): WorkflowValidateArgs {
  const parsed: WorkflowValidateArgs = {
    all: false,
    strict: false,
  }
  const positional: string[] = []
  for (const arg of args) {
    if (arg === '--all') {
      parsed.all = true
      continue
    }
    if (arg === '--strict') {
      parsed.strict = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      parsed.error = WORKFLOW_VALIDATE_USAGE
      continue
    }
    if (arg.startsWith('--')) {
      parsed.error = `Unknown workflow validate option: ${arg}\n${WORKFLOW_VALIDATE_USAGE}`
      continue
    }
    positional.push(arg)
  }
  if (positional.length > 1) {
    return {
      ...parsed,
      error: `Workflow validate accepts at most one target.\n${WORKFLOW_VALIDATE_USAGE}`,
    }
  }
  if (positional[0]) parsed.target = positional[0]
  return parsed
}

function workflowFilesInDir(
  dir: string,
  scope: 'project' | 'user',
  labelPrefix: string,
): WorkflowValidationTarget[] {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).filter(file => file.endsWith('.js')).sort()
  } catch {
    return []
  }
  return entries.map(file => {
    const scriptPath = join(dir, file)
    return {
      label: `${labelPrefix}:${basename(file, '.js')}`,
      scope,
      scriptPath,
    }
  })
}

export function listWorkflowValidationTargets(
  projectRoot = getProjectRoot(),
): WorkflowValidationTarget[] {
  const bundled = loadBundledWorkflowRefs().map(workflow => ({
    label: `bundled:${workflow.commandName}`,
    scope: 'bundled' as const,
    source: workflow.source,
  }))
  return [
    ...workflowFilesInDir(
      getProjectWorkflowsDir(projectRoot),
      'project',
      'project',
    ),
    ...workflowFilesInDir(
      getLegacyProjectWorkflowsDir(projectRoot),
      'project',
      'legacy-project',
    ),
    ...workflowFilesInDir(getUserWorkflowsDir(), 'user', 'user'),
    ...workflowFilesInDir(getLegacyUserWorkflowsDir(), 'user', 'legacy-user'),
    ...bundled,
  ]
}

function isPathLikeWorkflowTarget(target: string): boolean {
  return (
    target.endsWith('.js') ||
    target.includes('/') ||
    target.includes('\\') ||
    existsSync(resolve(target))
  )
}

function validationOptionsForTarget(
  target: WorkflowValidationTarget,
  strict: boolean,
) {
  const requireStrict = strict || target.scope === 'bundled'
  return {
    scope: target.scope,
    ...(target.scriptPath ? { scriptPath: target.scriptPath } : {}),
    requireBoundedBudgets: requireStrict,
    requirePhases: requireStrict,
    legacyCompatible: !requireStrict,
  }
}

export function validateWorkflowTarget(
  target: WorkflowValidationTarget,
  strict: boolean,
): WorkflowValidationCommandResult {
  let source = target.source
  if (source == null && target.scriptPath) {
    try {
      source = readWorkflowScriptFile(target.scriptPath)
    } catch (err) {
      const issues = [
        workflowIssue(
          'error',
          'read-failed',
          err instanceof Error ? err.message : String(err),
        ),
      ]
      return {
        target,
        ok: false,
        issues,
      }
    }
  }
  if (source == null) {
    const issues = [
      workflowIssue(
        'error',
        'missing-source',
        'Workflow source was not available for validation.',
      ),
    ]
    return {
      target,
      ok: false,
      issues,
    }
  }
  const validation = validateWorkflowAssetSource(
    source,
    validationOptionsForTarget(target, strict),
  )
  return {
    target,
    ok: validation.ok,
    validation,
    issues: validation.issues,
  }
}

function workflowTargetName(result: WorkflowValidationCommandResult): string {
  return (
    result.validation?.asset?.name ??
    (result.target.scriptPath
      ? basename(result.target.scriptPath, '.js')
      : result.target.label)
  )
}

function matchesWorkflowTarget(
  result: WorkflowValidationCommandResult,
  target: string,
): boolean {
  if (result.target.scope === target) return true
  if (result.target.label === target) return true
  if (workflowTargetName(result) === target) return true
  if (result.target.scriptPath) {
    const path = result.target.scriptPath
    return path === target || basename(path, '.js') === target
  }
  return false
}

function resolveValidationTargets(
  parsed: WorkflowValidateArgs,
): WorkflowValidationTarget[] {
  if (parsed.target && isPathLikeWorkflowTarget(parsed.target)) {
    const scriptPath = resolve(parsed.target)
    return [
      {
        label: `scriptPath:${scriptPath}`,
        scope: 'scriptPath',
        scriptPath,
      },
    ]
  }
  return listWorkflowValidationTargets()
}

export function validateWorkflowTargetsForCommand(
  args: readonly string[],
): WorkflowValidationCommandResult[] {
  const parsed = parseWorkflowValidateArgs(args)
  if (parsed.error) return []
  const results = resolveValidationTargets(parsed).map(target =>
    validateWorkflowTarget(target, parsed.strict),
  )
  if (!parsed.target || parsed.all) return results
  return results.filter(result => matchesWorkflowTarget(result, parsed.target!))
}

function severityCounts(results: readonly WorkflowValidationCommandResult[]) {
  let errors = 0
  let warnings = 0
  for (const result of results) {
    for (const issue of result.issues) {
      if (issue.severity === 'error') errors += 1
      if (issue.severity === 'warning') warnings += 1
    }
  }
  return { errors, warnings }
}

function statusLabel(result: WorkflowValidationCommandResult): string {
  if (!result.ok) return 'FAIL'
  return result.issues.some(issue => issue.severity === 'warning')
    ? 'WARN'
    : 'PASS'
}

function formatWorkflowValidationTarget(
  result: WorkflowValidationCommandResult,
): string {
  const path = result.target.scriptPath ? ` ${result.target.scriptPath}` : ''
  return `${workflowTargetName(result)} (${result.target.scope}${path})`
}

export function formatWorkflowValidationReport(
  results: readonly WorkflowValidationCommandResult[],
  args: readonly string[] = [],
): string {
  const parsed = parseWorkflowValidateArgs(args)
  if (parsed.error) return parsed.error
  if (results.length === 0) {
    return parsed.target
      ? `No workflow asset matched "${parsed.target}".\n${WORKFLOW_VALIDATE_USAGE}`
      : `No workflow assets found.\n${WORKFLOW_VALIDATE_USAGE}`
  }
  const { errors, warnings } = severityCounts(results)
  const ok = errors === 0
  const lines = [
    `Workflow validation ${ok ? 'passed' : 'failed'}: ${results.length} checked, ${errors} errors, ${warnings} warnings.`,
  ]
  for (const result of results) {
    lines.push(
      `[${statusLabel(result)}] ${formatWorkflowValidationTarget(result)}`,
    )
    for (const issue of result.issues) {
      lines.push(`  ${issue.severity} ${issue.code}: ${issue.message}`)
    }
  }
  return lines.join('\n')
}

export async function validateWorkflowsCommand(
  args: readonly string[],
): Promise<string> {
  const parsed = parseWorkflowValidateArgs(args)
  if (parsed.error) return parsed.error
  const results = validateWorkflowTargetsForCommand(args)
  return formatWorkflowValidationReport(results, args)
}
