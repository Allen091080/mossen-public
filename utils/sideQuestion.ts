/**
 * Side Question ("/btw") feature - allows asking quick questions without
 * interrupting the main agent context.
 *
 * Uses runForkedAgent to leverage prompt caching from the parent context
 * while keeping the side question response separate from main conversation.
 */

import { formatAPIError } from '../services/api/errorUtils.js'
import type { NonNullableUsage } from '../services/api/logging.js'
import type { Message, SystemAPIErrorMessage } from '../types/message.js'
import { getProductAssistantName, getProductDisplayName } from '../constants/product.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import { createUserMessage, extractTextContent } from './messages.js'
import { getInteractiveLanguageTag } from './uiLanguage.js'

// Pattern to detect "/btw" at start of input (case-insensitive, word boundary)
const BTW_PATTERN = /^\/btw\b/gi
const externalText = (...codes: number[]) => String.fromCharCode(...codes)
const LEGACY_PRODUCT_ROOT = externalText(67, 108, 97, 117, 100, 101)
const LEGACY_PRODUCT_CODE = `${LEGACY_PRODUCT_ROOT} Code`
const LEGACY_PRODUCT_CLI = `${LEGACY_PRODUCT_ROOT} CLI`
const LEGACY_PRODUCT_CODE_CLI = `${LEGACY_PRODUCT_CODE} CLI`
const LEGACY_PRODUCT_TERMS = [
  LEGACY_PRODUCT_CODE_CLI,
  LEGACY_PRODUCT_CODE,
  LEGACY_PRODUCT_CLI,
  LEGACY_PRODUCT_ROOT,
]

/**
 * Find positions of "/btw" keyword at the start of text for highlighting.
 * Similar to findThinkingTriggerPositions in thinking.ts.
 */
export function findBtwTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(BTW_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

export type SideQuestionResult = {
  response: string | null
  usage: NonNullableUsage
}

/**
 * Run a side question using a forked agent.
 * Shares the parent's prompt cache — no thinking override, no cache write.
 * All tools are blocked and we cap at 1 turn.
 */
export async function runSideQuestion({
  question,
  cacheSafeParams,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
}): Promise<SideQuestionResult> {
  const isChinese = getInteractiveLanguageTag() === 'zh'
  const runtimeName = getProductDisplayName()
  const assistantName = getProductAssistantName()

  // Wrap the question with instructions to answer without tools
  const wrappedQuestion = `<system-reminder>${
    isChinese
      ? `这是用户发来的旁路问题。你必须直接给出一次性答案。

重要上下文：
- 你是一个轻量的独立实例，只负责回答这个问题
- 主实例没有被打断，它会继续在后台工作
- 你共享上下文，但你是一个单独的实例
- 不要说自己被打断了，也不要说你“刚才正在做什么”
- 当你提到产品或运行环境时，使用“${assistantName}”或“${runtimeName}”，不要使用旧产品名

关键约束：
- 你没有任何工具，不能读文件、执行命令、搜索代码，也不能采取动作
- 这是一次性回答，不会有后续轮次
- 你只能基于现有上下文直接回答
- 不要说“我来试试”“我现在去检查”“让我看看”这类会暗示采取动作的话
- 如果你不知道答案，就直接说明，不要承诺稍后去查

请直接用中文回答这个问题。`
      : `This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect
- When referring to the product or runtime, use "${assistantName}" or "${runtimeName}", never legacy product names

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question in English with the information you have.`
  }</system-reminder>

${question}`

  const agentResult = await runForkedAgent({
    promptMessages: [createUserMessage({ content: wrappedQuestion })],
    // Do NOT override thinkingConfig — thinking is part of the API cache key,
    // and diverging from the main thread's config busts the prompt cache.
    // Adaptive thinking on a quick Q&A has negligible overhead.
    cacheSafeParams,
    canUseTool: async () => ({
      behavior: 'deny' as const,
      message: 'Side questions cannot use tools',
      decisionReason: { type: 'other' as const, reason: 'side_question' },
    }),
    querySource: 'side_question',
    forkLabel: 'side_question',
    maxTurns: 1, // Single turn only - no tool use loops
    // No future request shares this suffix; skip writing cache entries.
    skipCacheWrite: true,
  })

  return {
    response: normalizeSideQuestionBranding(
      extractSideQuestionResponse(agentResult.messages),
      runtimeName,
    ),
    usage: agentResult.totalUsage,
  }
}

function normalizeSideQuestionBranding(
  response: string | null,
  runtimeName: string,
): string | null {
  if (!response) return response

  const chineseRuntime = `本地${runtimeName}环境`
  const englishRuntime = `${runtimeName} environment`
  const chineseAssistant = '专注于软件工程任务的编码助手'

  let normalized = response
  for (const term of LEGACY_PRODUCT_TERMS) {
    const escaped = escapeRegExp(term)
    normalized = normalized
      .replace(new RegExp(`[\`“”"]${escaped}[\`“”"]`, 'g'), runtimeName)
      .replace(new RegExp(`${escaped}\\s*环境`, 'g'), chineseRuntime)
      .replace(new RegExp(`${escaped}\\s*environment`, 'g'), englishRuntime)
      .replaceAll(`软件工程助手，运行在本地 ${term} 环境中`, `软件工程助手，运行在${chineseRuntime}中`)
      .replaceAll(`我运行在 ${term} 环境中`, `我运行在${chineseRuntime}中`)
      .replaceAll(`我运行在本地 ${term} 环境中`, `我运行在${chineseRuntime}中`)
      .replaceAll(`I run in the ${term} environment`, `I run in the ${runtimeName} environment`)
      .replaceAll(`我是 ${term}`, `我是 ${runtimeName}`)
      .replaceAll(term, runtimeName)
  }

  return normalized
    .replaceAll('我是一个编码助手', `我是 ${runtimeName}，一个${chineseAssistant}`)
    .replaceAll('我是一个软件工程助手', `我是 ${runtimeName}，一个${chineseAssistant}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract a display string from forked agent messages.
 *
 * IMPORTANT: mossen.ts yields one AssistantMessage PER CONTENT BLOCK, not one
 * per API response. With adaptive thinking enabled (inherited from the main
 * thread to preserve the cache key), a thinking response arrives as:
 *   messages[0] = assistant { content: [thinking_block] }
 *   messages[1] = assistant { content: [text_block] }
 *
 * The old code used `.find(m => m.type === 'assistant')` which grabbed the
 * first (thinking-only) message, found no text block, and returned null →
 * "No response received". Repos with large context (many skills, big MOSSEN.md)
 * trigger thinking more often, which is why this reproduced in the monorepo
 * but not here.
 *
 * Secondary failure modes also surfaced as "No response received":
 *   - Model attempts tool_use → content = [thinking, tool_use], no text.
 *     Rare — the system-reminder usually prevents this, but handled here.
 *   - API error exhausts retries → query yields system api_error + user
 *     interruption, no assistant message at all.
 */
function extractSideQuestionResponse(messages: Message[]): string | null {
  // Flatten all assistant content blocks across the per-block messages.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' ? m.message.content : [],
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) return text

    // No text — check if the model tried to call a tool despite instructions.
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    if (toolUse) {
      const toolName = 'name' in toolUse ? toolUse.name : 'a tool'
      return getInteractiveLanguageTag() === 'zh'
        ? `（模型尝试调用 ${toolName}，而不是直接回答。请换一种问法，或回到主对话里提问。）`
        : `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`
    }
  }

  // No assistant content — likely API error exhausted retries. Surface the
  // first system api_error message so the user sees what happened.
  const apiErr = messages.find(
    (m): m is SystemAPIErrorMessage =>
      m.type === 'system' && 'subtype' in m && m.subtype === 'api_error',
  )
  if (apiErr) {
    return getInteractiveLanguageTag() === 'zh'
      ? `（API 错误：${formatAPIError(apiErr.error)}）`
      : `(API error: ${formatAPIError(apiErr.error)})`
  }

  return null
}
