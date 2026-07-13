import { createHash } from 'node:crypto'
import { validateUuid } from '../../utils/uuid.js'

export const WORKFLOW_PUBLICATION_PROTOCOL_VERSION = 1 as const
export const WORKFLOW_PUBLICATION_DRAFT_SCHEMA =
  'mossen-desktop-workflow-business-asset/v2' as const

export type WorkflowPublicationIssue = {
  code: string
  message: string
  path?: string
  nodeId?: string
  roleBindingId?: string
  capabilityId?: string
  skillId?: string
  providerId?: string
  policyId?: string
}

export type WorkflowDraftEnvelope = {
  protocolVersion: 1
  requestId: string
  draftSchema: typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA
  draftId: string
  localRevision: number
  sourceDigest: string
  definition: Record<string, unknown>
}

export type WorkflowValidationResponse = {
  version: 1
  surface: 'workflow-validation'
  requestId: string
  draftId: string
  localRevision: number
  sourceDigest: string
  status: 'pass' | 'warn' | 'fail'
  publishable: boolean
  errors: WorkflowPublicationIssue[]
  warnings: WorkflowPublicationIssue[]
  compatibility: {
    mossenVersion: string
    workflowRuntime: 'v1'
  }
}

export type WorkflowPublicationProtocolDescriptor = {
  version: 1
  surface: 'workflow-publication-protocol'
  transport: 'stdin-json/stdout-json'
  draftSchema: typeof WORKFLOW_PUBLICATION_DRAFT_SCHEMA
  operations: {
    validate: {
      available: true
      args: ['workflows', 'validate-draft', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-validation/v1'
      idempotent: true
    }
    publish: {
      available: true
      args: ['workflows', 'publish-draft', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-publication-receipt/v1'
      idempotent: true
    }
    reconcile: {
      available: true
      args: ['workflows', '--workbench', '--json']
      input: 'none'
      output: 'workbench-workflows/v1+publication'
      idempotent: true
    }
    enable: {
      available: true
      args: ['workflows', 'enable-published', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-enable-receipt/v1'
      idempotent: true
    }
    invoke: {
      available: true
      args: ['workflows', 'run-published', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-run-receipt/v1'
      idempotent: true
    }
    query: {
      available: true
      args: ['workflows', 'query-published-run', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-run-query/v1'
      idempotent: true
    }
    cancel: {
      available: true
      args: ['workflows', 'cancel-published-run', '--stdin', '--json']
      input: 'stdin-json'
      output: 'workflow-run-cancel-receipt/v1'
      idempotent: true
    }
  }
  requiredEvidence: ['assetId', 'assetVersion', 'sourceDigest', 'receiptId']
  requiredRunEvidence: [
    'runId',
    'steps',
    'evidence',
    'actionReceipt',
    'waits',
    'finalResult',
  ]
  execution: {
    publishedInvocation: {
      available: true
      enableRequired: true
      identity: ['assetId', 'assetVersion', 'sourceDigest']
      runStates: [
        'running',
        'waiting_approval',
        'waiting_permission',
        'completed',
        'failed',
        'cancelled',
      ]
    }
  }
}

type IssueCollector = {
  errors: WorkflowPublicationIssue[]
  warnings: WorkflowPublicationIssue[]
}

const SHA256_RE = /^[a-f0-9]{64}$/
const EXECUTOR_OPTIONAL_NODE_TYPES = new Set([
  'trigger-manual',
  'trigger-webhook',
  'trigger-file-watch',
  'join',
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

function runtimeVersion(): string {
  return typeof MACRO !== 'undefined' && MACRO.VERSION
    ? MACRO.VERSION
    : 'unknown'
}

export function workflowPublicationProtocolDescriptor(): WorkflowPublicationProtocolDescriptor {
  return {
    version: 1,
    surface: 'workflow-publication-protocol',
    transport: 'stdin-json/stdout-json',
    draftSchema: WORKFLOW_PUBLICATION_DRAFT_SCHEMA,
    operations: {
      validate: {
        available: true,
        args: ['workflows', 'validate-draft', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-validation/v1',
        idempotent: true,
      },
      publish: {
        available: true,
        args: ['workflows', 'publish-draft', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-publication-receipt/v1',
        idempotent: true,
      },
      reconcile: {
        available: true,
        args: ['workflows', '--workbench', '--json'],
        input: 'none',
        output: 'workbench-workflows/v1+publication',
        idempotent: true,
      },
      enable: {
        available: true,
        args: ['workflows', 'enable-published', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-enable-receipt/v1',
        idempotent: true,
      },
      invoke: {
        available: true,
        args: ['workflows', 'run-published', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-run-receipt/v1',
        idempotent: true,
      },
      query: {
        available: true,
        args: ['workflows', 'query-published-run', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-run-query/v1',
        idempotent: true,
      },
      cancel: {
        available: true,
        args: ['workflows', 'cancel-published-run', '--stdin', '--json'],
        input: 'stdin-json',
        output: 'workflow-run-cancel-receipt/v1',
        idempotent: true,
      },
    },
    requiredEvidence: ['assetId', 'assetVersion', 'sourceDigest', 'receiptId'],
    requiredRunEvidence: [
      'runId',
      'steps',
      'evidence',
      'actionReceipt',
      'waits',
      'finalResult',
    ],
    execution: {
      publishedInvocation: {
        available: true,
        enableRequired: true,
        identity: ['assetId', 'assetVersion', 'sourceDigest'],
        runStates: [
          'running',
          'waiting_approval',
          'waiting_permission',
          'completed',
          'failed',
          'cancelled',
        ],
      },
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function addError(
  collector: IssueCollector,
  code: string,
  message: string,
  detail: Omit<WorkflowPublicationIssue, 'code' | 'message'> = {},
): void {
  collector.errors.push({ code, message, ...detail })
}

function addWarning(
  collector: IssueCollector,
  code: string,
  message: string,
  detail: Omit<WorkflowPublicationIssue, 'code' | 'message'> = {},
): void {
  collector.warnings.push({ code, message, ...detail })
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

export function stableWorkflowPublicationJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function withoutKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const excluded = new Set(keys)
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  )
}

/**
 * Reproduces cli-harness' renderer-safe Business Asset v2 digest contract.
 * Identity/timestamps/canvas positions/publication state are intentionally not
 * source semantics.
 */
export function computeDesktopWorkflowSourceDigest(
  definition: Record<string, unknown>,
): string {
  const rawTeam = isRecord(definition.team) ? definition.team : undefined
  const rawBindings = Array.isArray(rawTeam?.bindings) ? rawTeam.bindings : []
  const team = rawTeam
    ? {
        bindings: rawBindings.map(binding =>
          isRecord(binding)
            ? withoutKeys(binding, ['createdAt', 'updatedAt'])
            : binding,
        ),
      }
    : undefined
  const nodes = Array.isArray(definition.nodes)
    ? definition.nodes.map(node =>
        isRecord(node) ? withoutKeys(node, ['position']) : node,
      )
    : []
  const payload = {
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    goal: definition.goal,
    subjectRefs: Array.isArray(definition.subjectRefs)
      ? definition.subjectRefs
      : [],
    team,
    dependencies: definition.dependencies,
    evidencePolicy: definition.evidencePolicy,
    nodes,
    edges: Array.isArray(definition.edges) ? definition.edges : [],
    roleRelations: Array.isArray(definition.roleRelations)
      ? definition.roleRelations
      : [],
    defaultCwd: definition.defaultCwd,
    variables: isRecord(definition.variables) ? definition.variables : {},
  }
  return createHash('sha256')
    .update(stableWorkflowPublicationJson(payload), 'utf8')
    .digest('hex')
}

function envelopeIdentity(value: unknown): {
  requestId: string
  draftId: string
  localRevision: number
  sourceDigest: string
} {
  const record = isRecord(value) ? value : {}
  return {
    requestId: typeof record.requestId === 'string' ? record.requestId : '',
    draftId: typeof record.draftId === 'string' ? record.draftId : '',
    localRevision:
      typeof record.localRevision === 'number' ? record.localRevision : 0,
    sourceDigest:
      typeof record.sourceDigest === 'string' ? record.sourceDigest : '',
  }
}

function validateEnvelope(
  value: unknown,
  collector: IssueCollector,
): WorkflowDraftEnvelope | null {
  if (!isRecord(value)) {
    addError(collector, 'invalid-envelope', 'Draft envelope must be a JSON object.', {
      path: '/',
    })
    return null
  }
  if (value.protocolVersion !== WORKFLOW_PUBLICATION_PROTOCOL_VERSION) {
    addError(
      collector,
      'unsupported-protocol-version',
      'protocolVersion must be 1.',
      { path: '/protocolVersion' },
    )
  }
  if (value.draftSchema !== WORKFLOW_PUBLICATION_DRAFT_SCHEMA) {
    addError(
      collector,
      'unsupported-draft-schema',
      `draftSchema must be ${WORKFLOW_PUBLICATION_DRAFT_SCHEMA}.`,
      { path: '/draftSchema' },
    )
  }
  if (!validateUuid(value.requestId)) {
    addError(collector, 'invalid-request-id', 'requestId must be a UUID.', {
      path: '/requestId',
    })
  }
  if (!nonEmptyString(value.draftId)) {
    addError(collector, 'missing-draft-id', 'draftId must be a non-empty string.', {
      path: '/draftId',
    })
  }
  if (
    !Number.isInteger(value.localRevision) ||
    typeof value.localRevision !== 'number' ||
    value.localRevision < 1
  ) {
    addError(
      collector,
      'invalid-local-revision',
      'localRevision must be a positive integer.',
      { path: '/localRevision' },
    )
  }
  if (typeof value.sourceDigest !== 'string' || !SHA256_RE.test(value.sourceDigest)) {
    addError(
      collector,
      'invalid-source-digest',
      'sourceDigest must be a lowercase SHA-256 hex digest.',
      { path: '/sourceDigest' },
    )
  }
  if (!isRecord(value.definition)) {
    addError(collector, 'missing-definition', 'definition must be a JSON object.', {
      path: '/definition',
    })
  }
  if (collector.errors.length > 0 || !isRecord(value.definition)) return null
  return value as WorkflowDraftEnvelope
}

function validateGraph(
  definition: Record<string, unknown>,
  collector: IssueCollector,
): Map<string, Record<string, unknown>> {
  const nodeById = new Map<string, Record<string, unknown>>()
  const nodes = definition.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) {
    addError(collector, 'nodes-missing', 'definition.nodes must contain at least one node.', {
      path: '/definition/nodes',
    })
    return nodeById
  }
  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      addError(collector, 'invalid-node', 'Workflow node must be an object.', {
        path: `/definition/nodes/${index}`,
      })
      return
    }
    if (!nonEmptyString(node.id)) {
      addError(collector, 'node-id-missing', 'Workflow node id is required.', {
        path: `/definition/nodes/${index}/id`,
      })
      return
    }
    if (nodeById.has(node.id)) {
      addError(collector, 'duplicate-node-id', `Duplicate workflow node id: ${node.id}.`, {
        path: `/definition/nodes/${index}/id`,
        nodeId: node.id,
      })
      return
    }
    nodeById.set(node.id, node)
    if (!nonEmptyString(node.type)) {
      addError(collector, 'node-type-missing', 'Workflow node type is required.', {
        path: `/definition/nodes/${index}/type`,
        nodeId: node.id,
      })
    } else if (!KNOWN_DESKTOP_NODE_TYPES.has(node.type)) {
      addError(collector, 'unknown-node-type', `Unknown Desktop workflow node type: ${node.type}.`, {
        path: `/definition/nodes/${index}/type`,
        nodeId: node.id,
      })
    }
    if (!isRecord(node.config)) {
      addError(collector, 'node-config-missing', 'Workflow node config must be an object.', {
        path: `/definition/nodes/${index}/config`,
        nodeId: node.id,
      })
    }
  })

  const adjacency = new Map<string, string[]>()
  for (const id of nodeById.keys()) adjacency.set(id, [])
  const edges = definition.edges
  if (!Array.isArray(edges)) {
    addError(collector, 'edges-missing', 'definition.edges must be an array.', {
      path: '/definition/edges',
    })
    return nodeById
  }
  edges.forEach((edge, index) => {
    if (!isRecord(edge) || !isRecord(edge.from) || !isRecord(edge.to)) {
      addError(collector, 'invalid-edge', 'Workflow edge must contain from and to objects.', {
        path: `/definition/edges/${index}`,
      })
      return
    }
    const from = edge.from.nodeId
    const to = edge.to.nodeId
    if (!nonEmptyString(from) || !nodeById.has(from)) {
      addError(collector, 'edge-source-missing', 'Workflow edge source node does not exist.', {
        path: `/definition/edges/${index}/from/nodeId`,
        ...(typeof from === 'string' ? { nodeId: from } : {}),
      })
      return
    }
    if (!nonEmptyString(to) || !nodeById.has(to)) {
      addError(collector, 'edge-target-missing', 'Workflow edge target node does not exist.', {
        path: `/definition/edges/${index}/to/nodeId`,
        ...(typeof to === 'string' ? { nodeId: to } : {}),
      })
      return
    }
    adjacency.get(from)!.push(to)
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  if ([...nodeById.keys()].some(visit)) {
    addError(collector, 'graph-cycle', 'Workflow graph must be acyclic.', {
      path: '/definition/edges',
    })
  }
  return nodeById
}

function validateBusinessDefinition(
  envelope: WorkflowDraftEnvelope,
  collector: IssueCollector,
): void {
  const definition = envelope.definition
  if (definition.schemaVersion !== 2) {
    addError(
      collector,
      'unsupported-business-asset-version',
      'definition.schemaVersion must be 2.',
      { path: '/definition/schemaVersion' },
    )
  }
  if (nonEmptyString(definition.id) && definition.id !== envelope.draftId) {
    addError(collector, 'draft-id-mismatch', 'definition.id must match draftId.', {
      path: '/definition/id',
    })
  }
  if (!nonEmptyString(definition.name)) {
    addError(collector, 'workflow-name-missing', 'Workflow name is required.', {
      path: '/definition/name',
    })
  }
  if (!isRecord(definition.goal) || !nonEmptyString(definition.goal.statement)) {
    addError(collector, 'goal-missing', 'Workflow goal statement is required.', {
      path: '/definition/goal/statement',
    })
  }
  if (
    !isRecord(definition.goal) ||
    !stringArray(definition.goal.successCriteria) ||
    !definition.goal.successCriteria.some(criterion => criterion.trim())
  ) {
    addError(
      collector,
      'success-criteria-missing',
      'Workflow must declare at least one success criterion.',
      { path: '/definition/goal/successCriteria' },
    )
  }
  if (!Array.isArray(definition.subjectRefs) || definition.subjectRefs.length === 0) {
    addError(collector, 'subject-missing', 'Workflow must reference a business subject.', {
      path: '/definition/subjectRefs',
    })
  }

  const nodeById = validateGraph(definition, collector)
  const bindings = isRecord(definition.team) && Array.isArray(definition.team.bindings)
    ? definition.team.bindings
    : null
  const bindingById = new Map<string, Record<string, unknown>>()
  if (!bindings) {
    addError(collector, 'team-missing', 'definition.team.bindings must be an array.', {
      path: '/definition/team/bindings',
    })
  } else {
    bindings.forEach((binding, index) => {
      if (!isRecord(binding) || !nonEmptyString(binding.id)) {
        addError(collector, 'role-binding-id-missing', 'Role binding id is required.', {
          path: `/definition/team/bindings/${index}/id`,
        })
        return
      }
      if (bindingById.has(binding.id)) {
        addError(collector, 'duplicate-role-binding-id', `Duplicate role binding id: ${binding.id}.`, {
          path: `/definition/team/bindings/${index}/id`,
          roleBindingId: binding.id,
        })
        return
      }
      bindingById.set(binding.id, binding)
      if (!Number.isInteger(binding.templateVersion) || Number(binding.templateVersion) < 0) {
        addError(collector, 'role-binding-version-invalid', 'templateVersion must be a non-negative integer.', {
          path: `/definition/team/bindings/${index}/templateVersion`,
          roleBindingId: binding.id,
        })
      }
      if (typeof binding.snapshotDigest !== 'string' || !SHA256_RE.test(binding.snapshotDigest)) {
        addError(collector, 'role-binding-digest-invalid', 'snapshotDigest must be a SHA-256 digest.', {
          path: `/definition/team/bindings/${index}/snapshotDigest`,
          roleBindingId: binding.id,
        })
      }
      for (const field of ['responsibilities', 'requiredInputs', 'expectedOutputs', 'facets', 'skillRefs', 'capabilityRefs']) {
        if (!Array.isArray(binding[field])) {
          addError(collector, 'role-binding-field-invalid', `${field} must be an array.`, {
            path: `/definition/team/bindings/${index}/${field}`,
            roleBindingId: binding.id,
          })
        }
      }
      if (binding.executor !== undefined && !hasResolvedExecutor(binding.executor)) {
        addError(collector, 'executor-invalid', 'Role binding executor is incomplete or unsupported.', {
          path: `/definition/team/bindings/${index}/executor`,
          roleBindingId: binding.id,
        })
      }
    })
  }

  for (const [nodeId, node] of nodeById) {
    const assignment = isRecord(node.assignment) ? node.assignment : null
    if (assignment) {
      const referencedBindingIds = [
        assignment.ownerRoleBindingId,
        ...(stringArray(assignment.reviewerRoleBindingIds)
          ? assignment.reviewerRoleBindingIds
          : []),
        ...(stringArray(assignment.approverRoleBindingIds)
          ? assignment.approverRoleBindingIds
          : []),
      ].filter(nonEmptyString)
      for (const roleBindingId of referencedBindingIds) {
        if (!bindingById.has(roleBindingId)) {
          addError(collector, 'role-binding-missing', 'Step assignment references an unknown role binding.', {
            nodeId,
            roleBindingId,
          })
        }
      }
    }
    if (EXECUTOR_OPTIONAL_NODE_TYPES.has(String(node.type))) continue
    const bindingId = assignment?.executorRoleBindingId
    if (!nonEmptyString(bindingId)) {
      addError(collector, 'step-role-unassigned', 'Executable workflow step needs an executor role binding.', {
        path: `/definition/nodes/${nodeId}/assignment/executorRoleBindingId`,
        nodeId,
      })
      continue
    }
    const binding = bindingById.get(bindingId)
    if (!binding) {
      addError(collector, 'role-binding-missing', 'Referenced executor role binding does not exist.', {
        nodeId,
        roleBindingId: bindingId,
      })
    } else if (!hasResolvedExecutor(binding.executor)) {
      addError(collector, 'executor-missing', 'Executor role binding has no resolved executor.', {
        nodeId,
        roleBindingId: bindingId,
      })
    }
    if (binding && node.type === 'capability-action') {
      const config = isRecord(node.config) ? node.config : {}
      if (
        nonEmptyString(config.capabilityId) &&
        (!stringArray(binding.capabilityRefs) ||
          !binding.capabilityRefs.includes(config.capabilityId))
      ) {
        addError(
          collector,
          'role-capability-not-allowed',
          'Executor role binding does not allow this capability.',
          {
            nodeId,
            roleBindingId: bindingId,
            capabilityId: config.capabilityId,
          },
        )
      }
    }
    const business = isRecord(node.business) ? node.business : null
    if (
      (business?.gatePolicy === 'required' || business?.gatePolicy === 'compliance') &&
      (!assignment || !Array.isArray(assignment.approverRoleBindingIds) || assignment.approverRoleBindingIds.length === 0)
    ) {
      addError(collector, 'required-gate-missing', 'Required/compliance steps need an approver role binding.', {
        nodeId,
      })
    }
  }

  const dependencies = isRecord(definition.dependencies)
    ? definition.dependencies
    : null
  if (!dependencies) {
    addError(collector, 'dependencies-missing', 'definition.dependencies must be an object.', {
      path: '/definition/dependencies',
    })
  } else {
    validateDependencies(dependencies, nodeById, bindingById, collector)
  }

  const knownRoleIds = new Set(bindingById.keys())
  for (const binding of bindingById.values()) {
    if (nonEmptyString(binding.templateRoleId)) knownRoleIds.add(binding.templateRoleId)
  }
  if (definition.roleRelations !== undefined && !Array.isArray(definition.roleRelations)) {
    addError(collector, 'role-relations-invalid', 'roleRelations must be an array.', {
      path: '/definition/roleRelations',
    })
  } else {
    for (const relation of (definition.roleRelations as unknown[] | undefined) ?? []) {
      if (
        !isRecord(relation) ||
        !nonEmptyString(relation.fromRoleId) ||
        !nonEmptyString(relation.toRoleId) ||
        !knownRoleIds.has(relation.fromRoleId) ||
        !knownRoleIds.has(relation.toRoleId)
      ) {
        addError(collector, 'role-relation-invalid', 'Role relation references an unknown role.', {
          path: '/definition/roleRelations',
        })
      }
    }
  }

  if (!isRecord(definition.evidencePolicy)) {
    addError(collector, 'evidence-policy-missing', 'definition.evidencePolicy must be an object.', {
      path: '/definition/evidencePolicy',
    })
  }

  const computedDigest = computeDesktopWorkflowSourceDigest(definition)
  if (computedDigest !== envelope.sourceDigest) {
    addError(
      collector,
      'source-digest-mismatch',
      `sourceDigest does not match definition semantics (computed ${computedDigest}).`,
      { path: '/sourceDigest' },
    )
  }
  const release = isRecord(definition.release) ? definition.release : null
  if (
    release &&
    (release.localRevision !== envelope.localRevision ||
      release.sourceDigest !== envelope.sourceDigest)
  ) {
    addError(
      collector,
      'release-stale',
      'definition.release revision/digest must match the publication envelope.',
      { path: '/definition/release' },
    )
  }
  const priorPublication = release && isRecord(release.publication)
    ? release.publication
    : null
  if (
    priorPublication &&
    priorPublication.sourceDigest !== undefined &&
    priorPublication.sourceDigest !== envelope.sourceDigest
  ) {
    addError(
      collector,
      'release-stale',
      'definition.release.publication sourceDigest is stale.',
      { path: '/definition/release/publication/sourceDigest' },
    )
  }
  if (definition.enabled === false) {
    addWarning(
      collector,
      'workflow-disabled',
      'Workflow is disabled; publication does not enable invocation.',
      { path: '/definition/enabled' },
    )
  }
}

function hasResolvedExecutor(value: unknown): boolean {
  if (!isRecord(value) || !nonEmptyString(value.kind)) return false
  if (value.kind === 'human') {
    return nonEmptyString(value.assigneeId) || nonEmptyString(value.displayName)
  }
  if (value.kind === 'service') return nonEmptyString(value.providerId)
  return value.kind === 'mossen-agent'
}

function validateDependencies(
  dependencies: Record<string, unknown>,
  nodeById: Map<string, Record<string, unknown>>,
  bindingById: Map<string, Record<string, unknown>>,
  collector: IssueCollector,
): void {
  for (const field of ['skills', 'capabilities', 'connectors', 'permissionPolicies']) {
    if (!Array.isArray(dependencies[field])) {
      addError(collector, 'dependency-list-missing', `${field} must be an array.`, {
        path: `/definition/dependencies/${field}`,
      })
    }
  }
  const skills = Array.isArray(dependencies.skills) ? dependencies.skills : []
  const capabilities = Array.isArray(dependencies.capabilities)
    ? dependencies.capabilities
    : []
  const connectors = Array.isArray(dependencies.connectors)
    ? dependencies.connectors
    : []
  const policies = Array.isArray(dependencies.permissionPolicies)
    ? dependencies.permissionPolicies
    : []
  const skillIds = new Set<string>()
  const capabilityIds = new Set<string>()
  const connectorIds = new Set<string>()
  const policyIds = new Set<string>()

  skills.forEach((value, index) => {
    if (!isRecord(value) || !nonEmptyString(value.skillId)) {
      addError(collector, 'skill-id-missing', 'Skill requirement needs skillId.', {
        path: `/definition/dependencies/skills/${index}/skillId`,
      })
      return
    }
    skillIds.add(value.skillId)
    if (!stringArray(value.requiredByRoleBindingIds)) {
      addError(collector, 'skill-role-bindings-invalid', 'requiredByRoleBindingIds must be a string array.', {
        skillId: value.skillId,
      })
      return
    }
    for (const bindingId of value.requiredByRoleBindingIds) {
      if (!bindingById.has(bindingId)) {
        addError(collector, 'skill-role-binding-missing', 'Skill requirement references an unknown role binding.', {
          skillId: value.skillId,
          roleBindingId: bindingId,
        })
      }
    }
  })

  capabilities.forEach((value, index) => {
    if (!isRecord(value) || !nonEmptyString(value.capabilityId)) {
      addError(collector, 'capability-id-missing', 'Capability requirement needs capabilityId.', {
        path: `/definition/dependencies/capabilities/${index}/capabilityId`,
      })
      return
    }
    capabilityIds.add(value.capabilityId)
    if (!stringArray(value.requiredByStepIds)) {
      addError(collector, 'capability-steps-invalid', 'requiredByStepIds must be a string array.', {
        capabilityId: value.capabilityId,
      })
      return
    }
    for (const nodeId of value.requiredByStepIds) {
      if (!nodeById.has(nodeId)) {
        addError(collector, 'capability-step-missing', 'Capability requirement references an unknown step.', {
          capabilityId: value.capabilityId,
          nodeId,
        })
      }
    }
  })

  connectors.forEach((value, index) => {
    if (!isRecord(value) || !nonEmptyString(value.providerId)) {
      addError(collector, 'connector-provider-missing', 'Connector requirement needs providerId.', {
        path: `/definition/dependencies/connectors/${index}/providerId`,
      })
      return
    }
    connectorIds.add(value.providerId)
    if (!stringArray(value.requiredByCapabilityIds)) {
      addError(collector, 'connector-capabilities-invalid', 'requiredByCapabilityIds must be a string array.', {
        providerId: value.providerId,
      })
      return
    }
    for (const capabilityId of value.requiredByCapabilityIds) {
      if (!capabilityIds.has(capabilityId)) {
        addError(collector, 'connector-capability-missing', 'Connector references an unknown capability requirement.', {
          providerId: value.providerId,
          capabilityId,
        })
      }
    }
  })

  policies.forEach((value, index) => {
    if (!isRecord(value) || !nonEmptyString(value.policyId)) {
      addError(collector, 'permission-policy-id-missing', 'Permission policy requirement needs policyId.', {
        path: `/definition/dependencies/permissionPolicies/${index}/policyId`,
      })
      return
    }
    policyIds.add(value.policyId)
    if (!stringArray(value.requiredByRoleBindingIds)) {
      addError(collector, 'permission-policy-bindings-invalid', 'requiredByRoleBindingIds must be a string array.', {
        policyId: value.policyId,
      })
      return
    }
    for (const bindingId of value.requiredByRoleBindingIds) {
      if (!bindingById.has(bindingId)) {
        addError(collector, 'permission-policy-binding-missing', 'Permission policy references an unknown role binding.', {
          policyId: value.policyId,
          roleBindingId: bindingId,
        })
      }
    }
  })

  for (const binding of bindingById.values()) {
    const bindingId = String(binding.id)
    for (const skillId of stringArray(binding.skillRefs) ? binding.skillRefs : []) {
      if (!skillIds.has(skillId)) {
        addError(collector, 'skill-requirement-missing', 'Role binding skillRef has no dependency requirement.', {
          skillId,
          roleBindingId: bindingId,
        })
      }
    }
    for (const capabilityId of stringArray(binding.capabilityRefs) ? binding.capabilityRefs : []) {
      if (!capabilityIds.has(capabilityId)) {
        addError(collector, 'capability-requirement-missing', 'Role binding capabilityRef has no dependency requirement.', {
          capabilityId,
          roleBindingId: bindingId,
        })
      }
    }
    if (nonEmptyString(binding.permissionPolicyRef) && !policyIds.has(binding.permissionPolicyRef)) {
      addError(collector, 'permission-policy-requirement-missing', 'Role binding policy has no dependency requirement.', {
        policyId: binding.permissionPolicyRef,
        roleBindingId: bindingId,
      })
    }
  }

  for (const [nodeId, node] of nodeById) {
    if (node.type !== 'capability-action') continue
    const config = isRecord(node.config) ? node.config : {}
    if (!nonEmptyString(config.capabilityId)) {
      addError(collector, 'capability-missing-id', 'Capability action needs capabilityId.', {
        nodeId,
      })
      continue
    }
    if (!capabilityIds.has(config.capabilityId)) {
      addError(collector, 'capability-requirement-missing', 'Capability action has no dependency requirement.', {
        nodeId,
        capabilityId: config.capabilityId,
      })
    }
    if (nonEmptyString(config.providerId) && !connectorIds.has(config.providerId)) {
      addError(collector, 'connector-requirement-missing', 'Capability action provider has no connector requirement.', {
        nodeId,
        capabilityId: config.capabilityId,
        providerId: config.providerId,
      })
    }
  }
}

export function validateWorkflowDraftEnvelope(
  value: unknown,
): WorkflowValidationResponse {
  const collector: IssueCollector = { errors: [], warnings: [] }
  const identity = envelopeIdentity(value)
  const envelope = validateEnvelope(value, collector)
  if (envelope) validateBusinessDefinition(envelope, collector)
  const status = collector.errors.length > 0
    ? 'fail'
    : collector.warnings.length > 0
      ? 'warn'
      : 'pass'
  return {
    version: 1,
    surface: 'workflow-validation',
    requestId: identity.requestId,
    draftId: identity.draftId,
    localRevision: identity.localRevision,
    sourceDigest: identity.sourceDigest,
    status,
    publishable: collector.errors.length === 0,
    errors: collector.errors,
    warnings: collector.warnings,
    compatibility: {
      mossenVersion: runtimeVersion(),
      workflowRuntime: 'v1',
    },
  }
}

export function parseWorkflowDraftEnvelope(value: unknown): WorkflowDraftEnvelope | null {
  const collector: IssueCollector = { errors: [], warnings: [] }
  return validateEnvelope(value, collector)
}
