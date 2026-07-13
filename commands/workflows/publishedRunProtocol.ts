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
  state: PublishedWorkflowRunState
  createdAt: string
  updatedAt: string
  startedAt: string
  completedAt: string | null
  cancelledAt: string | null
  input: unknown
  steps: PublishedWorkflowStep[]
  artifacts: PublishedWorkflowArtifact[]
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
  action: 'enable' | 'invoke' | 'retry' | 'cancel'
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
  idempotency: Record<
    string,
    {
      operation: 'enable' | 'invoke' | 'retry' | 'cancel'
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
  | 'runtime_unavailable'

export type PublishedWorkflowConflict = {
  version: 1
  surface: 'workflow-published-run-conflict'
  operation: 'enable' | 'invoke' | 'retry' | 'query' | 'cancel'
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
type InvokeRequest = MutationRequest & { input?: unknown }
type RunRequest = IdentityRequest & { runId: string }
type RetryRequest = RunRequest & { idempotencyKey: string }
type CancelRequest = RunRequest & { idempotencyKey: string }

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
    runs: registry.runs.map(run => ({
      ...run,
      retryOfRunId:
        typeof (run as Partial<PublishedWorkflowRun>).retryOfRunId === 'string'
          ? run.retryOfRunId
          : null,
      artifacts: Array.isArray((run as Partial<PublishedWorkflowRun>).artifacts)
        ? run.artifacts
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
  return request ? (requestStrings(value) as InvokeRequest) : null
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
  if (!request || !validateUuid(raw.idempotencyKey)) return null
  return raw as CancelRequest
}

function parseRetryRequest(value: unknown): RetryRequest | null {
  const request = parseRunRequest(value)
  const raw = requestStrings(value)
  if (!request || !validateUuid(raw.idempotencyKey)) return null
  return raw as RetryRequest
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
  operation: 'enable' | 'invoke' | 'retry' | 'cancel',
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
  operation: 'enable' | 'invoke' | 'retry' | 'cancel',
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

async function executePublishedRun(
  asset: PublishedWorkflowAsset,
  request: InvokeRequest,
  receiptId: string,
  now: Date,
  retryOfRunId: string | null = null,
): Promise<PublishedWorkflowRun> {
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
    state: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    input: request.input ?? null,
    steps,
    artifacts: [],
    waits: { approvalNodeIds: [], permissionNodeIds: [] },
    finalResult: null,
  }
  let current: unknown = request.input ?? null
  const variables = isRecord(asset.definition.variables)
    ? { ...asset.definition.variables }
    : {}
  let shortCircuited = false

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const step = steps[index]!
    if (shortCircuited) {
      step.state = 'skipped'
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
        run.waits.approvalNodeIds.push(step.nodeId)
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
        run.waits.permissionNodeIds.push(step.nodeId)
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
  return run
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
      const receiptId = hash('wfir', request.idempotencyKey)
      const run = await executePublishedRun(resolved.asset, request, receiptId, now)
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
        retryOfRunId: null,
        artifactIds: run.artifacts.map(artifact => artifact.artifactId),
        createdAt: now.toISOString(),
        run,
      }
      registry.runs.unshift(run)
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
      const retriedRun = await executePublishedRun(
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
      )
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
        createdAt: timestamp,
        retryOfRunId: original.runId,
        artifactIds: retriedRun.artifacts.map(artifact => artifact.artifactId),
        run: retriedRun,
      }
      registry.runs.unshift(retriedRun)
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
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelledAt: timestamp,
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
        retryOfRunId: nextRun.retryOfRunId,
        artifactIds: nextRun.artifacts.map(artifact => artifact.artifactId),
        createdAt: timestamp,
        run: nextRun,
      }
      registry.runs = registry.runs.map(item =>
        item.runId === run.runId ? nextRun : item,
      )
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
