import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  computeDesktopWorkflowSourceDigest,
  validateWorkflowDraftEnvelope,
  workflowPublicationProtocolDescriptor,
} from '../publicationProtocol.js'
import {
  loadWorkflowPublicationRegistry,
  publishWorkflowDraft,
  workflowPublicationRegistryPath,
} from '../publicationRegistry.js'
import { buildWorkbenchWorkflowSnapshot } from '../workbenchSnapshot.js'
import {
  cancelPublishedWorkflowRun,
  decidePublishedWorkflowRun,
  enablePublishedWorkflow,
  invokePublishedWorkflow,
  loadPublishedWorkflowRuntimeRegistry,
  publishedWorkflowRuntimeRegistryPath,
  queryPublishedWorkflowRun,
  retryPublishedWorkflowRun,
  setPublishedAgentRuntimeExecutorForTests,
  setPublishedAgentRuntimeSessionPreparerForTests,
  type PublishedAgentRuntimeRequest,
  type PublishedWorkflowRuntimeProjection,
} from '../publishedRunProtocol.js'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const THIRD_REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_IDEMPOTENCY_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const THIRD_IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function businessAssetDefinition(
  id = 'desktop-draft-1',
  name = 'Daily report approval',
): Record<string, unknown> {
  const definition: Record<string, unknown> = {
    id,
    schemaVersion: 2,
    name,
    description: 'Prepare, review, and send a daily report.',
    enabled: true,
    goal: {
      statement: 'Send an approved daily report.',
      expectedOutcome: 'The report is delivered with an auditable receipt.',
      successCriteria: ['Approval recorded', 'Delivery receipt recorded'],
    },
    subjectRefs: [
      {
        providerId: 'dingtalk',
        resourceType: 'group',
        resourceId: 'group-fixture',
      },
    ],
    team: {
      bindings: [
        {
          id: 'binding_sender',
          templateRoleId: 'role_sender',
          templateVersion: 1,
          snapshotDigest: 'b'.repeat(64),
          nameSnapshot: 'Report sender',
          descriptionSnapshot: 'Sends approved reports.',
          responsibilities: ['Send the approved report'],
          requiredInputs: ['Approved report'],
          expectedOutputs: ['Delivery receipt'],
          facets: [],
          executor: {
            kind: 'service',
            providerId: 'dingtalk',
            serviceId: 'send-message',
          },
          skillRefs: ['daily-report-skill'],
          capabilityRefs: ['dingtalk.send-message'],
          permissionPolicyRef: 'policy-report-send',
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    },
    dependencies: {
      skills: [
        {
          skillId: 'daily-report-skill',
          requiredByRoleBindingIds: ['binding_sender'],
        },
      ],
      capabilities: [
        {
          capabilityId: 'dingtalk.send-message',
          providerId: 'dingtalk',
          requiredByStepIds: ['step_send'],
        },
      ],
      connectors: [
        {
          providerId: 'dingtalk',
          requiredByCapabilityIds: ['dingtalk.send-message'],
        },
      ],
      permissionPolicies: [
        {
          policyId: 'policy-report-send',
          requiredByRoleBindingIds: ['binding_sender'],
        },
      ],
    },
    evidencePolicy: {
      captureInputs: true,
      captureOutputs: true,
      captureApprovals: true,
      captureArtifacts: true,
      captureRawCapabilityEvidence: true,
      retention: 'local',
    },
    nodes: [
      {
        id: 'trigger_manual',
        type: 'trigger-manual',
        position: { x: 10, y: 20 },
        config: {},
      },
      {
        id: 'step_send',
        type: 'capability-action',
        position: { x: 30, y: 40 },
        business: {
          title: 'Send approved report',
          expectedOutcome: 'Delivery receipt',
          gatePolicy: 'optional',
        },
        assignment: {
          executorRoleBindingId: 'binding_sender',
          ownerRoleBindingId: 'binding_sender',
          reviewerRoleBindingIds: [],
          approverRoleBindingIds: [],
        },
        config: {
          capabilityId: 'dingtalk.send-message',
          providerId: 'dingtalk',
          inputs: { targetId: 'fixture-target', message: 'fixture' },
        },
      },
    ],
    edges: [
      {
        from: { nodeId: 'trigger_manual' },
        to: { nodeId: 'step_send' },
      },
    ],
    roleRelations: [],
    variables: {},
    createdAt: 1,
    updatedAt: 2,
  }
  const sourceDigest = computeDesktopWorkflowSourceDigest(definition)
  definition.release = {
    localRevision: 1,
    sourceDigest,
    validation: { status: 'not-validated', issues: [] },
  }
  return definition
}

function draftEnvelope(
  definition = businessAssetDefinition(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const release = definition.release as Record<string, unknown>
  return {
    protocolVersion: 1,
    requestId: REQUEST_ID,
    draftSchema: 'mossen-desktop-workflow-business-asset/v2',
    draftId: definition.id,
    localRevision: release.localRevision,
    sourceDigest: release.sourceDigest,
    definition,
    ...overrides,
  }
}

function publishRequest(
  definition = businessAssetDefinition(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...draftEnvelope(definition),
    idempotencyKey: IDEMPOTENCY_KEY,
    expectedAssetId: null,
    expectedAssetVersion: null,
    scope: 'user',
    ...overrides,
  }
}

function revisedDefinition(
  prior: Record<string, unknown>,
  description: string,
): Record<string, unknown> {
  const next = structuredClone(prior)
  next.description = description
  const digest = computeDesktopWorkflowSourceDigest(next)
  next.release = {
    localRevision: Number((prior.release as Record<string, unknown>).localRevision) + 1,
    sourceDigest: digest,
    validation: { status: 'not-validated', issues: [] },
  }
  return next
}

function deterministicDefinition(): Record<string, unknown> {
  const definition = businessAssetDefinition(
    'desktop-published-run',
    'Deterministic published run',
  )
  definition.team = {
    bindings: [
      {
        id: 'binding_runtime',
        templateRoleId: 'role_runtime',
        templateVersion: 1,
        snapshotDigest: 'd'.repeat(64),
        nameSnapshot: 'Published runtime',
        descriptionSnapshot: 'Executes deterministic published steps.',
        responsibilities: ['Execute published steps'],
        requiredInputs: ['Run input'],
        expectedOutputs: ['Run result'],
        facets: [],
        executor: { kind: 'mossen-agent' },
        skillRefs: [],
        capabilityRefs: [],
        createdAt: 10,
        updatedAt: 20,
      },
    ],
  }
  definition.dependencies = {
    skills: [],
    capabilities: [],
    connectors: [],
    permissionPolicies: [],
  }
  definition.nodes = [
    { id: 'trigger', type: 'trigger-manual', config: {} },
    {
      id: 'trim',
      type: 'text-transform',
      business: { title: 'Trim input' },
      assignment: {
        executorRoleBindingId: 'binding_runtime',
        ownerRoleBindingId: 'binding_runtime',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: { operation: 'trim' },
    },
    {
      id: 'uppercase',
      type: 'text-transform',
      business: { title: 'Uppercase input' },
      assignment: {
        executorRoleBindingId: 'binding_runtime',
        ownerRoleBindingId: 'binding_runtime',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: {
        operation: 'uppercase',
        artifact: {
          name: 'published-result.json',
          kind: 'workflow-result',
          mediaType: 'application/json',
        },
      },
    },
  ]
  definition.edges = [
    { from: { nodeId: 'trigger' }, to: { nodeId: 'trim' } },
    { from: { nodeId: 'trim' }, to: { nodeId: 'uppercase' } },
  ]
  const sourceDigest = computeDesktopWorkflowSourceDigest(definition)
  definition.release = {
    localRevision: 1,
    sourceDigest,
    validation: { status: 'not-validated', issues: [] },
  }
  return definition
}

function approvalDefinition(): Record<string, unknown> {
  const definition = deterministicDefinition()
  definition.id = 'desktop-approval-run'
  definition.name = 'Published approval run'
  definition.nodes = [
    { id: 'trigger', type: 'trigger-manual', config: {} },
    {
      id: 'prepare',
      type: 'text-transform',
      business: { title: 'Prepare approval artifact' },
      assignment: {
        executorRoleBindingId: 'binding_runtime',
        ownerRoleBindingId: 'binding_runtime',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: {
        operation: 'trim',
        artifact: {
          name: 'approval-input.json',
          kind: 'approval-input',
          mediaType: 'application/json',
        },
      },
    },
    {
      id: 'approve',
      type: 'human-approval',
      business: { title: 'Approve result', gatePolicy: 'required' },
      assignment: {
        executorRoleBindingId: 'binding_runtime',
        ownerRoleBindingId: 'binding_runtime',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: ['binding_runtime'],
      },
      config: { message: 'Approve the fixture result.', allowReject: true },
    },
  ]
  definition.edges = [
    { from: { nodeId: 'trigger' }, to: { nodeId: 'prepare' } },
    { from: { nodeId: 'prepare' }, to: { nodeId: 'approve' } },
  ]
  const sourceDigest = computeDesktopWorkflowSourceDigest(definition)
  definition.release = {
    localRevision: 1,
    sourceDigest,
    validation: { status: 'not-validated', issues: [] },
  }
  return definition
}

function r12AgentDefinition(): Record<string, unknown> {
  const definition = deterministicDefinition()
  definition.id = 'desktop-r12-agent-run'
  definition.name = 'R12 Agent published run'
  definition.team = {
    bindings: [
      {
        id: 'binding_agent',
        templateRoleId: 'position_daily_report',
        templateVersion: 3,
        snapshotDigest: '1'.repeat(64),
        nameSnapshot: 'Daily report analyst',
        descriptionSnapshot: 'Runs the frozen report Agent.',
        responsibilities: ['Prepare the report'],
        requiredInputs: ['Report source'],
        expectedOutputs: ['Report result'],
        facets: [],
        executor: {
          kind: 'mossen-agent',
          adapterId: 'mossen-cli',
          agentRef: 'daily-report-agent',
          toolIds: ['Read', 'Bash'],
          worker: {
            id: 'worker_daily_report',
            version: 2,
            digest: '2'.repeat(64),
          },
        },
        skillRefs: ['daily-report'],
        capabilityRefs: [],
        createdAt: 10,
        updatedAt: 20,
      },
    ],
  }
  definition.dependencies = {
    skills: [
      {
        skillId: 'daily-report',
        requiredByRoleBindingIds: ['binding_agent'],
      },
    ],
    capabilities: [],
    connectors: [],
    permissionPolicies: [],
  }
  definition.nodes = [
    { id: 'trigger', type: 'trigger-manual', config: {} },
    {
      id: 'step_agent',
      type: 'mossen-call',
      business: {
        title: 'Prepare report with Mossen',
        expectedOutcome: 'A frozen Agent result',
        gatePolicy: 'optional',
      },
      assignment: {
        executorRoleBindingId: 'binding_agent',
        ownerRoleBindingId: 'binding_agent',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: {
        prompt: 'Prepare the report from {{input}}.',
        artifact: {
          name: 'r12-agent-result.json',
          kind: 'agent-result',
          mediaType: 'application/json',
        },
      },
    },
    {
      id: 'finish',
      type: 'text-transform',
      business: { title: 'Normalize final report' },
      assignment: {
        executorRoleBindingId: 'binding_agent',
        ownerRoleBindingId: 'binding_agent',
        reviewerRoleBindingIds: [],
        approverRoleBindingIds: [],
      },
      config: { operation: 'trim' },
    },
  ]
  definition.edges = [
    { from: { nodeId: 'trigger' }, to: { nodeId: 'step_agent' } },
    { from: { nodeId: 'step_agent' }, to: { nodeId: 'finish' } },
  ]
  const sourceDigest = computeDesktopWorkflowSourceDigest(definition)
  definition.release = {
    localRevision: 1,
    sourceDigest,
    validation: { status: 'not-validated', issues: [] },
  }
  return definition
}

type RuntimeProjectionRequest = Omit<
  PublishedWorkflowRuntimeProjection,
  'acceptedAt' | 'projectionDigest'
>

function r12Projection(
  overrides: Partial<RuntimeProjectionRequest> = {},
): RuntimeProjectionRequest {
  return {
    nodeId: 'step_agent',
    roleBindingId: 'binding_agent',
    position: {
      id: 'position_daily_report',
      version: 3,
      digest: '1'.repeat(64),
    },
    worker: {
      id: 'worker_daily_report',
      version: 2,
      digest: '2'.repeat(64),
    },
    grantDigest: '3'.repeat(64),
    catalogDigest: '4'.repeat(64),
    policyDigest: '5'.repeat(64),
    runtime: {
      adapterId: 'mossen-cli',
      agentRef: 'daily-report-agent',
      modelRef: null,
    },
    skills: { required: ['daily-report'], resolved: ['daily-report'] },
    tools: {
      inventory: ['Read', 'Bash'],
      allow: ['Read'],
      ask: ['Bash'],
      deny: [],
    },
    connectorRefs: [],
    resourceScopes: [],
    ...overrides,
  }
}

function fakePreparedAgentSession(request: PublishedAgentRuntimeRequest) {
  return {
    sessionId: '99999999-9999-4999-8999-999999999999',
    workspace: '/isolated/r12-agent-workspace',
    agentName: 'published-r12-fixture',
    definitionDigest: 'a'.repeat(64),
    agentDefinition: {
      description: 'R12 deterministic Agent fixture',
      prompt: 'Use the frozen Skill and request Bash once.',
      tools: [...request.projection.tools.inventory],
      skills: [...request.projection.skills.required],
      permissionMode: 'default' as const,
    },
    pendingTool: null,
  }
}

async function publishEnableR12(
  definition: Record<string, unknown>,
): Promise<{
  identity: {
    protocolVersion: 1
    assetId: string
    assetVersion: string
    sourceDigest: string
  }
}> {
  const published = await publishWorkflowDraft(publishRequest(definition))
  if ('conflict' in published) {
    throw new Error(
      `${published.conflict.message}: ${JSON.stringify(published.conflict.issues)}`,
    )
  }
  const identity = {
    protocolVersion: 1 as const,
    assetId: published.receipt.assetId,
    assetVersion: published.receipt.assetVersion,
    sourceDigest: published.receipt.sourceDigest,
  }
  const enabled = await enablePublishedWorkflow({
    ...identity,
    requestId: SECOND_REQUEST_ID,
    idempotencyKey: SECOND_IDEMPOTENCY_KEY,
  })
  if (!('response' in enabled)) throw new Error(enabled.conflict.message)
  return { identity }
}

function decisionRequest(params: {
  identity: {
    protocolVersion: 1
    assetId: string
    assetVersion: string
    sourceDigest: string
  }
  runId: string
  revision: number
  wait: { waitId: string; waitDigest: string; nodeId: string }
  requestId: string
  idempotencyKey: string
  kind: 'approval' | 'permission'
  outcome: 'approve' | 'reject' | 'allow_once' | 'deny'
  reason?: string
}) {
  return {
    ...params.identity,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    runId: params.runId,
    expectedRunRevision: params.revision,
    waitId: params.wait.waitId,
    waitDigest: params.wait.waitDigest,
    nodeId: params.wait.nodeId,
    decision: {
      kind: params.kind,
      outcome: params.outcome,
      reason: params.reason ?? null,
      actor: { kind: 'user', subjectId: 'local-r12-tester' },
    },
  }
}

describe('workflow publication protocol v1', () => {
  let root: string
  let priorHome: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'workflow-publication-'))
    priorHome = process.env.MOSSEN_HOME
    process.env.MOSSEN_HOME = join(root, 'mossen-home')
  })

  afterEach(() => {
    setPublishedAgentRuntimeExecutorForTests(undefined)
    setPublishedAgentRuntimeSessionPreparerForTests(undefined)
    if (priorHome === undefined) delete process.env.MOSSEN_HOME
    else process.env.MOSSEN_HOME = priorHome
    rmSync(root, { recursive: true, force: true })
  })

  test('advertises publication plus typed decision/resume execution', () => {
    expect(workflowPublicationProtocolDescriptor()).toMatchObject({
      version: 1,
      surface: 'workflow-publication-protocol',
      transport: 'stdin-json/stdout-json',
      draftSchema: 'mossen-desktop-workflow-business-asset/v2',
      operations: {
        validate: {
          args: ['workflows', 'validate-draft', '--stdin', '--json'],
          input: 'stdin-json',
          output: 'workflow-validation/v1',
          idempotent: true,
        },
        publish: {
          args: ['workflows', 'publish-draft', '--stdin', '--json'],
          input: 'stdin-json',
          output: 'workflow-publication-receipt/v1',
          idempotent: true,
        },
        reconcile: {
          args: ['workflows', '--workbench', '--json'],
          output: 'workbench-workflows/v1+publication',
        },
        enable: {
          args: ['workflows', 'enable-published', '--stdin', '--json'],
          output: 'workflow-enable-receipt/v1',
          idempotent: true,
        },
        invoke: {
          args: ['workflows', 'run-published', '--stdin', '--json'],
          output: 'workflow-run-receipt/v1',
          idempotent: true,
        },
        retry: {
          args: ['workflows', 'retry-published-run', '--stdin', '--json'],
          output: 'workflow-run-retry-receipt/v1',
          idempotent: true,
        },
        query: {
          args: ['workflows', 'query-published-run', '--stdin', '--json'],
          output: 'workflow-run-query/v1',
          idempotent: true,
        },
        cancel: {
          args: ['workflows', 'cancel-published-run', '--stdin', '--json'],
          output: 'workflow-run-cancel-receipt/v1',
          idempotent: true,
        },
        decide: {
          args: ['workflows', 'decide-published-run', '--stdin', '--json'],
          input: 'workflow-published-run-decision-request/v1',
          output: 'workflow-published-run-decision-receipt/v1',
          idempotent: true,
          atomicResume: true,
        },
      },
      requiredEvidence: ['assetId', 'assetVersion', 'sourceDigest', 'receiptId'],
      requiredRunEvidence: [
        'runId',
        'retryOfRunId',
        'steps',
        'evidence',
        'artifacts',
        'actionReceipt',
        'waits',
        'pendingWaits',
        'decisions',
        'executionAttempts',
        'runtimeProjections',
        'finalResult',
      ],
      execution: {
        publishedInvocation: {
          available: true,
          enableRequired: true,
          decisionResume: {
            available: true,
            waitKinds: ['approval', 'permission'],
            permissionOutcomes: ['allow_once', 'deny'],
            approvalOutcomes: ['approve', 'reject'],
            stableWaitIdentity: true,
            immutableDecisionEvidence: true,
            runtimeExecutionEvidence: true,
            atomicResume: true,
          },
        },
      },
    })
  })

  test('matches the golden digest generated by cli-harness Business Asset v2', () => {
    const definition = {
      id: 'wf_golden',
      name: 'Golden',
      description: '',
      enabled: true,
      goal: {
        statement: 'Ship',
        expectedOutcome: 'Done',
        successCriteria: ['Pass'],
      },
      subjectRefs: [],
      team: { bindings: [] },
      dependencies: {
        skills: [],
        capabilities: [],
        connectors: [],
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
      nodes: [
        {
          id: 'n1',
          type: 'trigger-manual',
          position: { x: 10, y: 20 },
          config: {},
        },
      ],
      edges: [],
      roleRelations: [],
      variables: {},
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 2,
    }
    expect(computeDesktopWorkflowSourceDigest(definition)).toBe(
      'e613721c650a8487210bc3e06498542b67fe84ffc6a18fdcde02f695b8d7f0cd',
    )
  })

  test('validates a complete draft without creating publication state', () => {
    const response = validateWorkflowDraftEnvelope(draftEnvelope())
    expect(response).toMatchObject({
      surface: 'workflow-validation',
      status: 'pass',
      publishable: true,
      errors: [],
      warnings: [],
    })
    expect(existsSync(workflowPublicationRegistryPath())).toBe(false)
  })

  test('returns node, role, skill, connector, and policy issues as structured errors', () => {
    const definition = businessAssetDefinition()
    const nodes = definition.nodes as Array<Record<string, unknown>>
    const action = nodes[1]!
    nodes.push({ id: 'unknown-step', type: 'future-node', config: {} })
    action.assignment = {
      executorRoleBindingId: 'missing-binding',
      reviewerRoleBindingIds: [],
      approverRoleBindingIds: [],
    }
    const binding = ((definition.team as Record<string, unknown>).bindings as Array<Record<string, unknown>>)[0]!
    binding.skillRefs = ['missing-skill']
    binding.capabilityRefs = ['missing-capability']
    binding.permissionPolicyRef = 'missing-policy'
    ;(action.config as Record<string, unknown>).providerId = 'missing-connector'
    const digest = computeDesktopWorkflowSourceDigest(definition)
    definition.release = {
      localRevision: 1,
      sourceDigest: digest,
      validation: { status: 'not-validated', issues: [] },
    }
    const response = validateWorkflowDraftEnvelope(draftEnvelope(definition))
    expect(response.status).toBe('fail')
    expect(response.publishable).toBe(false)
    expect(response.errors.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        'role-binding-missing',
        'skill-requirement-missing',
        'capability-requirement-missing',
        'permission-policy-requirement-missing',
        'connector-requirement-missing',
        'unknown-node-type',
      ]),
    )
    expect(response.errors.some(issue => Boolean(
      issue.nodeId || issue.roleBindingId || issue.skillId || issue.providerId || issue.policyId,
    ))).toBe(true)
  })

  test('publishes atomically and replays the same idempotency result', async () => {
    const request = publishRequest()
    const first = await publishWorkflowDraft(request, new Date('2026-07-10T10:00:00.000Z'))
    expect(first.ok).toBe(true)
    if ('conflict' in first) throw new Error(first.conflict.message)
    expect(first.replayed).toBe(false)
    expect(first.receipt).toMatchObject({
      status: 'accepted',
      assetVersion: '1.0.0',
      lifecycle: 'published',
      sourceDigest: request.sourceDigest,
    })
    const replay = await publishWorkflowDraft(request, new Date('2026-07-10T11:00:00.000Z'))
    expect(replay).toEqual({ ok: true, receipt: first.receipt, replayed: true })
    const stored = loadWorkflowPublicationRegistry()
    expect(stored.assets).toHaveLength(1)
    expect(stored.receipts).toHaveLength(1)
    expect(readFileSync(workflowPublicationRegistryPath(), 'utf8')).toContain(first.receipt.receiptId)
  })

  test('serializes concurrent retries into one asset and one receipt', async () => {
    const request = publishRequest()
    const [left, right] = await Promise.all([
      publishWorkflowDraft(request),
      publishWorkflowDraft(request),
    ])
    expect(left.ok).toBe(true)
    expect(right.ok).toBe(true)
    if ('conflict' in left || 'conflict' in right) {
      throw new Error('concurrent idempotent publish should not conflict')
    }
    expect(left.receipt).toEqual(right.receipt)
    expect([left.replayed, right.replayed].sort()).toEqual([false, true])
    const stored = loadWorkflowPublicationRegistry()
    expect(stored.assets).toHaveLength(1)
    expect(stored.receipts).toHaveLength(1)
  })

  test('updates the stable asset version and rejects stale writers', async () => {
    const original = businessAssetDefinition()
    const first = await publishWorkflowDraft(publishRequest(original))
    if ('conflict' in first) throw new Error(first.conflict.message)
    const revised = revisedDefinition(original, 'Revised publication definition.')
    const update = await publishWorkflowDraft(publishRequest(revised, {
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      expectedAssetId: first.receipt.assetId,
      expectedAssetVersion: first.receipt.assetVersion,
    }))
    expect(update.ok).toBe(true)
    if ('conflict' in update) throw new Error(update.conflict.message)
    expect(update.receipt.assetId).toBe(first.receipt.assetId)
    expect(update.receipt.assetVersion).toBe('1.0.1')
    expect(update.receipt.sourceDigest).not.toBe(first.receipt.sourceDigest)

    const stale = revisedDefinition(revised, 'Stale writer change.')
    const staleResult = await publishWorkflowDraft(publishRequest(stale, {
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      expectedAssetId: first.receipt.assetId,
      expectedAssetVersion: '1.0.0',
    }))
    expect(staleResult.ok).toBe(false)
    if (!('conflict' in staleResult)) throw new Error('expected stale conflict')
    expect(staleResult.conflict).toMatchObject({
      code: 'stale_asset_version',
      current: {
        assetId: first.receipt.assetId,
        assetVersion: '1.0.1',
        sourceDigest: update.receipt.sourceDigest,
      },
    })
  })

  test('returns typed canonical-name and idempotency-key conflicts', async () => {
    const firstRequest = publishRequest()
    const first = await publishWorkflowDraft(firstRequest)
    if ('conflict' in first) throw new Error(first.conflict.message)

    const otherDefinition = businessAssetDefinition(
      'desktop-draft-2',
      'Daily report approval',
    )
    const nameConflict = await publishWorkflowDraft(publishRequest(otherDefinition, {
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
    }))
    expect(nameConflict.ok).toBe(false)
    if (!('conflict' in nameConflict)) throw new Error('expected name conflict')
    expect(nameConflict.conflict.code).toBe('canonical_name_conflict')

    const changed = revisedDefinition(businessAssetDefinition(), 'Different request, reused key.')
    const idempotencyConflict = await publishWorkflowDraft(publishRequest(changed, {
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedAssetId: first.receipt.assetId,
      expectedAssetVersion: first.receipt.assetVersion,
    }))
    expect(idempotencyConflict.ok).toBe(false)
    if (!('conflict' in idempotencyConflict)) throw new Error('expected idempotency conflict')
    expect(idempotencyConflict.conflict.code).toBe('idempotency_key_conflict')
  })

  test('does not let optional plugin packaging change stable workflow identity', async () => {
    const definition = businessAssetDefinition()
    const first = await publishWorkflowDraft(publishRequest(definition))
    if ('conflict' in first) throw new Error(first.conflict.message)
    const packaged = structuredClone(definition)
    packaged.plugin = { packageId: 'optional-distribution-bundle' }
    const second = await publishWorkflowDraft(publishRequest(packaged, {
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      expectedAssetId: first.receipt.assetId,
      expectedAssetVersion: first.receipt.assetVersion,
    }))
    expect(second.ok).toBe(true)
    if ('conflict' in second) throw new Error(second.conflict.message)
    expect(second.receipt.assetId).toBe(first.receipt.assetId)
    expect(second.receipt.assetVersion).toBe(first.receipt.assetVersion)
    expect(second.receipt.sourceDigest).toBe(first.receipt.sourceDigest)
  })

  test('fails closed on a corrupt registry without overwriting it', async () => {
    const path = workflowPublicationRegistryPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{ corrupt registry', 'utf8')
    const result = await publishWorkflowDraft(publishRequest())
    expect(result.ok).toBe(false)
    if (!('conflict' in result)) throw new Error('expected registry failure')
    expect(result.conflict.code).toBe('registry_unavailable')
    expect(readFileSync(path, 'utf8')).toBe('{ corrupt registry')
  })

  test('reconciles receipt identity through the Workbench snapshot', async () => {
    const published = await publishWorkflowDraft(publishRequest())
    if ('conflict' in published) throw new Error(published.conflict.message)
    const snapshot = buildWorkbenchWorkflowSnapshot({
      runs: [],
      registryResults: [],
      generatedAt: '2026-07-10T12:00:00.000Z',
    })
    const asset = snapshot.registry.assets.find(
      item => item.id === published.receipt.assetId,
    )
    expect(asset).toMatchObject({
      id: published.receipt.assetId,
      scope: 'published',
      lifecycle: {
        status: 'published',
        version: published.receipt.assetVersion,
        sourceDigest: published.receipt.sourceDigest,
        lastReceiptId: published.receipt.receiptId,
      },
    })
    expect(
      asset?.actions.find(action => action.id === 'workflow.asset.runPublished'),
    ).toMatchObject({ available: false, kind: 'cli-command' })
    expect(snapshot.actionReceipts.items).toContainEqual(
      expect.objectContaining({
        receiptId: published.receipt.receiptId,
        requestId: published.receipt.requestId,
        idempotencyKey: published.receipt.idempotencyKey,
        draftId: published.receipt.draftId,
        assetId: published.receipt.assetId,
        assetVersion: published.receipt.assetVersion,
        sourceDigest: published.receipt.sourceDigest,
      }),
    )
  })

  test('enables an exact identity and rejects stale published versions', async () => {
    const definition = deterministicDefinition()
    const published = await publishWorkflowDraft(publishRequest(definition))
    if ('conflict' in published) throw new Error(published.conflict.message)
    const enableRequest = {
      protocolVersion: 1,
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      assetId: published.receipt.assetId,
      assetVersion: published.receipt.assetVersion,
      sourceDigest: published.receipt.sourceDigest,
    }
    const enabled = await enablePublishedWorkflow(enableRequest)
    const replay = await enablePublishedWorkflow(enableRequest)
    if (!('response' in enabled)) throw new Error(enabled.conflict.message)
    if (!('response' in replay)) throw new Error(replay.conflict.message)
    expect(replay.response).toEqual(enabled.response)
    expect(replay.replayed).toBe(true)

    const revised = revisedDefinition(definition, 'A newer published definition.')
    const update = await publishWorkflowDraft(publishRequest(revised, {
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      expectedAssetId: published.receipt.assetId,
      expectedAssetVersion: published.receipt.assetVersion,
    }))
    if ('conflict' in update) throw new Error(update.conflict.message)
    const stale = await invokePublishedWorkflow({
      ...enableRequest,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: 'fixture',
    })
    expect(stale.ok).toBe(false)
    if (!('conflict' in stale)) throw new Error('expected stale conflict')
    expect(stale.conflict).toMatchObject({
      code: 'stale_asset_identity',
      current: {
        assetId: update.receipt.assetId,
        assetVersion: update.receipt.assetVersion,
        sourceDigest: update.receipt.sourceDigest,
      },
    })
  })

  test('invokes, queries, and reconciles a completed published run', async () => {
    const definition = deterministicDefinition()
    const published = await publishWorkflowDraft(publishRequest(definition))
    if ('conflict' in published) throw new Error(published.conflict.message)
    const identity = {
      protocolVersion: 1,
      assetId: published.receipt.assetId,
      assetVersion: published.receipt.assetVersion,
      sourceDigest: published.receipt.sourceDigest,
    }
    const enabled = await enablePublishedWorkflow({
      ...identity,
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
    })
    if (!('response' in enabled)) throw new Error(enabled.conflict.message)
    const invokeRequest = {
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: '  published result  ',
    }
    const invoked = await invokePublishedWorkflow(invokeRequest)
    const replay = await invokePublishedWorkflow(invokeRequest)
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    if (!('response' in replay)) throw new Error(replay.conflict.message)
    expect(replay.response).toEqual(invoked.response)
    expect(replay.replayed).toBe(true)
    expect(invoked.response).toMatchObject({
      surface: 'workflow-run-receipt',
      runState: 'completed',
      run: {
        runId: invoked.response.runId,
        assetId: identity.assetId,
        assetVersion: identity.assetVersion,
        sourceDigest: identity.sourceDigest,
        state: 'completed',
        waits: { approvalNodeIds: [], permissionNodeIds: [] },
        finalResult: { status: 'succeeded', value: 'PUBLISHED RESULT' },
      },
    })
    expect(invoked.response.run.steps).toHaveLength(3)
    expect(
      invoked.response.run.steps.every(
        step => step.state === 'completed' && step.evidence.length >= 2,
      ),
    ).toBe(true)
    expect(invoked.response.run.retryOfRunId).toBeNull()
    expect(invoked.response.run.artifacts).toHaveLength(1)
    expect(invoked.response.run.artifacts[0]).toMatchObject({
      name: 'published-result.json',
      kind: 'workflow-result',
      mediaType: 'application/json',
      producedByNodeId: 'uppercase',
      digest: invoked.response.run.finalResult?.digest,
      sizeBytes: Buffer.byteLength(JSON.stringify('PUBLISHED RESULT')),
    })
    expect(invoked.response.run.artifacts[0]?.artifactId).toMatch(/^wfpa_[a-f0-9]{24}$/)
    expect(invoked.response.run.artifacts[0]?.uri).toBe(
      `mossen-artifact://published-runs/${invoked.response.runId}/${invoked.response.run.artifacts[0]?.artifactId}`,
    )

    const queried = queryPublishedWorkflowRun({
      ...identity,
      requestId: REQUEST_ID,
      runId: invoked.response.runId,
    })
    if (!('response' in queried)) throw new Error(queried.conflict.message)
    expect(queried.response.run).toEqual(invoked.response.run)

    const snapshot = buildWorkbenchWorkflowSnapshot({
      runs: [],
      registryResults: [],
      generatedAt: '2026-07-13T12:00:00.000Z',
    })
    expect(snapshot.publishedRuns.items).toContainEqual(invoked.response.run)
    expect(snapshot.registry.assets.find(item => item.id === identity.assetId)).toMatchObject({
      lifecycle: {
        status: 'published',
        executionStatus: 'enabled',
        enabledVersion: identity.assetVersion,
        enabledSourceDigest: identity.sourceDigest,
      },
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'workflow.asset.runPublished', available: true }),
      ]),
    })
    expect(snapshot.actionReceipts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receiptId: enabled.response.receiptId,
          actionId: 'workflow.asset.enablePublished',
        }),
        expect.objectContaining({
          receiptId: invoked.response.receiptId,
          actionId: 'workflow.asset.runPublished',
          runId: invoked.response.runId,
        }),
      ]),
    )
    const completedRetry = await retryPublishedWorkflowRun({
      ...identity,
      requestId: '88888888-8888-4888-8888-888888888888',
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      runId: invoked.response.runId,
    })
    expect(completedRetry.ok).toBe(false)
    if (!('conflict' in completedRetry)) {
      throw new Error('expected completed run retry rejection')
    }
    expect(completedRetry.conflict.code).toBe('run_not_retryable')
  })

  test('returns an explicit empty artifact array when no node declares an artifact', async () => {
    const definition = deterministicDefinition()
    const uppercase = (definition.nodes as Array<Record<string, unknown>>)[2]!
    uppercase.config = { operation: 'uppercase' }
    const sourceDigest = computeDesktopWorkflowSourceDigest(definition)
    definition.release = {
      localRevision: 1,
      sourceDigest,
      validation: { status: 'not-validated', issues: [] },
    }
    const published = await publishWorkflowDraft(publishRequest(definition))
    if ('conflict' in published) throw new Error(published.conflict.message)
    const identity = {
      protocolVersion: 1 as const,
      assetId: published.receipt.assetId,
      assetVersion: published.receipt.assetVersion,
      sourceDigest: published.receipt.sourceDigest,
    }
    const enabled = await enablePublishedWorkflow({
      ...identity,
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
    })
    if (!('response' in enabled)) throw new Error(enabled.conflict.message)
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'no artifact',
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    expect(invoked.response.artifactIds).toEqual([])
    expect(invoked.response.run.artifacts).toEqual([])

    const queried = queryPublishedWorkflowRun({
      ...identity,
      requestId: REQUEST_ID,
      runId: invoked.response.runId,
    })
    if (!('response' in queried)) throw new Error(queried.conflict.message)
    expect(queried.response.run.artifacts).toEqual([])

    const snapshot = buildWorkbenchWorkflowSnapshot({ runs: [], registryResults: [] })
    expect(
      snapshot.publishedRuns.items.find(run => run.runId === invoked.response.runId)
        ?.artifacts,
    ).toEqual([])

    const legacyRegistry = JSON.parse(
      readFileSync(publishedWorkflowRuntimeRegistryPath(), 'utf8'),
    ) as { runs: Array<Record<string, unknown>> }
    delete legacyRegistry.runs[0]?.artifacts
    delete legacyRegistry.runs[0]?.retryOfRunId
    writeFileSync(
      publishedWorkflowRuntimeRegistryPath(),
      `${JSON.stringify(legacyRegistry)}\n`,
      'utf8',
    )
    expect(loadPublishedWorkflowRuntimeRegistry().runs[0]).toMatchObject({
      artifacts: [],
      retryOfRunId: null,
    })
  })

  test('persists approval and permission waits and cancels a waiting run', async () => {
    const definition = approvalDefinition()
    const published = await publishWorkflowDraft(publishRequest(definition))
    if ('conflict' in published) throw new Error(published.conflict.message)
    const identity = {
      protocolVersion: 1,
      assetId: published.receipt.assetId,
      assetVersion: published.receipt.assetVersion,
      sourceDigest: published.receipt.sourceDigest,
    }
    const enabled = await enablePublishedWorkflow({
      ...identity,
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
    })
    if (!('response' in enabled)) throw new Error(enabled.conflict.message)
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'approval fixture',
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    expect(invoked.response.run).toMatchObject({
      state: 'waiting_approval',
      waits: { approvalNodeIds: ['approve'] },
      finalResult: null,
    })
    expect(invoked.response.run.steps[2]).toMatchObject({
      state: 'waiting_approval',
      approval: { status: 'waiting', message: 'Approve the fixture result.' },
    })
    expect(invoked.response.run.artifacts).toHaveLength(1)

    const cancelled = await cancelPublishedWorkflowRun({
      ...identity,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      runId: invoked.response.runId,
    })
    if (!('response' in cancelled)) throw new Error(cancelled.conflict.message)
    expect(cancelled.response).toMatchObject({
      surface: 'workflow-run-cancel-receipt',
      runId: invoked.response.runId,
      runState: 'cancelled',
      run: { state: 'cancelled', finalResult: { status: 'cancelled' } },
    })
    const originalAfterCancel = structuredClone(cancelled.response.run)
    const retryRequest = {
      ...identity,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      runId: invoked.response.runId,
    }
    const retried = await retryPublishedWorkflowRun(retryRequest)
    const retryReplay = await retryPublishedWorkflowRun(retryRequest)
    if (!('response' in retried)) throw new Error(retried.conflict.message)
    if (!('response' in retryReplay)) throw new Error(retryReplay.conflict.message)
    expect(retryReplay.replayed).toBe(true)
    expect(retryReplay.response).toEqual(retried.response)
    expect(retried.response.runId).not.toBe(invoked.response.runId)
    expect(retried.response.retryOfRunId).toBe(invoked.response.runId)
    expect(retried.response.run.retryOfRunId).toBe(invoked.response.runId)
    expect(retried.response.run.artifacts).toHaveLength(1)
    expect(retried.response.artifactIds).toEqual(
      retried.response.run.artifacts.map(artifact => artifact.artifactId),
    )

    const originalQuery = queryPublishedWorkflowRun({
      ...identity,
      requestId: '55555555-5555-4555-8555-555555555555',
      runId: invoked.response.runId,
    })
    const retryQuery = queryPublishedWorkflowRun({
      ...identity,
      requestId: '66666666-6666-4666-8666-666666666666',
      runId: retried.response.runId,
    })
    if (!('response' in originalQuery)) throw new Error(originalQuery.conflict.message)
    if (!('response' in retryQuery)) throw new Error(retryQuery.conflict.message)
    expect(originalQuery.response.run).toEqual(originalAfterCancel)
    expect(retryQuery.response.run).toEqual(retried.response.run)

    const changedReplay = await retryPublishedWorkflowRun({
      ...retryRequest,
      runId: retried.response.runId,
    })
    expect(changedReplay.ok).toBe(false)
    if (!('conflict' in changedReplay)) throw new Error('expected retry idempotency conflict')
    expect(changedReplay.conflict.code).toBe('idempotency_key_conflict')

    const staleRetry = await retryPublishedWorkflowRun({
      ...retryRequest,
      requestId: '77777777-7777-4777-8777-777777777777',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      assetVersion: '0.0.0',
    })
    expect(staleRetry.ok).toBe(false)
    if (!('conflict' in staleRetry)) throw new Error('expected stale retry conflict')
    expect(staleRetry.conflict.code).toBe('stale_asset_identity')

    const retrySnapshot = buildWorkbenchWorkflowSnapshot({
      runs: [],
      registryResults: [],
    })
    expect(
      retrySnapshot.publishedRuns.items.find(
        run => run.runId === retried.response.runId,
      ),
    ).toEqual(retried.response.run)
    expect(
      retrySnapshot.actionReceipts.items.find(
        receipt => receipt.receiptId === retried.response.receiptId,
      ),
    ).toMatchObject({
      actionId: 'workflow.run.retryPublished',
      runId: retried.response.runId,
      retryOfRunId: invoked.response.runId,
      artifactIds: retried.response.artifactIds,
    })

    const permissionDefinition = businessAssetDefinition(
      'desktop-permission-run',
      'Published permission run',
    )
    const permissionPublish = await publishWorkflowDraft(publishRequest(
      permissionDefinition,
      { requestId: SECOND_REQUEST_ID, idempotencyKey: SECOND_IDEMPOTENCY_KEY },
    ))
    if ('conflict' in permissionPublish) {
      throw new Error(permissionPublish.conflict.message)
    }
    const permissionIdentity = {
      protocolVersion: 1,
      assetId: permissionPublish.receipt.assetId,
      assetVersion: permissionPublish.receipt.assetVersion,
      sourceDigest: permissionPublish.receipt.sourceDigest,
    }
    const permissionEnabled = await enablePublishedWorkflow({
      ...permissionIdentity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
    })
    if (!('response' in permissionEnabled)) {
      throw new Error(permissionEnabled.conflict.message)
    }
    const permissionRun = await invokePublishedWorkflow({
      ...permissionIdentity,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: 'permission fixture',
    })
    if (!('response' in permissionRun)) throw new Error(permissionRun.conflict.message)
    expect(permissionRun.response.run).toMatchObject({
      state: 'waiting_permission',
      waits: { permissionNodeIds: ['step_send'] },
      finalResult: null,
    })
    expect(permissionRun.response.run.steps[1]).toMatchObject({
      state: 'waiting_permission',
      permission: {
        status: 'waiting',
        capability: 'dingtalk.send-message',
      },
    })
  })

  test('freezes an R12 Agent projection, creates repeated waits, and executes the Tool once', async () => {
    const definition = r12AgentDefinition()
    const { identity } = await publishEnableR12(definition)
    const phases: PublishedAgentRuntimeRequest['phase'][] = []
    let toolExecutions = 0
    const toolInput = { command: 'printf r12-tool-once' }
    const toolInputDigest = createHash('sha256')
      .update(JSON.stringify(toolInput))
      .digest('hex')
    setPublishedAgentRuntimeSessionPreparerForTests(async request =>
      fakePreparedAgentSession(request),
    )
    setPublishedAgentRuntimeExecutorForTests(async request => {
      phases.push(request.phase)
      if (!request.session) throw new Error('R12 Agent session was not frozen at invoke.')
      const evidence = {
        runtimeVersion: '1.6.0',
        runtimeBuild: `sha256:${'6'.repeat(64)}`,
        requestedSkillIds: ['daily-report'],
        resolvedSkillIds: ['daily-report'],
        preloadedSkillIds: ['daily-report'],
        failedSkillIds: [],
      }
      if (request.phase === 'start') {
        return {
          status: 'waiting',
          session: {
            ...request.session,
            pendingTool: {
              requestId: 'runtime-control-request-1',
              toolUseId: 'tool-use-1',
              toolId: 'Bash',
              input: toolInput,
              inputDigest: toolInputDigest,
            },
          },
          ...evidence,
          toolExecution: null,
        }
      }
      toolExecutions += 1
      return {
        status: 'completed',
        session: { ...request.session, pendingTool: null },
        ...evidence,
        output: ' R12 AGENT COMPLETE ',
        toolExecution: {
          toolId: 'Bash',
          toolUseId: 'tool-use-1',
          inputDigest: toolInputDigest,
          resultDigest: '8'.repeat(64),
        },
      }
    })

    const invokeRequest = {
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'report source',
      executionProtocolVersion: 1,
      runtimeProjections: [r12Projection()],
    }
    const invoked = await invokePublishedWorkflow(invokeRequest)
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    expect(phases).toEqual([])
    expect(toolExecutions).toBe(0)
    expect(invoked.response.run).toMatchObject({
      revision: 1,
      executionProtocolVersion: 1,
      state: 'waiting_permission',
      runtimeProjections: [
        {
          nodeId: 'step_agent',
          roleBindingId: 'binding_agent',
          grantDigest: '3'.repeat(64),
          catalogDigest: '4'.repeat(64),
          policyDigest: '5'.repeat(64),
          skills: { required: ['daily-report'], resolved: ['daily-report'] },
          tools: {
            inventory: ['Read', 'Bash'],
            allow: ['Read'],
            ask: ['Bash'],
            deny: [],
          },
        },
      ],
      pendingWaits: [
        {
          kind: 'permission',
          scope: 'step_execution',
          nodeId: 'step_agent',
          roleBindingId: 'binding_agent',
          action: { kind: 'step', id: 'step_agent' },
          allowedOutcomes: ['allow_once', 'deny'],
        },
      ],
    })
    const stepWait = invoked.response.run.pendingWaits[0]!
    expect(stepWait.waitId).toMatch(/^wfwait_[a-f0-9]{24}$/)
    expect(stepWait.waitDigest).toMatch(/^[a-f0-9]{64}$/)

    const firstDecisionRequest = decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait: stepWait,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'permission',
      outcome: 'allow_once',
      reason: 'Start this frozen Agent step.',
    })
    const firstDecision = await decidePublishedWorkflowRun(firstDecisionRequest)
    if (!('response' in firstDecision)) throw new Error(firstDecision.conflict.message)
    expect(phases).toEqual(['start'])
    expect(toolExecutions).toBe(0)
    expect(firstDecision.response.run).toMatchObject({
      revision: 2,
      state: 'waiting_permission',
      decisions: [
        {
          waitId: stepWait.waitId,
          outcome: 'allow_once',
          actor: { subjectId: 'local-r12-tester', assurance: 'client_asserted' },
        },
      ],
      executionAttempts: [
        { kind: 'agent_step', status: 'waiting', waitId: stepWait.waitId },
      ],
      pendingWaits: [
        {
          kind: 'permission',
          scope: 'runtime_tool',
          nodeId: 'step_agent',
          action: { kind: 'tool', id: 'Bash' },
        },
      ],
    })
    const toolWait = firstDecision.response.run.pendingWaits[0]!
    expect(toolWait.waitId).not.toBe(stepWait.waitId)
    expect(toolWait.waitDigest).not.toBe(stepWait.waitDigest)
    const firstReplay = await decidePublishedWorkflowRun(firstDecisionRequest)
    if (!('response' in firstReplay)) throw new Error(firstReplay.conflict.message)
    expect(firstReplay.replayed).toBe(true)
    expect(firstReplay.response).toEqual(firstDecision.response)
    expect(phases).toEqual(['start'])

    const changedReplay = await decidePublishedWorkflowRun({
      ...firstDecisionRequest,
      reason: undefined,
      decision: { ...firstDecisionRequest.decision, reason: 'changed request' },
    })
    expect(changedReplay.ok).toBe(false)
    if (!('conflict' in changedReplay)) throw new Error('expected idempotency conflict')
    expect(changedReplay.conflict.code).toBe('idempotency_key_conflict')

    const secondDecisionRequest = decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: firstDecision.response.run.revision,
      wait: toolWait,
      requestId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'permission',
      outcome: 'allow_once',
      reason: 'Run this Bash occurrence once.',
    })
    const completed = await decidePublishedWorkflowRun(secondDecisionRequest)
    if (!('response' in completed)) throw new Error(completed.conflict.message)
    expect(phases).toEqual(['start', 'resume_tool'])
    expect(toolExecutions).toBe(1)
    expect(completed.response.run).toMatchObject({
      revision: 3,
      state: 'completed',
      pendingWaits: [],
      finalResult: { status: 'succeeded', value: 'R12 AGENT COMPLETE' },
      executionAttempts: [
        { kind: 'agent_step', status: 'waiting' },
        {
          kind: 'runtime_tool',
          status: 'completed',
          toolId: 'Bash',
          inputDigest: toolInputDigest,
          resultDigest: '8'.repeat(64),
        },
      ],
    })
    const agentStep = completed.response.run.steps.find(
      step => step.nodeId === 'step_agent',
    )!
    expect(agentStep.runtimeEvidence).toMatchObject({
      runtimeVersion: '1.6.0',
      runtimeBuild: `sha256:${'6'.repeat(64)}`,
      sessionId: '99999999-9999-4999-8999-999999999999',
      requestedSkillIds: ['daily-report'],
      resolvedSkillIds: ['daily-report'],
      preloadedSkillIds: ['daily-report'],
      failedSkillIds: [],
      offeredToolInventory: ['Read', 'Bash'],
      toolAllow: ['Read'],
      toolAsk: ['Bash'],
      toolDeny: [],
      permissionWaitIds: [stepWait.waitId, toolWait.waitId],
    })
    const completedReplay = await decidePublishedWorkflowRun(secondDecisionRequest)
    if (!('response' in completedReplay)) {
      throw new Error(completedReplay.conflict.message)
    }
    expect(completedReplay.response).toEqual(completed.response)
    expect(toolExecutions).toBe(1)

    const queried = queryPublishedWorkflowRun({
      ...identity,
      requestId: '66666666-6666-4666-8666-666666666666',
      runId: invoked.response.runId,
    })
    if (!('response' in queried)) throw new Error(queried.conflict.message)
    expect(queried.response.run).toEqual(completed.response.run)
    expect(loadPublishedWorkflowRuntimeRegistry().runs[0]).toEqual(
      completed.response.run,
    )
    const snapshot = buildWorkbenchWorkflowSnapshot({ runs: [], registryResults: [] })
    expect(
      snapshot.publishedRuns.items.find(run => run.runId === invoked.response.runId),
    ).toEqual(completed.response.run)
    expect(
      snapshot.actionReceipts.items.find(
        receipt => receipt.receiptId === completed.response.receiptId,
      ),
    ).toMatchObject({
      actionId: 'workflow.run.decidePublished',
      runId: invoked.response.runId,
      runRevision: 3,
      waitId: toolWait.waitId,
      decisionId: completed.response.decisionId,
    })
  })

  test('R12 runtime Tool denial records evidence and never executes the Tool', async () => {
    const { identity } = await publishEnableR12(r12AgentDefinition())
    let startCalls = 0
    let resumeCalls = 0
    setPublishedAgentRuntimeSessionPreparerForTests(async request =>
      fakePreparedAgentSession(request),
    )
    setPublishedAgentRuntimeExecutorForTests(async request => {
      if (request.phase === 'resume_tool') {
        resumeCalls += 1
        throw new Error('denied Tool must not resume')
      }
      startCalls += 1
      return {
        status: 'waiting',
        session: {
          ...request.session!,
          pendingTool: {
            requestId: 'deny-control',
            toolUseId: 'deny-tool-use',
            toolId: 'Bash',
            input: { command: 'must-not-run' },
            inputDigest: '7'.repeat(64),
          },
        },
        runtimeVersion: '1.6.0',
        runtimeBuild: `sha256:${'6'.repeat(64)}`,
        requestedSkillIds: ['daily-report'],
        resolvedSkillIds: ['daily-report'],
        preloadedSkillIds: ['daily-report'],
        failedSkillIds: [],
        toolExecution: null,
      }
    })
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'deny fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [r12Projection()],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const first = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait: invoked.response.run.pendingWaits[0]!,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'permission',
      outcome: 'allow_once',
    }))
    if (!('response' in first)) throw new Error(first.conflict.message)
    const denied = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: first.response.run.revision,
      wait: first.response.run.pendingWaits[0]!,
      requestId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'permission',
      outcome: 'deny',
      reason: 'Do not execute this command.',
    }))
    if (!('response' in denied)) throw new Error(denied.conflict.message)
    expect(startCalls).toBe(1)
    expect(resumeCalls).toBe(0)
    expect(denied.response.run).toMatchObject({
      state: 'failed',
      decisions: [
        { outcome: 'allow_once' },
        { outcome: 'deny', reason: 'Do not execute this command.' },
      ],
      executionAttempts: [{ kind: 'agent_step', status: 'waiting' }],
      finalResult: { status: 'failed' },
    })
    expect(denied.response.run.finalResult?.error).toContain('permission_denied')
  })

  test('R12 records independently authorized allow-list Tool execution evidence', async () => {
    const { identity } = await publishEnableR12(r12AgentDefinition())
    const readInput = { file_path: '/isolated/r12-agent-workspace/report.txt' }
    const readInputDigest = createHash('sha256')
      .update(JSON.stringify(readInput))
      .digest('hex')
    setPublishedAgentRuntimeSessionPreparerForTests(async request =>
      fakePreparedAgentSession(request),
    )
    setPublishedAgentRuntimeExecutorForTests(async request => {
      if (!request.session) throw new Error('expected a frozen Agent session')
      return {
        status: 'completed',
        session: { ...request.session, pendingTool: null },
        runtimeVersion: '1.6.0',
        runtimeBuild: `sha256:${'6'.repeat(64)}`,
        requestedSkillIds: ['daily-report'],
        resolvedSkillIds: ['daily-report'],
        preloadedSkillIds: ['daily-report'],
        failedSkillIds: [],
        output: 'ALLOW-LIST TOOL COMPLETE',
        toolExecution: null,
        toolExecutions: [
          {
            toolId: 'Read',
            toolUseId: 'tool-use-read-1',
            inputDigest: readInputDigest,
            resultDigest: '8'.repeat(64),
          },
        ],
      }
    })

    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'allow-list Tool fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [r12Projection()],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const wait = invoked.response.run.pendingWaits[0]!
    const completed = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'permission',
      outcome: 'allow_once',
    }))
    if (!('response' in completed)) throw new Error(completed.conflict.message)
    expect(completed.response.run).toMatchObject({
      state: 'completed',
      executionAttempts: [
        { kind: 'agent_step', status: 'completed' },
        {
          kind: 'runtime_tool',
          status: 'completed',
          toolId: 'Read',
          toolUseId: 'tool-use-read-1',
          inputDigest: readInputDigest,
          resultDigest: '8'.repeat(64),
        },
      ],
      finalResult: { status: 'succeeded', value: 'ALLOW-LIST TOOL COMPLETE' },
    })
  })

  test('R12 human approval resumes on approve and fails on reject', async () => {
    const approvedSetup = await publishEnableR12(approvalDefinition())
    const approvedInvoke = await invokePublishedWorkflow({
      ...approvedSetup.identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'approval fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    if (!('response' in approvedInvoke)) {
      throw new Error(approvedInvoke.conflict.message)
    }
    const approvalWait = approvedInvoke.response.run.pendingWaits[0]!
    expect(approvalWait).toMatchObject({
      kind: 'approval',
      scope: 'human_approval',
      nodeId: 'approve',
      roleBindingId: 'binding_runtime',
      allowedOutcomes: ['approve', 'reject'],
    })
    const approved = await decidePublishedWorkflowRun(decisionRequest({
      identity: approvedSetup.identity,
      runId: approvedInvoke.response.runId,
      revision: approvedInvoke.response.run.revision,
      wait: approvalWait,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'approval',
      outcome: 'approve',
    }))
    if (!('response' in approved)) throw new Error(approved.conflict.message)
    expect(approved.response.run).toMatchObject({
      revision: 2,
      state: 'completed',
      decisions: [{ outcome: 'approve' }],
      finalResult: { status: 'succeeded', value: 'approval fixture' },
    })

    const rejectedDefinition = approvalDefinition()
    rejectedDefinition.id = 'desktop-approval-reject-run'
    rejectedDefinition.name = 'Published approval reject run'
    const rejectedDigest = computeDesktopWorkflowSourceDigest(rejectedDefinition)
    rejectedDefinition.release = {
      localRevision: 1,
      sourceDigest: rejectedDigest,
      validation: { status: 'not-validated', issues: [] },
    }
    const rejectedPublished = await publishWorkflowDraft(publishRequest(
      rejectedDefinition,
      {
        requestId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
    ))
    if ('conflict' in rejectedPublished) {
      throw new Error(rejectedPublished.conflict.message)
    }
    const rejectedIdentity = {
      protocolVersion: 1 as const,
      assetId: rejectedPublished.receipt.assetId,
      assetVersion: rejectedPublished.receipt.assetVersion,
      sourceDigest: rejectedPublished.receipt.sourceDigest,
    }
    const rejectedEnabled = await enablePublishedWorkflow({
      ...rejectedIdentity,
      requestId: '66666666-6666-4666-8666-666666666666',
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
    if (!('response' in rejectedEnabled)) {
      throw new Error(rejectedEnabled.conflict.message)
    }
    const rejectedInvoke = await invokePublishedWorkflow({
      ...rejectedIdentity,
      requestId: '77777777-7777-4777-8777-777777777777',
      idempotencyKey: '12121212-1212-4212-8212-121212121212',
      input: 'reject fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    if (!('response' in rejectedInvoke)) {
      throw new Error(rejectedInvoke.conflict.message)
    }
    const rejected = await decidePublishedWorkflowRun(decisionRequest({
      identity: rejectedIdentity,
      runId: rejectedInvoke.response.runId,
      revision: rejectedInvoke.response.run.revision,
      wait: rejectedInvoke.response.run.pendingWaits[0]!,
      requestId: '13131313-1313-4313-8313-131313131313',
      idempotencyKey: '14141414-1414-4414-8414-141414141414',
      kind: 'approval',
      outcome: 'reject',
      reason: 'Fixture rejected.',
    }))
    if (!('response' in rejected)) throw new Error(rejected.conflict.message)
    expect(rejected.response.run.state).toBe('failed')
    expect(rejected.response.run.finalResult?.error).toContain('approval_rejected')
  })

  test('R12 decisions fail closed on stale identity, wait, node, revision, and idempotency', async () => {
    const { identity } = await publishEnableR12(approvalDefinition())
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'conflict fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const wait = invoked.response.run.pendingWaits[0]!
    const base = decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'approval',
      outcome: 'approve',
    })
    const cases = [
      {
        request: { ...base, expectedRunRevision: 99 },
        code: 'run_revision_conflict',
      },
      {
        request: { ...base, waitId: 'wfwait_missing' },
        code: 'wait_not_found',
      },
      {
        request: { ...base, waitDigest: '0'.repeat(64) },
        code: 'stale_wait',
      },
      {
        request: { ...base, nodeId: 'wrong-node' },
        code: 'stale_wait',
      },
      {
        request: { ...base, assetVersion: '9.9.9' },
        code: 'run_identity_conflict',
      },
      {
        request: { ...base, runId: 'wfpubrun_missing' },
        code: 'run_not_found',
      },
    ] as const
    for (const item of cases) {
      const result = await decidePublishedWorkflowRun({
        ...item.request,
        idempotencyKey: crypto.randomUUID(),
      })
      expect(result.ok).toBe(false)
      if (!('conflict' in result)) throw new Error(`expected ${item.code}`)
      expect(result.conflict.code).toBe(item.code)
    }
    const accepted = await decidePublishedWorkflowRun(base)
    if (!('response' in accepted)) throw new Error(accepted.conflict.message)
    const changed = await decidePublishedWorkflowRun({
      ...base,
      decision: { ...base.decision, reason: 'different fingerprint' },
    })
    expect(changed.ok).toBe(false)
    if (!('conflict' in changed)) throw new Error('expected idempotency conflict')
    expect(changed.conflict.code).toBe('idempotency_key_conflict')
  })

  test('R12 invoke rejects unsupported executors, missing projections, and catalog drift without a run', async () => {
    const agentSetup = await publishEnableR12(r12AgentDefinition())
    const base = {
      ...agentSetup.identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'rejected fixture',
      executionProtocolVersion: 1,
    }
    const missing = await invokePublishedWorkflow({
      ...base,
      runtimeProjections: [],
    })
    expect(missing.ok).toBe(false)
    if (!('conflict' in missing)) throw new Error('expected missing projection conflict')
    expect(missing.conflict.code).toBe('execution_grant_missing')

    const foreign = await invokePublishedWorkflow({
      ...base,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      runtimeProjections: [
        {
          ...r12Projection(),
          runtime: {
            adapterId: 'codex-cli',
            agentRef: 'daily-report-agent',
            modelRef: null,
          },
        },
      ],
    })
    expect(foreign.ok).toBe(false)
    if (!('conflict' in foreign)) throw new Error('expected foreign adapter conflict')
    expect(foreign.conflict.code).toBe('unsupported_executor')

    const badPartition = await invokePublishedWorkflow({
      ...base,
      requestId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      runtimeProjections: [
        {
          ...r12Projection(),
          tools: {
            inventory: ['Read', 'Bash'],
            allow: ['Read'],
            ask: [],
            deny: [],
          },
        },
      ],
    })
    expect(badPartition.ok).toBe(false)
    if (!('conflict' in badPartition)) throw new Error('expected partition conflict')
    expect(badPartition.conflict.code).toBe('execution_grant_conflict')

    setPublishedAgentRuntimeSessionPreparerForTests(async () => {
      throw new Error('Agent catalog changed before invoke.')
    })
    const drift = await invokePublishedWorkflow({
      ...base,
      requestId: '66666666-6666-4666-8666-666666666666',
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      runtimeProjections: [r12Projection()],
    })
    expect(drift.ok).toBe(false)
    if (!('conflict' in drift)) throw new Error('expected catalog drift conflict')
    expect(drift.conflict.code).toBe('runtime_catalog_drift')
    expect(loadPublishedWorkflowRuntimeRegistry().runs).toEqual([])

    const unsupportedDefinition = businessAssetDefinition(
      'desktop-r12-unsupported',
      'R12 unsupported capability run',
    )
    const unsupportedPublished = await publishWorkflowDraft(publishRequest(
      unsupportedDefinition,
      {
        requestId: '71717171-7171-4171-8171-717171717171',
        idempotencyKey: '72727272-7272-4272-8272-727272727272',
      },
    ))
    if ('conflict' in unsupportedPublished) {
      throw new Error(unsupportedPublished.conflict.message)
    }
    const unsupportedIdentity = {
      protocolVersion: 1 as const,
      assetId: unsupportedPublished.receipt.assetId,
      assetVersion: unsupportedPublished.receipt.assetVersion,
      sourceDigest: unsupportedPublished.receipt.sourceDigest,
    }
    const unsupportedEnabled = await enablePublishedWorkflow({
      ...unsupportedIdentity,
      requestId: '73737373-7373-4373-8373-737373737373',
      idempotencyKey: '74747474-7474-4474-8474-747474747474',
    })
    if (!('response' in unsupportedEnabled)) {
      throw new Error(unsupportedEnabled.conflict.message)
    }
    const unsupported = await invokePublishedWorkflow({
      ...unsupportedIdentity,
      requestId: '77777777-7777-4777-8777-777777777777',
      idempotencyKey: '12121212-1212-4212-8212-121212121212',
      input: 'unsupported node fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    expect(unsupported.ok).toBe(false)
    if (!('conflict' in unsupported)) throw new Error('expected unsupported node conflict')
    expect(unsupported.conflict.code).toBe('unsupported_executor')
  })

  test('R12 decision and cancel serialize with one durable winner', async () => {
    const { identity } = await publishEnableR12(approvalDefinition())
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'race fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const revision = invoked.response.run.revision
    const [decision, cancellation] = await Promise.all([
      decidePublishedWorkflowRun(decisionRequest({
        identity,
        runId: invoked.response.runId,
        revision,
        wait: invoked.response.run.pendingWaits[0]!,
        requestId: '44444444-4444-4444-8444-444444444444',
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kind: 'approval',
        outcome: 'approve',
      })),
      cancelPublishedWorkflowRun({
        ...identity,
        requestId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        runId: invoked.response.runId,
        expectedRunRevision: revision,
      }),
    ])
    expect([decision.ok, cancellation.ok].filter(Boolean)).toHaveLength(1)
    const loser = decision.ok ? cancellation : decision
    if (!('conflict' in loser)) throw new Error('race loser must be a conflict')
    expect(['run_revision_conflict', 'run_not_waiting']).toContain(
      loser.conflict.code,
    )
    const stored = loadPublishedWorkflowRuntimeRegistry().runs[0]!
    expect(['completed', 'cancelled']).toContain(stored.state)
    expect(stored.revision).toBe(revision + 1)
  })

  test('R12 uses the frozen asset checkpoint after a later publication update', async () => {
    const definition = approvalDefinition()
    const { identity } = await publishEnableR12(definition)
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'frozen historical fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const revised = revisedDefinition(definition, 'Current publication changed later.')
    const updated = await publishWorkflowDraft(publishRequest(revised, {
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      expectedAssetId: identity.assetId,
      expectedAssetVersion: identity.assetVersion,
    }))
    if ('conflict' in updated) throw new Error(updated.conflict.message)
    expect(updated.receipt.assetVersion).not.toBe(identity.assetVersion)

    const decided = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait: invoked.response.run.pendingWaits[0]!,
      requestId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'approval',
      outcome: 'approve',
    }))
    if (!('response' in decided)) throw new Error(decided.conflict.message)
    expect(decided.response.run).toMatchObject({
      assetVersion: identity.assetVersion,
      sourceDigest: identity.sourceDigest,
      state: 'completed',
      finalResult: { value: 'frozen historical fixture' },
    })
  })

  test('R12 refuses a Tool resume when the private checkpoint input was tampered', async () => {
    const { identity } = await publishEnableR12(r12AgentDefinition())
    const toolInput = { command: 'printf reviewed-command' }
    const toolInputDigest = createHash('sha256')
      .update(JSON.stringify(toolInput))
      .digest('hex')
    let resumeCalls = 0
    setPublishedAgentRuntimeSessionPreparerForTests(async request =>
      fakePreparedAgentSession(request),
    )
    setPublishedAgentRuntimeExecutorForTests(async request => {
      if (!request.session) throw new Error('expected a frozen Agent session')
      if (request.phase === 'resume_tool') {
        resumeCalls += 1
        throw new Error('tampered Tool input must never resume')
      }
      return {
        status: 'waiting',
        session: {
          ...request.session,
          pendingTool: {
            requestId: 'runtime-control-request-tamper',
            toolUseId: 'tool-use-tamper',
            toolId: 'Bash',
            input: toolInput,
            inputDigest: toolInputDigest,
          },
        },
        runtimeVersion: '1.6.0',
        runtimeBuild: `sha256:${'6'.repeat(64)}`,
        requestedSkillIds: ['daily-report'],
        resolvedSkillIds: ['daily-report'],
        preloadedSkillIds: ['daily-report'],
        failedSkillIds: [],
        toolExecution: null,
      }
    })

    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'checkpoint tamper fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [r12Projection()],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const started = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait: invoked.response.run.pendingWaits[0]!,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'permission',
      outcome: 'allow_once',
    }))
    if (!('response' in started)) throw new Error(started.conflict.message)
    const toolWait = started.response.run.pendingWaits[0]!

    const runtimePath = publishedWorkflowRuntimeRegistryPath()
    const durable = JSON.parse(readFileSync(runtimePath, 'utf8')) as {
      checkpoints: Record<
        string,
        {
          agentSessions: Record<
            string,
            { pendingTool: { input: unknown } | null }
          >
        }
      >
    }
    const pending =
      durable.checkpoints[invoked.response.runId]
        ?.agentSessions.step_agent?.pendingTool
    if (!pending) throw new Error('expected a durable Tool checkpoint')
    pending.input = { command: 'printf tampered-command' }
    writeFileSync(runtimePath, `${JSON.stringify(durable, null, 2)}\n`, 'utf8')

    const refused = await decidePublishedWorkflowRun(decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: started.response.run.revision,
      wait: toolWait,
      requestId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'permission',
      outcome: 'allow_once',
    }))
    if (!('response' in refused)) throw new Error(refused.conflict.message)
    expect(resumeCalls).toBe(0)
    expect(refused.response.run).toMatchObject({
      state: 'failed',
      finalResult: { status: 'failed' },
    })
    expect(refused.response.run.finalResult?.error).toContain('resume_failed')
  })

  test('R12 persists an unknown attempt before dispatch and never replays it', async () => {
    const { identity } = await publishEnableR12(r12AgentDefinition())
    setPublishedAgentRuntimeSessionPreparerForTests(async request =>
      fakePreparedAgentSession(request),
    )
    let externalCalls = 0
    let observedWriteAheadStatus: string | null = null
    setPublishedAgentRuntimeExecutorForTests(async () => {
      externalCalls += 1
      const durable = JSON.parse(
        readFileSync(publishedWorkflowRuntimeRegistryPath(), 'utf8'),
      ) as { runs: Array<{ executionAttempts: Array<{ status: string }> }> }
      observedWriteAheadStatus = durable.runs[0]?.executionAttempts[0]?.status ?? null
      throw new Error('simulated transport loss after dispatch')
    })
    const invoked = await invokePublishedWorkflow({
      ...identity,
      requestId: THIRD_REQUEST_ID,
      idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      input: 'crash fixture',
      executionProtocolVersion: 1,
      runtimeProjections: [r12Projection()],
    })
    if (!('response' in invoked)) throw new Error(invoked.conflict.message)
    const request = decisionRequest({
      identity,
      runId: invoked.response.runId,
      revision: invoked.response.run.revision,
      wait: invoked.response.run.pendingWaits[0]!,
      requestId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'permission',
      outcome: 'allow_once',
    })
    const uncertain = await decidePublishedWorkflowRun(request)
    if (!('response' in uncertain)) throw new Error(uncertain.conflict.message)
    expect(observedWriteAheadStatus).toBe('unknown')
    expect(externalCalls).toBe(1)
    expect(uncertain.response.run).toMatchObject({
      state: 'failed',
      executionAttempts: [
        { status: 'unknown', errorCode: 'execution_outcome_unknown' },
      ],
      finalResult: { status: 'failed' },
    })
    expect(uncertain.response.run.finalResult?.error).toContain(
      'execution_outcome_unknown',
    )
    const replay = await decidePublishedWorkflowRun(request)
    if (!('response' in replay)) throw new Error(replay.conflict.message)
    expect(replay.response).toEqual(uncertain.response)
    expect(externalCalls).toBe(1)
  })
})
