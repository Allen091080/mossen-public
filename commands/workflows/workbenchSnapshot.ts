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
import {
  loadWorkflowPublicationRegistry,
  type PublishedWorkflowAsset,
  type WorkflowPublicationReceipt,
} from './publicationRegistry.js'
import {
  loadPublishedWorkflowRuntimeRegistry,
  type EnabledPublishedWorkflow,
  type PublishedWorkflowRun,
  type PublishedWorkflowRuntimeReceipt,
} from './publishedRunProtocol.js'

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
  scope: WorkflowValidationCommandResult['target']['scope'] | 'published'
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
    sourceDigest: string | null
    lastReceiptId: string | null
    executionStatus: 'enabled' | 'not_enabled' | null
    enabledVersion: string | null
    enabledSourceDigest: string | null
    lastEnableReceiptId: string | null
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
    publishedRuns: number
    waitingApproval: number
    waitingPermission: number
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
  publishedRuns: {
    emptyState: string | null
    items: PublishedWorkflowRun[]
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
      sourceDigest: null,
      lastReceiptId: null,
      executionStatus: null,
      enabledVersion: null,
      enabledSourceDigest: null,
      lastEnableReceiptId: null,
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

function publishedAssetActions(
  asset: PublishedWorkflowAsset,
  enabled: EnabledPublishedWorkflow | undefined,
): WorkbenchWorkflowAction[] {
  const exactEnabled =
    enabled?.assetVersion === asset.assetVersion &&
    enabled.sourceDigest === asset.sourceDigest
  return [
    workflowAction({
      id: 'workflow.asset.reconcilePublication',
      label: 'Reconcile publication',
      available: true,
      kind: 'cli-command',
      command: 'mossen workflows --workbench --json',
    }),
    workflowAction({
      id: 'workflow.asset.validatePublished',
      label: 'Validate published workflow',
      available: false,
      kind: 'unsupported',
      reason: 'typed validation requires the original Business Asset v2 stdin envelope',
    }),
    workflowAction({
      id: 'workflow.asset.enablePublished',
      label: 'Enable published workflow',
      available: !exactEnabled,
      kind: 'cli-command',
      command: 'mossen workflows enable-published --stdin --json',
      reason: exactEnabled ? 'the current published identity is already enabled' : undefined,
      requires: ['assetId', 'assetVersion', 'sourceDigest', 'idempotencyKey'],
    }),
    workflowAction({
      id: 'workflow.asset.runPublished',
      label: 'Run published workflow',
      available: exactEnabled,
      kind: 'cli-command',
      command: 'mossen workflows run-published --stdin --json',
      reason: exactEnabled
        ? undefined
        : 'the exact asset version and source digest must be enabled first',
      requires: ['assetId', 'assetVersion', 'sourceDigest', 'idempotencyKey'],
    }),
    workflowAction({
      id: 'workflow.asset.deprecate',
      label: 'Deprecate',
      available: false,
      kind: 'unsupported',
      reason: 'no stable workflow deprecate command exists yet',
      destructive: true,
    }),
  ]
}

function publishedRegistryItem(
  asset: PublishedWorkflowAsset,
  enabled: EnabledPublishedWorkflow | undefined,
): WorkbenchWorkflowRegistryItem {
  const nodes = Array.isArray(asset.definition.nodes)
    ? asset.definition.nodes
    : []
  return {
    id: asset.assetId,
    name: asset.canonicalName,
    title: asset.displayName,
    description: asset.description || null,
    scope: 'published',
    source: `publication ${asset.scope}`,
    scriptPath: null,
    validation: {
      ok: true,
      status: 'pass',
      errors: 0,
      warnings: 0,
      issues: [],
    },
    lifecycle: {
      status: asset.lifecycle,
      version: asset.assetVersion,
      owner: asset.scope,
      lastTestedAt: null,
      lastTestArtifact: null,
      compatibility: 'mossen-desktop-workflow-business-asset/v2',
      sourceDigest: asset.sourceDigest,
      lastReceiptId: asset.lastReceiptId,
      executionStatus:
        enabled?.assetVersion === asset.assetVersion &&
        enabled.sourceDigest === asset.sourceDigest
          ? 'enabled'
          : 'not_enabled',
      enabledVersion: enabled?.assetVersion ?? null,
      enabledSourceDigest: enabled?.sourceDigest ?? null,
      lastEnableReceiptId: enabled?.lastReceiptId ?? null,
    },
    phases: nodes.flatMap(node => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return []
      const record = node as Record<string, unknown>
      const business = record.business
      const title =
        business && typeof business === 'object' && !Array.isArray(business) &&
        typeof (business as Record<string, unknown>).title === 'string'
          ? String((business as Record<string, unknown>).title)
          : typeof record.type === 'string'
            ? record.type
            : 'workflow-step'
      return [{ title, detail: null, model: null }]
    }),
    budgets: {},
    evidence: {
      draftId: asset.draftId,
      localRevision: asset.localRevision,
      sourceDigest: asset.sourceDigest,
      receiptId: asset.lastReceiptId,
      enabledIdentity: enabled ?? null,
    },
    actions: publishedAssetActions(asset, enabled),
  }
}

function runtimeActionReceipt(
  receipt: PublishedWorkflowRuntimeReceipt,
): WorkbenchWorkflowActionReceipt {
  const actionId =
    receipt.action === 'enable'
      ? 'workflow.asset.enablePublished'
      : receipt.action === 'invoke'
        ? 'workflow.asset.runPublished'
        : receipt.action === 'retry'
          ? 'workflow.run.retryPublished'
          : receipt.action === 'decide'
            ? 'workflow.run.decidePublished'
            : 'workflow.run.cancelPublished'
  return {
    version: 1,
    receiptId: receipt.receiptId,
    actionId,
    status: 'accepted',
    createdAt: receipt.createdAt,
    input: null,
    command: `mossen workflows ${
      receipt.action === 'enable'
        ? 'enable-published'
        : receipt.action === 'invoke'
          ? 'run-published'
          : receipt.action === 'retry'
            ? 'retry-published-run'
            : receipt.action === 'decide'
              ? 'decide-published-run'
              : 'cancel-published-run'
    } --stdin --json`,
    runId: receipt.runId,
    workflowName: receipt.workflowName,
    message: `${receipt.action} accepted for ${receipt.assetId}${
      receipt.runId ? ` run ${receipt.runId}` : ''
    }.`,
    source: 'system',
    requestId: receipt.requestId,
    idempotencyKey: receipt.idempotencyKey,
    assetId: receipt.assetId,
    assetVersion: receipt.assetVersion,
    sourceDigest: receipt.sourceDigest,
    ...(receipt.retryOfRunId !== undefined
      ? { retryOfRunId: receipt.retryOfRunId }
      : {}),
    ...(receipt.artifactIds !== undefined
      ? { artifactIds: receipt.artifactIds }
      : {}),
    ...(receipt.runRevision !== undefined
      ? { runRevision: receipt.runRevision }
      : {}),
    ...(receipt.waitId !== undefined ? { waitId: receipt.waitId } : {}),
    ...(receipt.decisionId !== undefined
      ? { decisionId: receipt.decisionId }
      : {}),
  }
}

function publicationActionReceipt(
  receipt: WorkflowPublicationReceipt,
): WorkbenchWorkflowActionReceipt {
  return {
    version: 1,
    receiptId: receipt.receiptId,
    actionId: 'workflow.asset.publish',
    status: 'accepted',
    createdAt: receipt.publishedAt,
    input: null,
    command: 'mossen workflows publish-draft --stdin --json',
    runId: null,
    workflowName: receipt.canonicalName,
    message: `Published ${receipt.assetId} version ${receipt.assetVersion}.`,
    source: 'system',
    requestId: receipt.requestId,
    idempotencyKey: receipt.idempotencyKey,
    draftId: receipt.draftId,
    assetId: receipt.assetId,
    assetVersion: receipt.assetVersion,
    sourceDigest: receipt.sourceDigest,
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
  const publicationRegistry = loadWorkflowPublicationRegistry()
  const runtimeRegistry = loadPublishedWorkflowRuntimeRegistry()
  const registryAssets = [
    ...options.registryResults.map(buildRegistryItem),
    ...publicationRegistry.assets.map(asset =>
      publishedRegistryItem(asset, runtimeRegistry.enabled[asset.assetId]),
    ),
  ]
  const runs = workflowRunsToJson(options.runs).map(buildRunItem)
  const goalLinks = goalLinksForRuns(runs)
  const actionReceipts = [
    ...loadWorkbenchWorkflowActionReceipts(),
    ...publicationRegistry.receipts.map(publicationActionReceipt),
    ...runtimeRegistry.receipts.map(runtimeActionReceipt),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50)
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
      publishedRuns: runtimeRegistry.runs.length,
      waitingApproval: runtimeRegistry.runs.filter(
        run => run.state === 'waiting_approval',
      ).length,
      waitingPermission: runtimeRegistry.runs.filter(
        run => run.state === 'waiting_permission',
      ).length,
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
    publishedRuns: {
      emptyState:
        runtimeRegistry.runs.length === 0
          ? 'No published workflow runs recorded.'
          : null,
      items: runtimeRegistry.runs,
    },
  }
}

export function buildWorkbenchWorkflowRunSnapshot(
  meta: WorkflowRunMeta,
): WorkbenchWorkflowRunItem {
  return buildRunItem(workflowRunToJson(meta))
}
