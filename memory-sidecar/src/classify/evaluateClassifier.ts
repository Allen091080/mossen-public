import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type {
  Observation,
  ObservationRetrievalPolicy,
  ObservationType,
} from '../schema/observation.js'
import type { MemoryScope } from '../schema/scope.js'
import { classifyArchiveEventsWithRules } from './ruleClassifier.js'
import { refineRuleObservationCandidates } from './refineObservations.js'

export type ExpectedObservation = {
  eventId: string
  type: ObservationType
  scope: MemoryScope
  retrievalPolicy?: ObservationRetrievalPolicy
}

export type ClassifierEvalCase = {
  id: string
  description: string
  event: ArchiveEvent
  defaultScope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  expected: ExpectedObservation[]
  forbidden?: ExpectedObservation[]
}

export type ClassifierEvaluationMetrics = {
  precision: number
  recall: number
  scopeAccuracy: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  scopeCorrect: number
  scopeChecked: number
}

export type ClassifierEvaluationResult = {
  cases: ClassifierEvalCase[]
  observations: Observation[]
  metrics: ClassifierEvaluationMetrics
  failures: string[]
}

const PROJECT_ID = 'classifier-eval-project'
const SESSION_ID = 'classifier-eval-session'
const NOW = '2026-05-04T04:00:00.000Z'

export const CLASSIFIER_EVAL_CASES: ClassifierEvalCase[] = [
  {
    id: 'safety_rule_not_project_state',
    description: 'safety rules must not be classified as project_state',
    event: makeEvent(
      'eval-safety-rule',
      'user',
      '不能触碰真实用户记忆数据；扩大记忆范围前先确认。',
    ),
    expected: [{ eventId: 'eval-safety-rule', type: 'safety_rule', scope: 'project' }],
    forbidden: [{ eventId: 'eval-safety-rule', type: 'project_state', scope: 'project' }],
  },
  {
    id: 'team_policy_scope_team',
    description: 'team policy observations must keep team scope',
    event: makeEvent(
      'eval-team-policy',
      'user',
      '团队约定：team scope 未来只在 teams 模式启用时开放，团队可读策略保持 team。',
    ),
    expected: [{ eventId: 'eval-team-policy', type: 'team_policy', scope: 'team' }],
  },
  {
    id: 'user_long_term_preference_scope_user',
    description: 'user long-term preferences must stay user-scoped',
    event: makeEvent(
      'eval-user-preference',
      'user',
      '我以后默认希望回复先给结论，再给必要步骤。',
      'user',
    ),
    defaultScope: 'user',
    expected: [{ eventId: 'eval-user-preference', type: 'preference', scope: 'user' }],
  },
  {
    id: 'session_preference_scope_session',
    description: 'session-only preferences must stay session-scoped',
    event: makeEvent(
      'eval-session-preference',
      'user',
      '本次会话记住：只讨论分类评测，不展开无关实现。',
      'session',
    ),
    defaultScope: 'session',
    expected: [{ eventId: 'eval-session-preference', type: 'preference', scope: 'session' }],
    forbidden: [{ eventId: 'eval-session-preference', type: 'preference', scope: 'project' }],
  },
  {
    id: 'project_preference_scope_project',
    description: 'project preferences must stay project-scoped',
    event: makeEvent(
      'eval-project-preference',
      'user',
      '本项目默认采用离线 smoke 验证 memory-sidecar 分类质量。',
      'project',
    ),
    defaultScope: 'project',
    expected: [{ eventId: 'eval-project-preference', type: 'preference', scope: 'project' }],
  },
  {
    id: 'skill_candidate_candidate_only',
    description: 'skill candidates must remain candidate_only retrieval policy',
    event: makeEvent(
      'eval-skill-candidate',
      'assistant',
      '反复要求生成 skill：把固定 fixture 评测做成候选 skill，后续再人工确认。',
    ),
    expected: [
      {
        eventId: 'eval-skill-candidate',
        type: 'skill_candidate',
        scope: 'project',
        retrievalPolicy: 'candidate_only',
      },
    ],
    forbidden: [{ eventId: 'eval-skill-candidate', type: 'tool_preference', scope: 'project' }],
  },
  {
    id: 'current_status_project_state',
    description: 'explicit current status must produce project_state',
    event: makeEvent(
      'eval-current-status',
      'assistant',
      '当前状态：评测 smoke 已完成。',
    ),
    expected: [{ eventId: 'eval-current-status', type: 'project_state', scope: 'project' }],
  },
  {
    id: 'plain_stage_not_project_state',
    description: 'plain phase descriptions must not become project_state',
    event: makeEvent(
      'eval-plain-stage',
      'assistant',
      '第一阶段包含存储、分类、scope、profile 和 archive 这些普通模块描述。',
    ),
    expected: [],
    forbidden: [{ eventId: 'eval-plain-stage', type: 'project_state', scope: 'project' }],
  },
  {
    id: 'ordinary_explanation_no_observation',
    description: 'ordinary classifier explanations should not be memorized',
    event: makeEvent(
      'eval-ordinary-explanation',
      'assistant',
      '这句话只是解释分类器会如何看待文本，不代表用户偏好、团队策略或项目事实。',
    ),
    expected: [],
    forbidden: [
      { eventId: 'eval-ordinary-explanation', type: 'preference', scope: 'project' },
      { eventId: 'eval-ordinary-explanation', type: 'team_policy', scope: 'team' },
      { eventId: 'eval-ordinary-explanation', type: 'project_state', scope: 'project' },
      { eventId: 'eval-ordinary-explanation', type: 'decision', scope: 'project' },
    ],
  },
  {
    id: 'classification_meta_not_coding_convention',
    description: 'classification meta explanations must not become coding conventions',
    event: makeEvent(
      'eval-classification-meta',
      'assistant',
      '收到。这会被分类为 memory/product/safety 相关的长期偏好和架构约束，检索策略应以 hint 或 search_only 为主。',
    ),
    expected: [],
    forbidden: [
      { eventId: 'eval-classification-meta', type: 'coding_convention', scope: 'project' },
      { eventId: 'eval-classification-meta', type: 'decision', scope: 'project' },
      { eventId: 'eval-classification-meta', type: 'preference', scope: 'user' },
    ],
  },
  {
    id: 'completion_report_handoff_project',
    description: 'completion reports should preserve project handoff state',
    event: makeEvent(
      'eval-completion-report',
      'assistant',
      '完成报告：W93-D 分类评测已完成；下一步等待 reviewer 确认。',
    ),
    expected: [
      { eventId: 'eval-completion-report', type: 'project_state', scope: 'project' },
      { eventId: 'eval-completion-report', type: 'handoff', scope: 'project' },
    ],
  },
]

export function evaluateRuleRefinerClassifier(
  cases: ClassifierEvalCase[] = CLASSIFIER_EVAL_CASES,
): ClassifierEvaluationResult {
  const observations = refineRuleObservationCandidates(
    cases.flatMap(testCase =>
      classifyArchiveEventsWithRules([testCase.event], {
        defaultScope: testCase.defaultScope ?? 'project',
        now: () => NOW,
      }),
    ),
  )
  const metrics = calculateMetrics(cases, observations)
  const failures = collectFailures(cases, observations, metrics)

  return {
    cases,
    observations,
    metrics,
    failures,
  }
}

export function assertClassifierEvaluation(): ClassifierEvaluationResult {
  const result = evaluateRuleRefinerClassifier()
  if (result.failures.length > 0) {
    throw new Error(`classifier evaluation failed:\n${result.failures.join('\n')}`)
  }
  return result
}

function calculateMetrics(
  cases: ClassifierEvalCase[],
  observations: Observation[],
): ClassifierEvaluationMetrics {
  const expected = cases.flatMap(testCase => testCase.expected)
  const expectedKeys = new Set(expected.map(matchKey))
  const predictedKeys = new Set(observations.map(observationMatchKey))

  let truePositives = 0
  for (const key of predictedKeys) {
    if (expectedKeys.has(key)) truePositives += 1
  }

  const falsePositives = predictedKeys.size - truePositives
  const falseNegatives = expectedKeys.size - truePositives
  const precision = predictedKeys.size === 0 ? 1 : truePositives / predictedKeys.size
  const recall = expectedKeys.size === 0 ? 1 : truePositives / expectedKeys.size

  let scopeCorrect = 0
  let scopeChecked = 0
  for (const expectedObservation of expected) {
    const matchingObservation = observations.find(
      observation => observationMatchKey(observation) === matchKey(expectedObservation),
    )
    if (!matchingObservation) continue
    scopeChecked += 1
    if (
      matchingObservation.scope === expectedObservation.scope &&
      (expectedObservation.retrievalPolicy === undefined ||
        matchingObservation.retrievalPolicy === expectedObservation.retrievalPolicy)
    ) {
      scopeCorrect += 1
    }
  }

  return {
    precision,
    recall,
    scopeAccuracy: scopeChecked === 0 ? 1 : scopeCorrect / scopeChecked,
    truePositives,
    falsePositives,
    falseNegatives,
    scopeCorrect,
    scopeChecked,
  }
}

function collectFailures(
  cases: ClassifierEvalCase[],
  observations: Observation[],
  metrics: ClassifierEvaluationMetrics,
): string[] {
  const failures: string[] = []
  const predictedForbiddenKeys = new Set(observations.map(observationForbiddenMatchKey))

  for (const testCase of cases) {
    for (const expectedObservation of testCase.expected) {
      const observation = observations.find(
        candidate => observationMatchKey(candidate) === matchKey(expectedObservation),
      )
      if (!observation) {
        failures.push(`${testCase.id}: missing ${describeExpected(expectedObservation)}`)
        continue
      }
      if (observation.scope !== expectedObservation.scope) {
        failures.push(
          `${testCase.id}: expected ${expectedObservation.type} scope ${expectedObservation.scope}, got ${observation.scope}`,
        )
      }
      if (
        expectedObservation.retrievalPolicy !== undefined &&
        observation.retrievalPolicy !== expectedObservation.retrievalPolicy
      ) {
        failures.push(
          `${testCase.id}: expected ${expectedObservation.type} retrievalPolicy ${expectedObservation.retrievalPolicy}, got ${observation.retrievalPolicy}`,
        )
      }
    }

    for (const forbiddenObservation of testCase.forbidden ?? []) {
      if (predictedForbiddenKeys.has(forbiddenMatchKey(forbiddenObservation))) {
        failures.push(`${testCase.id}: forbidden ${describeExpected(forbiddenObservation)}`)
      }
    }
  }

  if (metrics.precision !== 1) {
    failures.push(`precision expected 1, got ${formatMetric(metrics.precision)}`)
  }
  if (metrics.recall !== 1) {
    failures.push(`recall expected 1, got ${formatMetric(metrics.recall)}`)
  }
  if (metrics.scopeAccuracy !== 1) {
    failures.push(`scope accuracy expected 1, got ${formatMetric(metrics.scopeAccuracy)}`)
  }

  return failures
}

function matchKey(expected: ExpectedObservation): string {
  return `${expected.eventId}:${expected.type}`
}

function observationMatchKey(observation: Observation): string {
  return `${observation.evidenceEventIds[0] ?? ''}:${observation.type}`
}

function observationForbiddenMatchKey(observation: Observation): string {
  return `${observation.evidenceEventIds[0] ?? ''}:${observation.type}:${observation.scope}`
}

function forbiddenMatchKey(expected: ExpectedObservation): string {
  return `${expected.eventId}:${expected.type}:${expected.scope}`
}

function describeExpected(expected: ExpectedObservation): string {
  const retrievalPolicy = expected.retrievalPolicy
    ? ` retrievalPolicy=${expected.retrievalPolicy}`
    : ''
  return `${expected.type} scope=${expected.scope}${retrievalPolicy} on ${expected.eventId}`
}

function formatMetric(value: number): string {
  return value.toFixed(3)
}

function makeEvent(
  eventId: string,
  role: ArchiveEvent['role'],
  text: string,
  scope: MemoryScope = 'project',
): ArchiveEvent {
  return {
    schemaVersion: 1,
    eventId,
    source: 'classifier-eval-fixture',
    sourceEventId: eventId,
    scope,
    visibility: visibilityForScope(scope),
    owner: {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    },
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    role,
    kind: 'message',
    text,
    textHash: `hash-${eventId}`,
    createdAt: NOW,
    redaction: { applied: false, version: 1 },
  }
}

function visibilityForScope(scope: MemoryScope): ArchiveEvent['visibility'] {
  if (scope === 'team') return 'team'
  if (scope === 'workspace') return 'workspace'
  if (scope === 'project') return 'project'
  return 'private'
}
