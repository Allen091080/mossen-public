import { queryHaiku } from '../../services/api/mossen.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { extractTextContent } from '../../utils/messages.js'
import { extractConversationText } from '../../utils/sessionTitle.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

function extractNameFromGeneratedContent(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidateJson = fencedMatch?.[1]?.trim() || trimmed
  const parsed =
    safeParseJSON(candidateJson) ??
    safeParseJSON(candidateJson.match(/\{[\s\S]*\}/)?.[0] ?? null)

  if (
    parsed &&
    typeof parsed === 'object' &&
    'name' in parsed &&
    typeof (parsed as { name: unknown }).name === 'string'
  ) {
    return (parsed as { name: string }).name
  }

  const slugMatch = candidateJson.match(/[a-z0-9]+(?:-[a-z0-9]+){1,3}/i)
  if (slugMatch) {
    return slugMatch[0].toLowerCase()
  }

  return null
}

export async function generateSessionName(
  messages: Message[],
  signal: AbortSignal,
): Promise<string | null> {
  const conversationText = extractConversationText(messages)
  if (!conversationText) {
    return null
  }

  try {
    const result = await queryHaiku({
      systemPrompt: asSystemPrompt([
        'Generate a short kebab-case name (2-4 words) that captures the main topic of this conversation. Use lowercase words separated by hyphens. Examples: "fix-login-bug", "add-auth-feature", "refactor-api-client", "debug-test-failures". Return JSON with a "name" field.',
      ]),
      userPrompt: conversationText,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      signal,
      options: {
        querySource: 'rename_generate_name',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })

    const content = extractTextContent(result.message.content)
    return extractNameFromGeneratedContent(content)
  } catch (error) {
    // Haiku timeout/rate-limit/network are expected operational failures —
    // logForDebugging, not logError. Called automatically on every 3rd bridge
    // message (initReplBridge.ts), so errors here would flood the error file.
    logForDebugging(`generateSessionName failed: ${errorMessage(error)}`, {
      level: 'error',
    })
    return null
  }
}
