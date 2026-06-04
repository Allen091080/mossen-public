import type { Observation, ObservationType } from '../schema/observation.js'

export type RefineRuleObservationOptions = {
  maxPerEvidence?: number
}

const DEFAULT_MAX_PER_EVIDENCE = 2

const TYPE_PRIORITY: Record<ObservationType, number> = {
  safety_rule: 100,
  team_policy: 96,
  preference: 92,
  decision: 88,
  workflow_pattern: 84,
  coding_convention: 80,
  tool_preference: 76,
  blocker: 72,
  skill_candidate: 68,
  instruction_candidate: 64,
  project_state: 60,
  handoff: 58,
  open_thread: 56,
  bugfix: 48,
  feature: 44,
  fact: 40,
}

export function refineRuleObservationCandidates(
  observations: Observation[],
  options: RefineRuleObservationOptions = {},
): Observation[] {
  const maxPerEvidence = options.maxPerEvidence ?? DEFAULT_MAX_PER_EVIDENCE
  const byEvidence = new Map<string, Observation[]>()

  for (const observation of observations) {
    if (!passesPrecisionGate(observation)) continue
    const key = observation.evidenceEventIds.slice().sort().join('\u001f')
    const existing = byEvidence.get(key) ?? []
    existing.push(observation)
    byEvidence.set(key, existing)
  }

  const refined: Observation[] = []
  for (const candidates of byEvidence.values()) {
    refined.push(...selectBestCandidates(candidates, maxPerEvidence))
  }

  return refined
}

function passesPrecisionGate(observation: Observation): boolean {
  const text = observation.summary.toLowerCase()

  if (observation.type === 'project_state') {
    return /当前状态|状态[:：]|已经完成|已完成|已实现|未实现|deferred|完成报告/i.test(text)
  }

  if (observation.type === 'team_policy') {
    return /团队约定|team scope|teams 模式|团队可读|协作/i.test(text)
  }

  if (observation.type === 'skill_candidate') {
    return /生成 skill|候选 skill|skill 候选|skill_candidate|反复要求|常用流程/i.test(text)
  }

  if (observation.type === 'workflow_pattern') {
    return (
      /流程|步骤|小步快跑|一次性完成|workflow/i.test(text) &&
      !/我以后|默认希望|希望回复|先给结论/i.test(text)
    )
  }

  if (observation.type === 'coding_convention') {
    return (
      /代码风格|命名|目录结构|不要重复造轮子|复用|coding convention|lint|typecheck|smoke|schema|api|接口/i.test(text) &&
      !/分类为|检索策略|长期偏好|架构约束/i.test(text)
    )
  }

  return true
}

function selectBestCandidates(
  candidates: Observation[],
  maxPerEvidence: number,
): Observation[] {
  const selected: Observation[] = []
  const usedDomains = new Set<string>()
  const sorted = [...candidates].sort(compareObservationCandidate)

  for (const candidate of sorted) {
    if (selected.length >= maxPerEvidence) break
    if (usedDomains.has(candidate.domain) && !isHighPriority(candidate.type)) continue
    selected.push(markRefined(candidate))
    usedDomains.add(candidate.domain)
  }

  if (!selected.length && sorted[0]) {
    selected.push(markRefined(sorted[0]))
  }

  return selected
}

function compareObservationCandidate(left: Observation, right: Observation): number {
  const priority = priorityFor(right) - priorityFor(left)
  if (priority !== 0) return priority

  const confidence = right.confidence - left.confidence
  if (confidence !== 0) return confidence

  return left.observationId.localeCompare(right.observationId)
}

function priorityFor(observation: Observation): number {
  return TYPE_PRIORITY[observation.type] ?? 0
}

function isHighPriority(type: ObservationType): boolean {
  return type === 'safety_rule' || type === 'team_policy' || type === 'preference'
}

function markRefined(observation: Observation): Observation {
  return {
    ...observation,
    confidence: Math.min(1, Number((observation.confidence + 0.04).toFixed(2))),
    tags: [...new Set([...observation.tags, 'rule:refined'])],
  }
}
