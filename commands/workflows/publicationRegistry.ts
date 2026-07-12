import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteJsonSync } from '../../utils/atomicWriteJson.js'
import { lock } from '../../utils/lockfile.js'
import { getMossenHome } from '../../utils/mossenHome.js'
import { validateUuid } from '../../utils/uuid.js'
import {
  parseWorkflowDraftEnvelope,
  stableWorkflowPublicationJson,
  validateWorkflowDraftEnvelope,
  type WorkflowDraftEnvelope,
  type WorkflowPublicationIssue,
  type WorkflowValidationResponse,
} from './publicationProtocol.js'

const REGISTRY_DIR = 'workflow-publication'
const REGISTRY_FILE = 'registry-v1.json'
const LOCK_FILE = '.registry-v1.lock'
const MAX_PUBLICATION_RECEIPTS = 500

export type WorkflowPublishRequest = WorkflowDraftEnvelope & {
  idempotencyKey: string
  expectedAssetId: string | null
  expectedAssetVersion: string | null
  scope: 'user'
}

export type WorkflowPublicationReceipt = {
  version: 1
  surface: 'workflow-publication-receipt'
  requestId: string
  idempotencyKey: string
  receiptId: string
  status: 'accepted'
  assetId: string
  canonicalName: string
  assetVersion: string
  lifecycle: 'published'
  sourceDigest: string
  draftId: string
  localRevision: number
  scope: 'user'
  publishedAt: string
}

export type PublishedWorkflowAsset = {
  assetId: string
  draftId: string
  canonicalName: string
  displayName: string
  description: string
  assetVersion: string
  lifecycle: 'published'
  sourceDigest: string
  localRevision: number
  scope: 'user'
  definition: Record<string, unknown>
  publishedAt: string
  updatedAt: string
  lastReceiptId: string
}

export type WorkflowPublicationConflictCode =
  | 'invalid_publish_request'
  | 'validation_failed'
  | 'idempotency_key_conflict'
  | 'expected_asset_not_found'
  | 'asset_id_conflict'
  | 'stale_asset_version'
  | 'canonical_name_conflict'
  | 'registry_unavailable'

export type WorkflowPublicationConflict = {
  version: 1
  surface: 'workflow-publication-conflict'
  requestId: string
  idempotencyKey: string
  status: 'rejected'
  code: WorkflowPublicationConflictCode
  message: string
  issues: WorkflowPublicationIssue[]
  current: {
    assetId: string
    assetVersion: string
    sourceDigest: string
    receiptId: string
  } | null
}

export type WorkflowPublicationResult =
  | { ok: true; receipt: WorkflowPublicationReceipt; replayed: boolean }
  | { ok: false; conflict: WorkflowPublicationConflict }

type StoredIdempotencyRecord = {
  fingerprint: string
  receipt: WorkflowPublicationReceipt
}

export type WorkflowPublicationRegistry = {
  version: 1
  updatedAt: string
  assets: PublishedWorkflowAsset[]
  receipts: WorkflowPublicationReceipt[]
  idempotency: Record<string, StoredIdempotencyRecord>
}

export class WorkflowPublicationRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowPublicationRegistryError'
  }
}

function emptyRegistry(): WorkflowPublicationRegistry {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    assets: [],
    receipts: [],
    idempotency: {},
  }
}

export function workflowPublicationRegistryPath(): string {
  return join(getMossenHome(), REGISTRY_DIR, REGISTRY_FILE)
}

function workflowPublicationLockPath(): string {
  return join(getMossenHome(), REGISTRY_DIR, LOCK_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStoredReceipt(value: unknown): value is WorkflowPublicationReceipt {
  if (!isRecord(value)) return false
  return (
    value.version === 1 &&
    value.surface === 'workflow-publication-receipt' &&
    typeof value.requestId === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.receiptId === 'string' &&
    value.status === 'accepted' &&
    typeof value.assetId === 'string' &&
    typeof value.canonicalName === 'string' &&
    typeof value.assetVersion === 'string' &&
    value.lifecycle === 'published' &&
    typeof value.sourceDigest === 'string' &&
    typeof value.draftId === 'string' &&
    typeof value.localRevision === 'number' &&
    value.scope === 'user' &&
    typeof value.publishedAt === 'string'
  )
}

function isStoredAsset(value: unknown): value is PublishedWorkflowAsset {
  if (!isRecord(value)) return false
  return (
    typeof value.assetId === 'string' &&
    typeof value.draftId === 'string' &&
    typeof value.canonicalName === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.description === 'string' &&
    typeof value.assetVersion === 'string' &&
    value.lifecycle === 'published' &&
    typeof value.sourceDigest === 'string' &&
    typeof value.localRevision === 'number' &&
    value.scope === 'user' &&
    isRecord(value.definition) &&
    typeof value.publishedAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.lastReceiptId === 'string'
  )
}

function parseRegistry(value: unknown): WorkflowPublicationRegistry {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.assets) ||
    !value.assets.every(isStoredAsset) ||
    !Array.isArray(value.receipts) ||
    !value.receipts.every(isStoredReceipt) ||
    !isRecord(value.idempotency)
  ) {
    throw new WorkflowPublicationRegistryError(
      'Workflow publication registry has an invalid v1 shape.',
    )
  }
  const idempotency: Record<string, StoredIdempotencyRecord> = {}
  for (const [key, raw] of Object.entries(value.idempotency)) {
    if (
      !isRecord(raw) ||
      typeof raw.fingerprint !== 'string' ||
      !isStoredReceipt(raw.receipt)
    ) {
      throw new WorkflowPublicationRegistryError(
        `Workflow publication idempotency record is invalid: ${key}.`,
      )
    }
    idempotency[key] = {
      fingerprint: raw.fingerprint,
      receipt: raw.receipt,
    }
  }
  return {
    version: 1,
    updatedAt: value.updatedAt,
    assets: value.assets,
    receipts: value.receipts,
    idempotency,
  }
}

export function loadWorkflowPublicationRegistry(): WorkflowPublicationRegistry {
  const path = workflowPublicationRegistryPath()
  if (!existsSync(path)) return emptyRegistry()
  try {
    return parseRegistry(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error instanceof WorkflowPublicationRegistryError) throw error
    throw new WorkflowPublicationRegistryError(
      `Workflow publication registry could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function canonicalWorkflowName(value: unknown): string {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLowerCase()
  return normalized
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function stableAssetId(scope: string, draftId: string): string {
  const digest = createHash('sha256')
    .update(`${scope}:${draftId}`, 'utf8')
    .digest('hex')
  return `wfa_${digest.slice(0, 24)}`
}

function stableReceiptId(idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`workflow-publication:${idempotencyKey}`, 'utf8')
    .digest('hex')
  return `wfpr_${digest.slice(0, 24)}`
}

function bumpPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return '1.0.0'
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function publishFingerprint(request: WorkflowPublishRequest): string {
  const payload = {
    protocolVersion: request.protocolVersion,
    draftSchema: request.draftSchema,
    draftId: request.draftId,
    localRevision: request.localRevision,
    sourceDigest: request.sourceDigest,
    expectedAssetId: request.expectedAssetId,
    expectedAssetVersion: request.expectedAssetVersion,
    scope: request.scope,
    definition: request.definition,
  }
  return createHash('sha256')
    .update(stableWorkflowPublicationJson(payload), 'utf8')
    .digest('hex')
}

function currentIdentity(asset?: PublishedWorkflowAsset | null): WorkflowPublicationConflict['current'] {
  if (!asset) return null
  return {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    sourceDigest: asset.sourceDigest,
    receiptId: asset.lastReceiptId,
  }
}

function conflict(
  raw: unknown,
  code: WorkflowPublicationConflictCode,
  message: string,
  issues: WorkflowPublicationIssue[] = [],
  current: PublishedWorkflowAsset | null = null,
): WorkflowPublicationResult {
  const request = isRecord(raw) ? raw : {}
  return {
    ok: false,
    conflict: {
      version: 1,
      surface: 'workflow-publication-conflict',
      requestId: typeof request.requestId === 'string' ? request.requestId : '',
      idempotencyKey:
        typeof request.idempotencyKey === 'string' ? request.idempotencyKey : '',
      status: 'rejected',
      code,
      message,
      issues,
      current: currentIdentity(current),
    },
  }
}

function parsePublishRequest(
  value: unknown,
): { request: WorkflowPublishRequest; validation: WorkflowValidationResponse } | WorkflowPublicationResult {
  const validation = validateWorkflowDraftEnvelope(value)
  const envelope = parseWorkflowDraftEnvelope(value)
  if (!isRecord(value) || !envelope) {
    return conflict(
      value,
      'invalid_publish_request',
      'Publish request envelope is invalid.',
      validation.errors,
    )
  }
  const issues: WorkflowPublicationIssue[] = []
  if (!validateUuid(value.idempotencyKey)) {
    issues.push({
      code: 'invalid-idempotency-key',
      message: 'idempotencyKey must be a UUID.',
      path: '/idempotencyKey',
    })
  }
  if (value.scope !== 'user') {
    issues.push({
      code: 'unsupported-scope',
      message: 'Only user publication scope is supported by protocol v1.',
      path: '/scope',
    })
  }
  for (const field of ['expectedAssetId', 'expectedAssetVersion'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') {
      issues.push({
        code: `invalid-${field === 'expectedAssetId' ? 'expected-asset-id' : 'expected-asset-version'}`,
        message: `${field} must be a string or null.`,
        path: `/${field}`,
      })
    }
  }
  if ((value.expectedAssetId === null) !== (value.expectedAssetVersion === null)) {
    issues.push({
      code: 'incomplete-expected-asset-identity',
      message: 'expectedAssetId and expectedAssetVersion must both be null or both be strings.',
      path: '/expectedAssetId',
    })
  }
  if (issues.length > 0) {
    return conflict(
      value,
      'invalid_publish_request',
      'Publish request fields are invalid.',
      issues,
    )
  }
  if (!validation.publishable) {
    return conflict(
      value,
      'validation_failed',
      'Workflow draft validation failed; no asset was published.',
      validation.errors,
    )
  }
  return {
    request: value as WorkflowPublishRequest,
    validation,
  }
}

function definitionDescription(definition: Record<string, unknown>): string {
  return typeof definition.description === 'string'
    ? definition.description
    : ''
}

export async function publishWorkflowDraft(
  value: unknown,
  now = new Date(),
): Promise<WorkflowPublicationResult> {
  const parsed = parsePublishRequest(value)
  if ('ok' in parsed) return parsed
  const { request } = parsed
  const registryPath = workflowPublicationRegistryPath()
  const lockPath = workflowPublicationLockPath()
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 })
  writeFileSync(lockPath, '', { encoding: 'utf8', flag: 'a', mode: 0o600 })
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(lockPath, {
      realpath: false,
      stale: 5_000,
      retries: {
        retries: 4,
        factor: 1,
        minTimeout: 25,
        maxTimeout: 100,
      },
    })
    const registry = loadWorkflowPublicationRegistry()
    const fingerprint = publishFingerprint(request)
    const priorIdempotency = registry.idempotency[request.idempotencyKey]
    if (priorIdempotency) {
      if (priorIdempotency.fingerprint === fingerprint) {
        return { ok: true, receipt: priorIdempotency.receipt, replayed: true }
      }
      const current = registry.assets.find(
        asset => asset.assetId === priorIdempotency.receipt.assetId,
      ) ?? null
      return conflict(
        request,
        'idempotency_key_conflict',
        'idempotencyKey was already used for a different publication request.',
        [],
        current,
      )
    }

    const canonicalName = canonicalWorkflowName(request.definition.name)
    if (!canonicalName) {
      return conflict(
        request,
        'invalid_publish_request',
        'Workflow name cannot be converted to a stable canonical name.',
        [{
          code: 'workflow-name-not-canonicalizable',
          message: 'Workflow name must contain at least one letter or number.',
          path: '/definition/name',
        }],
      )
    }
    const existing = registry.assets.find(asset => asset.draftId === request.draftId) ?? null
    const nameConflict = registry.assets.find(
      asset => asset.canonicalName === canonicalName && asset.draftId !== request.draftId,
    ) ?? null
    if (nameConflict) {
      return conflict(
        request,
        'canonical_name_conflict',
        `Published workflow name is already owned by asset ${nameConflict.assetId}.`,
        [],
        nameConflict,
      )
    }
    if (
      !existing &&
      (request.expectedAssetId !== null || request.expectedAssetVersion !== null)
    ) {
      return conflict(
        request,
        'expected_asset_not_found',
        'expectedAssetId was supplied but no published asset exists for this draft.',
      )
    }
    if (
      existing &&
      request.expectedAssetId !== null &&
      request.expectedAssetId !== existing.assetId
    ) {
      return conflict(
        request,
        'asset_id_conflict',
        'expectedAssetId does not match the current published asset.',
        [],
        existing,
      )
    }
    if (
      existing &&
      request.expectedAssetVersion !== existing.assetVersion
    ) {
      return conflict(
        request,
        'stale_asset_version',
        'expectedAssetVersion does not match the current published version.',
        [],
        existing,
      )
    }

    const timestamp = now.toISOString()
    const assetId = existing?.assetId ?? stableAssetId(request.scope, request.draftId)
    const assetVersion = existing
      ? existing.sourceDigest === request.sourceDigest
        ? existing.assetVersion
        : bumpPatchVersion(existing.assetVersion)
      : '1.0.0'
    const receipt: WorkflowPublicationReceipt = {
      version: 1,
      surface: 'workflow-publication-receipt',
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      receiptId: stableReceiptId(request.idempotencyKey),
      status: 'accepted',
      assetId,
      canonicalName,
      assetVersion,
      lifecycle: 'published',
      sourceDigest: request.sourceDigest,
      draftId: request.draftId,
      localRevision: request.localRevision,
      scope: request.scope,
      publishedAt: timestamp,
    }
    const asset: PublishedWorkflowAsset = {
      assetId,
      draftId: request.draftId,
      canonicalName,
      displayName: String(request.definition.name),
      description: definitionDescription(request.definition),
      assetVersion,
      lifecycle: 'published',
      sourceDigest: request.sourceDigest,
      localRevision: request.localRevision,
      scope: request.scope,
      definition: JSON.parse(JSON.stringify(request.definition)) as Record<string, unknown>,
      publishedAt: existing?.publishedAt ?? timestamp,
      updatedAt: timestamp,
      lastReceiptId: receipt.receiptId,
    }
    const assets = existing
      ? registry.assets.map(current => current.assetId === existing.assetId ? asset : current)
      : [...registry.assets, asset]
    const receipts = [receipt, ...registry.receipts]
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, MAX_PUBLICATION_RECEIPTS)
    const retainedReceiptIds = new Set(receipts.map(current => current.receiptId))
    const idempotency = Object.fromEntries(
      Object.entries({
        ...registry.idempotency,
        [request.idempotencyKey]: { fingerprint, receipt },
      }).filter(([, record]) => retainedReceiptIds.has(record.receipt.receiptId)),
    )
    const next: WorkflowPublicationRegistry = {
      version: 1,
      updatedAt: timestamp,
      assets: assets.sort((left, right) => left.assetId.localeCompare(right.assetId)),
      receipts,
      idempotency,
    }
    atomicWriteJsonSync(registryPath, next, { defaultMode: 0o600 })
    return { ok: true, receipt, replayed: false }
  } catch (error) {
    return conflict(
      value,
      'registry_unavailable',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    if (release) {
      // The registry transaction is already committed before lock release.
      // Do not turn a successful durable publication into a false failure if
      // lock cleanup itself races or fails; the bounded stale lock recovers.
      await release().catch(() => {})
    }
  }
}
