import type { ArchiveEvent } from '../schema/archiveEvent'
import type { Observation, ObservationType } from '../schema/observation'
import {
  defaultObservationDomain,
  defaultObservationKind,
  defaultObservationLifecycle,
  defaultObservationRetrievalPolicy,
} from '../schema/observation'
import type { MemoryScope } from '../schema/scope'
import { visibilityForScope } from '../index'
import { entityTagsFromText } from './entityExtractor.js'

export type RuleClassifierOptions = {
  defaultScope?: Extract<MemoryScope, 'session' | 'project' | 'user' | 'team'>
  now?: () => string
}

type RuleDefinition = {
  type: ObservationType
  keywords: RegExp[]
  scope: (event: ArchiveEvent, text: string, defaultScope: MemoryScope) => MemoryScope
  confidence: number
  tags: string[]
}

const RULES: RuleDefinition[] = [
  {
    type: 'preference',
    keywords: [/记住/u, /以后/u, /默认/u, /不要/u, /必须/u, /我喜欢/u, /我的要求/u, /红线/u],
    scope: (_event, text, defaultScope) => {
      if (/我以后|我的|我喜欢|我的要求|用户长期|长期偏好/u.test(text)) return 'user'
      return inferScope(text, defaultScope)
    },
    confidence: 0.68,
    tags: ['rule:preference'],
  },
  {
    type: 'workflow_pattern',
    keywords: [/流程/u, /步骤/u, /先.*再.*(?:执行|验证|提交|落地)/u, /小步快跑/u, /一次性完成/u, /\bworkflow\b/iu],
    scope: () => 'project',
    confidence: 0.7,
    tags: ['rule:workflow'],
  },
  {
    type: 'coding_convention',
    keywords: [/代码风格/u, /命名规范/u, /目录结构/u, /不要重复造轮子/u, /复用/u],
    scope: () => 'project',
    confidence: 0.7,
    tags: ['rule:coding-convention'],
  },
  {
    type: 'safety_rule',
    keywords: [/红线/u, /不能/u, /不要 push tags/u, /不要 push GitHub/u, /不能触碰/u, /必须先确认/u],
    scope: (_event, text) => (/团队|team/u.test(text) ? 'team' : 'project'),
    confidence: 0.78,
    tags: ['rule:safety'],
  },
  {
    type: 'tool_preference',
    keywords: [/用 .* 测试/u, /playwright/u, /mcp/u, /plugin/u, /github/u, /命令/u],
    scope: () => 'project',
    confidence: 0.66,
    tags: ['rule:tool-preference'],
  },
  {
    type: 'project_state',
    keywords: [/当前状态/u, /状态[:：]/u, /已经完成/u, /已完成/u, /已实现/u, /未实现/u, /deferred/u, /完成报告/u],
    scope: () => 'project',
    confidence: 0.64,
    tags: ['rule:project-state'],
  },
  {
    type: 'open_thread',
    keywords: [/下一步/u, /后续[:：]/u, /待办/u, /还要/u, /继续/u, /暂缓/u],
    scope: () => 'project',
    confidence: 0.64,
    tags: ['rule:open-thread'],
  },
  {
    type: 'skill_candidate',
    keywords: [/生成 skill/u, /候选 skill/u, /skill 候选/u, /反复要求/u, /常用流程/u],
    scope: () => 'project',
    confidence: 0.74,
    tags: ['rule:skill-candidate'],
  },
  {
    type: 'team_policy',
    keywords: [/团队约定/u, /teams 模式/u, /team scope/u, /团队可读/u, /协作/u],
    scope: () => 'team',
    confidence: 0.76,
    tags: ['rule:team-policy'],
  },
  {
    type: 'decision',
    keywords: [
      /决定/u,
      /采用/u,
      /方案/u,
      /结论/u,
      /拍板/u,
      /以后按这个/u,
      /\bdecision\b/iu,
      /\badopt(?:ed|s)?\b/iu,
      /\bkeeps?\b.+\bindependent\b/iu,
      /\bsidecar\b/iu,
    ],
    scope: () => 'project',
    confidence: 0.72,
    tags: ['rule:decision'],
  },
  {
    type: 'bugfix',
    keywords: [/修复/u, /失败原因/u, /测试通过/u, /回归/u, /root cause/iu],
    scope: () => 'project',
    confidence: 0.7,
    tags: ['rule:bugfix'],
  },
  {
    type: 'handoff',
    keywords: [/完成报告/u, /下一步/u, /等待确认/u, /未 push/iu, /deferred/iu],
    scope: () => 'project',
    confidence: 0.62,
    tags: ['rule:handoff'],
  },
  {
    type: 'blocker',
    keywords: [/\bSTOP\b/u, /blocked/iu, /等待拍板/u, /不能继续/u, /需要确认/u],
    scope: (_event, _text, defaultScope) => defaultScope === 'session' ? 'project' : defaultScope,
    confidence: 0.74,
    tags: ['rule:blocker'],
  },
]

function inferScope(text: string, defaultScope: MemoryScope): MemoryScope {
  if (/团队|我们团队|team scope|团队可读|teams 模式/u.test(text)) return 'team'
  if (/本次会话|当前会话|这个 session|session scope/u.test(text)) return 'session'
  if (/我以后|我的|我喜欢|我的要求|用户长期|长期偏好|user scope/u.test(text)) return 'user'
  if (/本项目|当前项目|project scope/u.test(text)) return 'project'
  if (defaultScope === 'workspace') return 'project'
  return defaultScope
}

export function classifyArchiveEventsWithRules(
  events: ArchiveEvent[],
  options: RuleClassifierOptions = {},
): Observation[] {
  const now = options.now ?? (() => new Date().toISOString())
  const defaultScope = options.defaultScope ?? 'project'
  const observations: Observation[] = []
  const seen = new Set<string>()

  for (const event of events) {
    const text = event.text.trim()
    if (!text || event.role === 'system') continue

    for (const rule of RULES) {
      if (!rule.keywords.some(pattern => pattern.test(text))) continue

      const scope = rule.scope(event, text, defaultScope)
      const dedupeKey = `${event.eventId}:${rule.type}:${scope}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      // W143-A: extract entity / file / path / version / command tokens
      // and merge them into tags as namespaced entries (e.g.
      // `entity:rust-analyzer`, `file:mac.rs`,
      // `path:app/src/app_services/mac.rs`,
      // `version:1.92.0-aarch64-apple-darwin`, `command:cargo run`).
      // Doing this at observation creation time means recall scoring
      // (which already evaluates `${title}\n${summary}\n${tags.join(' ')}`)
      // gains exact-substring matching on real entities for free.
      // Backwards compatible: tags is already string[]; old observations
      // are unaffected.
      const entityTags = entityTagsFromText(text)
      const mergedTags = [...rule.tags, ...entityTags]

      observations.push({
        schemaVersion: 1,
        observationId: makeObservationId(event.eventId, rule.type, scope),
        scope,
        visibility: visibilityForScope(scope),
        projectId: event.projectId,
        sessionId: event.sessionId,
        type: rule.type,
        kind: defaultObservationKind(rule.type),
        domain: defaultObservationDomain(rule.type, mergedTags),
        lifecycle: defaultObservationLifecycle(rule.type),
        retrievalPolicy: defaultObservationRetrievalPolicy(rule.type),
        title: makeTitle(rule.type, text),
        summary: summarize(text),
        evidenceIds: [event.eventId],
        evidenceEventIds: [event.eventId],
        files: extractFileHints(text),
        tags: mergedTags,
        confidence: rule.confidence,
        source: 'rule',
        promotionStatus: 'candidate',
        createdAt: now(),
      })
    }
  }

  return observations
}

function makeObservationId(eventId: string, type: ObservationType, scope: MemoryScope): string {
  const raw = `${eventId}:${type}:${scope}`
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(index)
  }
  return `obs_rule_${Math.abs(hash).toString(36)}`
}

function makeTitle(type: ObservationType, text: string): string {
  const label = {
    blocker: 'Blocker',
    bugfix: 'Bugfix',
    coding_convention: 'Coding convention',
    decision: 'Decision',
    fact: 'Fact',
    feature: 'Feature',
    handoff: 'Handoff',
    instruction_candidate: 'Instruction',
    open_thread: 'Open thread',
    preference: 'Preference',
    project_state: 'Project state',
    safety_rule: 'Safety rule',
    skill_candidate: 'Skill candidate',
    team_policy: 'Team policy',
    tool_preference: 'Tool preference',
    workflow_pattern: 'Workflow pattern',
  }[type]

  return `${label}: ${summarize(text, 80)}`
}

function summarize(text: string, maxLength = 220): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 3)}...`
}

function extractFileHints(text: string): string[] {
  const matches = text.match(/(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|css|scss|sql|yaml|yml))/g)
  if (!matches) return []

  return [...new Set(matches.map(match => match.trim()))].slice(0, 10)
}
