/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { plural } from '../../utils/stringUtils.js'
import { resolveAttachments, validateAttachmentPaths } from '../BriefTool/attachments.js'
import {
  renderToolResultMessage as renderBriefToolResultMessage,
  renderToolUseMessage,
} from './UI.js'
import {
  DESCRIPTION,
  SEND_USER_FILE_TOOL_NAME,
  SEND_USER_FILE_TOOL_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    attachments: z
      .array(z.string())
      .min(1)
      .describe(
        'File paths (absolute or relative to cwd) to deliver to the user.',
      ),
    message: z
      .string()
      .optional()
      .describe(
        'Optional short note to show with the delivered files.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().optional(),
    attachments: z
      .array(
        z.object({
          path: z.string(),
          size: z.number(),
          isImage: z.boolean(),
          file_uuid: z.string().optional(),
        }),
      )
      .describe('Resolved attachment metadata'),
    sentAt: z
      .string()
      .optional()
      .describe('ISO timestamp captured at tool execution time.'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'deliver files or screenshots directly to the user',
  maxResultSizeChars: 100_000,
  userFacingName() {
    return ''
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
  async validateInput({ attachments }, _context): Promise<ValidationResult> {
    return validateAttachmentPaths(attachments)
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SEND_USER_FILE_TOOL_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const n = output.attachments.length
    const suffix = ` (${n} ${plural(n, 'attachment')} delivered)`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Files delivered to user.${suffix}`,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage(output, progressMessages, options) {
    return renderBriefToolResultMessage(
      { ...output, message: output.message ?? '' },
      progressMessages,
      options,
    )
  },
  async call({ attachments, message }, context) {
    const sentAt = new Date().toISOString()
    const resolved = await resolveAttachments(attachments)
    return {
      data: {
        attachments: resolved,
        message,
        sentAt,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
