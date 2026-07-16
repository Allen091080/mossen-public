import { createHash } from 'node:crypto'
import { extractTextContent } from '../../utils/messages.js'
import { getDefaultSonnetModel } from '../../utils/model/model.js'
import { sideQuery } from '../../utils/sideQuery.js'
import { validateUuid } from '../../utils/uuid.js'
import {
  computeDesktopWorkflowSourceDigest,
  stableWorkflowPublicationJson,
  WORKFLOW_PUBLICATION_DRAFT_SCHEMA,
} from './publicationProtocol.js'
import {
  commitWorkflowGenerationRecord,
  inspectWorkflowGenerationCache,
} from './generationCache.js'

export const WORKFLOW_GENERATION_PROTOCOL_VERSION = 1 as const
export const MAX_WORKFLOW_GENERATION_INPUT_BYTES = 10 * 1024 * 1024
export const MAX_WORKFLOW_GENERATION_CLARIFICATION_ROUNDS = 3
export const MAX_WORKFLOW_GENERATION_QUESTIONS = 3
export const DEFAULT_WORKFLOW_GENERATION_TIMEOUT_MS = 370_000
export const DEFAULT_WORKFLOW_GENERATION_INITIAL_MODEL_TIMEOUT_MS = 180_000
export const DEFAULT_WORKFLOW_GENERATION_REPAIR_MODEL_TIMEOUT_MS = 180_000
export const MAX_WORKFLOW_GENERATION_MODEL_REPAIR_ATTEMPTS = 1

const MAX_WORKFLOW_GENERATION_REPAIR_CONTEXT_CHARS = 32_768

const SHA256_RE = /^[a-f0-9]{64}$/
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SUPPORTED_PLAN_NODE_TYPES = new Set([
  'mossen-call',
  'text-transform',
  'condition',
  'wait-delay',
  'loop-foreach',
  'fork-parallel',
  'human-approval',
  'set-variable',
  'join',
  'capability-action',
])
const KNOWN_DESKTOP_NODE_TYPES = new Set([
  'trigger-manual',
  'mossen-call',
  'text-transform',
  'condition',
  'http-request',
  'loop-foreach',
  'fork-parallel',
  'wait-delay',
  'file-read',
  'file-write',
  'human-approval',
  'trigger-webhook',
  'workflow-call',
  'set-variable',
  'join',
  'trigger-file-watch',
  'capability-action',
])
const ANSWER_TYPES = new Set([
  'short-text',
  'long-text',
  'single-choice',
  'multi-choice',
  'boolean',
  'number',
])
const BUSINESS_REJECTION_CODES = new Set([
  'unsupported-capability',
  'unsafe-request',
  'insufficient-grounding',
  'unsupported-draft-schema',
  'clarification-limit-reached',
  'policy-blocked',
])
const TRANSFORM_OPERATIONS = new Set([
  'replace',
  'regex-extract',
  'template',
  'trim',
  'uppercase',
  'lowercase',
])
const CONDITION_OPERATIONS = new Set([
  'contains',
  'regex',
  'not-empty',
  'equals',
])

type JsonRecord = Record<string, unknown>

export type WorkflowGenerationQuestion = {
  id: string
  path: string
  prompt: string
  reason: string
  required: boolean
  answerType:
    | 'short-text'
    | 'long-text'
    | 'single-choice'
    | 'multi-choice'
    | 'boolean'
    | 'number'
  options: Array<{ id: string; label: string }>
}

export type WorkflowGenerationAssumption = {
  id: string
  path: string
  statement: string
  confidence: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  sourceRefs: string[]
}

export type WorkflowGenerationWarning = {
  code: string
  severity: 'warning'
  path: string
  message: string
  requiresConfirmation: boolean
}

export type WorkflowGenerationUnresolvedBinding = {
  id: string
  kind:
    | 'human-executor'
    | 'agent-executor'
    | 'service-target'
    | 'business-subject'
    | 'skill'
    | 'capability'
    | 'connector'
    | 'permission-policy'
  path: string
  reason: string
  blockingStages: Array<'draft-test' | 'validate' | 'publish'>
  candidateIds: string[]
}

export type WorkflowGenerationProvenance = {
  path: string
  source: 'user-brief' | 'clarification-answer' | 'catalog' | 'inference'
  sourceRefs: string[]
  confidence: 'low' | 'medium' | 'high'
}

type WorkflowGenerationCommon = {
  version: 1
  surface: 'workflow-generation-result'
  requestId: string
  inputDigest: string
  catalogDigest: string
  mossenVersion: string
  generatedAt: string
}

export type WorkflowGenerationResult =
  | (WorkflowGenerationCommon & {
      status: 'needs_clarification'
      questions: WorkflowGenerationQuestion[]
      assumptions: WorkflowGenerationAssumption[]
      warnings: WorkflowGenerationWarning[]
    })
  | (WorkflowGenerationCommon & {
      status: 'proposed'
      proposalId: string
      draftSchema: typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA
      draft: Record<string, unknown>
      assumptions: WorkflowGenerationAssumption[]
      questions: []
      unresolvedBindings: WorkflowGenerationUnresolvedBinding[]
      warnings: WorkflowGenerationWarning[]
      provenance: WorkflowGenerationProvenance[]
    })
  | (WorkflowGenerationCommon & {
      status: 'rejected'
      code:
        | 'unsupported-capability'
        | 'unsafe-request'
        | 'insufficient-grounding'
        | 'unsupported-draft-schema'
        | 'clarification-limit-reached'
        | 'policy-blocked'
      reason: string
      warnings: WorkflowGenerationWarning[]
      questions: []
    })

export type WorkflowGenerationOperationErrorCode =
  | 'invalid-request'
  | 'input-too-large'
  | 'idempotency-conflict'
  | 'clarification-context-conflict'
  | 'generation-unavailable'
  | 'generation-timeout'
  | 'model-output-max-tokens'
  | 'model-output-empty'
  | 'model-output-invalid-json'
  | 'model-output-schema-invalid'
  | 'output-contract-invalid'
  | 'internal-error'
  | 'stdout-write-failed'

export type WorkflowGenerationOperationError = {
  version: 1
  surface: 'workflow-generation-error'
  requestId: string
  status: 'failed'
  code: WorkflowGenerationOperationErrorCode
  message: string
}

export type WorkflowGenerationProtocolDescriptor = {
  version: 1
  surface: 'workflow-generation-protocol'
  transport: 'stdin-json/stdout-json'
  input: 'workflow-generation-request/v1'
  output: 'workflow-generation-result/v1'
  draftSchema: typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA
  operation: {
    available: true
    args: ['workflows', 'generate-draft', '--stdin', '--json']
    idempotent: true
    writesState: false
    sideEffectMode: 'none'
  }
  limits: {
    maxInputBytes: 10485760
    maxClarificationRounds: 3
    maxQuestionsPerRound: 3
    timeoutMs: 370000
    initialModelTimeoutMs: 180000
    repairModelTimeoutMs: 180000
    maxModelOutputRepairAttempts: 1
  }
  requiredResultEvidence: [
    'requestId',
    'inputDigest',
    'catalogDigest',
    'mossenVersion',
  ]
}

type CatalogRoleTemplate = {
  id: string
  version: number
  snapshotDigest: string
  name: string
  description: string
  facetTypes: string[]
  executorKinds: string[]
  facets: unknown[]
}

type CatalogSkill = {
  id: string
  name: string
  description: string
}

type CatalogCapability = {
  id: string
  providerId?: string
  title: string
  sideEffect: string
  inputSchema?: JsonRecord
}

type CatalogConnector = {
  providerId: string
  status: string
}

type CatalogPolicy = {
  id: string
  title: string
  resolved: boolean
}

type CatalogTool = {
  id: string
  title: string
  sideEffect: string
}

type WorkflowGenerationRequest = {
  version: 1
  surface: 'workflow-generation-request'
  requestId: string
  idempotencyKey: string
  locale: string
  clarificationRound: number
  previousInputDigest: string | null
  brief: {
    description: string
    titleHint?: string
    expectedOutcome?: string
    constraints: string[]
    answers: Array<{
      questionId: string
      value: unknown
      selectedOptionIds: string[]
    }>
  }
  target: {
    draftSchema: typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA
    allowedNodeTypes: string[]
  }
  catalog: {
    version: 1
    digest: string
    roleTemplates: CatalogRoleTemplate[]
    skills: CatalogSkill[]
    capabilities: CatalogCapability[]
    connectors: CatalogConnector[]
    permissionPolicies: CatalogPolicy[]
    tools: CatalogTool[]
  }
  safety: {
    allowPublish: false
    allowInvoke: false
    allowSchedule: false
    allowExternalWrites: false
    allowSecrets: false
    requireExplicitHumanAssignee: true
    requireExplicitProductionTargets: true
  }
}

type ModelRolePlan = {
  key: string
  templateRoleId?: string
  name: string
  description: string
  executorKind: 'human' | 'mossen-agent'
  responsibilities: string[]
  requiredInputs: string[]
  expectedOutputs: string[]
  skillIds: string[]
  capabilityIds: string[]
  toolIds: string[]
  systemInstruction?: string
}

type ModelStepPlan = {
  key: string
  type: string
  title: string
  expectedOutcome: string
  executorRoleKey: string
  ownerRoleKey?: string
  reviewerRoleKeys: string[]
  approverRoleKeys: string[]
  prompt?: string
  operation?: string
  value?: string
  capabilityId?: string
  message?: string
  delayMs?: number
  branchCount?: number
  concurrencyCap?: number
  iterationCap?: number
  variableName?: string
  joinMode?: string
}

type ModelProposalPlan = {
  name: string
  description: string
  goalStatement: string
  expectedOutcome: string
  successCriteria: string[]
  roles: ModelRolePlan[]
  steps: ModelStepPlan[]
  assumptions: WorkflowGenerationAssumption[]
  warnings: WorkflowGenerationWarning[]
}

type ParsedModelResult =
  | {
      status: 'needs_clarification'
      questions: WorkflowGenerationQuestion[]
      assumptions: WorkflowGenerationAssumption[]
      warnings: WorkflowGenerationWarning[]
    }
  | { status: 'proposed'; proposal: ModelProposalPlan }
  | {
      status: 'rejected'
      code: string
      reason: string
    }

export type WorkflowGenerationModel = (
  request: WorkflowGenerationRequest,
  signal: AbortSignal,
) => Promise<unknown>

export type WorkflowGenerationOutcome =
  | { ok: true; result: WorkflowGenerationResult; replayed: boolean }
  | { ok: false; error: WorkflowGenerationOperationError }

type ParsedRequest = {
  request: WorkflowGenerationRequest
  inputDigest: string
  catalogDigest: string
  chainDigest: string
  fingerprint: string
  preflightRejection?: BusinessGenerationRejection
}

class InvalidGenerationRequest extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidGenerationRequest'
  }
}

class InvalidModelOutput extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidModelOutput'
  }
}

type WorkflowGenerationModelOutputErrorCode = Extract<
  WorkflowGenerationOperationErrorCode,
  | 'model-output-max-tokens'
  | 'model-output-empty'
  | 'model-output-invalid-json'
  | 'model-output-schema-invalid'
>

class WorkflowGenerationModelOutputError extends Error {
  constructor(
    readonly code: WorkflowGenerationModelOutputErrorCode,
    message: string,
    readonly repairable: boolean,
    readonly rawText = '',
  ) {
    super(message)
    this.name = 'WorkflowGenerationModelOutputError'
  }
}

export type WorkflowGenerationModelAttempt = 'initial' | 'repair'

export class WorkflowGenerationModelAttemptTimeout extends Error {
  constructor(
    readonly attempt: WorkflowGenerationModelAttempt,
    readonly timeoutMs: number,
  ) {
    super(`Workflow generation ${attempt} model attempt exceeded ${timeoutMs} ms.`)
    this.name = 'WorkflowGenerationModelAttemptTimeout'
  }
}

export async function runWorkflowGenerationModelAttempt<T>({
  attempt,
  parentSignal,
  timeoutMs,
  run,
}: {
  attempt: WorkflowGenerationModelAttempt
  parentSignal: AbortSignal
  timeoutMs: number
  run: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(parentSignal.reason)
  if (parentSignal.aborted) {
    abortFromParent()
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(
      new WorkflowGenerationModelAttemptTimeout(attempt, timeoutMs),
    )
  }, timeoutMs)
  timer.unref?.()
  try {
    const value = await run(controller.signal)
    if (timedOut) {
      throw new WorkflowGenerationModelAttemptTimeout(attempt, timeoutMs)
    }
    return value
  } catch (error) {
    if (timedOut) {
      throw new WorkflowGenerationModelAttemptTimeout(attempt, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', abortFromParent)
  }
}

class BusinessGenerationRejection extends Error {
  constructor(
    readonly code:
      | 'unsupported-capability'
      | 'unsafe-request'
      | 'insufficient-grounding'
      | 'unsupported-draft-schema'
      | 'clarification-limit-reached'
      | 'policy-blocked',
    message: string,
  ) {
    super(message)
    this.name = 'BusinessGenerationRejection'
  }
}

let activeGenerationAbortController: AbortController | null = null
let generationSignalHandlerInstalled = false

function installGenerationSignalHandler(): void {
  if (generationSignalHandlerInstalled) return
  generationSignalHandlerInstalled = true
  process.on('SIGTERM', () => activeGenerationAbortController?.abort())
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidGenerationRequest(`${field} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return nonEmptyString(value, field)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new InvalidGenerationRequest(`${field} must be a string array.`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

function modelString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidModelOutput(`${field} must be a non-empty string.`)
  }
  return value.trim()
}

function modelStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new InvalidModelOutput(`${field} must be a string array.`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(stableWorkflowPublicationJson(value), 'utf8')
    .digest('hex')
}

function shortId(prefix: string, seed: string, size = 20): string {
  return `${prefix}_${createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, size)}`
}

function runtimeVersion(): string {
  return typeof MACRO !== 'undefined' && MACRO.VERSION
    ? MACRO.VERSION
    : '1.4.3'
}

export function workflowGenerationProtocolDescriptor(): WorkflowGenerationProtocolDescriptor {
  return {
    version: 1,
    surface: 'workflow-generation-protocol',
    transport: 'stdin-json/stdout-json',
    input: 'workflow-generation-request/v1',
    output: 'workflow-generation-result/v1',
    draftSchema: WORKFLOW_PUBLICATION_DRAFT_SCHEMA,
    operation: {
      available: true,
      args: ['workflows', 'generate-draft', '--stdin', '--json'],
      idempotent: true,
      writesState: false,
      sideEffectMode: 'none',
    },
    limits: {
      maxInputBytes: 10485760,
      maxClarificationRounds: 3,
      maxQuestionsPerRound: 3,
      timeoutMs: DEFAULT_WORKFLOW_GENERATION_TIMEOUT_MS,
      initialModelTimeoutMs:
        DEFAULT_WORKFLOW_GENERATION_INITIAL_MODEL_TIMEOUT_MS,
      repairModelTimeoutMs:
        DEFAULT_WORKFLOW_GENERATION_REPAIR_MODEL_TIMEOUT_MS,
      maxModelOutputRepairAttempts: 1,
    },
    requiredResultEvidence: [
      'requestId',
      'inputDigest',
      'catalogDigest',
      'mossenVersion',
    ],
  }
}

export function workflowGenerationError(
  code: WorkflowGenerationOperationErrorCode,
  message: string,
  requestId = '',
): WorkflowGenerationOperationError {
  return {
    version: 1,
    surface: 'workflow-generation-error',
    requestId,
    status: 'failed',
    code,
    message,
  }
}

function assertUniqueIds(
  values: Array<{ id: string }>,
  field: string,
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new InvalidGenerationRequest(`${field} contains duplicate id ${value.id}.`)
    }
    seen.add(value.id)
  }
}

function parseRoleTemplates(value: unknown): CatalogRoleTemplate[] {
  if (!Array.isArray(value)) {
    throw new InvalidGenerationRequest('catalog.roleTemplates must be an array.')
  }
  const parsed = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new InvalidGenerationRequest(`catalog.roleTemplates[${index}] must be an object.`)
    }
    const id = nonEmptyString(item.id, `catalog.roleTemplates[${index}].id`)
    if (!SAFE_ID_RE.test(id)) {
      throw new InvalidGenerationRequest(`catalog.roleTemplates[${index}].id is invalid.`)
    }
    if (!Number.isInteger(item.version) || Number(item.version) < 0) {
      throw new InvalidGenerationRequest(`catalog.roleTemplates[${index}].version is invalid.`)
    }
    if (typeof item.snapshotDigest !== 'string' || !SHA256_RE.test(item.snapshotDigest)) {
      throw new InvalidGenerationRequest(
        `catalog.roleTemplates[${index}].snapshotDigest must be SHA-256.`,
      )
    }
    const facets = item.facets === undefined
      ? []
      : Array.isArray(item.facets)
        ? structuredClone(item.facets)
        : (() => {
            throw new InvalidGenerationRequest(
              `catalog.roleTemplates[${index}].facets must be an array.`,
            )
          })()
    return {
      id,
      version: Number(item.version),
      snapshotDigest: item.snapshotDigest,
      name: nonEmptyString(item.name, `catalog.roleTemplates[${index}].name`),
      description:
        typeof item.description === 'string' ? item.description.trim() : '',
      facetTypes: stringArray(
        item.facetTypes ?? [],
        `catalog.roleTemplates[${index}].facetTypes`,
      ),
      executorKinds: stringArray(
        item.executorKinds ?? [],
        `catalog.roleTemplates[${index}].executorKinds`,
      ),
      facets,
    }
  })
  assertUniqueIds(parsed, 'catalog.roleTemplates')
  return parsed
}

function parseSimpleCatalog<T extends { id: string }>(
  value: unknown,
  field: string,
  parser: (item: JsonRecord, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new InvalidGenerationRequest(`${field} must be an array.`)
  }
  const parsed = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new InvalidGenerationRequest(`${field}[${index}] must be an object.`)
    }
    return parser(item, index)
  })
  assertUniqueIds(parsed, field)
  return parsed
}

function containsSensitiveCatalogValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(child => containsSensitiveCatalogValue(child))
  }
  if (!isRecord(value)) return false
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '')
    if (/^(authorization|cookie|password|token|secret|apikey|envvalue)$/.test(normalized)) {
      if (
        (typeof child === 'string' && child.trim().length > 0) ||
        typeof child === 'number'
      ) {
        return true
      }
      if (isRecord(child)) {
        for (const evidenceKey of ['default', 'const', 'example', 'examples', 'value']) {
          const evidence = child[evidenceKey]
          if (
            (typeof evidence === 'string' && evidence.trim().length > 0) ||
            typeof evidence === 'number' ||
            (Array.isArray(evidence) && evidence.length > 0)
          ) {
            return true
          }
        }
      }
    }
    if (containsSensitiveCatalogValue(child)) return true
  }
  return false
}

function containsCredentialValue(value: string): boolean {
  return (
    /(?:authorization|cookie|password|token|secret|api[-_ ]?key)\s*[:=]\s*\S+/i.test(
      value,
    ) ||
    /bearer\s+[a-z0-9._~-]{8,}/i.test(value) ||
    /(?:密码|密钥|令牌|授权头)\s*[:：=]\s*\S+/u.test(value)
  )
}

function parseRequest(value: unknown): ParsedRequest {
  if (!isRecord(value)) {
    throw new InvalidGenerationRequest('generation request must be a JSON object.')
  }
  let byteLength: number
  try {
    byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new InvalidGenerationRequest('generation request must be JSON serializable.')
  }
  if (byteLength > MAX_WORKFLOW_GENERATION_INPUT_BYTES) {
    throw new InvalidGenerationRequest(
      `generation request exceeds ${MAX_WORKFLOW_GENERATION_INPUT_BYTES} bytes.`,
    )
  }
  const rawSemanticRequest = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== 'requestId' && key !== 'idempotencyKey',
    ),
  )
  const rawInputDigest = digest(rawSemanticRequest)
  if (value.version !== 1 || value.surface !== 'workflow-generation-request') {
    throw new InvalidGenerationRequest(
      'version must be 1 and surface must be workflow-generation-request.',
    )
  }
  if (!validateUuid(value.requestId)) {
    throw new InvalidGenerationRequest('requestId must be a UUID.')
  }
  if (!validateUuid(value.idempotencyKey)) {
    throw new InvalidGenerationRequest('idempotencyKey must be a UUID.')
  }
  const locale = nonEmptyString(value.locale, 'locale')
  if (
    !Number.isInteger(value.clarificationRound) ||
    Number(value.clarificationRound) < 0
  ) {
    throw new InvalidGenerationRequest(
      'clarificationRound must be a non-negative integer.',
    )
  }
  const clarificationRound = Number(value.clarificationRound)
  const previousInputDigest = value.previousInputDigest
  if (
    (clarificationRound === 0 && previousInputDigest !== null) ||
    (clarificationRound > 0 &&
      (typeof previousInputDigest !== 'string' ||
        !SHA256_RE.test(previousInputDigest)))
  ) {
    throw new InvalidGenerationRequest(
      'previousInputDigest must be null for round 0 and SHA-256 for later rounds.',
    )
  }

  if (!isRecord(value.brief)) {
    throw new InvalidGenerationRequest('brief must be an object.')
  }
  const description = nonEmptyString(value.brief.description, 'brief.description')
  const constraints = stringArray(value.brief.constraints ?? [], 'brief.constraints')
  if (!Array.isArray(value.brief.answers)) {
    throw new InvalidGenerationRequest('brief.answers must be an array.')
  }
  const answers = value.brief.answers.map((answer, index) => {
    if (!isRecord(answer)) {
      throw new InvalidGenerationRequest(`brief.answers[${index}] must be an object.`)
    }
    return {
      questionId: nonEmptyString(
        answer.questionId,
        `brief.answers[${index}].questionId`,
      ),
      value: answer.value,
      selectedOptionIds: stringArray(
        answer.selectedOptionIds ?? [],
        `brief.answers[${index}].selectedOptionIds`,
      ),
    }
  })
  if (clarificationRound === 0 && answers.length > 0) {
    throw new InvalidGenerationRequest(
      'round 0 must not contain clarification answers.',
    )
  }
  if (clarificationRound > 0 && answers.length === 0) {
    throw new InvalidGenerationRequest(
      'later clarification rounds must resend accumulated answers.',
    )
  }

  if (!isRecord(value.target)) {
    throw new InvalidGenerationRequest('target must be an object.')
  }
  const targetDraftSchema = nonEmptyString(
    value.target.draftSchema,
    'target.draftSchema',
  )
  const allowedNodeTypes = stringArray(
    value.target.allowedNodeTypes,
    'target.allowedNodeTypes',
  )
  if (allowedNodeTypes.length === 0) {
    throw new InvalidGenerationRequest('target.allowedNodeTypes must not be empty.')
  }
  for (const nodeType of allowedNodeTypes) {
    if (!KNOWN_DESKTOP_NODE_TYPES.has(nodeType)) {
      throw new InvalidGenerationRequest(
        `target.allowedNodeTypes contains unknown type ${nodeType}.`,
      )
    }
  }

  if (!isRecord(value.catalog) || value.catalog.version !== 1) {
    throw new InvalidGenerationRequest('catalog.version must be 1.')
  }
  if (typeof value.catalog.digest !== 'string' || !SHA256_RE.test(value.catalog.digest)) {
    throw new InvalidGenerationRequest('catalog.digest must be a lowercase SHA-256 digest.')
  }
  let preflightRejection: BusinessGenerationRejection | undefined
  if (containsSensitiveCatalogValue(value.catalog)) {
    preflightRejection = new BusinessGenerationRejection(
      'policy-blocked',
      'The catalog contains a secret-bearing value and was not sent to the model.',
    )
  }
  if (
    containsCredentialValue(description) ||
    constraints.some(containsCredentialValue)
  ) {
    preflightRejection = new BusinessGenerationRejection(
      'unsafe-request',
      'The brief contains a credential-shaped value and was not sent to the model.',
    )
  }
  const roleTemplates = parseRoleTemplates(value.catalog.roleTemplates)
  const skills = parseSimpleCatalog(
    value.catalog.skills,
    'catalog.skills',
    (item, index) => ({
      id: nonEmptyString(item.id, `catalog.skills[${index}].id`),
      name: nonEmptyString(item.name, `catalog.skills[${index}].name`),
      description: typeof item.description === 'string' ? item.description.trim() : '',
    }),
  )
  const capabilities = parseSimpleCatalog(
    value.catalog.capabilities,
    'catalog.capabilities',
    (item, index) => ({
      id: nonEmptyString(item.id, `catalog.capabilities[${index}].id`),
      ...(typeof item.providerId === 'string' && item.providerId.trim()
        ? { providerId: item.providerId.trim() }
        : {}),
      title: nonEmptyString(item.title, `catalog.capabilities[${index}].title`),
      sideEffect: nonEmptyString(
        item.sideEffect,
        `catalog.capabilities[${index}].sideEffect`,
      ),
      ...(isRecord(item.inputSchema)
        ? { inputSchema: structuredClone(item.inputSchema) }
        : {}),
    }),
  )
  const connectorsWithId = parseSimpleCatalog(
    value.catalog.connectors,
    'catalog.connectors',
    (item, index) => ({
      id: nonEmptyString(
        item.providerId,
        `catalog.connectors[${index}].providerId`,
      ),
      status: nonEmptyString(item.status, `catalog.connectors[${index}].status`),
    }),
  )
  const permissionPolicies = parseSimpleCatalog(
    value.catalog.permissionPolicies,
    'catalog.permissionPolicies',
    (item, index) => ({
      id: nonEmptyString(
        item.id,
        `catalog.permissionPolicies[${index}].id`,
      ),
      title: nonEmptyString(
        item.title,
        `catalog.permissionPolicies[${index}].title`,
      ),
      resolved: item.resolved === true,
    }),
  )
  const tools = parseSimpleCatalog(
    value.catalog.tools,
    'catalog.tools',
    (item, index) => ({
      id: nonEmptyString(item.id, `catalog.tools[${index}].id`),
      title: nonEmptyString(item.title, `catalog.tools[${index}].title`),
      sideEffect: nonEmptyString(item.sideEffect, `catalog.tools[${index}].sideEffect`),
    }),
  )

  if (!isRecord(value.safety)) {
    throw new InvalidGenerationRequest('safety must be an object.')
  }
  const safety = value.safety
  const safeFlags =
    safety.allowPublish === false &&
    safety.allowInvoke === false &&
    safety.allowSchedule === false &&
    safety.allowExternalWrites === false &&
    safety.allowSecrets === false &&
    safety.requireExplicitHumanAssignee === true &&
    safety.requireExplicitProductionTargets === true
  if (!safeFlags) {
    preflightRejection = new BusinessGenerationRejection(
      'policy-blocked',
      'Generation requires the frozen no-publish, no-run, no-schedule, no-write safety policy.',
    )
  }

  const request: WorkflowGenerationRequest = {
    version: 1,
    surface: 'workflow-generation-request',
    requestId: value.requestId as string,
    idempotencyKey: value.idempotencyKey as string,
    locale,
    clarificationRound,
    previousInputDigest: previousInputDigest as string | null,
    brief: {
      description,
      ...(optionalString(value.brief.titleHint, 'brief.titleHint')
        ? { titleHint: optionalString(value.brief.titleHint, 'brief.titleHint') }
        : {}),
      ...(optionalString(value.brief.expectedOutcome, 'brief.expectedOutcome')
        ? {
            expectedOutcome: optionalString(
              value.brief.expectedOutcome,
              'brief.expectedOutcome',
            ),
          }
        : {}),
      constraints,
      answers,
    },
    target: {
      draftSchema: targetDraftSchema as typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA,
      allowedNodeTypes,
    },
    catalog: {
      version: 1,
      digest: value.catalog.digest,
      roleTemplates,
      skills,
      capabilities,
      connectors: connectorsWithId.map(connector => ({
        providerId: connector.id,
        status: connector.status,
      })),
      permissionPolicies,
      tools,
    },
    safety: {
      allowPublish: false,
      allowInvoke: false,
      allowSchedule: false,
      allowExternalWrites: false,
      allowSecrets: false,
      requireExplicitHumanAssignee: true,
      requireExplicitProductionTargets: true,
    },
  }
  const inputDigest = rawInputDigest
  const chainDigest = digest({
    version: request.version,
    surface: request.surface,
    locale: request.locale,
    brief: {
      description: request.brief.description,
      titleHint: request.brief.titleHint,
      expectedOutcome: request.brief.expectedOutcome,
      constraints: request.brief.constraints,
    },
    target: request.target,
    catalogDigest: request.catalog.digest,
    safety: request.safety,
  })
  return {
    request,
    inputDigest,
    catalogDigest: request.catalog.digest,
    chainDigest,
    fingerprint: digest({ inputDigest, catalogDigest: request.catalog.digest }),
    ...(preflightRejection ? { preflightRejection } : {}),
  }
}

function parseQuestion(value: unknown, index: number): WorkflowGenerationQuestion {
  if (!isRecord(value)) {
    throw new InvalidModelOutput(`questions[${index}] must be an object.`)
  }
  const answerType = modelString(value.answerType, `questions[${index}].answerType`)
  if (!ANSWER_TYPES.has(answerType)) {
    throw new InvalidModelOutput(`questions[${index}].answerType is unsupported.`)
  }
  if (!Array.isArray(value.options)) {
    throw new InvalidModelOutput(`questions[${index}].options must be an array.`)
  }
  const options = value.options.map((option, optionIndex) => {
    if (!isRecord(option)) {
      throw new InvalidModelOutput(
        `questions[${index}].options[${optionIndex}] must be an object.`,
      )
    }
    return {
      id: modelString(option.id, `questions[${index}].options[${optionIndex}].id`),
      label: modelString(
        option.label,
        `questions[${index}].options[${optionIndex}].label`,
      ),
    }
  })
  return {
    id: modelString(value.id, `questions[${index}].id`),
    path: modelString(value.path, `questions[${index}].path`),
    prompt: modelString(value.prompt, `questions[${index}].prompt`),
    reason: modelString(value.reason, `questions[${index}].reason`),
    required: value.required !== false,
    answerType: answerType as WorkflowGenerationQuestion['answerType'],
    options,
  }
}

function parseAssumption(value: unknown, index: number): WorkflowGenerationAssumption {
  if (!isRecord(value)) {
    throw new InvalidModelOutput(`assumptions[${index}] must be an object.`)
  }
  const confidence = value.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    throw new InvalidModelOutput(`assumptions[${index}].confidence is invalid.`)
  }
  return {
    id: modelString(value.id, `assumptions[${index}].id`),
    path: modelString(value.path, `assumptions[${index}].path`),
    statement: modelString(value.statement, `assumptions[${index}].statement`),
    confidence,
    requiresConfirmation: value.requiresConfirmation !== false,
    sourceRefs: modelStringArray(
      value.sourceRefs ?? [],
      `assumptions[${index}].sourceRefs`,
    ),
  }
}

function parseWarning(value: unknown, index: number): WorkflowGenerationWarning {
  if (!isRecord(value)) {
    throw new InvalidModelOutput(`warnings[${index}] must be an object.`)
  }
  return {
    code: modelString(value.code, `warnings[${index}].code`),
    severity: 'warning',
    path: modelString(value.path, `warnings[${index}].path`),
    message: modelString(value.message, `warnings[${index}].message`),
    requiresConfirmation: value.requiresConfirmation !== false,
  }
}

function parseModelRole(value: unknown, index: number): ModelRolePlan {
  if (!isRecord(value)) {
    throw new InvalidModelOutput(`proposal.roles[${index}] must be an object.`)
  }
  if (value.executorKind !== 'human' && value.executorKind !== 'mossen-agent') {
    throw new InvalidModelOutput(`proposal.roles[${index}].executorKind is invalid.`)
  }
  return {
    key: modelString(value.key, `proposal.roles[${index}].key`),
    ...(typeof value.templateRoleId === 'string' && value.templateRoleId.trim()
      ? { templateRoleId: value.templateRoleId.trim() }
      : {}),
    name: modelString(value.name, `proposal.roles[${index}].name`),
    description:
      typeof value.description === 'string' ? value.description.trim() : '',
    executorKind: value.executorKind,
    responsibilities: modelStringArray(
      value.responsibilities ?? [],
      `proposal.roles[${index}].responsibilities`,
    ),
    requiredInputs: modelStringArray(
      value.requiredInputs ?? [],
      `proposal.roles[${index}].requiredInputs`,
    ),
    expectedOutputs: modelStringArray(
      value.expectedOutputs ?? [],
      `proposal.roles[${index}].expectedOutputs`,
    ),
    skillIds: modelStringArray(
      value.skillIds ?? [],
      `proposal.roles[${index}].skillIds`,
    ),
    capabilityIds: modelStringArray(
      value.capabilityIds ?? [],
      `proposal.roles[${index}].capabilityIds`,
    ),
    toolIds: modelStringArray(
      value.toolIds ?? [],
      `proposal.roles[${index}].toolIds`,
    ),
    ...(typeof value.systemInstruction === 'string' && value.systemInstruction.trim()
      ? { systemInstruction: value.systemInstruction.trim() }
      : {}),
  }
}

function parseModelStep(value: unknown, index: number): ModelStepPlan {
  if (!isRecord(value)) {
    throw new InvalidModelOutput(`proposal.steps[${index}] must be an object.`)
  }
  return {
    key: modelString(value.key, `proposal.steps[${index}].key`),
    type: modelString(value.type, `proposal.steps[${index}].type`),
    title: modelString(value.title, `proposal.steps[${index}].title`),
    expectedOutcome: modelString(
      value.expectedOutcome,
      `proposal.steps[${index}].expectedOutcome`,
    ),
    executorRoleKey: modelString(
      value.executorRoleKey,
      `proposal.steps[${index}].executorRoleKey`,
    ),
    ...(typeof value.ownerRoleKey === 'string' && value.ownerRoleKey.trim()
      ? { ownerRoleKey: value.ownerRoleKey.trim() }
      : {}),
    reviewerRoleKeys: modelStringArray(
      value.reviewerRoleKeys ?? [],
      `proposal.steps[${index}].reviewerRoleKeys`,
    ),
    approverRoleKeys: modelStringArray(
      value.approverRoleKeys ?? [],
      `proposal.steps[${index}].approverRoleKeys`,
    ),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.operation === 'string' ? { operation: value.operation } : {}),
    ...(typeof value.value === 'string' ? { value: value.value } : {}),
    ...(typeof value.capabilityId === 'string'
      ? { capabilityId: value.capabilityId }
      : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.delayMs === 'number' ? { delayMs: value.delayMs } : {}),
    ...(typeof value.branchCount === 'number'
      ? { branchCount: value.branchCount }
      : {}),
    ...(typeof value.concurrencyCap === 'number'
      ? { concurrencyCap: value.concurrencyCap }
      : {}),
    ...(typeof value.iterationCap === 'number'
      ? { iterationCap: value.iterationCap }
      : {}),
    ...(typeof value.variableName === 'string'
      ? { variableName: value.variableName }
      : {}),
    ...(typeof value.joinMode === 'string' ? { joinMode: value.joinMode } : {}),
  }
}

function parseModelResult(
  value: unknown,
  request: WorkflowGenerationRequest,
): ParsedModelResult {
  if (!isRecord(value)) {
    throw new InvalidModelOutput('model output must be a JSON object.')
  }
  if (value.status === 'needs_clarification') {
    if (!Array.isArray(value.questions)) {
      throw new InvalidModelOutput('questions must be an array.')
    }
    const questions = value.questions.map(parseQuestion)
    if (questions.length < 1 || questions.length > MAX_WORKFLOW_GENERATION_QUESTIONS) {
      throw new InvalidModelOutput('clarification requires 1-3 questions.')
    }
    const answered = new Set(request.brief.answers.map(answer => answer.questionId))
    if (questions.some(question => answered.has(question.id))) {
      throw new InvalidModelOutput('model repeated an already answered question.')
    }
    return {
      status: 'needs_clarification',
      questions,
      assumptions: Array.isArray(value.assumptions)
        ? value.assumptions.map(parseAssumption)
        : [],
      warnings: Array.isArray(value.warnings)
        ? value.warnings.map(parseWarning)
        : [],
    }
  }
  if (value.status === 'rejected') {
    const code = modelString(value.code, 'code')
    if (!BUSINESS_REJECTION_CODES.has(code)) {
      throw new InvalidModelOutput('rejected code is unsupported.')
    }
    return {
      status: 'rejected',
      code,
      reason: modelString(value.reason, 'reason'),
    }
  }
  if (value.status !== 'proposed' || !isRecord(value.proposal)) {
    throw new InvalidModelOutput(
      'status must be needs_clarification, proposed, or rejected.',
    )
  }
  const proposal = value.proposal
  if (!Array.isArray(proposal.roles) || proposal.roles.length === 0) {
    throw new InvalidModelOutput('proposal.roles must contain at least one role.')
  }
  if (!Array.isArray(proposal.steps) || proposal.steps.length === 0) {
    throw new InvalidModelOutput('proposal.steps must contain at least one step.')
  }
  const roles = proposal.roles.map(parseModelRole)
  const steps = proposal.steps.map(parseModelStep)
  if (new Set(roles.map(role => role.key)).size !== roles.length) {
    throw new InvalidModelOutput('proposal role keys must be unique.')
  }
  if (new Set(steps.map(step => step.key)).size !== steps.length) {
    throw new InvalidModelOutput('proposal step keys must be unique.')
  }
  return {
    status: 'proposed',
    proposal: {
      name: modelString(proposal.name, 'proposal.name'),
      description:
        typeof proposal.description === 'string'
          ? proposal.description.trim()
          : '',
      goalStatement: modelString(proposal.goalStatement, 'proposal.goalStatement'),
      expectedOutcome: modelString(
        proposal.expectedOutcome,
        'proposal.expectedOutcome',
      ),
      successCriteria: modelStringArray(
        proposal.successCriteria,
        'proposal.successCriteria',
      ),
      roles,
      steps,
      assumptions: Array.isArray(proposal.assumptions)
        ? proposal.assumptions.map(parseAssumption)
        : [],
      warnings: Array.isArray(proposal.warnings)
        ? proposal.warnings.map(parseWarning)
        : [],
    },
  }
}

function nullableModelSchema(schema: JsonRecord): JsonRecord {
  return { anyOf: [schema, { type: 'null' }] }
}

function modelStringSchema(): JsonRecord {
  return { type: 'string', minLength: 1 }
}

function modelStringArraySchema(): JsonRecord {
  return { type: 'array', items: modelStringSchema() }
}

export function workflowGenerationModelOutputSchema(): JsonRecord {
  const optionSchema: JsonRecord = {
    type: 'object',
    properties: {
      id: modelStringSchema(),
      label: modelStringSchema(),
    },
    required: ['id', 'label'],
    additionalProperties: false,
  }
  const questionSchema: JsonRecord = {
    type: 'object',
    properties: {
      id: modelStringSchema(),
      path: modelStringSchema(),
      prompt: modelStringSchema(),
      reason: modelStringSchema(),
      required: { type: 'boolean' },
      answerType: { enum: [...ANSWER_TYPES] },
      options: { type: 'array', items: optionSchema },
    },
    required: [
      'id',
      'path',
      'prompt',
      'reason',
      'required',
      'answerType',
      'options',
    ],
    additionalProperties: false,
  }
  const assumptionSchema: JsonRecord = {
    type: 'object',
    properties: {
      id: modelStringSchema(),
      path: modelStringSchema(),
      statement: modelStringSchema(),
      confidence: { enum: ['low', 'medium', 'high'] },
      requiresConfirmation: { type: 'boolean' },
      sourceRefs: modelStringArraySchema(),
    },
    required: [
      'id',
      'path',
      'statement',
      'confidence',
      'requiresConfirmation',
      'sourceRefs',
    ],
    additionalProperties: false,
  }
  const warningSchema: JsonRecord = {
    type: 'object',
    properties: {
      code: modelStringSchema(),
      severity: { const: 'warning' },
      path: modelStringSchema(),
      message: modelStringSchema(),
      requiresConfirmation: { type: 'boolean' },
    },
    required: [
      'code',
      'severity',
      'path',
      'message',
      'requiresConfirmation',
    ],
    additionalProperties: false,
  }
  const roleSchema: JsonRecord = {
    type: 'object',
    properties: {
      key: modelStringSchema(),
      templateRoleId: nullableModelSchema(modelStringSchema()),
      name: modelStringSchema(),
      description: modelStringSchema(),
      executorKind: { enum: ['human', 'mossen-agent'] },
      responsibilities: modelStringArraySchema(),
      requiredInputs: modelStringArraySchema(),
      expectedOutputs: modelStringArraySchema(),
      skillIds: modelStringArraySchema(),
      capabilityIds: modelStringArraySchema(),
      toolIds: modelStringArraySchema(),
      systemInstruction: nullableModelSchema(modelStringSchema()),
    },
    required: [
      'key',
      'templateRoleId',
      'name',
      'description',
      'executorKind',
      'responsibilities',
      'requiredInputs',
      'expectedOutputs',
      'skillIds',
      'capabilityIds',
      'toolIds',
      'systemInstruction',
    ],
    additionalProperties: false,
  }
  const nullableString = () => nullableModelSchema(modelStringSchema())
  const nullableInteger = (minimum = 0) =>
    nullableModelSchema({ type: 'integer', minimum })
  const stepSchema: JsonRecord = {
    type: 'object',
    properties: {
      key: modelStringSchema(),
      type: { enum: [...SUPPORTED_PLAN_NODE_TYPES] },
      title: modelStringSchema(),
      expectedOutcome: modelStringSchema(),
      executorRoleKey: modelStringSchema(),
      ownerRoleKey: nullableString(),
      reviewerRoleKeys: modelStringArraySchema(),
      approverRoleKeys: modelStringArraySchema(),
      prompt: nullableString(),
      operation: nullableString(),
      value: nullableString(),
      capabilityId: nullableString(),
      message: nullableString(),
      delayMs: nullableInteger(),
      branchCount: nullableInteger(1),
      concurrencyCap: nullableInteger(1),
      iterationCap: nullableInteger(1),
      variableName: nullableString(),
      joinMode: nullableString(),
    },
    required: [
      'key',
      'type',
      'title',
      'expectedOutcome',
      'executorRoleKey',
      'ownerRoleKey',
      'reviewerRoleKeys',
      'approverRoleKeys',
      'prompt',
      'operation',
      'value',
      'capabilityId',
      'message',
      'delayMs',
      'branchCount',
      'concurrencyCap',
      'iterationCap',
      'variableName',
      'joinMode',
    ],
    additionalProperties: false,
  }
  const proposalSchema: JsonRecord = {
    type: 'object',
    properties: {
      name: modelStringSchema(),
      description: modelStringSchema(),
      goalStatement: modelStringSchema(),
      expectedOutcome: modelStringSchema(),
      successCriteria: {
        ...modelStringArraySchema(),
        minItems: 1,
      },
      roles: { type: 'array', minItems: 1, items: roleSchema },
      steps: { type: 'array', minItems: 1, items: stepSchema },
      assumptions: { type: 'array', items: assumptionSchema },
      warnings: { type: 'array', items: warningSchema },
    },
    required: [
      'name',
      'description',
      'goalStatement',
      'expectedOutcome',
      'successCriteria',
      'roles',
      'steps',
      'assumptions',
      'warnings',
    ],
    additionalProperties: false,
  }
  return {
    type: 'object',
    properties: {
      status: { enum: ['needs_clarification', 'proposed', 'rejected'] },
      questions: {
        type: 'array',
        maxItems: MAX_WORKFLOW_GENERATION_QUESTIONS,
        items: questionSchema,
      },
      assumptions: { type: 'array', items: assumptionSchema },
      warnings: { type: 'array', items: warningSchema },
      proposal: nullableModelSchema(proposalSchema),
      code: nullableModelSchema({ enum: [...BUSINESS_REJECTION_CODES] }),
      reason: nullableModelSchema(modelStringSchema()),
    },
    required: [
      'status',
      'questions',
      'assumptions',
      'warnings',
      'proposal',
      'code',
      'reason',
    ],
    additionalProperties: false,
  }
}

function modelSystemPrompt(): string {
  return `You are Mossen's typed Workflow generation planner. Return one JSON object only, matching the supplied JSON Schema exactly.

Always include exactly these root fields: status, questions, assumptions, warnings, proposal, code, reason. Use [] for irrelevant arrays and null for irrelevant proposal/code/reason fields.

Every array must contain only complete values of its declared item type. Never use null, strings, placeholder objects, or partial objects as array items. If you cannot provide every required field of an assumption or warning, return [] for that array. Prefer empty assumptions and warnings over speculative filler.

You never publish, invoke, enable, schedule, send messages, access files, call tools, bind production resources, or claim validation. You receive a public redacted catalog. Every templateRoleId, skillId, capabilityId, providerId, and toolId in your response must exactly exist in that catalog.

Choose exactly one status:
- needs_clarification: 1-3 structured questions. Every question must contain non-empty id, path, prompt, and reason plus required, answerType, and options. answerType must be exactly one of short-text, long-text, single-choice, multi-choice, boolean, or number. Use single-choice with complete non-empty id/label options for a role-selection question. A valid role-selection shape is {"id":"approval-role","path":"brief.approvalRole","prompt":"Which role approves?","reason":"Approval ownership changes the workflow gate.","required":true,"answerType":"single-choice","options":[{"id":"operations-owner","label":"Operations owner"}]}. Do not repeat answered question IDs.
- proposed: a proposal object with name, description, goalStatement, expectedOutcome, successCriteria, roles, steps, assumptions, warnings.
- rejected: a stable business code and reason.

Proposal roles are complete objects. Every role must contain exactly: key, templateRoleId (string or null), name, description, executorKind (human or mossen-agent), responsibilities, requiredInputs, expectedOutputs, skillIds, capabilityIds, toolIds, and systemInstruction (string or null). All required strings are non-empty. A complete untemplated role shape is {"key":"analyst","templateRoleId":null,"name":"Analyst","description":"Produces the draft","executorKind":"mossen-agent","responsibilities":["Produce draft"],"requiredInputs":["Source report"],"expectedOutputs":["Draft report"],"skillIds":[],"capabilityIds":[],"toolIds":[],"systemInstruction":null}. Use only catalog IDs and do not invent assigneeId, agentId, policy, host, root, secret, or target.

Proposal steps are complete objects. Every step must contain exactly: key, type, title, expectedOutcome, executorRoleKey, ownerRoleKey, reviewerRoleKeys, approverRoleKeys, prompt, operation, value, capabilityId, message, delayMs, branchCount, concurrencyCap, iterationCap, variableName, and joinMode. Use null for every unused nullable field; never omit it or use an empty-string placeholder. type is one of: mossen-call, text-transform, condition, wait-delay, loop-foreach, fork-parallel, human-approval, set-variable, join, capability-action. A complete mossen-call shape is {"key":"draft","type":"mossen-call","title":"Draft report","expectedOutcome":"A reviewable draft","executorRoleKey":"analyst","ownerRoleKey":"analyst","reviewerRoleKeys":[],"approverRoleKeys":[],"prompt":"Produce the report draft","operation":null,"value":null,"capabilityId":null,"message":null,"delayMs":null,"branchCount":null,"concurrencyCap":null,"iterationCap":null,"variableName":null,"joinMode":null}. Do not include trigger-manual; Mossen inserts it. capability-action requires an exact catalog capabilityId and must be read/none side effect. External-write, file, HTTP-write, webhook, workflow-call, or scheduled requests must be clarified or rejected, never materialized.

If a human role is semantically required, keep executorKind human; Mossen will emit an unresolved assignee. Ask only when the missing business decision changes topology or responsibility. Inferred facts must appear in assumptions/warnings. Never return Markdown or fenced JSON.`
}

type GenerationModelResponse = Awaited<ReturnType<typeof sideQuery>>

function validateModelValueForRepair(
  value: unknown,
  request: WorkflowGenerationRequest,
): void {
  const parsed = parseModelResult(value, request)
  if (parsed.status !== 'proposed') return
  try {
    materializeProposal(
      request,
      parsed.proposal,
      digest({ requestId: request.requestId, catalogDigest: request.catalog.digest }),
      '2000-01-01T00:00:00.000Z',
    )
  } catch (error) {
    if (error instanceof InvalidModelOutput) throw error
    if (!(error instanceof BusinessGenerationRejection)) throw error
  }
}

function parseGenerationModelResponse(
  response: GenerationModelResponse,
  request: WorkflowGenerationRequest,
): unknown {
  if (response.stop_reason === 'max_tokens') {
    throw new WorkflowGenerationModelOutputError(
      'model-output-max-tokens',
      'Workflow generation model stopped at max_tokens before a complete result.',
      false,
    )
  }
  const text = extractTextContent(response.content, '\n').trim()
  if (!text) {
    throw new WorkflowGenerationModelOutputError(
      'model-output-empty',
      'Workflow generation model returned no JSON content.',
      false,
    )
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new WorkflowGenerationModelOutputError(
      'model-output-invalid-json',
      'Workflow generation model returned non-JSON text.',
      true,
      text,
    )
  }
  try {
    validateModelValueForRepair(value, request)
  } catch (error) {
    if (!(error instanceof InvalidModelOutput)) throw error
    throw new WorkflowGenerationModelOutputError(
      'model-output-schema-invalid',
      `Workflow generation model output did not satisfy the typed schema: ${error.message}`,
      true,
      text,
    )
  }
  return value
}

export type WorkflowGenerationRepairScope =
  | 'generic'
  | 'assumption-warning-arrays'
  | 'question-array'
  | 'proposal-roles-and-steps-arrays'
  | 'proposal-steps-array'

export type WorkflowGenerationRepairContext = {
  scope: WorkflowGenerationRepairScope
  directive: string
  previousOutput: string
}

function workflowGenerationRepairScope(
  message: string,
): WorkflowGenerationRepairScope {
  if (
    /proposal\.roles(?:\[| must)/i.test(message) ||
    /proposal role keys/i.test(message)
  ) {
    return 'proposal-roles-and-steps-arrays'
  }
  if (
    /proposal\.steps(?:\[| must)/i.test(message) ||
    /proposal step keys/i.test(message) ||
    /^Step\s.+\sreferences\s/i.test(message)
  ) {
    return 'proposal-steps-array'
  }
  if (/(?:assumptions|warnings)\[\d+\]/.test(message)) {
    return 'assumption-warning-arrays'
  }
  if (/questions\[\d+\]/.test(message)) return 'question-array'
  return 'generic'
}

export function workflowGenerationRepairContext(
  message: string,
  rawText: string,
): WorkflowGenerationRepairContext {
  const scope = workflowGenerationRepairScope(message)
  let previousValue: unknown
  try {
    previousValue = JSON.parse(rawText) as unknown
  } catch {
    previousValue = undefined
  }

  if (isRecord(previousValue) && isRecord(previousValue.proposal)) {
    const cloned = structuredClone(previousValue)
    const proposal = cloned.proposal as JsonRecord
    if (scope === 'proposal-roles-and-steps-arrays') {
      proposal.roles = []
      proposal.steps = []
    } else if (scope === 'proposal-steps-array') {
      proposal.steps = []
    } else if (scope === 'assumption-warning-arrays') {
      cloned.assumptions = []
      cloned.warnings = []
      proposal.assumptions = []
      proposal.warnings = []
    }
    previousValue = cloned
  }

  const previousOutput = (
    previousValue === undefined
      ? rawText
      : stableWorkflowPublicationJson(previousValue)
  ).slice(0, MAX_WORKFLOW_GENERATION_REPAIR_CONTEXT_CHARS)

  switch (scope) {
    case 'proposal-roles-and-steps-arrays':
      return {
        scope,
        previousOutput,
        directive: 'Required correction: discard and regenerate the entire proposal.roles array and the entire dependent proposal.steps array from the original request and catalog. The previous response below intentionally contains roles=[] and steps=[]; do not reconstruct one field or preserve any prior role/step item. Every new role and step must include every strict-schema property, using null only for unused nullable fields, and every step role key must reference a newly generated role key.',
      }
    case 'proposal-steps-array':
      return {
        scope,
        previousOutput,
        directive: 'Required correction: discard and regenerate the entire proposal.steps array from the original request, catalog, and preserved complete roles. The previous response below intentionally contains steps=[]; do not reconstruct one field or preserve any prior step item. Every new step must include every strict-schema property, using null only for unused nullable fields, and every role key must reference a complete role in proposal.roles.',
      }
    case 'assumption-warning-arrays':
      return {
        scope,
        previousOutput,
        directive: 'Required correction: set every assumptions and warnings array at both the root and proposal levels to []. Do not preserve or replace any prior assumption/warning item.',
      }
    case 'question-array':
      return {
        scope,
        previousOutput,
        directive: 'Required correction: replace the entire questions array with complete question objects; do not preserve placeholder fields. Every item requires non-empty id, path, prompt, reason, required, answerType, and options. answerType must be exactly one of short-text, long-text, single-choice, multi-choice, boolean, or number. For role selection use single-choice. Valid example: {"id":"approval-role","path":"brief.approvalRole","prompt":"Which role approves?","reason":"Approval ownership changes the workflow gate.","required":true,"answerType":"single-choice","options":[{"id":"operations-owner","label":"Operations owner"}]}.',
      }
    default:
      return { scope, previousOutput, directive: '' }
  }
}

function modelUserPrompt(
  request: WorkflowGenerationRequest,
  repair?: WorkflowGenerationModelOutputError,
): string {
  const serializedRequest = stableWorkflowPublicationJson(request)
  if (!repair) {
    return `Generate the typed semantic plan for this request:\n${serializedRequest}`
  }
  const repairContext = workflowGenerationRepairContext(
    repair.message,
    repair.rawText,
  )
  return `Repair the previous Workflow generation response. The original request, requestId, idempotencyKey, catalog, and safety boundary are unchanged. Return one complete JSON object matching the supplied schema. Do not use Markdown, fenced JSON, tools, or lifecycle claims. Every array item must be a complete value of its declared type; never emit null, strings, placeholder objects, or partial objects inside arrays. Use [] when no complete assumption or warning is required.

Validation failure: ${repair.code}: ${repair.message}
Repair scope: ${repairContext.scope}
${repairContext.directive}

Original request:
${serializedRequest}

Previous invalid response:
${repairContext.previousOutput}`
}

async function defaultGenerationModel(
  request: WorkflowGenerationRequest,
  signal: AbortSignal,
): Promise<unknown> {
  let repair: WorkflowGenerationModelOutputError | undefined
  for (
    let attempt = 0;
    attempt <= MAX_WORKFLOW_GENERATION_MODEL_REPAIR_ATTEMPTS;
    attempt += 1
  ) {
    const modelAttempt = attempt === 0 ? 'initial' : 'repair'
    const modelAttemptTimeoutMs =
      modelAttempt === 'initial'
        ? DEFAULT_WORKFLOW_GENERATION_INITIAL_MODEL_TIMEOUT_MS
        : DEFAULT_WORKFLOW_GENERATION_REPAIR_MODEL_TIMEOUT_MS
    const response = await runWorkflowGenerationModelAttempt({
      attempt: modelAttempt,
      parentSignal: signal,
      timeoutMs: modelAttemptTimeoutMs,
      run: attemptSignal =>
        sideQuery({
          model: getDefaultSonnetModel(),
          system: modelSystemPrompt(),
          messages: [
            {
              role: 'user',
              content: modelUserPrompt(request, repair),
            },
          ],
          output_format: {
            type: 'json_schema',
            name: 'workflow_generation_plan',
            schema: workflowGenerationModelOutputSchema(),
          },
          max_tokens: 8192,
          maxRetries: 1,
          signal: attemptSignal,
          skipSystemPromptPrefix: true,
          temperature: 0,
          thinking: false,
          querySource: 'workflow_generation',
        }),
    })
    try {
      return parseGenerationModelResponse(response, request)
    } catch (error) {
      if (
        error instanceof WorkflowGenerationModelOutputError &&
        error.repairable &&
        attempt < MAX_WORKFLOW_GENERATION_MODEL_REPAIR_ATTEMPTS
      ) {
        repair = error
        continue
      }
      throw error
    }
  }
  throw new Error('Workflow generation repair loop exhausted unexpectedly.')
}

function catalogMaps(request: WorkflowGenerationRequest): {
  roles: Map<string, CatalogRoleTemplate>
  skills: Map<string, CatalogSkill>
  capabilities: Map<string, CatalogCapability>
  connectors: Map<string, CatalogConnector>
  policies: Map<string, CatalogPolicy>
  tools: Map<string, CatalogTool>
} {
  return {
    roles: new Map(request.catalog.roleTemplates.map(item => [item.id, item])),
    skills: new Map(request.catalog.skills.map(item => [item.id, item])),
    capabilities: new Map(request.catalog.capabilities.map(item => [item.id, item])),
    connectors: new Map(
      request.catalog.connectors.map(item => [item.providerId, item]),
    ),
    policies: new Map(
      request.catalog.permissionPolicies.map(item => [item.id, item]),
    ),
    tools: new Map(request.catalog.tools.map(item => [item.id, item])),
  }
}

function safeTemplateFacets(
  template: CatalogRoleTemplate,
  tools: Map<string, CatalogTool>,
): unknown[] {
  const materialized = template.facets.map((value, index) => {
    if (!isRecord(value) || typeof value.type !== 'string') {
      throw new BusinessGenerationRejection(
        'insufficient-grounding',
        `Role template ${template.id} facet ${index} is invalid.`,
      )
    }
    if (value.type === 'mossen') {
      if (value.agent !== undefined || value.model !== undefined) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Role template ${template.id} contains an agent/model identity outside the generation catalog.`,
        )
      }
      const allowedTools = Array.isArray(value.allowedTools)
        ? value.allowedTools.map((toolId, toolIndex) => {
            if (typeof toolId !== 'string' || !tools.has(toolId)) {
              throw new BusinessGenerationRejection(
                'insufficient-grounding',
                `Role template ${template.id} allowedTools[${toolIndex}] is not grounded.`,
              )
            }
            return toolId
          })
        : []
      return {
        type: 'mossen',
        ...(typeof value.systemPrompt === 'string' && value.systemPrompt.trim()
          ? { systemPrompt: value.systemPrompt.trim() }
          : {}),
        ...(isRecord(value.outputSchema)
          ? { outputSchema: structuredClone(value.outputSchema) }
          : {}),
        ...(allowedTools.length > 0 ? { allowedTools } : {}),
      }
    }
    if (value.type === 'text') {
      const allowedOperations = Array.isArray(value.allowedOperations)
        ? value.allowedOperations.filter(
            (operation): operation is string =>
              typeof operation === 'string' &&
              TRANSFORM_OPERATIONS.has(operation),
          )
        : []
      return {
        type: 'text',
        ...(allowedOperations.length > 0 ? { allowedOperations } : {}),
      }
    }
    throw new BusinessGenerationRejection(
      'insufficient-grounding',
      `Role template ${template.id} has ${value.type} constraints that generation v1 cannot safely freeze.`,
    )
  })
  const advertised = [...new Set(template.facetTypes)].sort()
  const supplied = materialized
    .flatMap(facet =>
      isRecord(facet) && typeof facet.type === 'string' ? [facet.type] : [],
    )
    .filter((type, index, all) => all.indexOf(type) === index)
    .sort()
  if (stableWorkflowPublicationJson(advertised) !== stableWorkflowPublicationJson(supplied)) {
    throw new BusinessGenerationRejection(
      'insufficient-grounding',
      `Role template ${template.id} facet snapshot is incomplete or drifted.`,
    )
  }
  return materialized
}

function buildNodeConfig(
  step: ModelStepPlan,
  capability: CatalogCapability | undefined,
): JsonRecord {
  switch (step.type) {
    case 'mossen-call':
      return { prompt: step.prompt?.trim() || step.expectedOutcome }
    case 'text-transform':
      return {
        operation: TRANSFORM_OPERATIONS.has(step.operation ?? '')
          ? step.operation
          : 'trim',
        ...(step.value ? { replacement: step.value } : {}),
      }
    case 'condition':
      return {
        operation: CONDITION_OPERATIONS.has(step.operation ?? '')
          ? step.operation
          : 'not-empty',
        ...(step.value ? { value: step.value } : {}),
      }
    case 'wait-delay':
      return {
        delayMs:
          Number.isInteger(step.delayMs) && Number(step.delayMs) >= 0
            ? Math.min(Number(step.delayMs), 60_000)
            : 1_000,
      }
    case 'loop-foreach':
      return {
        iterationCap:
          Number.isInteger(step.iterationCap) && Number(step.iterationCap) > 0
            ? Math.min(Number(step.iterationCap), 100)
            : 100,
      }
    case 'fork-parallel':
      return {
        branchCount:
          Number.isInteger(step.branchCount) && Number(step.branchCount) >= 2
            ? Math.min(Number(step.branchCount), 16)
            : 2,
        concurrencyCap:
          Number.isInteger(step.concurrencyCap) &&
          Number(step.concurrencyCap) > 0
            ? Math.min(Number(step.concurrencyCap), 5)
            : 5,
      }
    case 'human-approval':
      return {
        message: step.message?.trim() || step.title,
        allowReject: true,
      }
    case 'set-variable':
      return {
        name: (step.variableName ?? step.key)
          .replace(/[^a-zA-Z0-9_]/g, '_')
          .slice(0, 64),
      }
    case 'join':
      return { mode: step.joinMode === 'wait-first' ? 'wait-first' : 'wait-all' }
    case 'capability-action':
      if (!capability) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Capability ${step.capabilityId ?? '(missing)'} is not in the request catalog.`,
        )
      }
      return {
        capabilityId: capability.id,
        ...(capability.providerId ? { providerId: capability.providerId } : {}),
        title: capability.title,
        ...(capability.inputSchema
          ? { inputSchema: structuredClone(capability.inputSchema) }
          : {}),
      }
    default:
      throw new BusinessGenerationRejection(
        'unsupported-capability',
        `Node type ${step.type} cannot be safely materialized by generation v1.`,
      )
  }
}

function materializeProposal(
  request: WorkflowGenerationRequest,
  plan: ModelProposalPlan,
  inputDigest: string,
  generatedAt: string,
): Omit<Extract<WorkflowGenerationResult, { status: 'proposed' }>, keyof WorkflowGenerationCommon | 'status'> {
  const serializedPlan = stableWorkflowPublicationJson(plan)
  if (containsCredentialValue(serializedPlan)) {
    throw new BusinessGenerationRejection(
      'unsafe-request',
      'The model output contained a credential-shaped value and was discarded.',
    )
  }
  if (
    /\b(?:already|has been|is)\s+(?:validated|published|enabled|run|authorized)\b/i.test(
      serializedPlan,
    ) ||
    /(?:已|已经)(?:验证|发布|启用|运行|授权)/u.test(serializedPlan)
  ) {
    throw new InvalidModelOutput(
      'model output claimed validation/publication/run/authorization state.',
    )
  }
  if (plan.successCriteria.length === 0) {
    throw new InvalidModelOutput('proposal.successCriteria must not be empty.')
  }
  const maps = catalogMaps(request)
  const proposalId = shortId('wfgp', `${inputDigest}:${request.catalog.digest}`, 24)
  const workflowId = shortId('wfproposal', proposalId, 24)
  const timestamp = Date.parse(generatedAt)
  const bindingIdByKey = new Map<string, string>()
  const unresolvedBindings: WorkflowGenerationUnresolvedBinding[] = []
  const warnings: WorkflowGenerationWarning[] = [...plan.warnings]
  const provenance: WorkflowGenerationProvenance[] = [
    {
      path: 'name',
      source: request.brief.titleHint ? 'user-brief' : 'inference',
      sourceRefs: [
        request.brief.titleHint ? 'brief.titleHint' : 'brief.description',
      ],
      confidence: request.brief.titleHint ? 'high' : 'medium',
    },
    {
      path: 'goal',
      source: request.brief.answers.length > 0
        ? 'clarification-answer'
        : 'user-brief',
      sourceRefs: request.brief.answers.length > 0
        ? ['brief.description', 'brief.answers']
        : ['brief.description'],
      confidence: 'high',
    },
  ]

  const bindings = plan.roles.map((role, index) => {
    const bindingId = shortId('binding', `${proposalId}:role:${role.key}`, 18)
    bindingIdByKey.set(role.key, bindingId)
    const template = role.templateRoleId
      ? maps.roles.get(role.templateRoleId)
      : undefined
    if (role.templateRoleId && !template) {
      throw new BusinessGenerationRejection(
        'insufficient-grounding',
        `Role template ${role.templateRoleId} is not in the request catalog.`,
      )
    }
    if (
      template &&
      template.executorKinds.length > 0 &&
      !template.executorKinds.includes(role.executorKind)
    ) {
      throw new BusinessGenerationRejection(
        'insufficient-grounding',
        `Role template ${template.id} does not support executor kind ${role.executorKind}.`,
      )
    }
    for (const skillId of role.skillIds) {
      if (!maps.skills.has(skillId)) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Skill ${skillId} is not in the request catalog.`,
        )
      }
    }
    for (const capabilityId of role.capabilityIds) {
      if (!maps.capabilities.has(capabilityId)) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Capability ${capabilityId} is not in the request catalog.`,
        )
      }
    }
    for (const toolId of role.toolIds) {
      const tool = maps.tools.get(toolId)
      if (!tool) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Tool ${toolId} is not in the request catalog.`,
        )
      }
      if (tool.sideEffect !== 'none' && tool.sideEffect !== 'read') {
        throw new BusinessGenerationRejection(
          'unsafe-request',
          `Tool ${toolId} is not side-effect-free.`,
        )
      }
    }
    const facets = template
      ? safeTemplateFacets(template, maps.tools)
      : role.systemInstruction || role.toolIds.length > 0
        ? [
            {
              type: 'mossen',
              ...(role.systemInstruction
                ? { systemPrompt: role.systemInstruction }
                : {}),
              ...(role.toolIds.length > 0
                ? { allowedTools: [...role.toolIds] }
                : {}),
            },
          ]
        : []
    const snapshotDigest = template
      ? template.snapshotDigest
      : digest({
          name: role.name,
          description: role.description,
          facets,
        })
    if (!template) {
      warnings.push({
        code: 'inferred-role',
        severity: 'warning',
        path: `team.bindings[${index}]`,
        message: `Role ${role.name} was inferred for this proposal and must be reviewed.`,
        requiresConfirmation: true,
      })
      provenance.push({
        path: `team.bindings[${index}]`,
        source: 'inference',
        sourceRefs: ['brief.description'],
        confidence: 'medium',
      })
    } else {
      provenance.push({
        path: `team.bindings[${index}]`,
        source: 'catalog',
        sourceRefs: [`catalog.roleTemplates.${template.id}`],
        confidence: 'high',
      })
    }
    if (role.executorKind === 'human') {
      unresolvedBindings.push({
        id: shortId('unresolved', `${proposalId}:human:${bindingId}`, 18),
        kind: 'human-executor',
        path: `team.bindings[${index}].executor.assigneeId`,
        reason: `No stable assignee ID was supplied for ${template?.name ?? role.name}.`,
        blockingStages: ['draft-test', 'validate', 'publish'],
        candidateIds: [],
      })
    }
    return {
      id: bindingId,
      ...(template ? { templateRoleId: template.id } : {}),
      templateVersion: template?.version ?? 0,
      snapshotDigest,
      nameSnapshot: template?.name ?? role.name,
      descriptionSnapshot: template?.description ?? role.description,
      responsibilities: role.responsibilities,
      requiredInputs: role.requiredInputs,
      expectedOutputs: role.expectedOutputs,
      facets,
      executor: { kind: role.executorKind },
      skillRefs: [...role.skillIds],
      capabilityRefs: [...role.capabilityIds],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })

  const defaultOwnerBindingId =
    bindings.find(binding => binding.executor.kind === 'mossen-agent')?.id ??
    bindings[0]!.id
  const triggerId = shortId('node', `${proposalId}:trigger`, 18)
  const nodes: JsonRecord[] = [
    {
      id: triggerId,
      type: 'trigger-manual',
      position: { x: 0, y: 0 },
      business: { title: 'Manual start', gatePolicy: 'optional' },
      assignment: {
        ownerRoleBindingId: defaultOwnerBindingId,
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: {},
    },
  ]
  const capabilitySteps = new Map<string, string[]>()

  for (const [index, step] of plan.steps.entries()) {
    if (!SUPPORTED_PLAN_NODE_TYPES.has(step.type)) {
      throw new BusinessGenerationRejection(
        'unsupported-capability',
        `Node type ${step.type} cannot be safely generated by protocol v1.`,
      )
    }
    if (!request.target.allowedNodeTypes.includes(step.type)) {
      throw new BusinessGenerationRejection(
        'unsupported-capability',
        `Node type ${step.type} is not allowed by the request target.`,
      )
    }
    const executorRoleBindingId = bindingIdByKey.get(step.executorRoleKey)
    if (!executorRoleBindingId) {
      throw new InvalidModelOutput(
        `Step ${step.key} references unknown executor role ${step.executorRoleKey}.`,
      )
    }
    const resolveRoleKeys = (keys: string[], field: string): string[] =>
      keys.map(key => {
        const id = bindingIdByKey.get(key)
        if (!id) {
          throw new InvalidModelOutput(
            `Step ${step.key} references unknown ${field} role ${key}.`,
          )
        }
        return id
      })
    const nodeId = shortId('node', `${proposalId}:step:${step.key}`, 18)
    const capability = step.type === 'capability-action'
      ? maps.capabilities.get(step.capabilityId ?? '')
      : undefined
    if (step.type === 'capability-action') {
      if (!capability) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Capability ${step.capabilityId ?? '(missing)'} is not in the request catalog.`,
        )
      }
      if (capability.sideEffect !== 'none' && capability.sideEffect !== 'read') {
        throw new BusinessGenerationRejection(
          'unsafe-request',
          `Capability ${capability.id} has side effect ${capability.sideEffect}.`,
        )
      }
      if (capability.providerId && !maps.connectors.has(capability.providerId)) {
        throw new BusinessGenerationRejection(
          'insufficient-grounding',
          `Provider ${capability.providerId} is not in the connector catalog.`,
        )
      }
      capabilitySteps.set(capability.id, [
        ...(capabilitySteps.get(capability.id) ?? []),
        nodeId,
      ])
      const executorBinding = bindings.find(
        binding => binding.id === executorRoleBindingId,
      )
      if (
        executorBinding &&
        !executorBinding.capabilityRefs.includes(capability.id)
      ) {
        executorBinding.capabilityRefs.push(capability.id)
      }
      provenance.push({
        path: `nodes[${index + 1}].config.capabilityId`,
        source: 'catalog',
        sourceRefs: [`catalog.capabilities.${capability.id}`],
        confidence: 'high',
      })
      const requiredInputs = Array.isArray(capability.inputSchema?.required)
        ? capability.inputSchema.required.filter(
            (item): item is string => typeof item === 'string',
          )
        : []
      if (requiredInputs.length > 0) {
        unresolvedBindings.push({
          id: shortId('unresolved', `${proposalId}:inputs:${nodeId}`, 18),
          kind: 'service-target',
          path: `nodes[${index + 1}].config.inputs`,
          reason: `Required capability inputs (${requiredInputs.join(', ')}) need explicit confirmation.`,
          blockingStages: ['draft-test', 'validate', 'publish'],
          candidateIds: [capability.id],
        })
      }
      if (
        capability.providerId &&
        maps.connectors.get(capability.providerId)?.status !== 'ready'
      ) {
        unresolvedBindings.push({
          id: shortId('unresolved', `${proposalId}:connector:${nodeId}`, 18),
          kind: 'connector',
          path: `dependencies.connectors`,
          reason: `Connector ${capability.providerId} is not ready.`,
          blockingStages: ['draft-test', 'validate', 'publish'],
          candidateIds: [capability.providerId],
        })
      }
    }
    const approverRoleBindingIds = resolveRoleKeys(
      step.approverRoleKeys,
      'approver',
    )
    if (
      step.type === 'human-approval' &&
      approverRoleBindingIds.length === 0
    ) {
      approverRoleBindingIds.push(executorRoleBindingId)
    }
    nodes.push({
      id: nodeId,
      type: step.type,
      position: { x: (index + 1) * 260, y: 0 },
      business: {
        title: step.title,
        expectedOutcome: step.expectedOutcome,
        gatePolicy: step.type === 'human-approval' ? 'required' : 'optional',
      },
      assignment: {
        executorRoleBindingId,
        ownerRoleBindingId:
          bindingIdByKey.get(step.ownerRoleKey ?? '') ?? executorRoleBindingId,
        reviewerRoleBindingIds: resolveRoleKeys(step.reviewerRoleKeys, 'reviewer'),
        approverRoleBindingIds,
      },
      config: buildNodeConfig(step, capability),
    })
    provenance.push({
      path: `nodes[${index + 1}]`,
      source: 'inference',
      sourceRefs: ['brief.description'],
      confidence: 'medium',
    })
  }

  if (!request.target.allowedNodeTypes.includes('trigger-manual')) {
    throw new BusinessGenerationRejection(
      'unsupported-capability',
      'Generation v1 requires trigger-manual in target.allowedNodeTypes.',
    )
  }

  const edges = nodes.slice(1).map((node, index) => ({
    from: { nodeId: String(nodes[index]!.id) },
    to: { nodeId: String(node.id) },
  }))
  const skills = new Map<string, string[]>()
  for (const binding of bindings) {
    for (const skillId of binding.skillRefs) {
      skills.set(skillId, [...(skills.get(skillId) ?? []), binding.id])
    }
  }
  const connectors = new Map<string, string[]>()
  for (const capabilityId of capabilitySteps.keys()) {
    const providerId = maps.capabilities.get(capabilityId)?.providerId
    if (providerId) {
      connectors.set(providerId, [
        ...(connectors.get(providerId) ?? []),
        capabilityId,
      ])
    }
  }

  unresolvedBindings.push({
    id: shortId('unresolved', `${proposalId}:subject`, 18),
    kind: 'business-subject',
    path: 'subjectRefs',
    reason: 'No stable business subject identity was supplied in the generation catalog.',
    blockingStages: ['draft-test', 'validate', 'publish'],
    candidateIds: [],
  })

  const draft: JsonRecord = {
    id: workflowId,
    schemaVersion: 2,
    name: plan.name,
    description: plan.description,
    enabled: false,
    goal: {
      statement: plan.goalStatement,
      expectedOutcome: plan.expectedOutcome,
      successCriteria: plan.successCriteria,
    },
    subjectRefs: [],
    team: { bindings },
    dependencies: {
      skills: [...skills.entries()].map(([skillId, roleBindingIds]) => ({
        skillId,
        requiredByRoleBindingIds: [...new Set(roleBindingIds)],
      })),
      capabilities: [...capabilitySteps.entries()].map(
        ([capabilityId, requiredByStepIds]) => ({
          capabilityId,
          ...(maps.capabilities.get(capabilityId)?.providerId
            ? { providerId: maps.capabilities.get(capabilityId)!.providerId }
            : {}),
          requiredByStepIds,
        }),
      ),
      connectors: [...connectors.entries()].map(
        ([providerId, requiredByCapabilityIds]) => ({
          providerId,
          requiredByCapabilityIds: [...new Set(requiredByCapabilityIds)],
        }),
      ),
      permissionPolicies: [],
    },
    evidencePolicy: {
      captureInputs: true,
      captureOutputs: true,
      captureApprovals: true,
      captureArtifacts: true,
      captureRawCapabilityEvidence: true,
      retention: 'local',
    },
    nodes,
    edges,
    roleRelations: [],
    variables: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const sourceDigest = computeDesktopWorkflowSourceDigest(draft)
  draft.release = {
    localRevision: 1,
    sourceDigest,
    validation: { status: 'not-validated', issues: [] },
  }
  validateMaterializedDraft(
    draft,
    request,
    unresolvedBindings,
    plan.assumptions,
    warnings,
    provenance,
  )
  return {
    proposalId,
    draftSchema: WORKFLOW_PUBLICATION_DRAFT_SCHEMA,
    draft,
    assumptions: plan.assumptions,
    questions: [],
    unresolvedBindings,
    warnings,
    provenance,
  }
}

function validateMaterializedDraft(
  draft: JsonRecord,
  request: WorkflowGenerationRequest,
  unresolved: WorkflowGenerationUnresolvedBinding[],
  assumptions: WorkflowGenerationAssumption[],
  warnings: WorkflowGenerationWarning[],
  provenance: WorkflowGenerationProvenance[],
): void {
  if (draft.schemaVersion !== 2 || !isRecord(draft.goal)) {
    throw new InvalidModelOutput('materialized draft is not Business Asset v2.')
  }
  if (
    !isRecord(draft.team) ||
    !Array.isArray(draft.team.bindings) ||
    !isRecord(draft.dependencies) ||
    !isRecord(draft.release) ||
    !isRecord(draft.evidencePolicy)
  ) {
    throw new InvalidModelOutput('materialized draft is missing required sections.')
  }
  const forbiddenIdentityKeys = new Set([
    'publication',
    'pendingPublication',
    'assetId',
    'receiptId',
    'runId',
    'scheduleId',
    'publishedAt',
    'enabledAt',
  ])
  const scanForbidden = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(scanForbidden)
    if (!isRecord(value)) return false
    return Object.entries(value).some(
      ([key, child]) => forbiddenIdentityKeys.has(key) || scanForbidden(child),
    )
  }
  if (scanForbidden(draft)) {
    throw new InvalidModelOutput('materialized draft contains lifecycle identity.')
  }
  if (
    draft.release.localRevision !== 1 ||
    !isRecord(draft.release.validation) ||
    draft.release.validation.status !== 'not-validated'
  ) {
    throw new InvalidModelOutput('materialized draft release state is not local/unvalidated.')
  }
  const expectedDigest = computeDesktopWorkflowSourceDigest(draft)
  if (draft.release.sourceDigest !== expectedDigest) {
    throw new InvalidModelOutput('materialized draft source digest is invalid.')
  }
  const bindings = draft.team.bindings.filter(isRecord)
  const bindingIds = new Set(bindings.map(binding => String(binding.id)))
  const humanUnresolvedPaths = new Set(
    unresolved
      .filter(item => item.kind === 'human-executor')
      .map(item => item.path),
  )
  bindings.forEach((binding, index) => {
    if (!isRecord(binding.executor)) {
      throw new InvalidModelOutput('materialized role binding has no executor.')
    }
    if (
      binding.executor.kind === 'human' &&
      !humanUnresolvedPaths.has(`team.bindings[${index}].executor.assigneeId`)
    ) {
      throw new InvalidModelOutput('unassigned human executor lacks unresolved evidence.')
    }
  })
  if (!Array.isArray(draft.nodes) || draft.nodes.length < 2) {
    throw new InvalidModelOutput('materialized draft needs a trigger and executable step.')
  }
  const nodeIds = new Set<string>()
  for (const [index, node] of draft.nodes.entries()) {
    if (!isRecord(node) || typeof node.id !== 'string' || nodeIds.has(node.id)) {
      throw new InvalidModelOutput('materialized node identity is invalid.')
    }
    nodeIds.add(node.id)
    if (!request.target.allowedNodeTypes.includes(String(node.type))) {
      throw new InvalidModelOutput('materialized node is outside allowedNodeTypes.')
    }
    const assignment = isRecord(node.assignment) ? node.assignment : {}
    if (index === 0) {
      if (assignment.executorRoleBindingId !== undefined) {
        throw new InvalidModelOutput('trigger must not have an executor assignment.')
      }
      if (!bindingIds.has(String(assignment.ownerRoleBindingId))) {
        throw new InvalidModelOutput('trigger owner binding is invalid.')
      }
    } else if (!bindingIds.has(String(assignment.executorRoleBindingId))) {
      throw new InvalidModelOutput('executable step has no valid executor binding.')
    }
  }
  if (!Array.isArray(draft.edges)) {
    throw new InvalidModelOutput('materialized draft edges are invalid.')
  }
  for (const edge of draft.edges) {
    if (
      !isRecord(edge) ||
      !isRecord(edge.from) ||
      !isRecord(edge.to) ||
      !nodeIds.has(String(edge.from.nodeId)) ||
      !nodeIds.has(String(edge.to.nodeId))
    ) {
      throw new InvalidModelOutput('materialized edge reference is invalid.')
    }
  }
  for (const item of assumptions) {
    if (!draftPathExists(draft, item.path, false)) {
      throw new InvalidModelOutput(
        `assumption path does not locate the draft: ${item.path}.`,
      )
    }
  }
  for (const item of warnings) {
    if (!draftPathExists(draft, item.path, false)) {
      throw new InvalidModelOutput(
        `warning path does not locate the draft: ${item.path}.`,
      )
    }
  }
  for (const item of provenance) {
    if (!draftPathExists(draft, item.path, false)) {
      throw new InvalidModelOutput(
        `provenance path does not locate the draft: ${item.path}.`,
      )
    }
  }
  for (const item of unresolved) {
    if (!draftPathExists(draft, item.path, true)) {
      throw new InvalidModelOutput(
        `unresolved binding path does not locate the draft: ${item.path}.`,
      )
    }
  }
}

function draftPathExists(
  root: unknown,
  path: string,
  allowMissingLeaf: boolean,
): boolean {
  const tokens: Array<string | number> = []
  const matcher = /([^[.\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(path)) !== null) {
    tokens.push(match[2] === undefined ? match[1]! : Number(match[2]))
  }
  if (tokens.length === 0) return false
  let current: unknown = root
  for (const [index, token] of tokens.entries()) {
    const isLeaf = index === tokens.length - 1
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return false
      }
      current = current[token]
      continue
    }
    if (!isRecord(current)) return false
    if (!(token in current)) return allowMissingLeaf && isLeaf
    current = current[token]
  }
  return true
}

function commonResult(
  parsed: ParsedRequest,
  generatedAt: string,
): WorkflowGenerationCommon {
  return {
    version: 1,
    surface: 'workflow-generation-result',
    requestId: parsed.request.requestId,
    inputDigest: parsed.inputDigest,
    catalogDigest: parsed.catalogDigest,
    mossenVersion: runtimeVersion(),
    generatedAt,
  }
}

function rejectedResult(
  parsed: ParsedRequest,
  generatedAt: string,
  rejection: BusinessGenerationRejection,
): Extract<WorkflowGenerationResult, { status: 'rejected' }> {
  return {
    ...commonResult(parsed, generatedAt),
    status: 'rejected',
    code: rejection.code,
    reason: rejection.message,
    warnings: [],
    questions: [],
  }
}

async function commitGenerationResult(
  parsed: ParsedRequest,
  result: WorkflowGenerationResult,
): Promise<WorkflowGenerationOutcome> {
  try {
    const committed = await commitWorkflowGenerationRecord({
      idempotencyKey: parsed.request.idempotencyKey,
      record: {
        fingerprint: parsed.fingerprint,
        inputDigest: parsed.inputDigest,
        catalogDigest: parsed.catalogDigest,
        chainDigest: parsed.chainDigest,
        status: result.status,
        generatedAt: result.generatedAt,
        result,
      },
    })
    if (committed.kind === 'replay') {
      return {
        ok: true,
        result: committed.result as WorkflowGenerationResult,
        replayed: true,
      }
    }
    if (committed.kind === 'idempotency-conflict') {
      return {
        ok: false,
        error: workflowGenerationError(
          'idempotency-conflict',
          'idempotencyKey was concurrently used with a different request.',
          parsed.request.requestId,
        ),
      }
    }
    return { ok: true, result, replayed: false }
  } catch {
    return {
      ok: false,
      error: workflowGenerationError(
        'internal-error',
        'Workflow generation result could not be committed to the idempotency cache.',
        parsed.request.requestId,
      ),
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (isRecord(error) && error.code === 'ABORT_ERR')
  )
}

function workflowGenerationOperationTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) return explicit
  if (process.env.MOSSEN_WORKFLOW_GENERATION_TEST_MODE !== '1') {
    return DEFAULT_WORKFLOW_GENERATION_TIMEOUT_MS
  }
  const testTimeoutMs = Number(
    process.env.MOSSEN_WORKFLOW_GENERATION_TEST_OPERATION_TIMEOUT_MS,
  )
  return Number.isInteger(testTimeoutMs) &&
    testTimeoutMs > 0 &&
    testTimeoutMs <= DEFAULT_WORKFLOW_GENERATION_TIMEOUT_MS
    ? testTimeoutMs
    : DEFAULT_WORKFLOW_GENERATION_TIMEOUT_MS
}

export async function generateWorkflowDraft(
  value: unknown,
  options: {
    model?: WorkflowGenerationModel
    timeoutMs?: number
    now?: () => Date
    signal?: AbortSignal
  } = {},
): Promise<WorkflowGenerationOutcome> {
  let parsed: ParsedRequest
  try {
    parsed = parseRequest(value)
  } catch (error) {
    return {
      ok: false,
      error: workflowGenerationError(
        error instanceof InvalidGenerationRequest &&
          error.message.includes('exceeds')
          ? 'input-too-large'
          : 'invalid-request',
        error instanceof Error ? error.message : 'Invalid generation request.',
        isRecord(value) && typeof value.requestId === 'string'
          ? value.requestId
          : '',
      ),
    }
  }

  const terminalRejection =
    parsed.preflightRejection ??
    (parsed.request.target.draftSchema !== WORKFLOW_PUBLICATION_DRAFT_SCHEMA
      ? new BusinessGenerationRejection(
          'unsupported-draft-schema',
          `Only ${WORKFLOW_PUBLICATION_DRAFT_SCHEMA} is supported.`,
        )
      : parsed.request.clarificationRound >=
          MAX_WORKFLOW_GENERATION_CLARIFICATION_ROUNDS
        ? new BusinessGenerationRejection(
            'clarification-limit-reached',
            'The maximum of three clarification rounds has been reached.',
          )
        : undefined)

  const cached = inspectWorkflowGenerationCache({
    idempotencyKey: parsed.request.idempotencyKey,
    fingerprint: parsed.fingerprint,
    previousInputDigest: terminalRejection
      ? null
      : parsed.request.previousInputDigest,
    catalogDigest: parsed.catalogDigest,
    chainDigest: parsed.chainDigest,
    answerQuestionIds: parsed.request.brief.answers.map(
      answer => answer.questionId,
    ),
  })
  if (cached.kind === 'replay') {
    return {
      ok: true,
      result: cached.result as WorkflowGenerationResult,
      replayed: true,
    }
  }
  if (cached.kind === 'idempotency-conflict') {
    return {
      ok: false,
      error: workflowGenerationError(
        'idempotency-conflict',
        'idempotencyKey was already used with a different input or catalog digest.',
        parsed.request.requestId,
      ),
    }
  }
  if (cached.kind === 'clarification-context-conflict') {
    return {
      ok: false,
      error: workflowGenerationError(
        'clarification-context-conflict',
        'previousInputDigest does not identify the prior clarification result for this chain.',
        parsed.request.requestId,
      ),
    }
  }
  if (terminalRejection) {
    return commitGenerationResult(
      parsed,
      rejectedResult(
        parsed,
        (options.now?.() ?? new Date()).toISOString(),
        terminalRejection,
      ),
    )
  }

  const controller = new AbortController()
  activeGenerationAbortController = controller
  installGenerationSignalHandler()
  let timedOut = false
  const timeoutMs = workflowGenerationOperationTimeoutMs(options.timeoutMs)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  const abortFromParent = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromParent, { once: true })
  let modelValue: unknown
  try {
    modelValue = await (options.model ?? defaultGenerationModel)(
      parsed.request,
      controller.signal,
    )
  } catch (error) {
    if (timedOut) {
      return {
        ok: false,
        error: workflowGenerationError(
          'generation-timeout',
          `Workflow generation exceeded ${timeoutMs} ms.`,
          parsed.request.requestId,
        ),
      }
    }
    if (error instanceof WorkflowGenerationModelOutputError) {
      return {
        ok: false,
        error: workflowGenerationError(
          error.code,
          error.message,
          parsed.request.requestId,
        ),
      }
    }
    if (error instanceof WorkflowGenerationModelAttemptTimeout) {
      return {
        ok: false,
        error: workflowGenerationError(
          'generation-timeout',
          `${error.message} The total operation budget is ${timeoutMs} ms.`,
          parsed.request.requestId,
        ),
      }
    }
    if (error instanceof InvalidModelOutput) {
      return {
        ok: false,
        error: workflowGenerationError(
          'model-output-schema-invalid',
          error.message,
          parsed.request.requestId,
        ),
      }
    }
    return {
      ok: false,
      error: workflowGenerationError(
        'generation-unavailable',
        isAbortError(error)
          ? 'Workflow generation was cancelled.'
          : 'The configured Mossen model could not generate a Workflow proposal.',
        parsed.request.requestId,
      ),
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromParent)
    if (activeGenerationAbortController === controller) {
      activeGenerationAbortController = null
    }
  }

  let result: WorkflowGenerationResult
  const generatedAt = (options.now?.() ?? new Date()).toISOString()
  try {
    const modelResult = parseModelResult(modelValue, parsed.request)
    if (modelResult.status === 'needs_clarification') {
      result = {
        ...commonResult(parsed, generatedAt),
        status: 'needs_clarification',
        questions: modelResult.questions,
        assumptions: modelResult.assumptions,
        warnings: modelResult.warnings,
      }
    } else if (modelResult.status === 'rejected') {
      result = rejectedResult(
        parsed,
        generatedAt,
        new BusinessGenerationRejection(
          modelResult.code as BusinessGenerationRejection['code'],
          modelResult.reason,
        ),
      )
    } else {
      result = {
        ...commonResult(parsed, generatedAt),
        status: 'proposed',
        ...materializeProposal(
          parsed.request,
          modelResult.proposal,
          parsed.inputDigest,
          generatedAt,
        ),
      }
    }
  } catch (error) {
    if (error instanceof BusinessGenerationRejection) {
      result = rejectedResult(parsed, generatedAt, error)
    } else {
      return {
        ok: false,
        error: workflowGenerationError(
          error instanceof InvalidModelOutput
            ? 'model-output-schema-invalid'
            : 'output-contract-invalid',
          error instanceof Error ? error.message : 'Model output was invalid.',
          parsed.request.requestId,
        ),
      }
    }
  }

  return commitGenerationResult(parsed, result)
}
