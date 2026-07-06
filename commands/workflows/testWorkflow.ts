import { basename } from 'node:path'
import { inferWorkflowArgsValue } from '../../tools/WorkflowTool/savedWorkflows.js'
import {
  validateWorkflowTargetsForCommand,
  type WorkflowValidationCommandResult,
} from './validateWorkflow.js'

export type WorkflowTestArgs = {
  run: boolean
  strict: boolean
  target?: string
  argsText?: string
  error?: string
}

export type WorkflowTestCommandResult = {
  ok: boolean
  message: string
  nextInput?: string
  submitNextInput?: boolean
}

export const WORKFLOW_TEST_USAGE =
  'Usage: /workflows test <name|path> [args...] [--run] [--strict|--legacy-compatible]'

export function parseWorkflowTestArgs(
  args: readonly string[],
): WorkflowTestArgs {
  const parsed: WorkflowTestArgs = {
    run: false,
    strict: true,
  }
  const positional: string[] = []
  for (const arg of args) {
    if (arg === '--run') {
      parsed.run = true
      continue
    }
    if (arg === '--strict') {
      parsed.strict = true
      continue
    }
    if (arg === '--legacy-compatible') {
      parsed.strict = false
      continue
    }
    if (arg === '--help' || arg === '-h') {
      parsed.error = WORKFLOW_TEST_USAGE
      continue
    }
    if (arg.startsWith('--')) {
      parsed.error = `Unknown workflow test option: ${arg}\n${WORKFLOW_TEST_USAGE}`
      continue
    }
    positional.push(arg)
  }
  if (positional.length === 0) {
    return {
      ...parsed,
      error: WORKFLOW_TEST_USAGE,
    }
  }
  const [target, ...inputParts] = positional
  return {
    ...parsed,
    target,
    ...(inputParts.length > 0 ? { argsText: inputParts.join(' ') } : {}),
  }
}

function workflowName(result: WorkflowValidationCommandResult): string {
  return (
    result.validation?.asset?.name ??
    (result.target.scriptPath
      ? basename(result.target.scriptPath, '.js')
      : result.target.label.replace(/^[^:]+:/, ''))
  )
}

function sourceLabel(result: WorkflowValidationCommandResult): string {
  return `${result.target.scope}${
    result.target.scriptPath ? ` ${result.target.scriptPath}` : ''
  }`
}

function validationLine(
  result: WorkflowValidationCommandResult,
  strict: boolean,
): string {
  const warnings = result.issues.filter(issue => issue.severity === 'warning')
  const errors = result.issues.filter(issue => issue.severity === 'error')
  const label = result.ok ? (warnings.length ? 'WARN' : 'PASS') : 'FAIL'
  return `Validation: ${label} (${strict ? 'strict' : 'legacy-compatible'}, ${errors.length} errors, ${warnings.length} warnings)`
}

function issueLines(result: WorkflowValidationCommandResult): string[] {
  return result.issues.map(
    issue => `  ${issue.severity} ${issue.code}: ${issue.message}`,
  )
}

function testArgsForWorkflow(
  result: WorkflowValidationCommandResult,
  argsText: string | undefined,
): unknown {
  const inferred = inferWorkflowArgsValue(argsText ?? '')
  if (inferred !== undefined) return inferred
  return { task: `Smoke test ${workflowName(result)}` }
}

function buildWorkflowTestNextInput(
  result: WorkflowValidationCommandResult,
  testArgs: unknown,
): string | null {
  const argsJson = JSON.stringify(testArgs)
  if (!argsJson) return null
  if (result.target.scope === 'scriptPath') {
    const scriptPath = result.target.scriptPath
    if (!scriptPath) return null
    return `Workflow({scriptPath: ${JSON.stringify(scriptPath)}, args: ${argsJson}})`
  }
  const name = result.validation?.asset?.name ?? workflowName(result)
  return `/${name} ${argsJson}`
}

function formatWorkflowTestReport(params: {
  result: WorkflowValidationCommandResult
  strict: boolean
  testArgs?: unknown
  nextInput?: string | null
  run: boolean
}): string {
  const { result, strict, testArgs, nextInput, run } = params
  const lines = [
    `Workflow test ${result.ok ? 'ready' : 'blocked'}: ${workflowName(result)}`,
    `Source: ${sourceLabel(result)}`,
    validationLine(result, strict),
    ...issueLines(result),
  ]
  if (!result.ok) {
    lines.push('No test command was queued because validation failed.')
    return lines.join('\n')
  }
  lines.push(
    `Test args: ${JSON.stringify(testArgs)}`,
    'Test command:',
    `  ${nextInput ?? '(not available)'}`,
    run
      ? 'Mode: run requested; queuing the test command.'
      : 'Mode: dry-run. Add --run to queue the test command.',
  )
  return lines.join('\n')
}

export function testWorkflowCommand(
  args: readonly string[],
): WorkflowTestCommandResult {
  const parsed = parseWorkflowTestArgs(args)
  if (parsed.error || !parsed.target) {
    return {
      ok: false,
      message: parsed.error ?? WORKFLOW_TEST_USAGE,
    }
  }
  const validationArgs = [
    parsed.target,
    ...(parsed.strict ? ['--strict'] : []),
  ]
  const results = validateWorkflowTargetsForCommand(validationArgs)
  if (results.length === 0) {
    return {
      ok: false,
      message: `No workflow asset matched "${parsed.target}".\n${WORKFLOW_TEST_USAGE}`,
    }
  }
  if (results.length > 1) {
    return {
      ok: false,
      message: [
        `Workflow test matched ${results.length} assets. Pick a specific workflow name or path:`,
        ...results.map(result => `  - ${workflowName(result)} (${sourceLabel(result)})`),
      ].join('\n'),
    }
  }

  const result = results[0]!
  const testArgs = result.ok
    ? testArgsForWorkflow(result, parsed.argsText)
    : undefined
  const nextInput =
    result.ok && testArgs !== undefined
      ? buildWorkflowTestNextInput(result, testArgs)
      : null
  return {
    ok: result.ok && Boolean(nextInput),
    message: formatWorkflowTestReport({
      result,
      strict: parsed.strict,
      testArgs,
      nextInput,
      run: parsed.run,
    }),
    ...(parsed.run && result.ok && nextInput
      ? { nextInput, submitNextInput: true }
      : {}),
  }
}
