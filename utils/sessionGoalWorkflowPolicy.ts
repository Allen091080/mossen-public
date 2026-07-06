import type { MossenGoalState } from '../bootstrap/state.js'
import {
  buildLoopLivenessReport,
  type LoopWorkItem,
} from './loopLiveness.js'

const MAX_WORKFLOW_TASK_CHARS = 3_000

export type SessionGoalWorkflowPolicyVerdict =
  | {
      type: 'launch_workflow'
      reason: string
      task: string
      signals: string[]
    }
  | {
      type: 'wait_for_workflow'
      reason: string
      works: LoopWorkItem[]
    }
  | {
      type: 'continue'
      reason: string
      signals: string[]
    }

function compact(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

function goalText(goal: MossenGoalState): string {
  return [
    goal.text,
    goal.successCriteria,
    goal.constraints,
  ].filter((part): part is string => Boolean(part?.trim())).join('\n')
}

function hasWorkflowEvidence(goal: MossenGoalState): boolean {
  return [...goal.recentEvidence, ...goal.negativeEvidence].some(evidence =>
    /^Workflow\b/i.test(evidence.trim()),
  )
}

function hasNonTerminalAttachedWorkflow(works: LoopWorkItem[]): boolean {
  return works.some(work =>
    work.status === 'active' ||
    work.status === 'paused' ||
    work.status === 'stale' ||
    work.status === 'failed' ||
    work.status === 'killed' ||
    work.status === 'unverifiable',
  )
}

function attachedWorkflowReason(works: LoopWorkItem[]): string {
  const first = works[0]
  if (!first) return 'No attached workflow work is visible.'
  const label = compact(first.label, 100)
  switch (first.status) {
    case 'active':
      return `Attached workflow work is still active: ${label}.`
    case 'paused':
      return `Attached workflow work is paused and must be resumed or inspected: ${label}.`
    case 'stale':
      return `Attached workflow work is stale and must be inspected before goal evaluation: ${label}.`
    case 'failed':
      return `Attached workflow work failed and must be reviewed before goal completion: ${label}.`
    case 'killed':
      return `Attached workflow work was stopped and must be reviewed before goal completion: ${label}.`
    case 'unverifiable':
      return `Attached workflow work ended without verification evidence: ${label}.`
    case 'completed':
      return `Attached workflow work has completed terminal evidence: ${label}.`
  }
}

function workflowScaleSignals(goal: MossenGoalState): string[] {
  const text = goalText(goal)
  const normalized = text.replace(/\s+/g, ' ').trim()
  const lower = normalized.toLowerCase()
  const signals: string[] = []
  if (goal.successCriteria?.trim()) signals.push('success criteria')
  if (goal.constraints?.trim()) signals.push('constraints')
  if (normalized.length >= 180) signals.push('large objective')
  if (/(^|\n)\s*(?:[-*]|\d+[.)])\s+/.test(text)) {
    signals.push('multi-part objective')
  }
  if (
    /\b(workflows?|loop os|multi[- ]?agent|subagent|repo|codebase|project|migration|migrate|refactor|audit|research|investigate|analy[sz]e|diagnos|harden|upgrade|implement|build|orchestrat|release|smoke|regression|e2e|end-to-end)\b/i.test(
      normalized,
    )
  ) {
    signals.push('workflow-scale keyword')
  }
  if (
    /(实现|开发|重构|迁移|审计|调研|分析|排查|加固|升级|编排|多.?agent|工作流|项目|代码库|回归|验证|发布|目标)/.test(
      normalized,
    )
  ) {
    signals.push('workflow-scale keyword')
  }
  if (/(docs\/upgrade|w\d{3,}|计划|目标)/i.test(lower)) {
    signals.push('planned implementation')
  }
  return [...new Set(signals)]
}

function looksNarrowSingleTurn(goal: MossenGoalState): boolean {
  if (goal.successCriteria?.trim() || goal.constraints?.trim()) return false
  const text = goal.text.replace(/\s+/g, ' ').trim()
  if (text.length > 140) return false
  return /^(translate|rewrite|summari[sz]e|explain|answer|show|tell me|what is|format|fix typo|run\b|check\b|翻译|改写|总结|解释|回答|查看|告诉我)/i.test(
    text,
  )
}

export function buildSessionGoalWorkflowTask(goal: MossenGoalState): string {
  const parts = [
    'Execute this Mossen session goal through a visible workflow.',
    '',
    'Objective:',
    goal.text,
    goal.successCriteria ? `\nSuccess criteria:\n${goal.successCriteria}` : null,
    goal.constraints ? `\nConstraints:\n${goal.constraints}` : null,
    '',
    'Workflow contract:',
    '- Decompose the objective into phases and agent work items.',
    '- Produce concrete evidence: file paths, command output, artifacts, task IDs, screenshots, runtime output, or explicit user confirmation.',
    '- Run or name validation commands where feasible.',
    '- Mark weak, missing, or summary-only evidence explicitly.',
    '- Return a final report with evidence, validationCommands, artifacts, missingChecks, failures, residualRisks, and openQuestions.',
    '- Do not treat the workflow launch receipt itself as completion evidence.',
  ].filter((part): part is string => part !== null)
  const task = parts.join('\n')
  return task.length <= MAX_WORKFLOW_TASK_CHARS
    ? task
    : `${task.slice(0, MAX_WORKFLOW_TASK_CHARS - 3)}...`
}

export function evaluateSessionGoalWorkflowPolicy(
  goal: MossenGoalState,
  tasks?: Record<string, unknown>,
): SessionGoalWorkflowPolicyVerdict {
  const attached = buildLoopLivenessReport(tasks, {
    goalId: goal.id,
    includeUnattached: false,
  }).works
  if (hasNonTerminalAttachedWorkflow(attached)) {
    return {
      type: 'wait_for_workflow',
      reason: attachedWorkflowReason(attached),
      works: attached,
    }
  }
  if (attached.length > 0 || hasWorkflowEvidence(goal)) {
    return {
      type: 'continue',
      reason: 'Workflow evidence already exists; evaluate or verify the terminal evidence instead of launching another workflow.',
      signals: [],
    }
  }
  if (looksNarrowSingleTurn(goal)) {
    return {
      type: 'continue',
      reason: 'Goal appears narrow enough for the main loop.',
      signals: [],
    }
  }
  const signals = workflowScaleSignals(goal)
  if (signals.length === 0) {
    return {
      type: 'continue',
      reason: 'No workflow-scale signal was detected.',
      signals,
    }
  }
  return {
    type: 'launch_workflow',
    reason: `Goal is workflow-scale: ${signals.join(', ')}.`,
    task: buildSessionGoalWorkflowTask(goal),
    signals,
  }
}
