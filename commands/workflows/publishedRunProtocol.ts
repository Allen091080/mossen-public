import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteJsonSync } from '../../utils/atomicWriteJson.js'
import { lock } from '../../utils/lockfile.js'
import { getMossenHome } from '../../utils/mossenHome.js'
import { validateUuid } from '../../utils/uuid.js'
import {
  loadWorkflowPublicationRegistry,
  type PublishedWorkflowAsset,
} from './publicationRegistry.js'
import { stableWorkflowPublicationJson } from './publicationProtocol.js'

const RUNTIME_FILE = 'runtime-v1.json'
const RUNTIME_LOCK_FILE = '.runtime-v1.lock'
const MAX_RUNTIME_RECEIPTS = 500
const MAX_RUNTIME_RUNS = 500

export type PublishedWorkflowRunState =
  | 'running'
  | 'waiting_approval'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled'

function isTerminalRunState(state: PublishedWorkflowRunState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

export type PublishedWorkflowStepState =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export type PublishedWorkflowEvidence = {
  kind: 'input' | 'output' | 'approval' | 'permission' | 'error'
  capturedAt: string
  digest: string
  summary: string
  value?: unknown
}

export type PublishedWorkflowRuntimeProjection = {
  nodeId: string
  roleBindingId: string
  position: {
    id: string
    version: number
    digest: string
  }
  worker: {
    id: string
    version: number
    digest: string
  }
  grantDigest: string
  catalogDigest: string
  policyDigest: string
  runtime: {
    adapterId: 'mossen-cli'
    agentRef: string
    modelRef: string | null
  }
  skills: {
    required: string[]
    resolved: string[]
  }
  tools: {
    inventory: string[]
    allow: string[]
    ask: string[]
    deny: string[]
  }
  connectorRefs: string[]
  resourceScopes: string[]
  acceptedAt: string
  projectionDigest: string
}

export type PublishedWorkflowWaitKind = 'approval' | 'permission'
export type PublishedWorkflowWaitScope =
  | 'human_approval'
  | 'step_execution'
  | 'runtime_tool'
  | 'connector_action'
  | 'resource_access'

export type PublishedWorkflowWait = {
  waitId: string
  waitDigest: string
  occurrence: number
  kind: PublishedWorkflowWaitKind
  scope: PublishedWorkflowWaitScope
  nodeId: string
  roleBindingId: string | null
  createdAt: string
  status: 'waiting'
  action: {
    kind: 'approval' | 'step' | 'tool' | 'connector' | 'resource'
    id: string
    inputDigest: string
    safeSummary: string
  }
  grantDigest: string | null
  catalogDigest: string | null
  policyDigest: string | null
  allowedOutcomes: Array<'approve' | 'reject' | 'allow_once' | 'deny'>
}

export type PublishedWorkflowDecision = {
  decisionId: string
  receiptId: string
  requestId: string
  idempotencyKey: string
  requestFingerprint: string
  waitId: string
  waitDigest: string
  runRevisionBefore: number
  runRevisionAfter: number
  kind: PublishedWorkflowWaitKind
  outcome: 'approve' | 'reject' | 'allow_once' | 'deny'
  reason: string | null
  actor: {
    kind: 'user' | 'system' | 'service'
    subjectId: string
    assurance: 'client_asserted'
  }
  decidedAt: string
}

export type PublishedWorkflowExecutionAttempt = {
  attemptId: string
  operationId: string
  nodeId: string
  waitId: string
  kind: 'agent_step' | 'runtime_tool'
  status: 'prepared' | 'dispatched' | 'waiting' | 'completed' | 'failed' | 'unknown'
  preparedAt: string
  dispatchedAt: string | null
  completedAt: string | null
  toolId: string | null
  toolUseId?: string | null
  inputDigest: string | null
  resultDigest: string | null
  errorCode: string | null
}

export type PublishedWorkflowStepRuntimeEvidence = {
  adapterId: 'mossen-cli'
  runtimeVersion: string | null
  runtimeBuild: string | null
  sessionId: string | null
  requestedSkillIds: string[]
  resolvedSkillIds: string[]
  preloadedSkillIds: string[]
  failedSkillIds: string[]
  offeredToolInventory: string[]
  toolAllow: string[]
  toolAsk: string[]
  toolDeny: string[]
  permissionWaitIds: string[]
  decisionIds: string[]
  executionAttemptIds: string[]
  outputDigest: string | null
  errorDigest: string | null
}

export type PublishedWorkflowStep = {
  nodeId: string
  nodeType: string
  title: string
  state: PublishedWorkflowStepState
  startedAt: string | null
  completedAt: string | null
  evidence: PublishedWorkflowEvidence[]
  approval: {
    status: 'not_required' | 'waiting'
    message: string | null
  }
  permission: {
    status: 'not_required' | 'waiting'
    capability: string | null
    reason: string | null
  }
  runtimeEvidence: PublishedWorkflowStepRuntimeEvidence | null
  error: string | null
}

export type PublishedWorkflowArtifact = {
  artifactId: string
  name: string
  kind: string
  mediaType: string
  digest: string
  sizeBytes: number
  producedByNodeId: string
  createdAt: string
  uri: string
}

export type PublishedWorkflowRun = {
  version: 1
  surface: 'workflow-published-run'
  runId: string
  retryOfRunId: string | null
  requestId: string
  idempotencyKey: string
  receiptId: string
  assetId: string
  assetVersion: string
  sourceDigest: string
  workflowName: string
  revision: number
  executionProtocolVersion: 1 | null
  state: PublishedWorkflowRunState
  createdAt: string
  updatedAt: string
  startedAt: string
  completedAt: string | null
  cancelledAt: string | null
  input: unknown
  steps: PublishedWorkflowStep[]
  artifacts: PublishedWorkflowArtifact[]
  runtimeProjections: PublishedWorkflowRuntimeProjection[]
  pendingWaits: PublishedWorkflowWait[]
  waitHistory: PublishedWorkflowWait[]
  decisions: PublishedWorkflowDecision[]
  executionAttempts: PublishedWorkflowExecutionAttempt[]
  waits: {
    approvalNodeIds: string[]
    permissionNodeIds: string[]
  }
  finalResult: {
    status: 'succeeded' | 'failed' | 'cancelled'
    digest: string
    value?: unknown
    error?: string
  } | null
}

export type PublishedWorkflowRuntimeReceipt = {
  version: 1
  surface:
    | 'workflow-enable-receipt'
    | 'workflow-run-receipt'
    | 'workflow-run-retry-receipt'
    | 'workflow-run-cancel-receipt'
    | 'workflow-published-run-decision-receipt'
  action: 'enable' | 'invoke' | 'retry' | 'cancel' | 'decide'
  status: 'accepted'
  requestId: string
  idempotencyKey: string
  receiptId: string
  assetId: string
  assetVersion: string
  sourceDigest: string
  workflowName: string
  runId: string | null
  runState: PublishedWorkflowRunState | null
  runRevision?: number | null
  waitId?: string | null
  decisionId?: string | null
  retryOfRunId?: string | null
  artifactIds?: string[]
  createdAt: string
}

export type EnabledPublishedWorkflow = {
  assetId: string
  assetVersion: string
  sourceDigest: string
  workflowName: string
  enabledAt: string
  lastReceiptId: string
}

export type PublishedWorkflowRuntimeRegistry = {
  version: 1
  updatedAt: string
  enabled: Record<string, EnabledPublishedWorkflow>
  receipts: PublishedWorkflowRuntimeReceipt[]
  runs: PublishedWorkflowRun[]
  checkpoints: Record<string, PublishedWorkflowExecutionCheckpoint>
  idempotency: Record<
    string,
    {
      operation: 'enable' | 'invoke' | 'retry' | 'cancel' | 'decide'
      fingerprint: string
      response: unknown
    }
  >
}

export type PublishedWorkflowConflictCode =
  | 'invalid_request'
  | 'idempotency_key_conflict'
  | 'asset_not_found'
  | 'stale_asset_identity'
  | 'asset_not_enabled'
  | 'run_not_found'
  | 'run_identity_conflict'
  | 'run_not_retryable'
  | 'run_not_cancellable'
  | 'run_not_waiting'
  | 'wait_not_found'
  | 'stale_wait'
  | 'run_revision_conflict'
  | 'unsupported_decision'
  | 'unsupported_executor'
  | 'execution_grant_missing'
  | 'execution_grant_conflict'
  | 'runtime_catalog_drift'
  | 'resume_failed'
  | 'execution_outcome_unknown'
  | 'runtime_unavailable'

export type PublishedWorkflowConflict = {
  version: 1
  surface: 'workflow-published-run-conflict'
  operation: 'enable' | 'invoke' | 'retry' | 'query' | 'cancel' | 'decide'
  status: 'rejected'
  requestId: string
  idempotencyKey: string | null
  code: PublishedWorkflowConflictCode
  message: string
  current: {
    assetId: string
    assetVersion: string
    sourceDigest: string
    runId?: string
    runState?: PublishedWorkflowRunState
  } | null
}

export type PublishedWorkflowEnableResponse = PublishedWorkflowRuntimeReceipt & {
  surface: 'workflow-enable-receipt'
  lifecycle: 'enabled'
}

export type PublishedWorkflowInvokeResponse = PublishedWorkflowRuntimeReceipt & {
  surface: 'workflow-run-receipt'
  runId: string
  runState: PublishedWorkflowRunState
  run: PublishedWorkflowRun
}

export type PublishedWorkflowQueryResponse = {
  version: 1
  surface: 'workflow-run-query'
  requestId: string
  assetId: string
  assetVersion: string
  sourceDigest: string
  runId: string
  run: PublishedWorkflowRun
}

export type PublishedWorkflowRetryResponse = PublishedWorkflowRuntimeReceipt & {
  surface: 'workflow-run-retry-receipt'
  action: 'retry'
  runId: string
  runState: PublishedWorkflowRunState
  retryOfRunId: string
  run: PublishedWorkflowRun
}

export type PublishedWorkflowCancelResponse = PublishedWorkflowRuntimeReceipt & {
  surface: 'workflow-run-cancel-receipt'
  runId: string
  runState: 'cancelled'
  run: PublishedWorkflowRun
}

export type PublishedWorkflowDecisionResponse = PublishedWorkflowRuntimeReceipt & {
  surface: 'workflow-published-run-decision-receipt'
  action: 'decide'
  runId: string
  runState: PublishedWorkflowRunState
  runRevision: number
  waitId: string
  decisionId: string
  run: PublishedWorkflowRun
}

export type PublishedWorkflowExecutionCheckpoint = {
  version: 1
  runId: string
  assetSnapshot: PublishedWorkflowAsset
  nextNodeIndex: number
  currentValue: unknown
  variables: Record<string, unknown>
  waitOccurrences: Record<string, number>
  agentSessions: Record<
    string,
    {
      sessionId: string
      workspace: string
      agentName: string
      definitionDigest: string
      agentDefinition: {
        description: string
        prompt: string
        tools: string[]
        skills: string[]
        permissionMode: 'default'
        model?: string
      }
      pendingTool: {
        requestId: string
        toolUseId: string
        toolId: string
        input: unknown
        inputDigest: string
      } | null
    }
  >
}

export type PublishedAgentRuntimeRequest = {
  phase: 'start' | 'resume_tool'
  runId: string
  nodeId: string
  nodeTitle: string
  nodeConfig: Record<string, unknown>
  input: unknown
  projection: PublishedWorkflowRuntimeProjection
  operationId: string
  session:
    | PublishedWorkflowExecutionCheckpoint['agentSessions'][string]
    | null
  toolDecision?: {
    outcome: 'allow_once'
    reason: string | null
    waitId: string
    decisionId: string
  }
}

export type PublishedAgentRuntimeToolExecution = {
  toolId: string
  toolUseId: string
  inputDigest: string
  resultDigest: string
}

export type PublishedAgentRuntimeOutcome =
  | {
      status: 'waiting'
      session: PublishedWorkflowExecutionCheckpoint['agentSessions'][string]
      runtimeVersion: string
      runtimeBuild: string
      requestedSkillIds: string[]
      resolvedSkillIds: string[]
      preloadedSkillIds: string[]
      failedSkillIds: string[]
      toolExecution: PublishedAgentRuntimeToolExecution | null
      toolExecutions?: PublishedAgentRuntimeToolExecution[]
    }
  | {
      status: 'completed'
      session: PublishedWorkflowExecutionCheckpoint['agentSessions'][string]
      runtimeVersion: string
      runtimeBuild: string
      requestedSkillIds: string[]
      resolvedSkillIds: string[]
      preloadedSkillIds: string[]
      failedSkillIds: string[]
      output: unknown
      toolExecution: PublishedAgentRuntimeToolExecution | null
      toolExecutions?: PublishedAgentRuntimeToolExecution[]
    }
  | {
      status: 'failed'
      session:
        | PublishedWorkflowExecutionCheckpoint['agentSessions'][string]
        | null
      runtimeVersion: string | null
      runtimeBuild: string | null
      requestedSkillIds: string[]
      resolvedSkillIds: string[]
      preloadedSkillIds: string[]
      failedSkillIds: string[]
      code: string
      error: string
      toolExecutions?: PublishedAgentRuntimeToolExecution[]
    }
  | {
      status: 'unknown'
      session:
        | PublishedWorkflowExecutionCheckpoint['agentSessions'][string]
        | null
      runtimeVersion: string | null
      runtimeBuild: string | null
      requestedSkillIds: string[]
      resolvedSkillIds: string[]
      preloadedSkillIds: string[]
      failedSkillIds: string[]
      code: 'execution_outcome_unknown'
      error: string
      toolExecutions?: PublishedAgentRuntimeToolExecution[]
    }

export type PublishedAgentRuntimeExecutor = (
  request: PublishedAgentRuntimeRequest,
) => Promise<PublishedAgentRuntimeOutcome>

export type PublishedAgentRuntimeSessionPreparer = (
  request: PublishedAgentRuntimeRequest,
) => Promise<PublishedWorkflowExecutionCheckpoint['agentSessions'][string]>

export type PublishedWorkflowOperationResult<T> =
  | { ok: true; response: T; replayed: boolean }
  | { ok: false; conflict: PublishedWorkflowConflict }

type IdentityRequest = {
  protocolVersion: 1
  requestId: string
  assetId: string
  assetVersion: string
  sourceDigest: string
}

type MutationRequest = IdentityRequest & { idempotencyKey: string }
type InvokeRequest = MutationRequest & {
  input?: unknown
  executionProtocolVersion?: 1
  runtimeProjections?: PublishedWorkflowRuntimeProjectionInput[]
}
type RunRequest = IdentityRequest & { runId: string }
type RetryRequest = RunRequest & { idempotencyKey: string }
type CancelRequest = RunRequest & {
  idempotencyKey: string
  expectedRunRevision?: number
}
type DecisionRequest = RunRequest & {
  idempotencyKey: string
  expectedRunRevision: number
  waitId: string
  waitDigest: string
  nodeId?: string
  decision: {
    kind: PublishedWorkflowWaitKind
    outcome: 'approve' | 'reject' | 'allow_once' | 'deny'
    reason: string | null
    actor: {
      kind: 'user' | 'system' | 'service'
      subjectId: string
    }
  }
}

type PublishedWorkflowRuntimeProjectionInput = Omit<
  PublishedWorkflowRuntimeProjection,
  'acceptedAt' | 'projectionDigest'
>

const SHA256_RE = /^[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function emptyRegistry(): PublishedWorkflowRuntimeRegistry {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    enabled: {},
    receipts: [],
    runs: [],
    checkpoints: {},
    idempotency: {},
  }
}

export function publishedWorkflowRuntimeRegistryPath(): string {
  return join(getMossenHome(), 'workflow-publication', RUNTIME_FILE)
}

function runtimeLockPath(): string {
  return join(getMossenHome(), 'workflow-publication', RUNTIME_LOCK_FILE)
}

export function loadPublishedWorkflowRuntimeRegistry(): PublishedWorkflowRuntimeRegistry {
  const path = publishedWorkflowRuntimeRegistryPath()
  if (!existsSync(path)) return emptyRegistry()
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.updatedAt !== 'string' ||
    !isRecord(value.enabled) ||
    !Array.isArray(value.receipts) ||
    !Array.isArray(value.runs) ||
    !isRecord(value.idempotency)
  ) {
    throw new Error('Published workflow runtime registry has an invalid v1 shape.')
  }
  const registry = value as PublishedWorkflowRuntimeRegistry
  return {
    ...registry,
    checkpoints: isRecord(
      (registry as Partial<PublishedWorkflowRuntimeRegistry>).checkpoints,
    )
      ? registry.checkpoints
      : {},
    runs: registry.runs.map(run => ({
      ...run,
      revision:
        Number.isInteger((run as Partial<PublishedWorkflowRun>).revision) &&
        Number((run as Partial<PublishedWorkflowRun>).revision) >= 0
          ? Number((run as Partial<PublishedWorkflowRun>).revision)
          : 0,
      executionProtocolVersion:
        (run as Partial<PublishedWorkflowRun>).executionProtocolVersion === 1
          ? 1
          : null,
      retryOfRunId:
        typeof (run as Partial<PublishedWorkflowRun>).retryOfRunId === 'string'
          ? run.retryOfRunId
          : null,
      artifacts: Array.isArray((run as Partial<PublishedWorkflowRun>).artifacts)
        ? run.artifacts
        : [],
      runtimeProjections: Array.isArray(
        (run as Partial<PublishedWorkflowRun>).runtimeProjections,
      )
        ? run.runtimeProjections
        : [],
      pendingWaits: Array.isArray(
        (run as Partial<PublishedWorkflowRun>).pendingWaits,
      )
        ? run.pendingWaits
        : [],
      waitHistory: Array.isArray(
        (run as Partial<PublishedWorkflowRun>).waitHistory,
      )
        ? run.waitHistory
        : [],
      decisions: Array.isArray((run as Partial<PublishedWorkflowRun>).decisions)
        ? run.decisions
        : [],
      executionAttempts: Array.isArray(
        (run as Partial<PublishedWorkflowRun>).executionAttempts,
      )
        ? run.executionAttempts
        : [],
      steps: Array.isArray(run.steps)
        ? run.steps.map(step => ({
            ...step,
            runtimeEvidence:
              (step as Partial<PublishedWorkflowStep>).runtimeEvidence ?? null,
          }))
        : [],
    })),
  }
}

function hash(prefix: string, value: string, length = 24): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, length)}`
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(stableWorkflowPublicationJson(value), 'utf8')
    .digest('hex')
}

function valueJson(value: unknown): string {
  return stableWorkflowPublicationJson(value) ?? 'null'
}

let publishedAgentRuntimeExecutorForTests:
  | PublishedAgentRuntimeExecutor
  | undefined
let publishedAgentRuntimeSessionPreparerForTests:
  | PublishedAgentRuntimeSessionPreparer
  | undefined

export function setPublishedAgentRuntimeExecutorForTests(
  executor: PublishedAgentRuntimeExecutor | undefined,
): void {
  publishedAgentRuntimeExecutorForTests = executor
}

export function setPublishedAgentRuntimeSessionPreparerForTests(
  preparer: PublishedAgentRuntimeSessionPreparer | undefined,
): void {
  publishedAgentRuntimeSessionPreparerForTests = preparer
}

async function preparePublishedAgentSession(
  request: PublishedAgentRuntimeRequest,
): Promise<PublishedWorkflowExecutionCheckpoint['agentSessions'][string]> {
  if (publishedAgentRuntimeSessionPreparerForTests) {
    return publishedAgentRuntimeSessionPreparerForTests(request)
  }
  const { preparePublishedAgentRuntimeSession } = await import(
    './publishedAgentRuntime.js'
  )
  return preparePublishedAgentRuntimeSession(request)
}

async function executePublishedAgent(
  request: PublishedAgentRuntimeRequest,
): Promise<PublishedAgentRuntimeOutcome> {
  if (publishedAgentRuntimeExecutorForTests) {
    return publishedAgentRuntimeExecutorForTests(request)
  }
  const { executePublishedAgentRuntime } = await import(
    './publishedAgentRuntime.js'
  )
  return executePublishedAgentRuntime(request)
}

async function prepareRuntimeSessions(
  asset: PublishedWorkflowAsset,
  request: InvokeRequest,
  runId: string,
  projections: readonly PublishedWorkflowRuntimeProjection[],
): Promise<PublishedWorkflowExecutionCheckpoint['agentSessions']> {
  const nodes = publishedNodes(asset)
  const sessions: PublishedWorkflowExecutionCheckpoint['agentSessions'] = {}
  for (const projection of projections) {
    const node = nodes.find(item => String(item.id) === projection.nodeId)
    if (!node) {
      throw new Error(`Frozen Agent node ${projection.nodeId} is unavailable.`)
    }
    sessions[projection.nodeId] = await preparePublishedAgentSession({
      phase: 'start',
      runId,
      nodeId: projection.nodeId,
      nodeTitle: nodeTitle(node),
      nodeConfig: requestStrings(node.config),
      input: request.input ?? null,
      projection,
      operationId: hash(
        'wfprepare',
        `${runId}:${projection.nodeId}:${projection.projectionDigest}`,
      ),
      session: null,
    })
  }
  return sessions
}

function evidence(
  kind: PublishedWorkflowEvidence['kind'],
  value: unknown,
  capturedAt: string,
  captureValue: boolean,
  summary: string,
): PublishedWorkflowEvidence {
  return {
    kind,
    capturedAt,
    digest: createHash('sha256').update(valueJson(value), 'utf8').digest('hex'),
    summary,
    ...(captureValue ? { value } : {}),
  }
}

function requestStrings(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function parseIdentityRequest(value: unknown): IdentityRequest | null {
  const request = requestStrings(value)
  if (
    request.protocolVersion !== 1 ||
    !validateUuid(request.requestId) ||
    typeof request.assetId !== 'string' ||
    !request.assetId ||
    typeof request.assetVersion !== 'string' ||
    !request.assetVersion ||
    typeof request.sourceDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.sourceDigest)
  ) {
    return null
  }
  return request as IdentityRequest
}

function parseMutationRequest(value: unknown): MutationRequest | null {
  const identity = parseIdentityRequest(value)
  const request = requestStrings(value)
  if (!identity || !validateUuid(request.idempotencyKey)) return null
  return request as MutationRequest
}

function parseInvokeRequest(value: unknown): InvokeRequest | null {
  const request = parseMutationRequest(value)
  if (!request) return null
  const raw = requestStrings(value)
  const hasProtocol = raw.executionProtocolVersion !== undefined
  const hasProjections = raw.runtimeProjections !== undefined
  if (hasProtocol !== hasProjections) return null
  if (
    hasProtocol &&
    (raw.executionProtocolVersion !== 1 || !Array.isArray(raw.runtimeProjections))
  ) {
    return null
  }
  return raw as InvokeRequest
}

function parseRunRequest(value: unknown): RunRequest | null {
  const identity = parseIdentityRequest(value)
  const request = requestStrings(value)
  if (!identity || typeof request.runId !== 'string' || !request.runId) return null
  return request as RunRequest
}

function parseCancelRequest(value: unknown): CancelRequest | null {
  const request = parseRunRequest(value)
  const raw = requestStrings(value)
  if (
    !request ||
    !validateUuid(raw.idempotencyKey) ||
    (raw.expectedRunRevision !== undefined &&
      (!Number.isInteger(raw.expectedRunRevision) ||
        Number(raw.expectedRunRevision) < 0))
  ) {
    return null
  }
  return raw as CancelRequest
}

function parseRetryRequest(value: unknown): RetryRequest | null {
  const request = parseRunRequest(value)
  const raw = requestStrings(value)
  if (!request || !validateUuid(raw.idempotencyKey)) return null
  return raw as RetryRequest
}

function parseDecisionRequest(value: unknown): DecisionRequest | null {
  const request = parseRunRequest(value)
  const raw = requestStrings(value)
  const decision = requestStrings(raw.decision)
  const actor = requestStrings(decision.actor)
  if (
    !request ||
    !validateUuid(raw.idempotencyKey) ||
    !Number.isInteger(raw.expectedRunRevision) ||
    Number(raw.expectedRunRevision) < 0 ||
    typeof raw.waitId !== 'string' ||
    !raw.waitId ||
    typeof raw.waitDigest !== 'string' ||
    !SHA256_RE.test(raw.waitDigest) ||
    (raw.nodeId !== undefined && !nonEmptyString(raw.nodeId)) ||
    (decision.kind !== 'approval' && decision.kind !== 'permission') ||
    !['approve', 'reject', 'allow_once', 'deny'].includes(
      String(decision.outcome),
    ) ||
    (decision.reason !== undefined &&
      decision.reason !== null &&
      (typeof decision.reason !== 'string' || decision.reason.length > 1000)) ||
    !['user', 'system', 'service'].includes(String(actor.kind)) ||
    typeof actor.subjectId !== 'string' ||
    !actor.subjectId.trim() ||
    actor.subjectId.trim().length > 200
  ) {
    return null
  }
  if (
    (decision.kind === 'approval' &&
      decision.outcome !== 'approve' &&
      decision.outcome !== 'reject') ||
    (decision.kind === 'permission' &&
      decision.outcome !== 'allow_once' &&
      decision.outcome !== 'deny')
  ) {
    return null
  }
  return {
    ...(raw as RunRequest),
    idempotencyKey: String(raw.idempotencyKey),
    expectedRunRevision: Number(raw.expectedRunRevision),
    waitId: raw.waitId,
    waitDigest: raw.waitDigest,
    ...(nonEmptyString(raw.nodeId) ? { nodeId: raw.nodeId.trim() } : {}),
    decision: {
      kind: decision.kind,
      outcome: decision.outcome as
        | 'approve'
        | 'reject'
        | 'allow_once'
        | 'deny',
      reason:
        typeof decision.reason === 'string' && decision.reason.trim()
          ? decision.reason.trim()
          : null,
      actor: {
        kind: actor.kind as 'user' | 'system' | 'service',
        subjectId: actor.subjectId.trim(),
      },
    },
  }
}

function currentAsset(asset: PublishedWorkflowAsset | null): PublishedWorkflowConflict['current'] {
  return asset
    ? {
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        sourceDigest: asset.sourceDigest,
      }
    : null
}

function conflict(
  operation: PublishedWorkflowConflict['operation'],
  value: unknown,
  code: PublishedWorkflowConflictCode,
  message: string,
  current: PublishedWorkflowConflict['current'] = null,
): { ok: false; conflict: PublishedWorkflowConflict } {
  const request = requestStrings(value)
  return {
    ok: false,
    conflict: {
      version: 1,
      surface: 'workflow-published-run-conflict',
      operation,
      status: 'rejected',
      requestId: typeof request.requestId === 'string' ? request.requestId : '',
      idempotencyKey:
        typeof request.idempotencyKey === 'string' ? request.idempotencyKey : null,
      code,
      message,
      current,
    },
  }
}

function findExactAsset(
  request: IdentityRequest,
): { asset: PublishedWorkflowAsset } | { code: PublishedWorkflowConflictCode; message: string; current: PublishedWorkflowConflict['current'] } {
  const asset = loadWorkflowPublicationRegistry().assets.find(
    candidate => candidate.assetId === request.assetId,
  ) ?? null
  if (!asset) {
    return {
      code: 'asset_not_found',
      message: `Published workflow asset ${request.assetId} was not found.`,
      current: null,
    }
  }
  if (
    asset.assetVersion !== request.assetVersion ||
    asset.sourceDigest !== request.sourceDigest
  ) {
    return {
      code: 'stale_asset_identity',
      message: 'Requested assetVersion/sourceDigest does not match the current publication.',
      current: currentAsset(asset),
    }
  }
  return { asset }
}

async function withRuntimeLock<T>(
  work: (registry: PublishedWorkflowRuntimeRegistry) => Promise<T> | T,
): Promise<T> {
  const path = publishedWorkflowRuntimeRegistryPath()
  const lockPath = runtimeLockPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(lockPath, '', { encoding: 'utf8', flag: 'a', mode: 0o600 })
  const release = await lock(lockPath, {
    realpath: false,
    stale: 10_000,
    retries: { retries: 8, factor: 1, minTimeout: 25, maxTimeout: 100 },
  })
  try {
    return await work(loadPublishedWorkflowRuntimeRegistry())
  } finally {
    await release().catch(() => {})
  }
}

function saveRegistry(registry: PublishedWorkflowRuntimeRegistry): void {
  atomicWriteJsonSync(publishedWorkflowRuntimeRegistryPath(), registry, {
    defaultMode: 0o600,
  })
}

function retainRegistry(registry: PublishedWorkflowRuntimeRegistry): void {
  registry.receipts = registry.receipts
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_RUNTIME_RECEIPTS)
  registry.runs = registry.runs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_RUNTIME_RUNS)
  const receiptIds = new Set(registry.receipts.map(item => item.receiptId))
  registry.idempotency = Object.fromEntries(
    Object.entries(registry.idempotency).filter(([, item]) => {
      const response = isRecord(item.response) ? item.response : {}
      return typeof response.receiptId !== 'string' || receiptIds.has(response.receiptId)
    }),
  )
}

function recordIdempotency(
  registry: PublishedWorkflowRuntimeRegistry,
  operation: 'enable' | 'invoke' | 'retry' | 'cancel' | 'decide',
  idempotencyKey: string,
  requestFingerprint: string,
  response: unknown,
): void {
  registry.idempotency[`${operation}:${idempotencyKey}`] = {
    operation,
    fingerprint: requestFingerprint,
    response,
  }
}

function priorResponse<T>(
  registry: PublishedWorkflowRuntimeRegistry,
  operation: 'enable' | 'invoke' | 'retry' | 'cancel' | 'decide',
  request: MutationRequest,
): PublishedWorkflowOperationResult<T> | null {
  const key = `${operation}:${request.idempotencyKey}`
  const prior = registry.idempotency[key]
  if (!prior) return null
  if (prior.fingerprint !== fingerprint(request)) {
    return conflict(
      operation,
      request,
      'idempotency_key_conflict',
      `idempotencyKey was already used for a different ${operation} request.`,
    )
  }
  return { ok: true, response: prior.response as T, replayed: true }
}

export async function enablePublishedWorkflow(
  value: unknown,
  now = new Date(),
): Promise<PublishedWorkflowOperationResult<PublishedWorkflowEnableResponse>> {
  const request = parseMutationRequest(value)
  if (!request) {
    return conflict('enable', value, 'invalid_request', 'Enable request is invalid.')
  }
  try {
    const resolved = findExactAsset(request)
    if (!('asset' in resolved)) {
      return conflict('enable', request, resolved.code, resolved.message, resolved.current)
    }
    return await withRuntimeLock(registry => {
      const replay = priorResponse<PublishedWorkflowEnableResponse>(
        registry,
        'enable',
        request,
      )
      if (replay) return replay
      const timestamp = now.toISOString()
      const receiptId = hash('wfer', request.idempotencyKey)
      const response: PublishedWorkflowEnableResponse = {
        version: 1,
        surface: 'workflow-enable-receipt',
        action: 'enable',
        status: 'accepted',
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        receiptId,
        assetId: resolved.asset.assetId,
        assetVersion: resolved.asset.assetVersion,
        sourceDigest: resolved.asset.sourceDigest,
        workflowName: resolved.asset.canonicalName,
        runId: null,
        runState: null,
        createdAt: timestamp,
        lifecycle: 'enabled',
      }
      registry.enabled[resolved.asset.assetId] = {
        assetId: resolved.asset.assetId,
        assetVersion: resolved.asset.assetVersion,
        sourceDigest: resolved.asset.sourceDigest,
        workflowName: resolved.asset.canonicalName,
        enabledAt: timestamp,
        lastReceiptId: receiptId,
      }
      registry.receipts.unshift(response)
      registry.updatedAt = timestamp
      recordIdempotency(registry, 'enable', request.idempotencyKey, fingerprint(request), response)
      retainRegistry(registry)
      saveRegistry(registry)
      return { ok: true, response, replayed: false }
    })
  } catch (error) {
    return conflict(
      'enable',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function nodeTitle(node: Record<string, unknown>): string {
  const business = isRecord(node.business) ? node.business : {}
  return typeof business.title === 'string'
    ? business.title
    : typeof node.type === 'string'
      ? node.type
      : 'workflow-step'
}

function publishedNodes(asset: PublishedWorkflowAsset): Record<string, unknown>[] {
  const nodes = Array.isArray(asset.definition.nodes)
    ? asset.definition.nodes.filter(isRecord)
    : []
  const edges = Array.isArray(asset.definition.edges)
    ? asset.definition.edges.filter(isRecord)
    : []
  if (edges.length === 0) return nodes

  const byId = new Map(nodes.map(node => [String(node.id), node]))
  const order = new Map(nodes.map((node, index) => [String(node.id), index]))
  const indegree = new Map(nodes.map(node => [String(node.id), 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const from = isRecord(edge.from) ? String(edge.from.nodeId ?? '') : ''
    const to = isRecord(edge.to) ? String(edge.to.nodeId ?? '') : ''
    if (!byId.has(from) || !byId.has(to)) continue
    outgoing.set(from, [...(outgoing.get(from) ?? []), to])
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }
  const ready = nodes
    .map(node => String(node.id))
    .filter(id => indegree.get(id) === 0)
  const sorted: Record<string, unknown>[] = []
  while (ready.length > 0) {
    ready.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
    const id = ready.shift()!
    sorted.push(byId.get(id)!)
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 1) - 1
      indegree.set(target, next)
      if (next === 0) ready.push(target)
    }
  }
  return sorted.length === nodes.length ? sorted : nodes
}

type RuntimeProjectionValidation =
  | { ok: true; projections: PublishedWorkflowRuntimeProjection[] }
  | {
      ok: false
      code:
        | 'execution_grant_missing'
        | 'execution_grant_conflict'
        | 'runtime_catalog_drift'
        | 'unsupported_executor'
      message: string
    }

const R12_SUPPORTED_NODE_TYPES = new Set([
  'trigger-manual',
  'trigger-webhook',
  'trigger-file-watch',
  'join',
  'text-transform',
  'condition',
  'set-variable',
  'wait-delay',
  'human-approval',
  'mossen-call',
])

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function uniqueStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const result = value.map(item =>
    typeof item === 'string' ? item.trim() : '',
  )
  if (
    result.some(item => !item) ||
    new Set(result).size !== result.length
  ) {
    return null
  }
  return result
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every(item => right.includes(item))
  )
}

function parseProjection(
  value: unknown,
  acceptedAt: string,
): PublishedWorkflowRuntimeProjection | null {
  if (!isRecord(value)) return null
  const position = requestStrings(value.position)
  const worker = requestStrings(value.worker)
  const runtime = requestStrings(value.runtime)
  const skills = requestStrings(value.skills)
  const tools = requestStrings(value.tools)
  const required = uniqueStringList(skills.required)
  const resolved = uniqueStringList(skills.resolved)
  const inventory = uniqueStringList(tools.inventory)
  const allow = uniqueStringList(tools.allow)
  const ask = uniqueStringList(tools.ask)
  const deny = uniqueStringList(tools.deny)
  const connectorRefs = uniqueStringList(value.connectorRefs)
  const resourceScopes = uniqueStringList(value.resourceScopes)
  if (
    !nonEmptyString(value.nodeId) ||
    !nonEmptyString(value.roleBindingId) ||
    !nonEmptyString(position.id) ||
    !Number.isInteger(position.version) ||
    Number(position.version) < 0 ||
    typeof position.digest !== 'string' ||
    !SHA256_RE.test(position.digest) ||
    !nonEmptyString(worker.id) ||
    !Number.isInteger(worker.version) ||
    Number(worker.version) < 0 ||
    typeof worker.digest !== 'string' ||
    !SHA256_RE.test(worker.digest) ||
    typeof value.grantDigest !== 'string' ||
    !SHA256_RE.test(value.grantDigest) ||
    typeof value.catalogDigest !== 'string' ||
    !SHA256_RE.test(value.catalogDigest) ||
    typeof value.policyDigest !== 'string' ||
    !SHA256_RE.test(value.policyDigest) ||
    runtime.adapterId !== 'mossen-cli' ||
    !nonEmptyString(runtime.agentRef) ||
    (runtime.modelRef !== null && !nonEmptyString(runtime.modelRef)) ||
    !required ||
    !resolved ||
    !sameStringSet(required, resolved) ||
    !inventory ||
    inventory.length === 0 ||
    !allow ||
    !ask ||
    !deny ||
    !connectorRefs ||
    !resourceScopes
  ) {
    return null
  }
  const partition = [...allow, ...ask, ...deny]
  if (
    new Set(partition).size !== partition.length ||
    !sameStringSet(partition, inventory)
  ) {
    return null
  }
  const input: PublishedWorkflowRuntimeProjectionInput = {
    nodeId: value.nodeId.trim(),
    roleBindingId: value.roleBindingId.trim(),
    position: {
      id: position.id.trim(),
      version: Number(position.version),
      digest: position.digest,
    },
    worker: {
      id: worker.id.trim(),
      version: Number(worker.version),
      digest: worker.digest,
    },
    grantDigest: value.grantDigest,
    catalogDigest: value.catalogDigest,
    policyDigest: value.policyDigest,
    runtime: {
      adapterId: 'mossen-cli',
      agentRef: runtime.agentRef.trim(),
      modelRef:
        runtime.modelRef === null
          ? null
          : String(runtime.modelRef).trim(),
    },
    skills: { required, resolved },
    tools: { inventory, allow, ask, deny },
    connectorRefs,
    resourceScopes,
  }
  return {
    ...input,
    acceptedAt,
    projectionDigest: fingerprint(input),
  }
}

function validateRuntimeProjections(
  asset: PublishedWorkflowAsset,
  request: InvokeRequest,
  acceptedAt: string,
): RuntimeProjectionValidation {
  if (request.executionProtocolVersion !== 1 || !request.runtimeProjections) {
    return { ok: true, projections: [] }
  }
  const projections: PublishedWorkflowRuntimeProjection[] = []
  for (const value of request.runtimeProjections) {
    const rawRuntime = isRecord(value) ? requestStrings(value.runtime) : {}
    if (
      rawRuntime.adapterId !== undefined &&
      rawRuntime.adapterId !== 'mossen-cli'
    ) {
      return {
        ok: false,
        code: 'unsupported_executor',
        message: `R12 Published execution does not support adapter ${String(rawRuntime.adapterId)}.`,
      }
    }
    const projection = parseProjection(value, acceptedAt)
    if (!projection) {
      return {
        ok: false,
        code: 'execution_grant_conflict',
        message: 'A runtime projection is malformed or its Tool partition is not exact.',
      }
    }
    if (projections.some(item => item.nodeId === projection.nodeId)) {
      return {
        ok: false,
        code: 'execution_grant_conflict',
        message: `Runtime projection for node ${projection.nodeId} is duplicated.`,
      }
    }
    projections.push(projection)
  }

  const nodes = publishedNodes(asset)
  const bindings =
    isRecord(asset.definition.team) && Array.isArray(asset.definition.team.bindings)
      ? asset.definition.team.bindings.filter(isRecord)
      : []
  const bindingById = new Map(bindings.map(binding => [String(binding.id), binding]))
  for (const node of nodes) {
    const nodeId = String(node.id)
    const nodeType = String(node.type)
    if (!R12_SUPPORTED_NODE_TYPES.has(nodeType)) {
      return {
        ok: false,
        code: 'unsupported_executor',
        message: `R12 Published execution does not support node type ${nodeType} at ${nodeId}.`,
      }
    }
    if (nodeType !== 'mossen-call') continue
    const projection = projections.find(item => item.nodeId === nodeId)
    if (!projection) {
      return {
        ok: false,
        code: 'execution_grant_missing',
        message: `Mossen Agent node ${nodeId} has no frozen runtime projection.`,
      }
    }
    const assignment = requestStrings(node.assignment)
    const roleBindingId = String(assignment.executorRoleBindingId ?? '')
    const binding = bindingById.get(roleBindingId)
    const executor = requestStrings(binding?.executor)
    const worker = requestStrings(executor.worker)
    const bindingSkills = uniqueStringList(binding?.skillRefs) ?? []
    const executorTools = uniqueStringList(executor.toolIds)
    if (
      !binding ||
      projection.roleBindingId !== roleBindingId ||
      executor.kind !== 'mossen-agent' ||
      (executor.adapterId !== undefined && executor.adapterId !== 'mossen-cli') ||
      (nonEmptyString(executor.agentRef) &&
        executor.agentRef !== projection.runtime.agentRef) ||
      projection.position.id !== binding.templateRoleId ||
      projection.position.version !== binding.templateVersion ||
      projection.position.digest !== binding.snapshotDigest ||
      !nonEmptyString(worker.id) ||
      !Number.isInteger(worker.version) ||
      typeof worker.digest !== 'string' ||
      projection.worker.id !== worker.id ||
      projection.worker.version !== worker.version ||
      projection.worker.digest !== worker.digest ||
      !sameStringSet(bindingSkills, projection.skills.required) ||
      (executorTools !== null &&
        !sameStringSet(executorTools, projection.tools.inventory))
    ) {
      return {
        ok: false,
        code: 'execution_grant_conflict',
        message: `Runtime projection for node ${nodeId} conflicts with its frozen role/worker binding.`,
      }
    }
    if (projection.connectorRefs.length || projection.resourceScopes.length) {
      return {
        ok: false,
        code: 'unsupported_executor',
        message: `R12 v1 Mossen Agent node ${nodeId} does not support connector or resource-scope execution.`,
      }
    }
  }

  for (const projection of projections) {
    const node = nodes.find(item => String(item.id) === projection.nodeId)
    if (!node || String(node.type) !== 'mossen-call') {
      return {
        ok: false,
        code: 'execution_grant_conflict',
        message: `Runtime projection references non-Agent node ${projection.nodeId}.`,
      }
    }
  }
  return { ok: true, projections }
}

function capturePolicy(asset: PublishedWorkflowAsset): {
  inputs: boolean
  outputs: boolean
  approvals: boolean
  artifacts: boolean
  raw: boolean
} {
  const policy = isRecord(asset.definition.evidencePolicy)
    ? asset.definition.evidencePolicy
    : {}
  return {
    inputs: policy.captureInputs !== false,
    outputs: policy.captureOutputs !== false,
    approvals: policy.captureApprovals !== false,
    artifacts: policy.captureArtifacts !== false,
    raw: policy.captureRawCapabilityEvidence !== false,
  }
}

function transformText(input: unknown, config: Record<string, unknown>): unknown {
  const text = typeof input === 'string' ? input : valueJson(input)
  switch (config.operation) {
    case 'trim':
      return text.trim()
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'replace':
      return text.split(String(config.pattern ?? '')).join(String(config.replacement ?? ''))
    case 'regex-extract': {
      const match = text.match(new RegExp(String(config.pattern ?? '')))
      return match?.[1] ?? match?.[0] ?? ''
    }
    case 'template':
      return String(config.replacement ?? '{{input}}').replaceAll('{{input}}', text)
    default:
      throw new Error(`Unsupported text-transform operation: ${String(config.operation)}`)
  }
}

function conditionMatches(input: unknown, config: Record<string, unknown>): boolean {
  const text = typeof input === 'string' ? input : valueJson(input)
  switch (config.operation) {
    case 'not-empty':
      return text.length > 0
    case 'contains':
      return text.includes(String(config.value ?? ''))
    case 'equals':
      return text === String(config.value ?? '')
    case 'regex':
      return new RegExp(String(config.value ?? '')).test(text)
    default:
      throw new Error(`Unsupported condition operation: ${String(config.operation)}`)
  }
}

function artifactText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback
}

function artifactForNode(
  runId: string,
  nodeId: string,
  config: Record<string, unknown>,
  value: unknown,
  createdAt: string,
): PublishedWorkflowArtifact | null {
  if (!isRecord(config.artifact)) return null
  const bytes = Buffer.from(valueJson(value), 'utf8')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const name = artifactText(config.artifact.name, `${nodeId}-output`, 200)
  const kind = artifactText(config.artifact.kind, 'node-output', 100)
  const mediaType = artifactText(
    config.artifact.mediaType,
    'application/json',
    200,
  )
  const artifactId = hash(
    'wfpa',
    `${runId}:${nodeId}:${name}:${kind}:${mediaType}:${digest}`,
  )
  return {
    artifactId,
    name,
    kind,
    mediaType,
    digest,
    sizeBytes: bytes.byteLength,
    producedByNodeId: nodeId,
    createdAt,
    uri: `mossen-artifact://published-runs/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}`,
  }
}

const PERMISSION_NODE_TYPES = new Set([
  'mossen-call',
  'http-request',
  'file-read',
  'file-write',
  'workflow-call',
  'capability-action',
  'loop-foreach',
  'fork-parallel',
])

function nodeRoleBindingId(node: Record<string, unknown>): string | null {
  const assignment = requestStrings(node.assignment)
  return nonEmptyString(assignment.executorRoleBindingId)
    ? assignment.executorRoleBindingId
    : null
}

function addPendingWait(
  run: PublishedWorkflowRun,
  step: PublishedWorkflowStep,
  options: {
    kind: PublishedWorkflowWaitKind
    scope: PublishedWorkflowWaitScope
    actionKind: PublishedWorkflowWait['action']['kind']
    actionId: string
    actionInput: unknown
    safeSummary: string
    allowedOutcomes: PublishedWorkflowWait['allowedOutcomes']
    projection?: PublishedWorkflowRuntimeProjection
    roleBindingId?: string | null
  },
  createdAt: string,
): PublishedWorkflowWait {
  const occurrence =
    run.waitHistory.filter(
      wait => wait.nodeId === step.nodeId && wait.scope === options.scope,
    ).length + 1
  const roleBindingId =
    options.projection?.roleBindingId ?? options.roleBindingId ?? null
  const reviewFacts = {
    occurrence,
    kind: options.kind,
    scope: options.scope,
    nodeId: step.nodeId,
    roleBindingId,
    action: {
      kind: options.actionKind,
      id: options.actionId,
      inputDigest: fingerprint(options.actionInput),
      safeSummary: options.safeSummary.slice(0, 500),
    },
    grantDigest: options.projection?.grantDigest ?? null,
    catalogDigest: options.projection?.catalogDigest ?? null,
    policyDigest: options.projection?.policyDigest ?? null,
    allowedOutcomes: options.allowedOutcomes,
  }
  const wait: PublishedWorkflowWait = {
    waitId: hash(
      'wfwait',
      `${run.runId}:${step.nodeId}:${options.scope}:${occurrence}:${run.revision}`,
    ),
    waitDigest: fingerprint(reviewFacts),
    ...reviewFacts,
    createdAt,
    status: 'waiting',
  }
  run.pendingWaits = [wait]
  run.waitHistory.push(wait)
  run.waits = {
    approvalNodeIds: options.kind === 'approval' ? [step.nodeId] : [],
    permissionNodeIds: options.kind === 'permission' ? [step.nodeId] : [],
  }
  return wait
}

async function executePublishedRun(
  asset: PublishedWorkflowAsset,
  request: InvokeRequest,
  receiptId: string,
  now: Date,
  retryOfRunId: string | null = null,
  runtimeProjections: PublishedWorkflowRuntimeProjection[] = [],
  executionProtocolVersion: 1 | null = null,
): Promise<{
  run: PublishedWorkflowRun
  checkpoint: PublishedWorkflowExecutionCheckpoint | null
}> {
  const timestamp = now.toISOString()
  const nodes = publishedNodes(asset)
  const policy = capturePolicy(asset)
  const steps: PublishedWorkflowStep[] = nodes.map(node => ({
    nodeId: String(node.id),
    nodeType: String(node.type),
    title: nodeTitle(node),
    state: 'pending',
    startedAt: null,
    completedAt: null,
    evidence: [],
    approval: { status: 'not_required', message: null },
    permission: { status: 'not_required', capability: null, reason: null },
    runtimeEvidence: null,
    error: null,
  }))
  const run: PublishedWorkflowRun = {
    version: 1,
    surface: 'workflow-published-run',
    runId: hash(
      'wfpubrun',
      retryOfRunId
        ? `${asset.assetId}:${retryOfRunId}:${request.idempotencyKey}`
        : `${asset.assetId}:${request.idempotencyKey}`,
    ),
    retryOfRunId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    receiptId,
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    sourceDigest: asset.sourceDigest,
    workflowName: asset.canonicalName,
    revision: executionProtocolVersion === 1 ? 1 : 0,
    executionProtocolVersion,
    state: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    input: request.input ?? null,
    steps,
    artifacts: [],
    runtimeProjections,
    pendingWaits: [],
    waitHistory: [],
    decisions: [],
    executionAttempts: [],
    waits: { approvalNodeIds: [], permissionNodeIds: [] },
    finalResult: null,
  }
  let current: unknown = request.input ?? null
  const variables = isRecord(asset.definition.variables)
    ? { ...asset.definition.variables }
    : {}
  const checkpoint: PublishedWorkflowExecutionCheckpoint | null =
    executionProtocolVersion === 1
      ? {
          version: 1,
          runId: run.runId,
          assetSnapshot: structuredClone(asset),
          nextNodeIndex: 0,
          currentValue: current,
          variables: { ...variables },
          waitOccurrences: {},
          agentSessions: {},
        }
      : null
  let shortCircuited = false

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const step = steps[index]!
    if (shortCircuited) {
      step.state = 'skipped'
      if (checkpoint) checkpoint.nextNodeIndex = index + 1
      continue
    }
    step.state = 'running'
    step.startedAt = timestamp
    step.evidence.push(
      evidence('input', current, timestamp, policy.inputs, 'Step input captured.'),
    )
    const type = String(node.type)
    const config = isRecord(node.config) ? node.config : {}
    try {
      if (type === 'human-approval') {
        step.state = 'waiting_approval'
        step.approval = {
          status: 'waiting',
          message:
            typeof config.message === 'string'
              ? config.message
              : 'Published workflow requires human approval.',
        }
        step.evidence.push(
          evidence(
            'approval',
            step.approval,
            timestamp,
            policy.approvals,
            'Human approval is waiting.',
          ),
        )
        run.state = 'waiting_approval'
        if (executionProtocolVersion === 1) {
          addPendingWait(
            run,
            step,
            {
              kind: 'approval',
              scope: 'human_approval',
              actionKind: 'approval',
              actionId: step.nodeId,
              actionInput: {
                message: step.approval.message,
                inputDigest: fingerprint(current),
              },
              safeSummary:
                step.approval.message ?? 'Published workflow approval required.',
              allowedOutcomes: ['approve', 'reject'],
              roleBindingId: nodeRoleBindingId(node),
            },
            timestamp,
          )
        } else {
          run.waits.approvalNodeIds.push(step.nodeId)
        }
        if (checkpoint) {
          checkpoint.nextNodeIndex = index
          checkpoint.currentValue = current
          checkpoint.variables = { ...variables }
        }
        break
      }
      if (PERMISSION_NODE_TYPES.has(type)) {
        const capability =
          type === 'capability-action' && typeof config.capabilityId === 'string'
            ? config.capabilityId
            : `published-workflow.${type}`
        step.state = 'waiting_permission'
        step.permission = {
          status: 'waiting',
          capability,
          reason: `Published execution requires explicit authority for ${type}.`,
        }
        step.evidence.push(
          evidence(
            'permission',
            step.permission,
            timestamp,
            policy.raw,
            `Permission ${capability} is waiting.`,
          ),
        )
        run.state = 'waiting_permission'
        if (executionProtocolVersion === 1 && type === 'mossen-call') {
          const projection = runtimeProjections.find(
            item => item.nodeId === step.nodeId,
          )
          if (!projection) {
            throw new Error(`Missing runtime projection for ${step.nodeId}.`)
          }
          step.runtimeEvidence = {
            adapterId: 'mossen-cli',
            runtimeVersion: null,
            runtimeBuild: null,
            sessionId: null,
            requestedSkillIds: [...projection.skills.required],
            resolvedSkillIds: [],
            preloadedSkillIds: [],
            failedSkillIds: [],
            offeredToolInventory: [...projection.tools.inventory],
            toolAllow: [...projection.tools.allow],
            toolAsk: [...projection.tools.ask],
            toolDeny: [...projection.tools.deny],
            permissionWaitIds: [],
            decisionIds: [],
            executionAttemptIds: [],
            outputDigest: null,
            errorDigest: null,
          }
          const wait = addPendingWait(
            run,
            step,
            {
              kind: 'permission',
              scope: 'step_execution',
              actionKind: 'step',
              actionId: step.nodeId,
              actionInput: {
                nodeId: step.nodeId,
                projectionDigest: projection.projectionDigest,
                inputDigest: fingerprint(current),
              },
              safeSummary: `Run Mossen Agent ${projection.runtime.agentRef} for ${step.title}.`,
              allowedOutcomes: ['allow_once', 'deny'],
              projection,
            },
            timestamp,
          )
          step.runtimeEvidence.permissionWaitIds.push(wait.waitId)
        } else {
          run.waits.permissionNodeIds.push(step.nodeId)
        }
        if (checkpoint) {
          checkpoint.nextNodeIndex = index
          checkpoint.currentValue = current
          checkpoint.variables = { ...variables }
        }
        break
      }
      switch (type) {
        case 'trigger-manual':
        case 'trigger-webhook':
        case 'trigger-file-watch':
        case 'join':
          break
        case 'text-transform':
          current = transformText(current, config)
          break
        case 'condition':
          if (!conditionMatches(current, config)) shortCircuited = true
          break
        case 'set-variable': {
          const name = typeof config.name === 'string' ? config.name : ''
          if (!/^[A-Za-z0-9_.]+$/.test(name)) {
            throw new Error('set-variable requires a valid name.')
          }
          variables[name] = current
          break
        }
        case 'wait-delay': {
          const delayMs = Number(config.delayMs ?? 0)
          if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60_000) {
            throw new Error('wait-delay must be between 0 and 60000ms.')
          }
          await new Promise<void>(resolve => setTimeout(resolve, delayMs))
          break
        }
        default:
          throw new Error(`Published runtime does not recognize node type ${type}.`)
      }
      step.state = 'completed'
      step.completedAt = new Date().toISOString()
      step.evidence.push(
        evidence('output', current, step.completedAt, policy.outputs, 'Step output captured.'),
      )
      const artifact = policy.artifacts
        ? artifactForNode(
            run.runId,
            step.nodeId,
            config,
            current,
            step.completedAt,
          )
        : null
      if (artifact) run.artifacts.push(artifact)
      if (checkpoint) {
        checkpoint.nextNodeIndex = index + 1
        checkpoint.currentValue = current
        checkpoint.variables = { ...variables }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      step.state = 'failed'
      step.completedAt = new Date().toISOString()
      step.error = message
      step.evidence.push(
        evidence('error', message, step.completedAt, true, 'Step failed.'),
      )
      run.state = 'failed'
      run.finalResult = {
        status: 'failed',
        digest: createHash('sha256').update(message).digest('hex'),
        error: message,
      }
      break
    }
  }

  if (run.state === 'running') {
    run.state = 'completed'
    run.completedAt = new Date().toISOString()
    run.finalResult = {
      status: 'succeeded',
      digest: createHash('sha256').update(valueJson(current)).digest('hex'),
      ...(policy.outputs ? { value: current } : {}),
    }
  } else if (run.state === 'failed') {
    run.completedAt = new Date().toISOString()
  }
  run.updatedAt = new Date().toISOString()
  return { run, checkpoint }
}

function failPublishedRun(
  run: PublishedWorkflowRun,
  step: PublishedWorkflowStep,
  code: string,
  message: string,
  timestamp: string,
): void {
  step.state = 'failed'
  step.completedAt = timestamp
  step.error = message
  step.evidence.push(evidence('error', { code, message }, timestamp, true, 'Step failed.'))
  if (step.runtimeEvidence) {
    step.runtimeEvidence.errorDigest = fingerprint({ code, message })
  }
  run.state = 'failed'
  run.updatedAt = timestamp
  run.completedAt = timestamp
  run.pendingWaits = []
  run.waits = { approvalNodeIds: [], permissionNodeIds: [] }
  run.finalResult = {
    status: 'failed',
    digest: fingerprint({ code, message }),
    error: `${code}: ${message}`,
  }
}

async function advanceR12Run(
  asset: PublishedWorkflowAsset,
  run: PublishedWorkflowRun,
  checkpoint: PublishedWorkflowExecutionCheckpoint,
): Promise<void> {
  const nodes = publishedNodes(asset)
  const policy = capturePolicy(asset)
  let current = checkpoint.currentValue
  const variables = { ...checkpoint.variables }
  run.state = 'running'
  run.pendingWaits = []
  run.waits = { approvalNodeIds: [], permissionNodeIds: [] }

  for (let index = checkpoint.nextNodeIndex; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const step = run.steps[index]!
    const timestamp = new Date().toISOString()
    checkpoint.nextNodeIndex = index
    step.state = 'running'
    step.startedAt ??= timestamp
    if (step.evidence.every(item => item.kind !== 'input')) {
      step.evidence.push(
        evidence('input', current, timestamp, policy.inputs, 'Step input captured.'),
      )
    }
    const type = String(node.type)
    const config = requestStrings(node.config)
    try {
      if (type === 'human-approval') {
        step.state = 'waiting_approval'
        step.approval = {
          status: 'waiting',
          message:
            typeof config.message === 'string'
              ? config.message
              : 'Published workflow requires human approval.',
        }
        step.evidence.push(
          evidence(
            'approval',
            step.approval,
            timestamp,
            policy.approvals,
            'Human approval is waiting.',
          ),
        )
        run.state = 'waiting_approval'
        addPendingWait(
          run,
          step,
          {
            kind: 'approval',
            scope: 'human_approval',
            actionKind: 'approval',
            actionId: step.nodeId,
            actionInput: {
              message: step.approval.message,
              inputDigest: fingerprint(current),
            },
            safeSummary:
              step.approval.message ?? 'Published workflow approval required.',
            allowedOutcomes: ['approve', 'reject'],
            roleBindingId: nodeRoleBindingId(node),
          },
          timestamp,
        )
        checkpoint.currentValue = current
        checkpoint.variables = { ...variables }
        run.updatedAt = timestamp
        return
      }
      if (type === 'mossen-call') {
        const projection = run.runtimeProjections.find(
          item => item.nodeId === step.nodeId,
        )
        if (!projection) {
          failPublishedRun(
            run,
            step,
            'execution_grant_missing',
            `Missing runtime projection for ${step.nodeId}.`,
            timestamp,
          )
          return
        }
        step.state = 'waiting_permission'
        step.permission = {
          status: 'waiting',
          capability: 'published-workflow.mossen-call',
          reason: 'Published Agent execution requires explicit allow-once authority.',
        }
        step.runtimeEvidence ??= {
          adapterId: 'mossen-cli',
          runtimeVersion: null,
          runtimeBuild: null,
          sessionId: null,
          requestedSkillIds: [...projection.skills.required],
          resolvedSkillIds: [],
          preloadedSkillIds: [],
          failedSkillIds: [],
          offeredToolInventory: [...projection.tools.inventory],
          toolAllow: [...projection.tools.allow],
          toolAsk: [...projection.tools.ask],
          toolDeny: [...projection.tools.deny],
          permissionWaitIds: [],
          decisionIds: [],
          executionAttemptIds: [],
          outputDigest: null,
          errorDigest: null,
        }
        run.state = 'waiting_permission'
        const wait = addPendingWait(
          run,
          step,
          {
            kind: 'permission',
            scope: 'step_execution',
            actionKind: 'step',
            actionId: step.nodeId,
            actionInput: {
              nodeId: step.nodeId,
              projectionDigest: projection.projectionDigest,
              inputDigest: fingerprint(current),
            },
            safeSummary: `Run Mossen Agent ${projection.runtime.agentRef} for ${step.title}.`,
            allowedOutcomes: ['allow_once', 'deny'],
            projection,
          },
          timestamp,
        )
        step.runtimeEvidence.permissionWaitIds.push(wait.waitId)
        checkpoint.currentValue = current
        checkpoint.variables = { ...variables }
        run.updatedAt = timestamp
        return
      }

      let stopAfterStep = false
      switch (type) {
        case 'trigger-manual':
        case 'trigger-webhook':
        case 'trigger-file-watch':
        case 'join':
          break
        case 'text-transform':
          current = transformText(current, config)
          break
        case 'condition':
          if (!conditionMatches(current, config)) {
            for (let skippedIndex = index + 1; skippedIndex < run.steps.length; skippedIndex += 1) {
              run.steps[skippedIndex]!.state = 'skipped'
            }
            stopAfterStep = true
            break
          }
          break
        case 'set-variable': {
          const name = typeof config.name === 'string' ? config.name : ''
          if (!/^[A-Za-z0-9_.]+$/.test(name)) {
            throw new Error('set-variable requires a valid name.')
          }
          variables[name] = current
          break
        }
        case 'wait-delay': {
          const delayMs = Number(config.delayMs ?? 0)
          if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60_000) {
            throw new Error('wait-delay must be between 0 and 60000ms.')
          }
          await new Promise<void>(resolve => setTimeout(resolve, delayMs))
          break
        }
        default:
          throw new Error(`R12 Published runtime does not support node type ${type}.`)
      }
      const completedAt = new Date().toISOString()
      step.state = 'completed'
      step.completedAt = completedAt
      step.evidence.push(
        evidence('output', current, completedAt, policy.outputs, 'Step output captured.'),
      )
      const artifact = policy.artifacts
        ? artifactForNode(run.runId, step.nodeId, config, current, completedAt)
        : null
      if (artifact && !run.artifacts.some(item => item.artifactId === artifact.artifactId)) {
        run.artifacts.push(artifact)
      }
      checkpoint.nextNodeIndex = stopAfterStep ? nodes.length : index + 1
      checkpoint.currentValue = current
      checkpoint.variables = { ...variables }
      if (checkpoint.nextNodeIndex >= nodes.length) break
    } catch (error) {
      failPublishedRun(
        run,
        step,
        'resume_failed',
        error instanceof Error ? error.message : String(error),
        new Date().toISOString(),
      )
      return
    }
  }

  const completedAt = new Date().toISOString()
  run.state = 'completed'
  run.updatedAt = completedAt
  run.completedAt = completedAt
  run.pendingWaits = []
  run.waits = { approvalNodeIds: [], permissionNodeIds: [] }
  run.finalResult = {
    status: 'succeeded',
    digest: fingerprint(current),
    ...(policy.outputs ? { value: current } : {}),
  }
  checkpoint.nextNodeIndex = nodes.length
  checkpoint.currentValue = current
  checkpoint.variables = { ...variables }
}

export async function invokePublishedWorkflow(
  value: unknown,
  now = new Date(),
): Promise<PublishedWorkflowOperationResult<PublishedWorkflowInvokeResponse>> {
  const request = parseInvokeRequest(value)
  if (!request) {
    return conflict('invoke', value, 'invalid_request', 'Published run request is invalid.')
  }
  try {
    const resolved = findExactAsset(request)
    if (!('asset' in resolved)) {
      return conflict('invoke', request, resolved.code, resolved.message, resolved.current)
    }
    const projectionValidation = validateRuntimeProjections(
      resolved.asset,
      request,
      now.toISOString(),
    )
    if ('code' in projectionValidation) {
      return conflict(
        'invoke',
        request,
        projectionValidation.code,
        projectionValidation.message,
        currentAsset(resolved.asset),
      )
    }
    return await withRuntimeLock(async registry => {
      const replay = priorResponse<PublishedWorkflowInvokeResponse>(
        registry,
        'invoke',
        request,
      )
      if (replay) return replay
      const enabled = registry.enabled[request.assetId]
      if (
        !enabled ||
        enabled.assetVersion !== request.assetVersion ||
        enabled.sourceDigest !== request.sourceDigest
      ) {
        return conflict(
          'invoke',
          request,
          'asset_not_enabled',
          'The exact published asset version and digest are not enabled.',
          currentAsset(resolved.asset),
        )
      }
      const pendingRunId = hash(
        'wfpubrun',
        `${resolved.asset.assetId}:${request.idempotencyKey}`,
      )
      let preparedSessions: PublishedWorkflowExecutionCheckpoint['agentSessions']
      try {
        preparedSessions = await prepareRuntimeSessions(
          resolved.asset,
          request,
          pendingRunId,
          projectionValidation.projections,
        )
      } catch (error) {
        return conflict(
          'invoke',
          request,
          'runtime_catalog_drift',
          error instanceof Error ? error.message : String(error),
          currentAsset(resolved.asset),
        )
      }
      const receiptId = hash('wfir', request.idempotencyKey)
      const execution = await executePublishedRun(
        resolved.asset,
        request,
        receiptId,
        now,
        null,
        projectionValidation.projections,
        request.executionProtocolVersion === 1 ? 1 : null,
      )
      const { run } = execution
      if (execution.checkpoint) {
        execution.checkpoint.agentSessions = preparedSessions
      }
      const response: PublishedWorkflowInvokeResponse = {
        version: 1,
        surface: 'workflow-run-receipt',
        action: 'invoke',
        status: 'accepted',
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        receiptId,
        assetId: request.assetId,
        assetVersion: request.assetVersion,
        sourceDigest: request.sourceDigest,
        workflowName: resolved.asset.canonicalName,
        runId: run.runId,
        runState: run.state,
        runRevision: run.revision,
        retryOfRunId: null,
        artifactIds: run.artifacts.map(artifact => artifact.artifactId),
        createdAt: now.toISOString(),
        run,
      }
      registry.runs.unshift(run)
      if (execution.checkpoint && !isTerminalRunState(run.state)) {
        registry.checkpoints[run.runId] = execution.checkpoint
      }
      registry.receipts.unshift(response)
      registry.updatedAt = run.updatedAt
      recordIdempotency(registry, 'invoke', request.idempotencyKey, fingerprint(request), response)
      retainRegistry(registry)
      saveRegistry(registry)
      return { ok: true, response, replayed: false }
    })
  } catch (error) {
    return conflict(
      'invoke',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function findRun(
  registry: PublishedWorkflowRuntimeRegistry,
  request: RunRequest,
): PublishedWorkflowRun | null {
  return registry.runs.find(run => run.runId === request.runId) ?? null
}

function runCurrent(run: PublishedWorkflowRun): PublishedWorkflowConflict['current'] {
  return {
    assetId: run.assetId,
    assetVersion: run.assetVersion,
    sourceDigest: run.sourceDigest,
    runId: run.runId,
    runState: run.state,
  }
}

function runIdentityMatches(run: PublishedWorkflowRun, request: RunRequest): boolean {
  return (
    run.assetId === request.assetId &&
    run.assetVersion === request.assetVersion &&
    run.sourceDigest === request.sourceDigest
  )
}

export async function retryPublishedWorkflowRun(
  value: unknown,
  now = new Date(),
): Promise<PublishedWorkflowOperationResult<PublishedWorkflowRetryResponse>> {
  const request = parseRetryRequest(value)
  if (!request) {
    return conflict('retry', value, 'invalid_request', 'Published run retry request is invalid.')
  }
  try {
    const resolved = findExactAsset(request)
    if (!('asset' in resolved)) {
      return conflict('retry', request, resolved.code, resolved.message, resolved.current)
    }
    return await withRuntimeLock(async registry => {
      const replay = priorResponse<PublishedWorkflowRetryResponse>(
        registry,
        'retry',
        request,
      )
      if (replay) return replay
      const original = findRun(registry, request)
      if (!original) {
        return conflict(
          'retry',
          request,
          'run_not_found',
          `Run ${request.runId} was not found.`,
        )
      }
      if (!runIdentityMatches(original, request)) {
        return conflict(
          'retry',
          request,
          'run_identity_conflict',
          'Run identity does not match the requested published asset identity.',
          runCurrent(original),
        )
      }
      if (original.state !== 'failed' && original.state !== 'cancelled') {
        return conflict(
          'retry',
          request,
          'run_not_retryable',
          `Run ${original.runId} is ${original.state}; only failed or cancelled runs can be retried.`,
          runCurrent(original),
        )
      }
      const timestamp = now.toISOString()
      const receiptId = hash('wfrr', request.idempotencyKey)
      const retryExecution = await executePublishedRun(
        resolved.asset,
        {
          protocolVersion: request.protocolVersion,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          assetId: request.assetId,
          assetVersion: request.assetVersion,
          sourceDigest: request.sourceDigest,
          input: original.input,
        },
        receiptId,
        now,
        original.runId,
        original.runtimeProjections,
        original.executionProtocolVersion,
      )
      const retriedRun = retryExecution.run
      const response: PublishedWorkflowRetryResponse = {
        version: 1,
        surface: 'workflow-run-retry-receipt',
        action: 'retry',
        status: 'accepted',
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        receiptId,
        assetId: original.assetId,
        assetVersion: original.assetVersion,
        sourceDigest: original.sourceDigest,
        workflowName: original.workflowName,
        runId: retriedRun.runId,
        runState: retriedRun.state,
        runRevision: retriedRun.revision,
        createdAt: timestamp,
        retryOfRunId: original.runId,
        artifactIds: retriedRun.artifacts.map(artifact => artifact.artifactId),
        run: retriedRun,
      }
      registry.runs.unshift(retriedRun)
      if (retryExecution.checkpoint && !isTerminalRunState(retriedRun.state)) {
        registry.checkpoints[retriedRun.runId] = retryExecution.checkpoint
      }
      registry.receipts.unshift(response)
      registry.updatedAt = retriedRun.updatedAt
      recordIdempotency(
        registry,
        'retry',
        request.idempotencyKey,
        fingerprint(request),
        response,
      )
      retainRegistry(registry)
      saveRegistry(registry)
      return { ok: true, response, replayed: false }
    })
  } catch (error) {
    return conflict(
      'retry',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function applyAgentRuntimeEvidence(
  step: PublishedWorkflowStep,
  outcome: PublishedAgentRuntimeOutcome,
): void {
  if (!step.runtimeEvidence) return
  step.runtimeEvidence.runtimeVersion = outcome.runtimeVersion
  step.runtimeEvidence.runtimeBuild = outcome.runtimeBuild
  step.runtimeEvidence.sessionId = outcome.session?.sessionId ?? null
  step.runtimeEvidence.requestedSkillIds = [...outcome.requestedSkillIds]
  step.runtimeEvidence.resolvedSkillIds = [...outcome.resolvedSkillIds]
  step.runtimeEvidence.preloadedSkillIds = [...outcome.preloadedSkillIds]
  step.runtimeEvidence.failedSkillIds = [...outcome.failedSkillIds]
}

function validateAgentRuntimeEvidence(
  projection: PublishedWorkflowRuntimeProjection,
  outcome: PublishedAgentRuntimeOutcome,
): string | null {
  if (
    !sameStringSet(outcome.requestedSkillIds, projection.skills.required) ||
    !sameStringSet(outcome.resolvedSkillIds, projection.skills.resolved) ||
    !sameStringSet(outcome.preloadedSkillIds, projection.skills.resolved) ||
    outcome.failedSkillIds.length > 0
  ) {
    return 'Mossen Agent Skill evidence does not match the frozen runtime projection.'
  }
  return null
}

function validateAgentToolExecutionEvidence(
  projection: PublishedWorkflowRuntimeProjection,
  outcome: PublishedAgentRuntimeOutcome,
  approvedToolUseId: string | null,
): string | null {
  const executions = outcome.toolExecutions ?? []
  if (new Set(executions.map(item => item.toolUseId)).size !== executions.length) {
    return 'Mossen Agent Tool execution evidence contains duplicate Tool use identities.'
  }
  for (const execution of executions) {
    if (
      !nonEmptyString(execution.toolId) ||
      !nonEmptyString(execution.toolUseId) ||
      !SHA256_RE.test(execution.inputDigest) ||
      !SHA256_RE.test(execution.resultDigest) ||
      !projection.tools.inventory.includes(execution.toolId) ||
      projection.tools.deny.includes(execution.toolId) ||
      (projection.tools.ask.includes(execution.toolId) &&
        execution.toolUseId !== approvedToolUseId)
    ) {
      return 'Mossen Agent Tool execution evidence exceeds the frozen Tool authority.'
    }
  }
  return null
}

function recordAgentToolExecutionEvidence(
  run: PublishedWorkflowRun,
  step: PublishedWorkflowStep,
  attempt: PublishedWorkflowExecutionAttempt,
  executions: readonly PublishedAgentRuntimeToolExecution[],
  completedAt: string,
): void {
  for (const execution of executions) {
    if (
      attempt.kind === 'runtime_tool' &&
      attempt.toolUseId === execution.toolUseId
    ) {
      attempt.toolId = execution.toolId
      attempt.inputDigest = execution.inputDigest
      attempt.resultDigest = execution.resultDigest
      continue
    }
    if (
      run.executionAttempts.some(
        item => item.toolUseId === execution.toolUseId,
      )
    ) {
      continue
    }
    const toolAttempt: PublishedWorkflowExecutionAttempt = {
      attemptId: hash(
        'wftoolattempt',
        `${attempt.operationId}:${execution.toolUseId}`,
      ),
      operationId: hash(
        'wftoolop',
        `${attempt.operationId}:${execution.toolUseId}`,
      ),
      nodeId: attempt.nodeId,
      waitId: attempt.waitId,
      kind: 'runtime_tool',
      status: 'completed',
      preparedAt: attempt.preparedAt,
      dispatchedAt: attempt.dispatchedAt,
      completedAt,
      toolId: execution.toolId,
      toolUseId: execution.toolUseId,
      inputDigest: execution.inputDigest,
      resultDigest: execution.resultDigest,
      errorCode: null,
    }
    run.executionAttempts.push(toolAttempt)
    step.runtimeEvidence?.executionAttemptIds.push(toolAttempt.attemptId)
  }
}

function runtimeProjectionDigestMatches(
  projection: PublishedWorkflowRuntimeProjection,
): boolean {
  const { acceptedAt: _acceptedAt, projectionDigest, ...input } = projection
  return projectionDigest === fingerprint(input)
}

function decisionResponse(
  run: PublishedWorkflowRun,
  request: DecisionRequest,
  wait: PublishedWorkflowWait,
  decision: PublishedWorkflowDecision,
  createdAt: string,
): PublishedWorkflowDecisionResponse {
  return {
    version: 1,
    surface: 'workflow-published-run-decision-receipt',
    action: 'decide',
    status: 'accepted',
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    receiptId: decision.receiptId,
    assetId: run.assetId,
    assetVersion: run.assetVersion,
    sourceDigest: run.sourceDigest,
    workflowName: run.workflowName,
    runId: run.runId,
    runState: run.state,
    runRevision: run.revision,
    waitId: wait.waitId,
    decisionId: decision.decisionId,
    retryOfRunId: run.retryOfRunId,
    artifactIds: run.artifacts.map(artifact => artifact.artifactId),
    createdAt,
    run,
  }
}

export async function decidePublishedWorkflowRun(
  value: unknown,
  now = new Date(),
): Promise<PublishedWorkflowOperationResult<PublishedWorkflowDecisionResponse>> {
  const request = parseDecisionRequest(value)
  if (!request) {
    return conflict(
      'decide',
      value,
      'invalid_request',
      'Published run decision request is invalid.',
    )
  }
  try {
    return await withRuntimeLock(async registry => {
      const replay = priorResponse<PublishedWorkflowDecisionResponse>(
        registry,
        'decide',
        request,
      )
      if (replay) return replay

      const run = findRun(registry, request)
      if (!run) {
        return conflict(
          'decide',
          request,
          'run_not_found',
          `Run ${request.runId} was not found.`,
        )
      }
      if (!runIdentityMatches(run, request)) {
        return conflict(
          'decide',
          request,
          'run_identity_conflict',
          'Run identity does not match the requested published asset identity.',
          runCurrent(run),
        )
      }
      if (run.executionProtocolVersion !== 1) {
        return conflict(
          'decide',
          request,
          'unsupported_decision',
          'This legacy Published Run has no R12 decision/resume checkpoint.',
          runCurrent(run),
        )
      }
      const interruptedDecision = run.decisions.find(
        item => item.idempotencyKey === request.idempotencyKey,
      )
      if (interruptedDecision) {
        if (interruptedDecision.requestFingerprint !== fingerprint(request)) {
          return conflict(
            'decide',
            request,
            'idempotency_key_conflict',
            'idempotencyKey was durably recorded for a different decision request.',
            runCurrent(run),
          )
        }
        return conflict(
          'decide',
          request,
          'execution_outcome_unknown',
          'The decision was durably recorded but no final receipt exists; execution will not be replayed automatically.',
          runCurrent(run),
        )
      }
      if (
        run.state !== 'waiting_approval' &&
        run.state !== 'waiting_permission'
      ) {
        return conflict(
          'decide',
          request,
          'run_not_waiting',
          `Run ${run.runId} is ${run.state}.`,
          runCurrent(run),
        )
      }
      if (run.revision !== request.expectedRunRevision) {
        return conflict(
          'decide',
          request,
          'run_revision_conflict',
          `Run revision ${run.revision} does not match expected revision ${request.expectedRunRevision}.`,
          runCurrent(run),
        )
      }
      const wait = run.pendingWaits.find(item => item.waitId === request.waitId)
      if (!wait) {
        return conflict(
          'decide',
          request,
          'wait_not_found',
          `Wait ${request.waitId} is not pending on run ${run.runId}.`,
          runCurrent(run),
        )
      }
      if (
        wait.waitDigest !== request.waitDigest ||
        wait.kind !== request.decision.kind ||
        (request.nodeId !== undefined && request.nodeId !== wait.nodeId)
      ) {
        return conflict(
          'decide',
          request,
          'stale_wait',
          'waitDigest, nodeId, or decision kind does not match the pending wait.',
          runCurrent(run),
        )
      }
      if (!wait.allowedOutcomes.includes(request.decision.outcome)) {
        return conflict(
          'decide',
          request,
          'unsupported_decision',
          `Outcome ${request.decision.outcome} is not allowed for wait ${wait.waitId}.`,
          runCurrent(run),
        )
      }
      const checkpoint = registry.checkpoints[run.runId]
      if (
        !checkpoint ||
        checkpoint.runId !== run.runId ||
        !checkpoint.assetSnapshot ||
        checkpoint.assetSnapshot.assetId !== run.assetId ||
        checkpoint.assetSnapshot.assetVersion !== run.assetVersion ||
        checkpoint.assetSnapshot.sourceDigest !== run.sourceDigest
      ) {
        return conflict(
          'decide',
          request,
          'resume_failed',
          `Run ${run.runId} has no identity-matched authoritative execution checkpoint.`,
          runCurrent(run),
        )
      }
      const stepIndex = run.steps.findIndex(step => step.nodeId === wait.nodeId)
      const asset = checkpoint.assetSnapshot
      const nodes = publishedNodes(asset)
      const step = stepIndex >= 0 ? run.steps[stepIndex] : undefined
      const node = stepIndex >= 0 ? nodes[stepIndex] : undefined
      if (!step || !node || step.nodeId !== String(node.id)) {
        return conflict(
          'decide',
          request,
          'resume_failed',
          'The pending wait no longer maps to its frozen workflow node.',
          runCurrent(run),
        )
      }

      const timestamp = now.toISOString()
      const receiptId = hash('wfdcr', request.idempotencyKey)
      const decision: PublishedWorkflowDecision = {
        decisionId: hash(
          'wfdecision',
          `${run.runId}:${wait.waitId}:${request.idempotencyKey}`,
        ),
        receiptId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint(request),
        waitId: wait.waitId,
        waitDigest: wait.waitDigest,
        runRevisionBefore: run.revision,
        runRevisionAfter: run.revision + 1,
        kind: request.decision.kind,
        outcome: request.decision.outcome,
        reason: request.decision.reason,
        actor: {
          ...request.decision.actor,
          assurance: 'client_asserted',
        },
        decidedAt: timestamp,
      }
      run.decisions.push(decision)
      run.revision += 1
      run.updatedAt = timestamp
      run.pendingWaits = []
      run.waits = { approvalNodeIds: [], permissionNodeIds: [] }
      step.evidence.push(
        evidence(
          wait.kind === 'approval' ? 'approval' : 'permission',
          {
            waitId: wait.waitId,
            decisionId: decision.decisionId,
            outcome: decision.outcome,
            actor: decision.actor,
          },
          timestamp,
          wait.kind === 'approval' ? capturePolicy(asset).approvals : false,
          `${wait.kind} decision ${decision.outcome} recorded.`,
        ),
      )
      if (step.runtimeEvidence) {
        step.runtimeEvidence.decisionIds.push(decision.decisionId)
      }

      if (decision.outcome === 'reject' || decision.outcome === 'deny') {
        failPublishedRun(
          run,
          step,
          decision.outcome === 'reject'
            ? 'approval_rejected'
            : 'permission_denied',
          decision.reason ?? `${decision.outcome} decision accepted.`,
          timestamp,
        )
      } else if (wait.scope === 'human_approval') {
        step.state = 'completed'
        step.completedAt = timestamp
        step.approval = {
          status: 'not_required',
          message: step.approval.message,
        }
        step.evidence.push(
          evidence(
            'output',
            checkpoint.currentValue,
            timestamp,
            capturePolicy(asset).outputs,
            'Approval step completed.',
          ),
        )
        checkpoint.nextNodeIndex = stepIndex + 1
        await advanceR12Run(asset, run, checkpoint)
      } else if (
        wait.scope === 'step_execution' ||
        wait.scope === 'runtime_tool'
      ) {
        const projection = run.runtimeProjections.find(
          item => item.nodeId === step.nodeId,
        )
        if (!projection) {
          failPublishedRun(
            run,
            step,
            'execution_grant_missing',
            `Runtime projection for ${step.nodeId} is unavailable.`,
            timestamp,
          )
        } else if (!runtimeProjectionDigestMatches(projection)) {
          failPublishedRun(
            run,
            step,
            'execution_grant_conflict',
            `Frozen runtime projection for ${step.nodeId} failed its digest check.`,
            timestamp,
          )
        } else if (
          wait.grantDigest !== projection.grantDigest ||
          wait.catalogDigest !== projection.catalogDigest ||
          wait.policyDigest !== projection.policyDigest
        ) {
          failPublishedRun(
            run,
            step,
            'execution_grant_conflict',
            `Wait ${wait.waitId} no longer matches its frozen runtime projection.`,
            timestamp,
          )
        } else {
          const session = checkpoint.agentSessions[step.nodeId] ?? null
          const pendingSessionTool = session?.pendingTool ?? null
          if (
            wait.scope === 'runtime_tool' &&
            (!pendingSessionTool ||
              pendingSessionTool.toolId !== wait.action.id ||
              pendingSessionTool.inputDigest !== wait.action.inputDigest ||
              fingerprint(pendingSessionTool.input) !== pendingSessionTool.inputDigest)
          ) {
            failPublishedRun(
              run,
              step,
              'resume_failed',
              'Runtime Tool wait does not match its unresolved Tool checkpoint.',
              timestamp,
            )
          } else {
            const pendingTool = session?.pendingTool ?? null
            const attempt: PublishedWorkflowExecutionAttempt = {
              attemptId: hash(
                'wfattempt',
                `${run.runId}:${wait.waitId}:${decision.decisionId}`,
              ),
              operationId: hash(
                'wfop',
                `${run.runId}:${wait.waitId}:${decision.decisionId}`,
              ),
              nodeId: step.nodeId,
              waitId: wait.waitId,
              kind:
                wait.scope === 'runtime_tool' ? 'runtime_tool' : 'agent_step',
              status: 'prepared',
              preparedAt: timestamp,
              dispatchedAt: null,
              completedAt: null,
              toolId: pendingTool?.toolId ?? null,
              toolUseId: pendingTool?.toolUseId ?? null,
              inputDigest: pendingTool?.inputDigest ?? null,
              resultDigest: null,
              errorCode: null,
            }
            run.executionAttempts.push(attempt)
            step.runtimeEvidence?.executionAttemptIds.push(attempt.attemptId)
            // Write-ahead uncertainty marker: if this process exits after the
            // external boundary, the durable record already forbids blind replay.
            attempt.status = 'unknown'
            attempt.dispatchedAt = timestamp
            attempt.errorCode = 'execution_outcome_unknown'
            run.state = 'running'
            registry.updatedAt = timestamp
            saveRegistry(registry)

            let outcome: PublishedAgentRuntimeOutcome
            try {
              outcome = await executePublishedAgent({
                phase:
                  wait.scope === 'runtime_tool' ? 'resume_tool' : 'start',
                runId: run.runId,
                nodeId: step.nodeId,
                nodeTitle: step.title,
                nodeConfig: requestStrings(node.config),
                input: checkpoint.currentValue,
                projection,
                operationId: attempt.operationId,
                session,
                ...(wait.scope === 'runtime_tool'
                  ? {
                      toolDecision: {
                        outcome: 'allow_once' as const,
                        reason: decision.reason,
                        waitId: wait.waitId,
                        decisionId: decision.decisionId,
                      },
                    }
                  : {}),
              })
            } catch (error) {
              outcome = {
                status: 'unknown',
                session,
                runtimeVersion: null,
                runtimeBuild: null,
                requestedSkillIds: [...projection.skills.required],
                resolvedSkillIds: [],
                preloadedSkillIds: [],
                failedSkillIds: [],
                code: 'execution_outcome_unknown',
                error: error instanceof Error ? error.message : String(error),
              }
            }
            applyAgentRuntimeEvidence(step, outcome)
            const toolEvidenceError =
              outcome.status === 'waiting' || outcome.status === 'completed'
                ? validateAgentToolExecutionEvidence(
                    projection,
                    outcome,
                    pendingTool?.toolUseId ?? null,
                  )
                : null
            const evidenceError =
              outcome.status === 'waiting' || outcome.status === 'completed'
                ? validateAgentRuntimeEvidence(projection, outcome) ??
                  toolEvidenceError
                : null
            if (!toolEvidenceError) {
              recordAgentToolExecutionEvidence(
                run,
                step,
                attempt,
                outcome.toolExecutions ?? [],
                new Date().toISOString(),
              )
            }
            if (outcome.status === 'unknown') {
              attempt.status = 'unknown'
              attempt.completedAt = new Date().toISOString()
              attempt.errorCode = outcome.code
              failPublishedRun(
                run,
                step,
                outcome.code,
                outcome.error,
                attempt.completedAt,
              )
            } else if (evidenceError) {
              attempt.status = 'failed'
              attempt.completedAt = new Date().toISOString()
              attempt.errorCode = 'runtime_catalog_drift'
              failPublishedRun(
                run,
                step,
                'runtime_catalog_drift',
                evidenceError,
                attempt.completedAt,
              )
            } else if (outcome.status === 'waiting') {
              const pending = outcome.session.pendingTool
              if (
                !pending ||
                !projection.tools.inventory.includes(pending.toolId) ||
                !projection.tools.ask.includes(pending.toolId)
              ) {
                attempt.status = 'failed'
                attempt.completedAt = new Date().toISOString()
                attempt.errorCode = 'execution_grant_conflict'
                failPublishedRun(
                  run,
                  step,
                  'execution_grant_conflict',
                  'Runtime requested an unclassified or non-ask Tool.',
                  attempt.completedAt,
                )
              } else {
                checkpoint.agentSessions[step.nodeId] = outcome.session
                attempt.status = outcome.toolExecution ? 'completed' : 'waiting'
                attempt.errorCode = null
                if (outcome.toolExecution) {
                  attempt.completedAt = new Date().toISOString()
                  attempt.toolId = outcome.toolExecution.toolId
                  attempt.inputDigest = outcome.toolExecution.inputDigest
                  attempt.resultDigest = outcome.toolExecution.resultDigest
                }
                step.state = 'waiting_permission'
                step.permission = {
                  status: 'waiting',
                  capability: pending.toolId,
                  reason: 'Mossen Agent requested a Tool requiring allow-once authority.',
                }
                run.state = 'waiting_permission'
                const nextWait = addPendingWait(
                  run,
                  step,
                  {
                    kind: 'permission',
                    scope: 'runtime_tool',
                    actionKind: 'tool',
                    actionId: pending.toolId,
                    actionInput: pending.input,
                    safeSummary: `Run Tool ${pending.toolId} for ${step.title}.`,
                    allowedOutcomes: ['allow_once', 'deny'],
                    projection,
                  },
                  new Date().toISOString(),
                )
                step.runtimeEvidence?.permissionWaitIds.push(nextWait.waitId)
              }
            } else if (outcome.status === 'completed') {
              checkpoint.agentSessions[step.nodeId] = outcome.session
              attempt.status = 'completed'
              attempt.completedAt = new Date().toISOString()
              attempt.errorCode = null
              attempt.resultDigest = fingerprint(outcome.output)
              if (outcome.toolExecution) {
                attempt.toolId = outcome.toolExecution.toolId
                attempt.inputDigest = outcome.toolExecution.inputDigest
                attempt.resultDigest = outcome.toolExecution.resultDigest
              }
              step.state = 'completed'
              step.completedAt = attempt.completedAt
              step.permission = {
                status: 'not_required',
                capability: null,
                reason: null,
              }
              step.evidence.push(
                evidence(
                  'output',
                  outcome.output,
                  attempt.completedAt,
                  capturePolicy(asset).outputs,
                  'Mossen Agent output captured.',
                ),
              )
              if (step.runtimeEvidence) {
                step.runtimeEvidence.outputDigest = fingerprint(outcome.output)
              }
              const artifact = capturePolicy(asset).artifacts
                ? artifactForNode(
                    run.runId,
                    step.nodeId,
                    requestStrings(node.config),
                    outcome.output,
                    attempt.completedAt,
                  )
                : null
              if (artifact && !run.artifacts.some(item => item.artifactId === artifact.artifactId)) {
                run.artifacts.push(artifact)
              }
              checkpoint.currentValue = outcome.output
              checkpoint.nextNodeIndex = stepIndex + 1
              await advanceR12Run(asset, run, checkpoint)
            } else {
              attempt.status = 'failed'
              attempt.completedAt = new Date().toISOString()
              attempt.errorCode = outcome.code
              failPublishedRun(
                run,
                step,
                outcome.code,
                outcome.error,
                attempt.completedAt,
              )
            }
          }
        }
      } else {
        failPublishedRun(
          run,
          step,
          'unsupported_decision',
          `Wait scope ${wait.scope} is not executable in R12 v1.`,
          timestamp,
        )
      }

      const response = decisionResponse(run, request, wait, decision, timestamp)
      registry.runs = registry.runs.map(item =>
        item.runId === run.runId ? run : item,
      )
      if (isTerminalRunState(run.state)) {
        delete registry.checkpoints[run.runId]
      } else {
        registry.checkpoints[run.runId] = checkpoint
      }
      registry.receipts.unshift(response)
      registry.updatedAt = run.updatedAt
      recordIdempotency(
        registry,
        'decide',
        request.idempotencyKey,
        fingerprint(request),
        response,
      )
      retainRegistry(registry)
      saveRegistry(registry)
      return { ok: true, response, replayed: false }
    })
  } catch (error) {
    return conflict(
      'decide',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function queryPublishedWorkflowRun(
  value: unknown,
): PublishedWorkflowOperationResult<PublishedWorkflowQueryResponse> {
  const request = parseRunRequest(value)
  if (!request) {
    return conflict('query', value, 'invalid_request', 'Published run query is invalid.')
  }
  try {
    const registry = loadPublishedWorkflowRuntimeRegistry()
    const run = findRun(registry, request)
    if (!run) {
      return conflict('query', request, 'run_not_found', `Run ${request.runId} was not found.`)
    }
    if (!runIdentityMatches(run, request)) {
      return conflict(
        'query',
        request,
        'run_identity_conflict',
        'Run identity does not match the requested published asset identity.',
        runCurrent(run),
      )
    }
    return {
      ok: true,
      replayed: false,
      response: {
        version: 1,
        surface: 'workflow-run-query',
        requestId: request.requestId,
        assetId: request.assetId,
        assetVersion: request.assetVersion,
        sourceDigest: request.sourceDigest,
        runId: request.runId,
        run,
      },
    }
  } catch (error) {
    return conflict(
      'query',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function cancelPublishedWorkflowRun(
  value: unknown,
  now = new Date(),
): Promise<PublishedWorkflowOperationResult<PublishedWorkflowCancelResponse>> {
  const request = parseCancelRequest(value)
  if (!request) {
    return conflict('cancel', value, 'invalid_request', 'Published run cancel request is invalid.')
  }
  try {
    return await withRuntimeLock(registry => {
      const replay = priorResponse<PublishedWorkflowCancelResponse>(
        registry,
        'cancel',
        request,
      )
      if (replay) return replay
      const run = findRun(registry, request)
      if (!run) {
        return conflict('cancel', request, 'run_not_found', `Run ${request.runId} was not found.`)
      }
      if (!runIdentityMatches(run, request)) {
        return conflict(
          'cancel',
          request,
          'run_identity_conflict',
          'Run identity does not match the requested published asset identity.',
          runCurrent(run),
        )
      }
      if (
        run.executionProtocolVersion === 1 &&
        request.expectedRunRevision !== run.revision
      ) {
        return conflict(
          'cancel',
          request,
          'run_revision_conflict',
          `Run revision ${run.revision} does not match expected revision ${String(request.expectedRunRevision)}.`,
          runCurrent(run),
        )
      }
      if (run.state !== 'waiting_approval' && run.state !== 'waiting_permission') {
        return conflict(
          'cancel',
          request,
          'run_not_cancellable',
          `Run ${run.runId} is already ${run.state}.`,
          runCurrent(run),
        )
      }
      const timestamp = now.toISOString()
      const nextRun: PublishedWorkflowRun = {
        ...run,
        state: 'cancelled',
        revision: run.executionProtocolVersion === 1 ? run.revision + 1 : run.revision,
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelledAt: timestamp,
        pendingWaits: [],
        waits: { approvalNodeIds: [], permissionNodeIds: [] },
        steps: run.steps.map(step =>
          step.state === 'pending' || step.state.startsWith('waiting_')
            ? { ...step, state: 'cancelled', completedAt: timestamp }
            : step,
        ),
        finalResult: {
          status: 'cancelled',
          digest: createHash('sha256').update(`cancelled:${run.runId}`).digest('hex'),
        },
      }
      const response: PublishedWorkflowCancelResponse = {
        version: 1,
        surface: 'workflow-run-cancel-receipt',
        action: 'cancel',
        status: 'accepted',
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        receiptId: hash('wfcr', request.idempotencyKey),
        assetId: run.assetId,
        assetVersion: run.assetVersion,
        sourceDigest: run.sourceDigest,
        workflowName: run.workflowName,
        runId: run.runId,
        runState: 'cancelled',
        runRevision: nextRun.revision,
        retryOfRunId: nextRun.retryOfRunId,
        artifactIds: nextRun.artifacts.map(artifact => artifact.artifactId),
        createdAt: timestamp,
        run: nextRun,
      }
      registry.runs = registry.runs.map(item =>
        item.runId === run.runId ? nextRun : item,
      )
      delete registry.checkpoints[run.runId]
      registry.receipts.unshift(response)
      registry.updatedAt = timestamp
      recordIdempotency(registry, 'cancel', request.idempotencyKey, fingerprint(request), response)
      retainRegistry(registry)
      saveRegistry(registry)
      return { ok: true, response, replayed: false }
    })
  } catch (error) {
    return conflict(
      'cancel',
      request,
      'runtime_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}
