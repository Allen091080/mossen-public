import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { isProactiveActive } from '../../proactive/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, SLEEP_TOOL_NAME, SLEEP_TOOL_PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    durationSeconds: z
      .number()
      .min(1)
      .max(3600)
      .describe('How long to sleep before waking up again.'),
    reason: z
      .string()
      .optional()
      .describe('Optional short reason for sleeping.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    sleptSeconds: z.number(),
    interrupted: z.boolean(),
    reason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function sleepWithAbort(
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }
    signal.addEventListener('abort', onAbort)
  })
}

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  maxResultSizeChars: 4_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return feature('PROACTIVE') || feature('KAIROS')
      ? isProactiveActive()
      : false
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  interruptBehavior() {
    return 'cancel'
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SLEEP_TOOL_PROMPT
  },
  renderToolUseMessage({ durationSeconds }) {
    return `Sleep for ${durationSeconds}s`
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.interrupted
        ? `Sleep interrupted after ${output.sleptSeconds}s`
        : `Slept for ${output.sleptSeconds}s`,
    }
  },
  async call({ durationSeconds, reason }, context) {
    const interrupted = await sleepWithAbort(
      durationSeconds * 1000,
      context.abortController.signal,
    )
    return {
      data: {
        sleptSeconds: durationSeconds,
        interrupted,
        ...(reason !== undefined && { reason }),
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
