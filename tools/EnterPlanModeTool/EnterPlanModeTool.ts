import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  getAllowedChannels,
  handlePlanModeTransition,
} from '../../bootstrap/state.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js'
import { isPlanModeInterviewPhaseEnabled } from '../../utils/planModeV2.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from './constants.js'
import { getEnterPlanModeToolPrompt } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'
import type { PermissionResult } from '../../types/permissions.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    // No parameters needed
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Confirmation that plan mode was entered'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterPlanModeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_PLAN_MODE_TOOL_NAME,
  searchHint: 'switch to plan mode to design an approach before coding',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Requests permission to enter plan mode for complex tasks requiring exploration and design'
  },
  async prompt() {
    return getEnterPlanModeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  shouldDefer: true,
  isEnabled() {
    // When --channels is active, ExitPlanMode is disabled (its approval
    // dialog needs the terminal). Disable entry too so plan mode isn't a
    // trap the model can enter but never leave.
    if (
      (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
      getAllowedChannels().length > 0
    ) {
      return false
    }
    return true
  },
  isConcurrencySafe() {
    return true
  },
  requiresUserInteraction() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(_input, context): Promise<PermissionResult> {
    const mode = context.getAppState().toolPermissionContext.mode
    if (mode === 'bypassPermissions') {
      return {
        behavior: 'deny',
        message:
          'The user has enabled YOLO mode, so do not enter plan mode. Continue implementing unless the user explicitly asks for plan mode.',
        decisionReason: {
          type: 'other',
          reason: 'YOLO mode should not be downgraded by EnterPlanMode',
        },
      }
    }
    if (mode === 'plan') {
      return {
        behavior: 'allow',
        updatedInput: {},
        decisionReason: {
          type: 'mode',
          mode,
        },
      }
    }
    return {
      behavior: 'ask',
      message:
        'Mossen wants to enter plan mode before making implementation changes.',
      decisionReason: {
        type: 'other',
        reason: 'entering plan mode changes the session permission mode',
      },
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  async call(_input, context) {
    if (context.agentId) {
      throw new Error('EnterPlanMode tool cannot be used in agent contexts')
    }

    const appState = context.getAppState()
    if (appState.toolPermissionContext.mode === 'bypassPermissions') {
      return {
        data: {
          message:
            'YOLO mode is active, so plan mode was not entered. Continue implementing unless the user explicitly asks for plan mode.',
        },
      }
    }

    handlePlanModeTransition(appState.toolPermissionContext.mode, 'plan')

    // Update the permission mode to 'plan'. prepareContextForPlanMode runs
    // the classifier activation side effects when the user's defaultMode is
    // 'auto' — see permissionSetup.ts for the full lifecycle.
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(
        prepareContextForPlanMode(prev.toolPermissionContext),
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ),
    }))

    return {
      data: {
        message:
          'Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.',
      },
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    const instructions = isPlanModeInterviewPhaseEnabled()
      ? `${message}

DO NOT write or edit any files except the plan file. Detailed workflow instructions will follow.`
      : `${message}

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`

    return {
      type: 'tool_result',
      content: instructions,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
