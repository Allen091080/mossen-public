// Goal state is process-local session state, but the transition logic is kept
// outside bootstrap/state.ts so the global state container does not absorb the
// whole goal subsystem.
// eslint-disable-next-line custom-rules/bootstrap-isolation
import { randomUUID } from 'src/utils/crypto.js'

export type MossenGoalState = {
  id: string
  text: string
  successCriteria?: string
  constraints?: string
  recentEvidence: string[]
  negativeEvidence: string[]
  blockerHistory: {
    fingerprint: string
    reason: string
    turnCount: number
    recordedAt: string
  }[]
  nextPlan?: string
  createdAt: string
  updatedAt: string
  evaluatorModel: string
  turnBudget: number
  tokenBudget?: number | null
  maxDurationSec?: number | null
  tokenBaselineInputTokens?: number
  tokenBaselineOutputTokens?: number
  tokenBaselineCacheReadInputTokens?: number
  tokenBaselineCacheCreationInputTokens?: number
  turnCount: number
  tokenEstimate?: number
  lastTurnTokenEstimate?: number
  lastEvaluatorTokenEstimate?: number
  lastEvaluatorReason?: string
  lastEvaluatorAt?: string
  lastEvaluatorStatus?: 'met' | 'not_met' | 'error' | 'max_turns' | 'deferred'
  evaluationFailureCount: number
  clearReason?: string
  status:
    | 'active'
    | 'paused'
    | 'blocked'
    | 'budget_limited'
    | 'cleared'
    | 'completed'
    | 'failed'
}

export type SessionGoalStateContainer = {
  sessionGoal: MossenGoalState | null
  sessionGoalHistory: MossenGoalState[]
}

type SessionGoalStateControllerDeps = {
  getState: () => SessionGoalStateContainer
  getTotalInputTokens: () => number
  getTotalOutputTokens: () => number
  getTotalCacheReadInputTokens: () => number
  getTotalCacheCreationInputTokens: () => number
}

// G5: sharper token estimate. The previous heuristic was a flat chars/4, which
// badly under- or over-counts CJK-heavy text (CJK is roughly one token per
// character, whereas Latin text is ~4 chars/token). Count CJK codepoints at ~1
// token each and the remaining characters at ~4 chars/token. Still an estimate
// (no live tokenizer), but materially closer for mixed Chinese/English goals.
const CJK_RANGE =
  /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/u

export function estimateSessionGoalTokens(text: string): number {
  if (!text) return 1
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (CJK_RANGE.test(ch)) cjk++
    else other++
  }
  const estimate = cjk + Math.ceil(other / 4)
  return Math.max(1, estimate)
}

function normalizeSessionGoalEvidence(evidence?: readonly string[]): string[] {
  if (!evidence?.length) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of evidence) {
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
    if (normalized.length >= 20) break
  }
  return normalized
}

function normalizeSessionGoalBlockerFingerprint(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .slice(0, 12)
    .join(' ')
}

function countConsecutiveBlockerAttempts(
  history: MossenGoalState['blockerHistory'],
  fingerprint: string,
): number {
  const distinctTurns = new Set<number>()
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index]!
    if (item.fingerprint !== fingerprint) break
    distinctTurns.add(item.turnCount)
  }
  return distinctTurns.size
}

function getDefaultSessionGoalTurnBudget(): number {
  const raw = process.env.MOSSEN_CODE_GOAL_MAX_TURNS
  if (!raw) return 20
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(500, Math.max(1, Math.floor(parsed)))
}

function getDefaultSessionGoalEvaluatorModel(): string {
  const raw = process.env.MOSSEN_CODE_GOAL_EVALUATOR?.trim()
  return raw || 'haiku'
}

/** Max terminal goals retained in session history (G4). */
const MAX_SESSION_GOAL_HISTORY = 10

export function createSessionGoalStateController(
  deps: SessionGoalStateControllerDeps,
) {
  const state = deps.getState

  function archiveSessionGoal(goal: MossenGoalState): void {
    const current = state()
    const next = [...current.sessionGoalHistory, goal]
    current.sessionGoalHistory =
      next.length > MAX_SESSION_GOAL_HISTORY
        ? next.slice(next.length - MAX_SESSION_GOAL_HISTORY)
        : next
  }

  function normalizeSessionGoalForState(goal: MossenGoalState): MossenGoalState {
    return {
      ...goal,
      recentEvidence: Array.isArray(goal.recentEvidence)
        ? normalizeSessionGoalEvidence(goal.recentEvidence)
        : [],
      negativeEvidence: Array.isArray(goal.negativeEvidence)
        ? normalizeSessionGoalEvidence(goal.negativeEvidence)
        : [],
      blockerHistory: Array.isArray(goal.blockerHistory)
        ? goal.blockerHistory
            .filter(
              item =>
                item &&
                typeof item === 'object' &&
                typeof item.fingerprint === 'string' &&
                typeof item.reason === 'string' &&
                typeof item.turnCount === 'number' &&
                typeof item.recordedAt === 'string',
            )
            .slice(-10)
        : [],
    }
  }

  function getSessionGoalActualTokenUsage(
    goal: MossenGoalState | null = state().sessionGoal,
  ): number | null {
    if (!goal) return null
    if (
      goal.tokenBaselineInputTokens === undefined ||
      goal.tokenBaselineOutputTokens === undefined ||
      goal.tokenBaselineCacheReadInputTokens === undefined ||
      goal.tokenBaselineCacheCreationInputTokens === undefined
    ) {
      return null
    }
    const total =
      Math.max(0, deps.getTotalInputTokens() - goal.tokenBaselineInputTokens) +
      Math.max(0, deps.getTotalOutputTokens() - goal.tokenBaselineOutputTokens) +
      Math.max(
        0,
        deps.getTotalCacheReadInputTokens() -
          goal.tokenBaselineCacheReadInputTokens,
      ) +
      Math.max(
        0,
        deps.getTotalCacheCreationInputTokens() -
          goal.tokenBaselineCacheCreationInputTokens,
      )
    return total
  }

  function getSessionGoalHistory(): readonly MossenGoalState[] {
    return state().sessionGoalHistory
  }

  function getSessionGoalState(): MossenGoalState | null {
    return state().sessionGoal
  }

  function replaceSessionGoalStateForRestore(
    goal: MossenGoalState | null,
    history?: readonly MossenGoalState[],
  ): void {
    const current = state()
    current.sessionGoal = goal ? normalizeSessionGoalForState(goal) : null
    if (history) {
      current.sessionGoalHistory = history
        .slice(-MAX_SESSION_GOAL_HISTORY)
        .map(normalizeSessionGoalForState)
    }
  }

  function setSessionGoalState(
    text: string,
    successCriteria?: string,
    options?: Partial<
      Pick<
        MossenGoalState,
        | 'id'
        | 'createdAt'
        | 'evaluatorModel'
        | 'turnBudget'
        | 'tokenBudget'
        | 'maxDurationSec'
        | 'tokenBaselineInputTokens'
        | 'tokenBaselineOutputTokens'
        | 'tokenBaselineCacheReadInputTokens'
        | 'tokenBaselineCacheCreationInputTokens'
        | 'turnCount'
        | 'tokenEstimate'
        | 'constraints'
        | 'recentEvidence'
        | 'negativeEvidence'
        | 'blockerHistory'
        | 'nextPlan'
      >
    >,
  ): MossenGoalState {
    const now = new Date().toISOString()
    const current = state()
    const goal: MossenGoalState = {
      id:
        options?.id ??
        `goal_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      text,
      ...(successCriteria ? { successCriteria } : {}),
      ...(options?.constraints ? { constraints: options.constraints } : {}),
      recentEvidence: options?.recentEvidence ?? [],
      negativeEvidence: options?.negativeEvidence ?? [],
      blockerHistory: options?.blockerHistory ?? [],
      ...(options?.nextPlan ? { nextPlan: options.nextPlan } : {}),
      createdAt: options?.createdAt ?? now,
      updatedAt: now,
      ...(options?.tokenBudget !== undefined
        ? { tokenBudget: options.tokenBudget }
        : {}),
      ...(options?.maxDurationSec !== undefined
        ? { maxDurationSec: options.maxDurationSec }
        : {}),
      tokenBaselineInputTokens:
        options?.tokenBaselineInputTokens ?? deps.getTotalInputTokens(),
      tokenBaselineOutputTokens:
        options?.tokenBaselineOutputTokens ?? deps.getTotalOutputTokens(),
      tokenBaselineCacheReadInputTokens:
        options?.tokenBaselineCacheReadInputTokens ??
        deps.getTotalCacheReadInputTokens(),
      tokenBaselineCacheCreationInputTokens:
        options?.tokenBaselineCacheCreationInputTokens ??
        deps.getTotalCacheCreationInputTokens(),
      turnCount: options?.turnCount ?? 0,
      evaluatorModel:
        options?.evaluatorModel ?? getDefaultSessionGoalEvaluatorModel(),
      turnBudget: options?.turnBudget ?? getDefaultSessionGoalTurnBudget(),
      tokenEstimate: options?.tokenEstimate ?? estimateSessionGoalTokens(
        successCriteria ? `${text}\n${successCriteria}` : text,
      ),
      evaluationFailureCount: 0,
      status: 'active',
    }
    const previous = current.sessionGoal
    if (
      previous &&
      (previous.status === 'active' ||
        previous.status === 'paused' ||
        previous.status === 'blocked' ||
        previous.status === 'budget_limited')
    ) {
      archiveSessionGoal({
        ...previous,
        updatedAt: now,
        clearReason: 'replaced',
        status: 'cleared',
      })
    }
    current.sessionGoal = goal
    return goal
  }

  function clearSessionGoalState(reason = 'user_cancel'): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal) return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      clearReason: reason,
      status: 'cleared',
    }
    archiveSessionGoal(current.sessionGoal)
    return current.sessionGoal
  }

  function recordSessionGoalNegativeEvidence(
    evidence: string | readonly string[],
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    const additions = normalizeSessionGoalEvidence(
      Array.isArray(evidence) ? evidence : [evidence],
    )
    if (additions.length === 0) return current.sessionGoal
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      negativeEvidence: normalizeSessionGoalEvidence([
        ...current.sessionGoal.negativeEvidence,
        ...additions,
      ]),
    }
    return current.sessionGoal
  }

  function recordSessionGoalEvidence(
    evidence: string | readonly string[],
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    const additions = normalizeSessionGoalEvidence(
      Array.isArray(evidence) ? evidence : [evidence],
    )
    if (additions.length === 0) return current.sessionGoal
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      recentEvidence: normalizeSessionGoalEvidence([
        ...current.sessionGoal.recentEvidence,
        ...additions,
      ]),
    }
    return current.sessionGoal
  }

  function recordSessionGoalBlockerAttempt(reason: string): {
    goal: MossenGoalState | null
    fingerprint: string
    repeatCount: number
  } {
    const current = state()
    const fingerprint = normalizeSessionGoalBlockerFingerprint(reason)
    if (
      !current.sessionGoal ||
      current.sessionGoal.status !== 'active' ||
      !fingerprint
    ) {
      return { goal: current.sessionGoal, fingerprint, repeatCount: 0 }
    }
    const now = new Date().toISOString()
    const last =
      current.sessionGoal.blockerHistory[
        current.sessionGoal.blockerHistory.length - 1
      ]
    const nextHistory =
      last?.fingerprint === fingerprint &&
      last.turnCount === current.sessionGoal.turnCount
        ? current.sessionGoal.blockerHistory
        : [
            ...current.sessionGoal.blockerHistory,
            {
              fingerprint,
              reason,
              turnCount: current.sessionGoal.turnCount,
              recordedAt: now,
            },
          ].slice(-10)
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: now,
      blockerHistory: nextHistory,
      lastEvaluatorReason: reason,
    }
    return {
      goal: current.sessionGoal,
      fingerprint,
      repeatCount: countConsecutiveBlockerAttempts(nextHistory, fingerprint),
    }
  }

  function completeSessionGoalState(
    reason?: string,
    options?: {
      evidence?: readonly string[]
      nextPlan?: string
    },
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    const evidence = normalizeSessionGoalEvidence(options?.evidence)
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      ...(reason ? { lastEvaluatorReason: reason } : {}),
      ...(reason
        ? {
            lastEvaluatorAt: new Date().toISOString(),
            lastEvaluatorStatus: 'met' as const,
          }
        : {}),
      ...(evidence.length ? { recentEvidence: evidence } : {}),
      ...(options?.nextPlan ? { nextPlan: options.nextPlan } : {}),
      status: 'completed',
    }
    archiveSessionGoal(current.sessionGoal)
    return current.sessionGoal
  }

  function pauseSessionGoalState(
    reason: string,
    options?: { evaluatorError?: boolean },
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      ...(options?.evaluatorError
        ? {
            lastEvaluatorAt: new Date().toISOString(),
            lastEvaluatorStatus: 'error' as const,
          }
        : {}),
      lastEvaluatorReason: reason,
      evaluationFailureCount: options?.evaluatorError
        ? current.sessionGoal.evaluationFailureCount + 1
        : current.sessionGoal.evaluationFailureCount,
      status: 'paused',
    }
    return current.sessionGoal
  }

  function failSessionGoalState(reason: string): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      lastEvaluatorAt: new Date().toISOString(),
      lastEvaluatorReason: reason,
      lastEvaluatorStatus: 'error',
      clearReason: reason,
      status: 'failed',
    }
    archiveSessionGoal(current.sessionGoal)
    return current.sessionGoal
  }

  function blockSessionGoalState(
    reason: string,
    options?: {
      evidence?: readonly string[]
      nextPlan?: string
    },
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    const evidence = normalizeSessionGoalEvidence(options?.evidence)
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      lastEvaluatorAt: new Date().toISOString(),
      lastEvaluatorReason: reason,
      ...(evidence.length ? { recentEvidence: evidence } : {}),
      ...(options?.nextPlan ? { nextPlan: options.nextPlan } : {}),
      status: 'blocked',
    }
    return current.sessionGoal
  }

  function budgetLimitSessionGoalState(reason: string): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      lastEvaluatorAt: new Date().toISOString(),
      lastEvaluatorReason: reason,
      lastEvaluatorStatus: 'max_turns',
      clearReason: reason,
      status: 'budget_limited',
    }
    archiveSessionGoal(current.sessionGoal)
    return current.sessionGoal
  }

  function resumeSessionGoalState(): MossenGoalState | null {
    const current = state()
    if (
      !current.sessionGoal ||
      (current.sessionGoal.status !== 'paused' &&
        current.sessionGoal.status !== 'blocked' &&
        current.sessionGoal.status !== 'budget_limited')
    ) return null
    const previousStatus = current.sessionGoal.status
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      blockerHistory:
        previousStatus === 'blocked' ? [] : current.sessionGoal.blockerHistory,
      status: 'active',
    }
    return current.sessionGoal
  }

  function editSessionGoalState(options: {
    text?: string
    successCriteria?: string | null
    constraints?: string | null
    nextPlan?: string | null
  }): MossenGoalState | null {
    const current = state()
    if (
      !current.sessionGoal ||
      (current.sessionGoal.status !== 'active' &&
        current.sessionGoal.status !== 'paused' &&
        current.sessionGoal.status !== 'blocked' &&
        current.sessionGoal.status !== 'budget_limited')
    ) return null
    const text = options.text?.trim()
    const successCriteria = options.successCriteria
    const constraints = options.constraints
    const nextPlan = options.nextPlan
    current.sessionGoal = {
      ...current.sessionGoal,
      ...(text ? { text } : {}),
      ...(successCriteria === undefined
        ? {}
        : successCriteria
          ? { successCriteria }
          : { successCriteria: undefined }),
      ...(constraints === undefined
        ? {}
        : constraints
          ? { constraints }
          : { constraints: undefined }),
      ...(nextPlan === undefined
        ? {}
        : nextPlan
          ? { nextPlan }
          : { nextPlan: undefined }),
      updatedAt: new Date().toISOString(),
      tokenEstimate: estimateSessionGoalTokens(
        [
          text || current.sessionGoal.text,
          successCriteria === undefined
            ? current.sessionGoal.successCriteria
            : successCriteria || undefined,
        ].filter((part): part is string => !!part).join('\n'),
      ),
    }
    return current.sessionGoal
  }

  function updateSessionGoalBudgets(options: {
    turnBudget?: number
    tokenBudget?: number | null
    maxDurationSec?: number | null
    resumeIfBudgetLimited?: boolean
  }): MossenGoalState | null {
    const current = state()
    if (
      !current.sessionGoal ||
      (current.sessionGoal.status !== 'active' &&
        current.sessionGoal.status !== 'paused' &&
        current.sessionGoal.status !== 'blocked' &&
        current.sessionGoal.status !== 'budget_limited')
    ) return null
    const shouldResume =
      options.resumeIfBudgetLimited === true &&
      current.sessionGoal.status === 'budget_limited'
    current.sessionGoal = {
      ...current.sessionGoal,
      ...(options.turnBudget !== undefined
        ? { turnBudget: options.turnBudget }
        : {}),
      ...(options.tokenBudget !== undefined
        ? { tokenBudget: options.tokenBudget }
        : {}),
      ...(options.maxDurationSec !== undefined
        ? { maxDurationSec: options.maxDurationSec }
        : {}),
      ...(shouldResume ? { status: 'active' as const, clearReason: undefined } : {}),
      updatedAt: new Date().toISOString(),
      lastEvaluatorReason: shouldResume
        ? 'budget_updated'
        : current.sessionGoal.lastEvaluatorReason,
    }
    return current.sessionGoal
  }

  function recordSessionGoalEvaluation(
    status: NonNullable<MossenGoalState['lastEvaluatorStatus']>,
    reason: string,
    options?: {
      turnCount?: number
      tokenEstimate?: number
      lastTurnTokenEstimate?: number
      lastEvaluatorTokenEstimate?: number
      incrementFailureCount?: boolean
    },
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      lastEvaluatorAt: new Date().toISOString(),
      lastEvaluatorStatus: status,
      lastEvaluatorReason: reason,
      ...(options?.turnCount !== undefined
        ? { turnCount: options.turnCount }
        : {}),
      ...(options?.tokenEstimate !== undefined
        ? { tokenEstimate: options.tokenEstimate }
        : {}),
      ...(options?.lastTurnTokenEstimate !== undefined
        ? { lastTurnTokenEstimate: options.lastTurnTokenEstimate }
        : {}),
      ...(options?.lastEvaluatorTokenEstimate !== undefined
        ? { lastEvaluatorTokenEstimate: options.lastEvaluatorTokenEstimate }
        : {}),
      evaluationFailureCount:
        status === 'error' || options?.incrementFailureCount
          ? current.sessionGoal.evaluationFailureCount + 1
          : 0,
    }
    return current.sessionGoal
  }

  function deferSessionGoalEvaluation(
    reason: string,
    options?: {
      tokenEstimate?: number
      lastTurnTokenEstimate?: number
    },
  ): MossenGoalState | null {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return null
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      lastEvaluatorAt: new Date().toISOString(),
      lastEvaluatorStatus: 'deferred',
      lastEvaluatorReason: reason,
      ...(options?.tokenEstimate !== undefined
        ? { tokenEstimate: options.tokenEstimate }
        : {}),
      ...(options?.lastTurnTokenEstimate !== undefined
        ? { lastTurnTokenEstimate: options.lastTurnTokenEstimate }
        : {}),
    }
    return current.sessionGoal
  }

  function incrementSessionGoalTurnCount(): void {
    const current = state()
    if (!current.sessionGoal || current.sessionGoal.status !== 'active') return
    current.sessionGoal = {
      ...current.sessionGoal,
      updatedAt: new Date().toISOString(),
      turnCount: current.sessionGoal.turnCount + 1,
    }
  }

  return {
    getSessionGoalActualTokenUsage,
    getSessionGoalHistory,
    getSessionGoalState,
    replaceSessionGoalStateForRestore,
    setSessionGoalState,
    clearSessionGoalState,
    recordSessionGoalEvidence,
    recordSessionGoalNegativeEvidence,
    recordSessionGoalBlockerAttempt,
    completeSessionGoalState,
    pauseSessionGoalState,
    failSessionGoalState,
    blockSessionGoalState,
    budgetLimitSessionGoalState,
    resumeSessionGoalState,
    editSessionGoalState,
    updateSessionGoalBudgets,
    recordSessionGoalEvaluation,
    deferSessionGoalEvaluation,
    incrementSessionGoalTurnCount,
  }
}
