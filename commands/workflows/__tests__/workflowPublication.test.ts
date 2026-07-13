import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
  enablePublishedWorkflow,
  invokePublishedWorkflow,
  loadPublishedWorkflowRuntimeRegistry,
  publishedWorkflowRuntimeRegistryPath,
  queryPublishedWorkflowRun,
  retryPublishedWorkflowRun,
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

describe('workflow publication protocol v1', () => {
  let root: string
  let priorHome: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'workflow-publication-'))
    priorHome = process.env.MOSSEN_HOME
    process.env.MOSSEN_HOME = join(root, 'mossen-home')
  })

  afterEach(() => {
    if (priorHome === undefined) delete process.env.MOSSEN_HOME
    else process.env.MOSSEN_HOME = priorHome
    rmSync(root, { recursive: true, force: true })
  })

  test('advertises publication plus typed enable/invoke/retry/query/cancel', () => {
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
        'finalResult',
      ],
      execution: {
        publishedInvocation: { available: true, enableRequired: true },
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
})
