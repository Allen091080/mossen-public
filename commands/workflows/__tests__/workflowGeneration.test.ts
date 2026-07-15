import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  generateWorkflowDraft,
  MAX_WORKFLOW_GENERATION_MODEL_REPAIR_ATTEMPTS,
  workflowGenerationModelOutputSchema,
  workflowGenerationProtocolDescriptor,
  type WorkflowGenerationModel,
} from '../generationProtocol.js'
import { workflowGenerationCachePath } from '../generationCache.js'
import { workflowPublicationRegistryPath } from '../publicationRegistry.js'
import { publishedWorkflowRuntimeRegistryPath } from '../publishedRunProtocol.js'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_IDEMPOTENCY_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CATALOG_DIGEST = 'c'.repeat(64)
const FIXED_DATE = new Date('2026-07-15T08:00:00.000Z')

function generationRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    surface: 'workflow-generation-request',
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    locale: 'zh-CN',
    clarificationRound: 0,
    previousInputDigest: null,
    brief: {
      description: '汇总日报，生成周报草稿，由运营负责人批准，不发送消息。',
      titleHint: '销售日报汇总',
      expectedOutcome: '一份经过批准的周报草稿',
      constraints: ['不发送群消息', '不执行生产写操作'],
      answers: [],
    },
    target: {
      draftSchema: 'mossen-desktop-workflow-business-asset/v2',
      allowedNodeTypes: [
        'trigger-manual',
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
      ],
    },
    catalog: {
      version: 1,
      digest: CATALOG_DIGEST,
      roleTemplates: [
        {
          id: 'role-approver',
          version: 2,
          snapshotDigest: 'd'.repeat(64),
          name: '运营批准人',
          description: '批准业务结果',
          facetTypes: [],
          executorKinds: ['human'],
          facets: [],
        },
      ],
      skills: [
        {
          id: 'skill-daily-report',
          name: '日报整理',
          description: '整理日报内容',
        },
      ],
      capabilities: [
        {
          id: 'sales.read-daily-report',
          providerId: 'sales-provider',
          title: '读取日报',
          sideEffect: 'read',
          inputSchema: {
            type: 'object',
            properties: { reportId: { type: 'string' } },
            required: ['reportId'],
          },
        },
      ],
      connectors: [{ providerId: 'sales-provider', status: 'ready' }],
      permissionPolicies: [],
      tools: [{ id: 'Read', title: 'Read', sideEffect: 'read' }],
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
    ...overrides,
  }
}

function clarificationModelResult(): Record<string, unknown> {
  return {
    status: 'needs_clarification',
    questions: [
      {
        id: 'approval-owner',
        path: 'team.approver',
        prompt: '谁负责最终批准周报草稿？',
        reason: '批准角色会改变流程关口。',
        required: true,
        answerType: 'single-choice',
        options: [{ id: 'operations-owner', label: '运营负责人' }],
      },
    ],
    assumptions: [],
    warnings: [],
  }
}

function proposalModelResult(
  capabilityId = 'sales.read-daily-report',
): Record<string, unknown> {
  return {
    status: 'proposed',
    proposal: {
      name: '销售日报汇总',
      description: '读取日报、整理周报草稿并由运营负责人批准。',
      goalStatement: '生成经过批准的销售周报草稿。',
      expectedOutcome: '一份经过批准且未发送的周报草稿。',
      successCriteria: ['日报已汇总', '运营负责人已批准', '未发送外部消息'],
      roles: [
        {
          key: 'analyst',
          name: '日报分析员',
          description: '读取日报并整理草稿',
          executorKind: 'mossen-agent',
          responsibilities: ['汇总日报', '整理周报草稿'],
          requiredInputs: ['销售日报'],
          expectedOutputs: ['周报草稿'],
          skillIds: ['skill-daily-report'],
          capabilityIds: [capabilityId],
          toolIds: ['Read'],
          systemInstruction: '只整理输入内容，不执行外部写入。',
        },
        {
          key: 'approver',
          templateRoleId: 'role-approver',
          name: '模型不得覆盖这个名称',
          description: '模型不得覆盖这个描述',
          executorKind: 'human',
          responsibilities: ['批准周报草稿'],
          requiredInputs: ['周报草稿'],
          expectedOutputs: ['批准结果'],
          skillIds: [],
          capabilityIds: [],
          toolIds: [],
        },
      ],
      steps: [
        {
          key: 'read',
          type: 'capability-action',
          title: '读取销售日报',
          expectedOutcome: '获得日报内容',
          executorRoleKey: 'analyst',
          ownerRoleKey: 'analyst',
          reviewerRoleKeys: [],
          approverRoleKeys: [],
          capabilityId,
        },
        {
          key: 'draft',
          type: 'mossen-call',
          title: '整理周报草稿',
          expectedOutcome: '形成周报草稿',
          executorRoleKey: 'analyst',
          ownerRoleKey: 'analyst',
          reviewerRoleKeys: [],
          approverRoleKeys: [],
          prompt: '根据输入整理周报草稿，不发送。',
        },
        {
          key: 'approve',
          type: 'human-approval',
          title: '批准周报草稿',
          expectedOutcome: '记录批准结果',
          executorRoleKey: 'approver',
          ownerRoleKey: 'approver',
          reviewerRoleKeys: [],
          approverRoleKeys: ['approver'],
          message: '请批准周报草稿。',
        },
      ],
      assumptions: [
        {
          id: 'draft-is-final-output',
          path: 'goal.successCriteria[0]',
          statement: '生成草稿即完成自动处理阶段。',
          confidence: 'medium',
          requiresConfirmation: true,
          sourceRefs: ['brief.description'],
        },
      ],
      warnings: [],
    },
  }
}

describe('workflow generation protocol', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mossen-workflow-generation-'))
    process.env.MOSSEN_HOME = home
  })

  afterEach(() => {
    delete process.env.MOSSEN_HOME
    rmSync(home, { recursive: true, force: true })
  })

  test('advertises the frozen side-effect-free descriptor', () => {
    expect(workflowGenerationProtocolDescriptor()).toEqual({
      version: 1,
      surface: 'workflow-generation-protocol',
      transport: 'stdin-json/stdout-json',
      input: 'workflow-generation-request/v1',
      output: 'workflow-generation-result/v1',
      draftSchema: 'mossen-desktop-workflow-business-asset/v2',
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
        timeoutMs: 180000,
        maxModelOutputRepairAttempts: 1,
      },
      requiredResultEvidence: [
        'requestId',
        'inputDigest',
        'catalogDigest',
        'mossenVersion',
      ],
    })
  })

  test('defines one strict root-object model schema and one repair attempt', () => {
    const schema = workflowGenerationModelOutputSchema()
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'questions',
        'assumptions',
        'warnings',
        'proposal',
        'code',
        'reason',
      ],
    })
    expect(
      (schema.properties as Record<string, unknown>).status,
    ).toEqual({ enum: ['needs_clarification', 'proposed', 'rejected'] })
    const questions = (schema.properties as Record<string, unknown>)
      .questions as Record<string, unknown>
    const questionItems = questions.items as Record<string, unknown>
    expect(
      (questionItems.properties as Record<string, unknown>).path,
    ).toEqual({ type: 'string', minLength: 1 })
    expect(MAX_WORKFLOW_GENERATION_MODEL_REPAIR_ATTEMPTS).toBe(1)
  })

  test('returns typed clarification and exact replay without a second model call', async () => {
    let calls = 0
    const model: WorkflowGenerationModel = async () => {
      calls += 1
      return clarificationModelResult()
    }
    const first = await generateWorkflowDraft(generationRequest(), {
      model,
      now: () => FIXED_DATE,
    })
    const replay = await generateWorkflowDraft(generationRequest(), {
      model,
      now: () => new Date('2026-07-15T09:00:00.000Z'),
    })
    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    if (!first.ok || !replay.ok) return
    expect(first.result.status).toBe('needs_clarification')
    expect(first.result).toEqual(replay.result)
    expect(replay.replayed).toBe(true)
    expect(calls).toBe(1)
  })

  test('materializes a grounded Business Asset v2 after clarification', async () => {
    const first = await generateWorkflowDraft(generationRequest(), {
      model: async () => clarificationModelResult(),
      now: () => FIXED_DATE,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const nextRequest = generationRequest({
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      clarificationRound: 1,
      previousInputDigest: first.result.inputDigest,
      brief: {
        description: '汇总日报，生成周报草稿，由运营负责人批准，不发送消息。',
        titleHint: '销售日报汇总',
        expectedOutcome: '一份经过批准的周报草稿',
        constraints: ['不发送群消息', '不执行生产写操作'],
        answers: [
          {
            questionId: 'approval-owner',
            value: '由运营负责人批准',
            selectedOptionIds: ['operations-owner'],
          },
        ],
      },
    })
    const outcome = await generateWorkflowDraft(nextRequest, {
      model: async () => proposalModelResult(),
      now: () => FIXED_DATE,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok || outcome.result.status !== 'proposed') return
    const result = outcome.result
    const draft = result.draft as {
      schemaVersion: number
      enabled: boolean
      release: {
        validation: { status: string; issues: unknown[] }
        publication?: unknown
      }
      pendingPublication?: unknown
      nodes: Array<{
        type: string
        assignment: { executorRoleBindingId?: string }
      }>
      team: { bindings: Array<Record<string, unknown>> }
      dependencies: {
        skills: Array<{ skillId: string }>
        capabilities: Array<{ capabilityId: string; providerId?: string }>
        connectors: Array<{ providerId: string }>
      }
    }
    expect(result.draftSchema).toBe('mossen-desktop-workflow-business-asset/v2')
    expect(result.catalogDigest).toBe(CATALOG_DIGEST)
    expect(draft.schemaVersion).toBe(2)
    expect(draft.enabled).toBe(false)
    expect(draft.release.validation).toEqual({ status: 'not-validated', issues: [] })
    expect(draft.release.publication).toBeUndefined()
    expect(draft.pendingPublication).toBeUndefined()
    expect(draft.nodes[0].type).toBe('trigger-manual')
    expect(draft.nodes[0].assignment.executorRoleBindingId).toBeUndefined()
    expect(
      draft.nodes
        .slice(1)
        .every(node => Boolean(node.assignment.executorRoleBindingId)),
    ).toBe(true)
    expect(draft.team.bindings[1]).toMatchObject({
      templateRoleId: 'role-approver',
      templateVersion: 2,
      snapshotDigest: 'd'.repeat(64),
      nameSnapshot: '运营批准人',
      descriptionSnapshot: '批准业务结果',
      executor: { kind: 'human' },
    })
    expect(draft.dependencies.skills[0].skillId).toBe('skill-daily-report')
    expect(draft.dependencies.capabilities[0]).toMatchObject({
      capabilityId: 'sales.read-daily-report',
      providerId: 'sales-provider',
    })
    expect(draft.dependencies.connectors[0].providerId).toBe('sales-provider')
    expect(result.unresolvedBindings.some(item => item.kind === 'human-executor')).toBe(true)
    expect(result.unresolvedBindings.some(item => item.kind === 'service-target')).toBe(true)
    expect(result.unresolvedBindings.some(item => item.kind === 'business-subject')).toBe(true)
    expect(result.provenance.some(item => item.source === 'catalog')).toBe(true)
    expect(existsSync(workflowGenerationCachePath())).toBe(true)
    expect(existsSync(workflowPublicationRegistryPath())).toBe(false)
    expect(existsSync(publishedWorkflowRuntimeRegistryPath())).toBe(false)
  })

  test('rejects unknown catalog references without emitting a draft', async () => {
    const outcome = await generateWorkflowDraft(generationRequest(), {
      model: async () => proposalModelResult('unknown.capability'),
      now: () => FIXED_DATE,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result).toMatchObject({
      status: 'rejected',
      code: 'insufficient-grounding',
    })
    expect('draft' in outcome.result).toBe(false)
  })

  test('returns typed nonzero operation conflicts for changed idempotent input', async () => {
    await generateWorkflowDraft(generationRequest(), {
      model: async () => clarificationModelResult(),
      now: () => FIXED_DATE,
    })
    const changed = generationRequest({
      brief: {
        description: '不同的业务目标',
        constraints: [],
        answers: [],
      },
    })
    const outcome = await generateWorkflowDraft(changed, {
      model: async () => clarificationModelResult(),
      now: () => FIXED_DATE,
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'idempotency-conflict' },
    })
  })

  test('rejects a mismatched clarification context before model invocation', async () => {
    let called = false
    const request = generationRequest({
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      clarificationRound: 1,
      previousInputDigest: 'e'.repeat(64),
      brief: {
        description: '汇总日报，生成周报草稿，由运营负责人批准，不发送消息。',
        titleHint: '销售日报汇总',
        expectedOutcome: '一份经过批准的周报草稿',
        constraints: ['不发送群消息', '不执行生产写操作'],
        answers: [
          {
            questionId: 'approval-owner',
            value: '运营负责人',
            selectedOptionIds: ['operations-owner'],
          },
        ],
      },
    })
    const outcome = await generateWorkflowDraft(request, {
      model: async () => {
        called = true
        return proposalModelResult()
      },
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'clarification-context-conflict' },
    })
    expect(called).toBe(false)
  })

  test('rejects clarification answers that do not answer the prior question', async () => {
    const first = await generateWorkflowDraft(generationRequest(), {
      model: async () => clarificationModelResult(),
      now: () => FIXED_DATE,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const request = generationRequest({
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      clarificationRound: 1,
      previousInputDigest: first.result.inputDigest,
      brief: {
        description: '汇总日报，生成周报草稿，由运营负责人批准，不发送消息。',
        titleHint: '销售日报汇总',
        expectedOutcome: '一份经过批准的周报草稿',
        constraints: ['不发送群消息', '不执行生产写操作'],
        answers: [
          {
            questionId: 'different-question',
            value: '运营负责人',
            selectedOptionIds: ['operations-owner'],
          },
        ],
      },
    })
    const outcome = await generateWorkflowDraft(request, {
      model: async () => proposalModelResult(),
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'clarification-context-conflict' },
    })
  })

  test('returns legal policy rejection for an unsafe generation policy', async () => {
    const request = generationRequest()
    ;(request.safety as Record<string, unknown>).allowExternalWrites = true
    let called = false
    const outcome = await generateWorkflowDraft(request, {
      model: async () => {
        called = true
        return proposalModelResult()
      },
      now: () => FIXED_DATE,
    })
    const replay = await generateWorkflowDraft(request, {
      model: async () => {
        called = true
        return proposalModelResult()
      },
      now: () => new Date('2026-07-15T09:00:00.000Z'),
    })
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'rejected', code: 'policy-blocked' },
    })
    expect(replay).toMatchObject({ ok: true, replayed: true })
    if (outcome.ok && replay.ok) expect(replay.result).toEqual(outcome.result)
    expect(called).toBe(false)
  })

  test('does not send credential-shaped brief values to the model', async () => {
    const request = generationRequest({
      brief: {
        description: 'Use authorization: Bearer abcdefghijklmnop',
        constraints: [],
        answers: [],
      },
    })
    let called = false
    const outcome = await generateWorkflowDraft(request, {
      model: async () => {
        called = true
        return proposalModelResult()
      },
      now: () => FIXED_DATE,
    })
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'rejected', code: 'unsafe-request' },
    })
    expect(called).toBe(false)
  })

  test('returns model-output-schema-invalid for malformed model JSON shape', async () => {
    const outcome = await generateWorkflowDraft(generationRequest(), {
      model: async () => ({ status: 'proposed', proposal: {} }),
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'model-output-schema-invalid' },
    })
  })

  test('rejects model evidence paths that do not locate the draft', async () => {
    const modelResult = proposalModelResult()
    const proposal = modelResult.proposal as Record<string, unknown>
    proposal.assumptions = [
      {
        id: 'bad-path',
        path: 'release.publication.assetId',
        statement: 'This lifecycle claim must not survive.',
        confidence: 'high',
        requiresConfirmation: true,
        sourceRefs: ['brief.description'],
      },
    ]
    const outcome = await generateWorkflowDraft(generationRequest(), {
      model: async () => modelResult,
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'model-output-schema-invalid' },
    })
  })

  test('rejects model claims that the proposal is already published', async () => {
    const modelResult = proposalModelResult()
    const proposal = modelResult.proposal as Record<string, unknown>
    proposal.description = 'This workflow is already published.'
    const outcome = await generateWorkflowDraft(generationRequest(), {
      model: async () => modelResult,
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'model-output-schema-invalid' },
    })
  })

  test('aborts bounded model work with generation-timeout', async () => {
    const outcome = await generateWorkflowDraft(generationRequest(), {
      timeoutMs: 5,
      model: async (_request, signal) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'generation-timeout' },
    })
  })

  test('returns clarification-limit-reached at round three', async () => {
    const request = generationRequest({
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      clarificationRound: 3,
      previousInputDigest: 'e'.repeat(64),
      brief: {
        description: '汇总日报。',
        constraints: [],
        answers: [
          { questionId: 'q1', value: 'a', selectedOptionIds: [] },
        ],
      },
    })
    const outcome = await generateWorkflowDraft(request, {
      model: async () => clarificationModelResult(),
      now: () => FIXED_DATE,
    })
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        status: 'rejected',
        code: 'clarification-limit-reached',
      },
    })
  })

  test('rejects malformed requests before touching any state', async () => {
    const outcome = await generateWorkflowDraft({ version: 1 })
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    expect(existsSync(workflowGenerationCachePath())).toBe(false)
    expect(existsSync(workflowPublicationRegistryPath())).toBe(false)
    expect(existsSync(publishedWorkflowRuntimeRegistryPath())).toBe(false)
  })
})
