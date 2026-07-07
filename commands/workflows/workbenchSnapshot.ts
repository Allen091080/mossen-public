import { basename } from 'node:path'
import {
  isWorkflowRunActiveInCurrentProcess,
  loadWorkflowCheckpoint,
  type WorkflowCheckpoint,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import type { WorkflowAssetIssue } from '../../tools/WorkflowTool/workflowAsset.js'
import {
  workflowRunToJson,
  workflowRunsToJson,
  type WorkflowJsonRun,
  type WorkflowMachineState,
  type WorkflowTreeNodeState,
} from './workflowProgressTree.js'
import {
  loadWorkbenchWorkflowActionReceipts,
  type WorkbenchWorkflowActionReceipt,
} from './workbenchActionReceipts.js'
import type { WorkflowValidationCommandResult } from './validateWorkflow.js'

export type WorkbenchWorkflowActionKind = 'slash-input' | 'cli-command' | 'unsupported'

export type WorkbenchWorkflowControlActionId =
  | 'workflow.run.pause'
  | 'workflow.run.stop'
  | 'workflow.run.stopAgent'
  | 'workflow.run.retryAgent'

export type WorkbenchWorkflowControlPayload = {
  subtype: 'workflow_control'
  actionId: WorkbenchWorkflowControlActionId
  runId: string
  agentNumber?: number
}

export type WorkbenchWorkflowAction = {
  id: string
  label: string
  available: boolean
  kind: WorkbenchWorkflowActionKind
  input: string | null
  command: string | null
  control: WorkbenchWorkflowControlPayload | null
  reason: string | null
  destructive: boolean
  requires: string[]
}

export type WorkbenchWorkflowRegistryItem = {
  id: string
  name: string
  title: string | null
  description: string | null
  scope: WorkflowValidationCommandResult['target']['scope']
  source: string
  scriptPath: string | null
  validation: {
    ok: boolean
    status: 'pass' | 'warn' | 'fail'
    errors: number
    warnings: number
    issues: WorkflowAssetIssue[]
  }
  lifecycle: {
    status: string
    version: string | null
    owner: string | null
    lastTestedAt: string | null
    lastTestArtifact: string | null
    compatibility: string | null
  }
  phases: Array<{ title: string; detail: string | null; model: string | null }>
  budgets: Record<string, unknown>
  evidence: Record<string, unknown>
  actions: WorkbenchWorkflowAction[]
}

export type WorkbenchWorkflowRunItem = WorkflowJsonRun & {
  checkpoint: WorkflowCheckpoint | null
  controls: WorkbenchWorkflowAction[]
}

export type WorkbenchWorkflowGoalLink = {
  goalId: string
  runIds: string[]
  latestRunId: string | null
  states: Partial<Record<WorkflowMachineState, number>>
  evidence: string[]
  commands: string[]
  artifacts: string[]
  failures: string[]
  summary: string
}

export type WorkbenchWorkflowSnapshot = {
  version: 1
  surface: 'workbench-workflows'
  generatedAt: string
  summary: {
    registryAssets: number
    registryValid: number
    registryInvalid: number
    runs: number
    running: number
    blocked: number
    completed: number
    failed: number
    cancelled: number
    goalLinkedRuns: number
    goalLinks: number
    actionReceipts: number
    needsAttention: number
  }
  registry: {
    validationMode: 'legacy-compatible'
    emptyState: string | null
    actions: WorkbenchWorkflowAction[]
    assets: WorkbenchWorkflowRegistryItem[]
  }
  runs: {
    emptyState: string | null
    items: WorkbenchWorkflowRunItem[]
  }
  goalLinks: WorkbenchWorkflowGoalLink[]
  actionReceipts: {
    emptyState: string | null
    items: WorkbenchWorkflowActionReceipt[]
  }
}

function workflowAction(params: {
  id: string
  label: string
  available: boolean
  kind: WorkbenchWorkflowActionKind
  input?: string
  command?: string
  control?: WorkbenchWorkflowControlPayload
  reason?: string
  destructive?: boolean
  requires?: string[]
}): WorkbenchWorkflowAction {
  return {
    id: params.id,
    label: params.label,
    available: params.available,
    kind: params.kind,
    input: params.input ?? null,
    command: params.command ?? null,
    control: params.control ?? null,
    reason: params.reason ?? null,
    destructive: params.destructive ?? false,
    requires: params.requires ?? [],
  }
}

function assetName(result: WorkflowValidationCommandResult): string {
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

function issueCounts(issues: readonly WorkflowAssetIssue[]): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    if (issue.severity === 'warning') warnings += 1
  }
  return { errors, warnings }
}

function validationStatus(
  ok: boolean,
  counts: { errors: number; warnings: number },
): 'pass' | 'warn' | 'fail' {
  if (!ok || counts.errors > 0) return 'fail'
  return counts.warnings > 0 ? 'warn' : 'pass'
}

function registryActions(): WorkbenchWorkflowAction[] {
  return [
    workflowAction({
      id: 'workflow.registry.create',
      label: 'Create workflow',
      available: true,
      kind: 'slash-input',
      input: '/workflows create <name>',
      requires: ['name'],
    }),
    workflowAction({
      id: 'workflow.registry.validateAll',
      label: 'Validate all workflows',
      available: true,
      kind: 'slash-input',
      input: '/workflows validate --all --strict',
    }),
    workflowAction({
      id: 'workflow.registry.open',
      label: 'Refresh registry snapshot',
      available: true,
      kind: 'cli-command',
      command: 'mossen workflows --workbench --json',
    }),
  ]
}

function assetActions(name: string, ok: boolean): WorkbenchWorkflowAction[] {
  return [
    workflowAction({
      id: 'workflow.asset.explain',
      label: 'Explain',
      available: true,
      kind: 'slash-input',
      input: `/workflows explain ${name} --strict`,
    }),
    workflowAction({
      id: 'workflow.asset.validate',
      label: 'Validate',
      available: true,
      kind: 'slash-input',
      input: `/workflows validate ${name} --strict`,
    }),
    workflowAction({
      id: 'workflow.asset.test',
      label: 'Test',
      available: ok,
      kind: 'slash-input',
      input: `/workflows test ${name}`,
      reason: ok ? undefined : 'workflow validation must pass before testing',
    }),
    workflowAction({
      id: 'workflow.asset.runTest',
      label: 'Queue test run',
      available: ok,
      kind: 'slash-input',
      input: `/workflows test ${name} --run`,
      reason: ok ? undefined : 'workflow validation must pass before queueing a run',
    }),
    workflowAction({
      id: 'workflow.asset.run',
      label: 'Run workflow',
      available: ok,
      kind: 'slash-input',
      input: `/${name} {"task":"..."}`,
      requires: ['args'],
      reason: ok ? undefined : 'workflow validation must pass before running',
    }),
    workflowAction({
      id: 'workflow.asset.deprecate',
      label: 'Deprecate',
      available: false,
      kind: 'unsupported',
      reason: 'no stable workflow deprecate command exists yet',
    }),
  ]
}

function buildRegistryItem(
  result: WorkflowValidationCommandResult,
): WorkbenchWorkflowRegistryItem {
  const asset = result.validation?.asset
  const counts = issueCounts(result.issues)
  const name = assetName(result)
  return {
    id: `${result.target.scope}:${result.target.scriptPath ?? name}`,
    name,
    title: asset?.title ?? null,
    description: asset?.description ?? null,
    scope: result.target.scope,
    source: sourceLabel(result),
    scriptPath: result.target.scriptPath ?? asset?.scriptPath ?? null,
    validation: {
      ok: result.ok,
      status: validationStatus(result.ok, counts),
      errors: counts.errors,
      warnings: counts.warnings,
      issues: result.issues,
    },
    lifecycle: {
      status: asset?.lifecycle?.status ?? 'unknown',
      version: asset?.lifecycle?.version ?? null,
      owner: asset?.lifecycle?.owner ?? null,
      lastTestedAt: asset?.lifecycle?.lastTestedAt ?? null,
      lastTestArtifact: asset?.lifecycle?.lastTestArtifact ?? null,
      compatibility: asset?.lifecycle?.compatibility ?? null,
    },
    phases: (asset?.phases ?? []).map(phase => ({
      title: phase.title,
      detail: phase.detail ?? null,
      model: phase.model ?? null,
    })),
    budgets: asset?.budgets ?? {},
    evidence: asset?.evidence ?? {},
    actions: assetActions(name, result.ok),
  }
}

function collectTreeStates(
  run: WorkflowJsonRun,
  state: WorkflowTreeNodeState,
): number {
  let count = run.tree.state === state ? 1 : 0
  const stack = [...run.tree.children]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.state === state) count += 1
    stack.push(...node.children)
  }
  return count
}

function runControls(
  run: WorkflowJsonRun,
  checkpoint: WorkflowCheckpoint | null,
): WorkbenchWorkflowAction[] {
  const active = run.status === 'running' || run.status === 'paused'
  const liveController = isWorkflowRunActiveInCurrentProcess(run.runId)
  const liveControllerReason = 'requires a live workflow controller in this process'
  const canPause = run.status === 'running' && liveController
  const canStop = active && liveController
  const canResume = checkpoint?.resumeSafety.canResume === true
  const hasAgentControls =
    liveController &&
    active &&
    (collectTreeStates(run, 'running') > 0 || collectTreeStates(run, 'queued') > 0)
  return [
    workflowAction({
      id: 'workflow.run.openJson',
      label: 'Open run JSON',
      available: true,
      kind: 'cli-command',
      command: `mossen workflow ${run.runId} --json`,
    }),
    workflowAction({
      id: 'workflow.run.exportReport',
      label: 'Export report',
      available: true,
      kind: 'cli-command',
      command: `mossen workflow ${run.runId} --report`,
    }),
    workflowAction({
      id: 'workflow.run.pause',
      label: 'Pause workflow',
      available: canPause,
      kind: 'slash-input',
      input: `/workflows pause ${run.runId}`,
      control: canPause
        ? {
            subtype: 'workflow_control',
            actionId: 'workflow.run.pause',
            runId: run.runId,
          }
        : undefined,
      reason: canPause
        ? undefined
        : run.status === 'running'
          ? liveControllerReason
          : 'only running workflows can be paused',
    }),
    workflowAction({
      id: 'workflow.run.stop',
      label: 'Stop workflow',
      available: canStop,
      kind: 'slash-input',
      input: `/workflows stop ${run.runId}`,
      control: canStop
        ? {
            subtype: 'workflow_control',
            actionId: 'workflow.run.stop',
            runId: run.runId,
          }
        : undefined,
      destructive: true,
      reason: canStop
        ? undefined
        : active
          ? liveControllerReason
          : 'only running or paused workflows can be stopped',
    }),
    workflowAction({
      id: 'workflow.run.resume',
      label: 'Resume workflow',
      available: canResume,
      kind: 'slash-input',
      input: `/workflows resume ${run.runId}`,
      reason: canResume
        ? undefined
        : checkpoint?.resumeSafety.blockedReason ?? 'no resumable checkpoint',
    }),
    workflowAction({
      id: 'workflow.run.resumeTask',
      label: 'Resume task',
      available: canResume,
      kind: 'slash-input',
      input: `/workflows resume-task ${run.runId}`,
      reason: canResume
        ? undefined
        : checkpoint?.resumeSafety.blockedReason ?? 'no resumable checkpoint',
    }),
    workflowAction({
      id: 'workflow.run.stopAgent',
      label: 'Stop agent',
      available: hasAgentControls,
      kind: 'slash-input',
      input: `/workflows stop-agent ${run.runId} <agentNumber>`,
      destructive: true,
      requires: ['agentNumber'],
      reason: hasAgentControls
        ? undefined
        : active && !liveController
          ? liveControllerReason
          : 'requires a running or queued workflow agent',
    }),
    workflowAction({
      id: 'workflow.run.retryAgent',
      label: 'Retry agent',
      available: hasAgentControls,
      kind: 'slash-input',
      input: `/workflows restart-agent ${run.runId} <agentNumber>`,
      requires: ['agentNumber'],
      reason: hasAgentControls
        ? undefined
        : active && !liveController
          ? liveControllerReason
          : 'requires a running workflow agent',
    }),
    workflowAction({
      id: 'workflow.run.save',
      label: 'Save as reusable workflow',
      available: true,
      kind: 'slash-input',
      input: `/workflows save ${run.runId} <name>`,
      requires: ['name'],
    }),
  ]
}

function uniqueBounded(values: readonly string[], max = 12): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= max) break
  }
  return result
}

function goalLinksForRuns(
  runs: readonly WorkbenchWorkflowRunItem[],
): WorkbenchWorkflowGoalLink[] {
  const byGoal = new Map<string, WorkbenchWorkflowRunItem[]>()
  for (const run of runs) {
    if (!run.parentGoalId) continue
    const bucket = byGoal.get(run.parentGoalId) ?? []
    bucket.push(run)
    byGoal.set(run.parentGoalId, bucket)
  }
  return [...byGoal.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([goalId, goalRuns]) => {
      const states: Partial<Record<WorkflowMachineState, number>> = {}
      for (const run of goalRuns) states[run.state] = (states[run.state] ?? 0) + 1
      const latest = [...goalRuns].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0]
      const completed = states.completed ?? 0
      const failed = states.failed ?? 0
      const blocked = states.blocked ?? 0
      return {
        goalId,
        runIds: goalRuns.map(run => run.runId),
        latestRunId: latest?.runId ?? null,
        states,
        evidence: uniqueBounded(goalRuns.flatMap(run => run.verification.evidence)),
        commands: uniqueBounded(goalRuns.flatMap(run => run.verification.commands)),
        artifacts: uniqueBounded(goalRuns.flatMap(run => run.verification.artifacts)),
        failures: uniqueBounded(goalRuns.flatMap(run => run.failures)),
        summary: `${goalRuns.length} workflow run(s), ${completed} completed, ${failed} failed, ${blocked} blocked`,
      }
    })
}

function buildRunItem(run: WorkflowJsonRun): WorkbenchWorkflowRunItem {
  const checkpoint = loadWorkflowCheckpoint(run.runId)
  return {
    ...run,
    checkpoint,
    controls: runControls(run, checkpoint),
  }
}

function countRuns(
  runs: readonly WorkbenchWorkflowRunItem[],
  state: WorkflowMachineState,
): number {
  return runs.filter(run => run.state === state).length
}

export function buildWorkbenchWorkflowSnapshot(options: {
  runs: WorkflowRunMeta[]
  registryResults: WorkflowValidationCommandResult[]
  generatedAt?: string
}): WorkbenchWorkflowSnapshot {
  const registryAssets = options.registryResults.map(buildRegistryItem)
  const runs = workflowRunsToJson(options.runs).map(buildRunItem)
  const goalLinks = goalLinksForRuns(runs)
  const actionReceipts = loadWorkbenchWorkflowActionReceipts()
  const invalidAssets = registryAssets.filter(asset => !asset.validation.ok).length
  const needsAttention = runs.filter(run =>
    run.state === 'failed' ||
    run.state === 'blocked' ||
    run.verification.state === 'failed' ||
    run.failures.length > 0
  ).length
  return {
    version: 1,
    surface: 'workbench-workflows',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      registryAssets: registryAssets.length,
      registryValid: registryAssets.length - invalidAssets,
      registryInvalid: invalidAssets,
      runs: runs.length,
      running: countRuns(runs, 'running'),
      blocked: countRuns(runs, 'blocked'),
      completed: countRuns(runs, 'completed'),
      failed: countRuns(runs, 'failed'),
      cancelled: countRuns(runs, 'cancelled'),
      goalLinkedRuns: runs.filter(run => Boolean(run.parentGoalId)).length,
      goalLinks: goalLinks.length,
      actionReceipts: actionReceipts.length,
      needsAttention,
    },
    registry: {
      validationMode: 'legacy-compatible',
      emptyState: registryAssets.length === 0
        ? 'No workflow assets found. Create one with /workflows create <name>.'
        : null,
      actions: registryActions(),
      assets: registryAssets,
    },
    runs: {
      emptyState: runs.length === 0
        ? 'No workflow runs recorded for this session.'
        : null,
      items: runs,
    },
    goalLinks,
    actionReceipts: {
      emptyState: actionReceipts.length === 0
        ? 'No Workbench workflow action receipts recorded for this session.'
        : null,
      items: actionReceipts,
    },
  }
}

export function buildWorkbenchWorkflowRunSnapshot(
  meta: WorkflowRunMeta,
): WorkbenchWorkflowRunItem {
  return buildRunItem(workflowRunToJson(meta))
}
