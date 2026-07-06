import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectRoot } from '../../bootstrap/state.js'
import {
  buildDynamicWorkflowScript,
  MAX_DYNAMIC_WORKFLOW_TASK_CHARS,
} from '../../tools/WorkflowTool/dynamicWorkflow.js'
import { rewriteWorkflowMetaName } from '../../tools/WorkflowTool/engine/meta.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
} from '../../tools/WorkflowTool/savedWorkflows.js'
import {
  validateWorkflowAssetSource,
  type WorkflowAssetIssue,
  type WorkflowAssetValidationResult,
} from '../../tools/WorkflowTool/workflowAsset.js'
import { deriveWorkflowSaveName } from './saveWorkflow.js'

export type WorkflowDraftArgs = {
  force: boolean
  user: boolean
  write: boolean
  goal?: string
  name?: string
  error?: string
}

export type WorkflowDraftResult = {
  ok: boolean
  message: string
  name?: string
  path?: string
  source?: string
  written?: boolean
}

export const WORKFLOW_DRAFT_USAGE =
  'Usage: /workflows draft <goal text> [--name <name>] [--user] [--write] [--force]'

function parseNameFlag(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  return deriveWorkflowSaveName({ runId: raw })
}

export function parseWorkflowDraftArgs(
  args: readonly string[],
): WorkflowDraftArgs {
  const parsed: WorkflowDraftArgs = {
    force: false,
    user: false,
    write: false,
  }
  const goalParts: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--force') {
      parsed.force = true
      continue
    }
    if (arg === '--user') {
      parsed.user = true
      continue
    }
    if (arg === '--write') {
      parsed.write = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      parsed.error = WORKFLOW_DRAFT_USAGE
      continue
    }
    if (arg === '--run') {
      parsed.error =
        'Workflow draft never runs generated workflows. Use --write, review the file, then run /workflows test <name> --run.'
      continue
    }
    if (arg === '--name') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        parsed.error = `--name requires a value.\n${WORKFLOW_DRAFT_USAGE}`
        continue
      }
      index += 1
      parsed.name = parseNameFlag(value)
      if (!parsed.name) {
        parsed.error =
          'Workflow draft name must include at least one letter, number, underscore, or dash.'
      }
      continue
    }
    if (arg.startsWith('--name=')) {
      parsed.name = parseNameFlag(arg.slice('--name='.length))
      if (!parsed.name) {
        parsed.error =
          'Workflow draft name must include at least one letter, number, underscore, or dash.'
      }
      continue
    }
    if (arg.startsWith('--')) {
      parsed.error = `Unknown workflow draft option: ${arg}\n${WORKFLOW_DRAFT_USAGE}`
      continue
    }
    goalParts.push(arg)
  }
  const goal = goalParts.join(' ').trim()
  if (!goal) {
    return {
      ...parsed,
      error: parsed.error ?? WORKFLOW_DRAFT_USAGE,
    }
  }
  if (goal.length > MAX_DYNAMIC_WORKFLOW_TASK_CHARS) {
    return {
      ...parsed,
      goal,
      error: `Workflow goal exceeds ${MAX_DYNAMIC_WORKFLOW_TASK_CHARS} characters.`,
    }
  }
  return { ...parsed, goal }
}

function issueLines(issues: readonly WorkflowAssetIssue[]): string[] {
  return issues.map(
    issue => `  ${issue.severity} ${issue.code}: ${issue.message}`,
  )
}

function previewSource(source: string, maxLines = 24): string[] {
  const lines = source.split(/\r?\n/).slice(0, maxLines)
  return lines.map(line => `  ${line}`)
}

function validationLine(validation: WorkflowAssetValidationResult): string {
  const warnings = validation.issues.filter(issue => issue.severity === 'warning')
  const errors = validation.issues.filter(issue => issue.severity === 'error')
  const label = validation.ok ? (warnings.length ? 'WARN' : 'PASS') : 'FAIL'
  return `Validation: ${label} (strict, ${errors.length} errors, ${warnings.length} warnings)`
}

export function buildWorkflowDraft(
  args: readonly string[],
  options: {
    buildScript?: (goal: string) => string
  } = {},
): WorkflowDraftResult {
  const parsed = parseWorkflowDraftArgs(args)
  if (parsed.error || !parsed.goal) {
    return {
      ok: false,
      message: parsed.error ?? WORKFLOW_DRAFT_USAGE,
    }
  }
  let source: string
  try {
    source = options.buildScript
      ? options.buildScript(parsed.goal)
      : buildDynamicWorkflowScript(parsed.goal, { name: parsed.name })
    if (options.buildScript && parsed.name) {
      source = rewriteWorkflowMetaName(source, parsed.name)
    }
  } catch (err) {
    return {
      ok: false,
      message: `Workflow draft blocked before write: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  const initialValidation = validateWorkflowAssetSource(source, {
    scope: parsed.user ? 'user' : 'project',
    requireBoundedBudgets: true,
    requirePhases: true,
  })
  const name = initialValidation.asset?.name ?? parsed.name
  if (!initialValidation.ok || !name) {
    return {
      ok: false,
      source,
      message: [
        `Workflow draft blocked before write: ${name ?? '(unnamed)'}`,
        validationLine(initialValidation),
        ...issueLines(initialValidation.issues),
        'No file was written and no run was queued.',
      ].join('\n'),
    }
  }

  const dir = parsed.user
    ? getUserWorkflowsDir()
    : getProjectWorkflowsDir(getProjectRoot())
  const path = join(dir, `${name}.js`)
  const validation = validateWorkflowAssetSource(source, {
    scope: parsed.user ? 'user' : 'project',
    scriptPath: path,
    requireBoundedBudgets: true,
    requirePhases: true,
  })
  if (!validation.ok) {
    return {
      ok: false,
      name,
      path,
      source,
      message: [
        `Workflow draft blocked before write: ${name}`,
        validationLine(validation),
        ...issueLines(validation.issues),
        'No file was written and no run was queued.',
      ].join('\n'),
    }
  }

  if (!parsed.write) {
    return {
      ok: true,
      name,
      path,
      source,
      written: false,
      message: [
        `Workflow draft ready for review: ${name}`,
        `Goal: ${parsed.goal}`,
        `Target: ${path}`,
        validationLine(validation),
        'Review required: no file was written and no run was queued.',
        'Preview:',
        ...previewSource(source),
        'Next:',
        '  Write after review: repeat this draft command with --write.',
        `  Then validate: /workflows validate ${name} --strict`,
        `  Then test: /workflows test ${name} --run`,
      ].join('\n'),
    }
  }

  if (existsSync(path) && !parsed.force) {
    return {
      ok: false,
      name,
      path,
      source,
      message: `Workflow draft "${name}" already exists at ${path}. Use --force to overwrite after review.`,
    }
  }
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, source, 'utf8')
  } catch (err) {
    return {
      ok: false,
      name,
      path,
      source,
      message: `Failed to write workflow draft "${name}" at ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  return {
    ok: true,
    name,
    path,
    source,
    written: true,
    message: [
      `Workflow draft written: ${name}`,
      `Path: ${path}`,
      validationLine(validation),
      'No run was queued by draft generation.',
      'Next:',
      `  Validate: /workflows validate ${name} --strict`,
      `  Review: /workflows explain ${name} --strict`,
      `  Dry test: /workflows test ${name}`,
      `  Run test after review: /workflows test ${name} --run`,
    ].join('\n'),
  }
}

export function draftWorkflowCommand(args: readonly string[]): WorkflowDraftResult {
  return buildWorkflowDraft(args)
}
