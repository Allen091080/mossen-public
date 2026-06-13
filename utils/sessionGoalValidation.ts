import type { MossenGoalState } from '../bootstrap/state.js'

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'into',
  'from',
  'have',
  'has',
  'must',
  'should',
  'need',
  'needs',
])

function normalizeToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

const NEGATIVE_PATTERNS = [
  /\bInputValidationError\b/i,
  /\bInvalid tool parameters\b/i,
  /工具参数无效/,
  /<tool_use_error>/i,
  /\btool execution failed\b/i,
  /\btool .* failed\b/i,
  /\bvalidation failed\b/i,
]

const RESOLUTION_PATTERNS = [
  /\b(fixed|resolved|addressed|reran|re-ran|passed|succeeded|verified)\b/i,
  /\b(no longer|not reproducible)\b/i,
  /已(修复|解决|通过|验证)/,
  /重新.{0,12}(运行|执行).{0,12}(成功|通过)/,
  /不再.{0,12}(失败|报错|无效)/,
]

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeEvidenceText(text: string): string[] {
  const normalized = normalizeText(text)
  const latin = normalized
    .match(/[a-z0-9][a-z0-9_-]{2,}/g)
    ?.map(normalizeToken)
    .filter(token => !STOP_WORDS.has(token)) ?? []
  const cjk = normalized.match(/[\u4e00-\u9fff]/gu) ?? []
  return [...new Set([...latin, ...cjk])]
}

export function splitSessionGoalSuccessCriteria(criteria?: string): string[] {
  if (!criteria?.trim()) return []
  const rawParts = criteria
    .split(/\n|[;；]/)
    .map(part =>
      part
        .replace(/^\s*(?:[-*•]|\d+[.)]|[（(]?\d+[）)])\s*/, '')
        .trim(),
    )
    .filter(Boolean)
  return [...new Set(rawParts)].slice(0, 20)
}

function evidenceCoversCriterion(criterion: string, evidence: readonly string[]): boolean {
  const normalizedCriterion = normalizeText(criterion)
  if (!normalizedCriterion) return true
  const normalizedEvidence = evidence.map(normalizeText).filter(Boolean)
  if (
    normalizedEvidence.some(
      item =>
        item.includes(normalizedCriterion) ||
        (normalizedCriterion.length > 12 && normalizedCriterion.includes(item)),
    )
  ) return true

  const criterionTokens = tokenizeEvidenceText(criterion)
  if (criterionTokens.length === 0) return false
  const requiredOverlap = criterionTokens.length <= 3
    ? 1
    : Math.ceil(criterionTokens.length * 0.5)
  return normalizedEvidence.some(item => {
    const evidenceTokens = new Set(tokenizeEvidenceText(item))
    let overlap = 0
    for (const token of criterionTokens) {
      if (evidenceTokens.has(token)) overlap++
    }
    return overlap >= requiredOverlap
  })
}

export function hasSessionGoalNegativeSignal(text: string): boolean {
  return NEGATIVE_PATTERNS.some(pattern => pattern.test(text))
}

function evidenceResolvesNegativeEvidence(
  negative: string,
  evidence: readonly string[],
): boolean {
  const negativeTokens = new Set(tokenizeEvidenceText(negative))
  return evidence.some(item => {
    if (!RESOLUTION_PATTERNS.some(pattern => pattern.test(item))) return false
    const evidenceTokens = new Set(tokenizeEvidenceText(item))
    if (negativeTokens.size === 0) return true
    let overlap = 0
    for (const token of negativeTokens) {
      if (evidenceTokens.has(token)) overlap++
    }
    return overlap > 0 || /\b(tool|error|validation|parameter)\b/i.test(item) || /工具|参数|错误|失败/.test(item)
  })
}

export function validateSessionGoalCompletionEvidence(
  goal: Pick<MossenGoalState, 'successCriteria' | 'negativeEvidence'>,
  evidence: readonly string[],
): {
  ok: boolean
  missingCriteria: string[]
  unresolvedNegativeEvidence: string[]
} {
  const missingCriteria = splitSessionGoalSuccessCriteria(goal.successCriteria)
    .filter(criterion => !evidenceCoversCriterion(criterion, evidence))
  const evidenceHasNegativeSignal = evidence.filter(hasSessionGoalNegativeSignal)
  const unresolvedNegativeEvidence = [
    ...goal.negativeEvidence,
    ...evidenceHasNegativeSignal,
  ].filter(negative => !evidenceResolvesNegativeEvidence(negative, evidence))
  return {
    ok: missingCriteria.length === 0 && unresolvedNegativeEvidence.length === 0,
    missingCriteria,
    unresolvedNegativeEvidence,
  }
}
