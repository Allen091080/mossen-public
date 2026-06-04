import { getSessionGoalState } from '../bootstrap/state.js'
import { getGraphemeSegmenter } from './intl.js'

const MAX_PROMPT_GOAL_GRAPHEMES = 1200
const MAX_PROMPT_CRITERIA_GRAPHEMES = 800

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

  return [
    '# Current Session Goal',
    'The user set a session-scoped goal for this conversation. Treat it as lightweight task context, not as permission to bypass safety, hard-deny rules, permission prompts, or normal stopping behavior.',
    `Goal: ${text}`,
    criteria ? `Success criteria: ${criteria}` : null,
    `Turns since goal was set: ${goal.turnCount}`,
    'Use get_goal if you need current goal state. When the objective is actually achieved and no required work remains, call update_goal with status "complete". Only use status "blocked" after the same blocking condition repeats across at least three consecutive goal turns and further progress is impossible without user input or an external-state change.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
