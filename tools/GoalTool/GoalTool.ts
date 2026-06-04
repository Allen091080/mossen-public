import { z } from 'zod/v4'
import {
  blockSessionGoalState,
  completeSessionGoalState,
  getSessionGoalState,
  setSessionGoalState,
  type MossenGoalState,
} from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createSessionGoalEventMessage } from '../../utils/sessionGoalEvents.js'

const GoalStatusSchema = z.enum([
  'active',
  'paused',
  'blocked',
  'complete',
  'cleared',
  'failed',
])

const GoalToolGoalSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: GoalStatusSchema,
  turn_budget: z.number(),
  turns_used: z.number(),
  turns_remaining: z.number(),
  token_budget: z.number().nullable(),
  tokens_used: z.number(),
  remaining_tokens: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  reason: z.string().nullable(),
})

const GoalToolOutputSchema = z.object({
  goal: GoalToolGoalSchema.nullable(),
  remaining_tokens: z.number().nullable(),
  completion_budget_report: z.string().nullable(),
  error: z.string().optional(),
})

type GoalToolOutput = z.infer<typeof GoalToolOutputSchema>

function goalStatusForTool(goal: MossenGoalState): z.infer<typeof GoalStatusSchema> {
  if (goal.status === 'completed') return 'complete'
  return goal.status
}

function goalToToolGoal(goal: MossenGoalState): z.infer<typeof GoalToolGoalSchema> {
  const tokensUsed = goal.tokenEstimate ?? 0
  const remainingTokens =
    goal.tokenBudget !== undefined && goal.tokenBudget !== null
      ? Math.max(0, goal.tokenBudget - tokensUsed)
      : null
  return {
    id: goal.id,
    objective: goal.text,
    status: goalStatusForTool(goal),
    turn_budget: goal.turnBudget,
    turns_used: goal.turnCount,
    turns_remaining: Math.max(0, goal.turnBudget - goal.turnCount),
    token_budget: goal.tokenBudget ?? null,
    tokens_used: tokensUsed,
    remaining_tokens: remainingTokens,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
    reason: goal.lastEvaluatorReason ?? goal.clearReason ?? null,
  }
}

function responseForGoal(
  goal: MossenGoalState | null,
  options?: { completionBudgetReport?: boolean; error?: string },
): GoalToolOutput {
  const mappedGoal = goal ? goalToToolGoal(goal) : null
  const completionBudgetReport =
    options?.completionBudgetReport && mappedGoal?.status === 'complete'
      ? 'Goal achieved. Report final usage from this tool result: turns_used/turn_budget and, if token_budget is present, tokens_used/token_budget.'
      : null
  return {
    goal: mappedGoal,
    remaining_tokens: mappedGoal?.remaining_tokens ?? null,
    completion_budget_report: completionBudgetReport,
    ...(options?.error ? { error: options.error } : {}),
  }
}

function jsonToolResult(output: GoalToolOutput, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: JSON.stringify(output, null, 2),
  }
}

const getGoalInputSchema = lazySchema(() => z.strictObject({}))
type GetGoalInputSchema = ReturnType<typeof getGoalInputSchema>

export const GetGoalTool = buildTool({
  name: 'get_goal',
  searchHint: 'inspect current session goal',
  alwaysLoad: true,
  maxResultSizeChars: 20_000,
  async description() {
    return 'Get the current goal for this session, including status, turn usage, token estimate, and remaining budgets.'
  },
  async prompt() {
    return ''
  },
  get inputSchema(): GetGoalInputSchema {
    return getGoalInputSchema()
  },
  get outputSchema() {
    return GoalToolOutputSchema
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call() {
    return { data: responseForGoal(getSessionGoalState()) }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<GetGoalInputSchema, GoalToolOutput>)

const createGoalInputSchema = lazySchema(() =>
  z.strictObject({
    objective: z
      .string()
      .min(1)
      .describe(
        'Required. The concrete objective to start pursuing. Only use when the user explicitly asks to set a goal.',
      ),
    token_budget: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Positive token budget for the new goal. Omit unless explicitly requested.'),
  }),
)
type CreateGoalInputSchema = ReturnType<typeof createGoalInputSchema>

export const CreateGoalTool = buildTool({
  name: 'create_goal',
  searchHint: 'create explicit session goal',
  alwaysLoad: true,
  maxResultSizeChars: 20_000,
  async description() {
    return 'Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. Fails if an active, paused, blocked, or completed goal already exists.'
  },
  async prompt() {
    return ''
  },
  get inputSchema(): CreateGoalInputSchema {
    return createGoalInputSchema()
  },
  get outputSchema() {
    return GoalToolOutputSchema
  },
  renderToolUseMessage() {
    return null
  },
  async call({ objective, token_budget }) {
    const existing = getSessionGoalState()
    if (existing && existing.status !== 'cleared' && existing.status !== 'failed') {
      return {
        data: responseForGoal(existing, {
          error:
            'cannot create a new goal because this session already has a goal; use update_goal only to mark it complete or blocked, or ask the user to run /goal clear',
        }),
      }
    }

    const goal = setSessionGoalState(objective, undefined, {
      ...(token_budget !== undefined ? { tokenBudget: token_budget } : {}),
    })

    return {
      data: responseForGoal(goal),
      newMessages: [
        createSessionGoalEventMessage({
          type: 'goal_created',
          goalId: goal.id,
          condition: goal.text,
          createdAt: goal.createdAt,
          evaluatorModel: goal.evaluatorModel,
          turnBudget: goal.turnBudget,
          tokenBudget: goal.tokenBudget,
          maxDurationSec: goal.maxDurationSec,
        }),
      ],
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<CreateGoalInputSchema, GoalToolOutput>)

const updateGoalInputSchema = lazySchema(() =>
  z.strictObject({
    status: z
      .enum(['complete', 'blocked'])
      .describe(
        'Required. Set complete only when the objective is achieved and no required work remains. Set blocked only after the same blocking condition repeats for at least three consecutive goal turns and further progress is impossible without user input or an external-state change.',
      ),
  }),
)
type UpdateGoalInputSchema = ReturnType<typeof updateGoalInputSchema>

export const UpdateGoalTool = buildTool({
  name: 'update_goal',
  searchHint: 'complete or block session goal',
  alwaysLoad: true,
  maxResultSizeChars: 20_000,
  async description() {
    return 'Update the existing goal. Use only to mark the goal achieved or genuinely blocked. You cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those changes are controlled by the user or system.'
  },
  async prompt() {
    return ''
  },
  get inputSchema(): UpdateGoalInputSchema {
    return updateGoalInputSchema()
  },
  get outputSchema() {
    return GoalToolOutputSchema
  },
  renderToolUseMessage() {
    return null
  },
  async call({ status }) {
    const current = getSessionGoalState()
    if (!current || current.status !== 'active') {
      return {
        data: responseForGoal(current, {
          error: 'update_goal requires an active goal',
        }),
      }
    }

    if (status === 'complete') {
      const completed = completeSessionGoalState('model_reported_complete') ?? current
      return {
        data: responseForGoal(completed, { completionBudgetReport: true }),
        newMessages: [
          createSessionGoalEventMessage({
            type: 'goal_cleared',
            goalId: completed.id,
            reason: 'condition_met',
            clearedAt: completed.updatedAt,
            turnsUsed: completed.turnCount,
            tokensUsed: completed.tokenEstimate ?? 0,
          }),
        ],
      }
    }

    const blocked = blockSessionGoalState('model_reported_blocked') ?? current
    return {
      data: responseForGoal(blocked),
      newMessages: [
        createSessionGoalEventMessage({
          type: 'goal_blocked',
          goalId: blocked.id,
          reason: blocked.lastEvaluatorReason ?? 'model_reported_blocked',
          blockedAt: blocked.updatedAt,
        }),
      ],
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<UpdateGoalInputSchema, GoalToolOutput>)
