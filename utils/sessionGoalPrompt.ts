import { getSessionGoalState } from '../bootstrap/state.js'
import { getGraphemeSegmenter } from './intl.js'

const MAX_PROMPT_GOAL_GRAPHEMES = 1200
const MAX_PROMPT_CRITERIA_GRAPHEMES = 800
const MAX_PROMPT_CONSTRAINT_GRAPHEMES = 800
const MAX_PROMPT_EVIDENCE_GRAPHEMES = 600

function truncateToGraphemeCount(text: string, maxGraphemes: number): string {
  if (maxGraphemes <= 0) return ''
  let count = 0
  let result = ''
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    if (count >= maxGraphemes) return result + '…'
    result += segment
    count++
  }
  return result
}

export function getActiveSessionGoalPromptSection(): string | null {
  const goal = getSessionGoalState()
  if (!goal || goal.status !== 'active') return null

  const text = truncateToGraphemeCount(goal.text, MAX_PROMPT_GOAL_GRAPHEMES)
  const criteria = goal.successCriteria
    ? truncateToGraphemeCount(
        goal.successCriteria,
        MAX_PROMPT_CRITERIA_GRAPHEMES,
      )
    : null
  const constraints = goal.constraints
    ? truncateToGraphemeCount(
        goal.constraints,
        MAX_PROMPT_CONSTRAINT_GRAPHEMES,
      )
    : null
  const evidence = goal.recentEvidence.length
    ? truncateToGraphemeCount(
        goal.recentEvidence.map(item => `- ${item}`).join('\n'),
        MAX_PROMPT_EVIDENCE_GRAPHEMES,
      )
    : null
  const negativeEvidence = goal.negativeEvidence.length
    ? truncateToGraphemeCount(
        goal.negativeEvidence.map(item => `- ${item}`).join('\n'),
        MAX_PROMPT_EVIDENCE_GRAPHEMES,
      )
    : null

  return [
    '# Current Session Goal',
    'The user set a session-scoped goal for this conversation. Treat it as lightweight task context, not as permission to bypass safety, hard-deny rules, permission prompts, or normal stopping behavior.',
    `Goal: ${text}`,
    criteria ? `Success criteria: ${criteria}` : null,
    constraints ? `Constraints: ${constraints}` : null,
    evidence ? `Recent evidence:\n${evidence}` : null,
    negativeEvidence ? `Unresolved negative evidence:\n${negativeEvidence}` : null,
    goal.nextPlan ? `Next plan: ${truncateToGraphemeCount(goal.nextPlan, MAX_PROMPT_EVIDENCE_GRAPHEMES)}` : null,
    `Turns since goal was set: ${goal.turnCount}`,
    'For broad, multi-step, repo-wide, audit, migration, research, or parallelizable work, prefer Workflow({ task: <goal-or-next-plan> }) so progress is visible in /workflows and completion can be judged from real workflow/agent state.',
    'A launched workflow is not completion evidence by itself; wait for terminal workflow/agent state and cite report, files, commands, tests, screenshots, runtime output, or user confirmation.',
    'Use get_goal if you need current goal state. When the objective is actually achieved and no required work remains, call update_goal with status "complete" and include concrete evidence. Only use status "blocked" after the same blocking condition repeats across at least three consecutive goal turns and further progress is impossible without user input or an external-state change.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
