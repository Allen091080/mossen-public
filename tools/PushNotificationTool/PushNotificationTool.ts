/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import React from 'react'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  DESCRIPTION,
  PUSH_NOTIFICATION_TOOL_NAME,
  PUSH_NOTIFICATION_TOOL_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().min(1).max(120).describe('Notification title'),
    body: z.string().min(1).max(500).describe('Notification body'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    delivered: z.boolean(),
    title: z.string(),
    body: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  maxResultSizeChars: 4_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PUSH_NOTIFICATION_TOOL_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.delivered
        ? `Notification sent: ${output.title}`
        : `Notification not sent: ${output.title}`,
    }
  },
  renderToolUseMessage(input) {
    const title = typeof input.title === 'string' ? input.title : 'notification'
    return `Send notification: ${title}`
  },
  renderToolResultMessage(output: Output) {
    return output.delivered ? `${output.title}: ${output.body}` : null
  },
  async call({ title, body }, context) {
    context.sendOSNotification?.({
      message: `${title}\n${body}`,
      notificationType: 'push-notification',
    })
    return {
      data: {
        delivered: true,
        title,
        body,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
