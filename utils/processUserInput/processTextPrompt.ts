import { randomUUID } from 'crypto'
import { setPromptId } from 'src/bootstrap/state.js'
import type { MossenContentBlockParam } from 'src/services/api/mossenSdk.js'
import type {
  AttachmentMessage,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import type { PermissionMode } from '../../types/permissions.js'
import { createUserMessage } from '../messages.js'
import {
  matchesKeepGoingKeyword,
  matchesNegativeKeyword,
} from '../userPromptKeywords.js'
import { workflowReminderFor } from '../workflowKeyword.js'

export function processTextPrompt(
  input: string | Array<MossenContentBlockParam>,
  imageContentBlocks: MossenContentBlockParam[],
  imagePasteIds: number[],
  attachmentMessages: AttachmentMessage[],
  uuid?: string,
  permissionMode?: PermissionMode,
  isMeta?: boolean,
): {
  messages: (UserMessage | AttachmentMessage | SystemMessage)[]
  shouldQuery: boolean
} {
  const promptId = randomUUID()
  setPromptId(promptId)

  const userPromptText =
    typeof input === 'string'
      ? input
      : input.find(block => block.type === 'text')?.text || ''

  const isNegative = matchesNegativeKeyword(userPromptText)
  const isKeepGoing = matchesKeepGoingKeyword(userPromptText)
  logMossenEvent('mossen.input.prompt', {
    is_negative: isNegative,
    is_keep_going: isKeepGoing,
  })

  // Opt-in workflow orchestration: when the user typed the workflow/ultracode
  // keyword, inject the hint as a SEPARATE isMeta message
  // (model-visible, user-hidden) — never concatenated into the user's text,
  // which would leak the <system-reminder> into the transcript. Skipped for
  // isMeta prompts (scheduled / system-generated). See workflowKeyword.ts.
  const workflowReminder = isMeta ? null : workflowReminderFor(userPromptText)
  const workflowReminderMessages = workflowReminder
    ? [createUserMessage({ content: workflowReminder, isMeta: true })]
    : []

  // If we have pasted images, create a message with image content
  if (imageContentBlocks.length > 0) {
    // Build content: text first, then images below
    const textContent =
      typeof input === 'string'
        ? input.trim()
          ? [{ type: 'text' as const, text: input }]
          : []
        : input
    const userMessage = createUserMessage({
      content: [...textContent, ...imageContentBlocks],
      uuid: uuid,
      imagePasteIds: imagePasteIds.length > 0 ? imagePasteIds : undefined,
      permissionMode,
      isMeta: isMeta || undefined,
    })

    return {
      messages: [userMessage, ...attachmentMessages, ...workflowReminderMessages],
      shouldQuery: true,
    }
  }

  const userMessage = createUserMessage({
    content: input,
    uuid,
    permissionMode,
    isMeta: isMeta || undefined,
  })

  return {
    messages: [userMessage, ...attachmentMessages, ...workflowReminderMessages],
    shouldQuery: true,
  }
}
