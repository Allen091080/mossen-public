import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .optional()
      .describe('Reserved stub field for Tungsten sessions.'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export function clearSessionsWithTungstenUsage(): void {
  // Tungsten is disabled in this source build; no usage cache exists.
}

export function resetInitializationState(): void {
  // Tungsten is disabled in this source build; no initialization state exists.
}

export const TungstenTool = buildTool({
  name: 'Tungsten',
  searchHint: 'disabled tmux-style terminal session helper',
  maxResultSizeChars: 8_000,
  userFacingName() {
    return 'Tungsten'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return false
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return 'Unavailable in this reconstructed source build.'
  },
  async prompt() {
    return 'Unavailable in this reconstructed source build.'
  },
  renderToolUseMessage() {
    return 'Tungsten unavailable'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
    }
  },
  async call() {
    return {
      data: {
        success: false,
        message: 'TungstenTool is unavailable in this reconstructed source build.',
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
