import { createHash } from 'node:crypto'
import { getCacheSharingParams } from '../compact/compact.js'
import {
  partialCompactConversation,
  type CompactionResult,
} from '../../services/compact/compact.js'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'

const DEFAULT_KEEP_RECENT_MESSAGES = 8
const MIN_KEEP_RECENT_MESSAGES = 2
const MAX_KEEP_RECENT_MESSAGES = 50

type RewindSummarizeArgs =
  | { mode: 'selector' }
  | {
      mode: 'summarize'
      dryRun: boolean
      confirmToken?: string
      keepRecent: number
      reason?: string
    }

export type RewindSummarizePlan = {
  action: 'rewind-summarize'
  version: 1
  direction: 'up_to'
  messageCount: number
  pivotIndex: number
  keepRecent: number
  messagesToSummarize: number
  messagesToKeep: number
  firstKeptUuid?: string
  lastMessageUuid?: string
  reason?: string
}

export const call: LocalCommandCall = async (
  args,
  context,
): Promise<LocalCommandResult> => {
  const parsed = parseRewindSummarizeArgs(args)
  if (parsed.mode === 'selector') {
    if (context.openMessageSelector) {
      context.openMessageSelector()
    }
    // Return a skip message to not append any messages.
    return { type: 'skip' }
  }

  const messages = getMessagesAfterCompactBoundary(context.messages)
  const plan = createRewindSummarizePlan(
    messages,
    parsed.keepRecent,
    parsed.reason,
  )
  const token = tokenForRewindSummarizePlan(plan)

  if (parsed.dryRun) {
    return {
      type: 'text',
      value: formatRewindSummarizeDryRun(plan, token),
    }
  }

  if (!parsed.confirmToken) {
    throw new Error(formatRewindSummarizeUsage())
  }

  if (parsed.confirmToken !== token) {
    throw new Error(
      getLocalizedText({
        en: `rewind summarize token mismatch; rerun dry-run. expected=${token}`,
        zh: `rewind summarize token 不匹配；请重新运行 dry-run。expected=${token}`,
      }),
    )
  }

  const result = await partialCompactConversation(
    messages,
    plan.pivotIndex,
    context,
    await getCacheSharingParams(context, messages),
    parsed.reason,
    'up_to',
  )

  return {
    type: 'compact',
    compactionResult: result as CompactionResult,
    displayText: formatRewindSummarizeApplied(plan),
  }
}

export function parseRewindSummarizeArgs(args: string): RewindSummarizeArgs {
  const parts = splitArgs(args)
  if (parts.length === 0 || parts[0] !== 'summarize') {
    return { mode: 'selector' }
  }

  let dryRun = false
  let confirmToken: string | undefined
  let keepRecent = DEFAULT_KEEP_RECENT_MESSAGES
  let reason: string | undefined

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    if (part === '--dry-run') {
      dryRun = true
      continue
    }
    if (part === '--confirm') {
      confirmToken = parts[i + 1]
      i++
      continue
    }
    if (part === '--keep-recent') {
      keepRecent = parseKeepRecent(parts[i + 1])
      i++
      continue
    }
    if (part === '--reason') {
      const reasonParts = parts.slice(i + 1)
      reason = reasonParts.join(' ').trim() || undefined
      break
    }
    if (part === '--help' || part === '-h') {
      throw new Error(formatRewindSummarizeUsage())
    }
  }

  if (dryRun && confirmToken) {
    throw new Error(
      getLocalizedText({
        en: 'Use either --dry-run or --confirm <8hex>, not both.',
        zh: '请二选一使用 --dry-run 或 --confirm <8hex>，不要同时使用。',
      }),
    )
  }

  return {
    mode: 'summarize',
    dryRun,
    confirmToken,
    keepRecent,
    reason,
  }
}

export function createRewindSummarizePlan(
  messages: Message[],
  keepRecent: number = DEFAULT_KEEP_RECENT_MESSAGES,
  reason?: string,
): RewindSummarizePlan {
  const normalizedKeepRecent = clampKeepRecent(keepRecent)
  const messageCount = messages.length
  const pivotIndex = Math.max(1, messageCount - normalizedKeepRecent)
  const messagesToSummarize = pivotIndex
  const messagesToKeep = Math.max(0, messageCount - pivotIndex)

  if (messageCount < MIN_KEEP_RECENT_MESSAGES + 1) {
    throw new Error(
      getLocalizedText({
        en: 'Not enough conversation history to summarize safely.',
        zh: '当前对话历史太短，无法安全生成摘要。',
      }),
    )
  }

  if (messagesToSummarize <= 0 || messagesToKeep <= 0) {
    throw new Error(
      getLocalizedText({
        en: 'Nothing to summarize before the kept recent messages.',
        zh: '最近保留消息之前没有可摘要的内容。',
      }),
    )
  }

  const firstKept = messages[pivotIndex]
  const lastMessage = messages.at(-1)

  return {
    action: 'rewind-summarize',
    version: 1,
    direction: 'up_to',
    messageCount,
    pivotIndex,
    keepRecent: normalizedKeepRecent,
    messagesToSummarize,
    messagesToKeep,
    firstKeptUuid: typeof firstKept?.uuid === 'string' ? firstKept.uuid : undefined,
    lastMessageUuid:
      typeof lastMessage?.uuid === 'string' ? lastMessage.uuid : undefined,
    reason,
  }
}

export function tokenForRewindSummarizePlan(
  plan: RewindSummarizePlan,
): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex')
    .slice(0, 8)
}

function formatRewindSummarizeDryRun(
  plan: RewindSummarizePlan,
  token: string,
): string {
  return getLocalizedText({
    en: [
      `rewind summarize dry-run (token=${token})`,
      `Messages to summarize: ${plan.messagesToSummarize}`,
      `Recent messages kept: ${plan.messagesToKeep}`,
      `First kept message: ${plan.firstKeptUuid ?? 'unknown'}`,
      `Last message: ${plan.lastMessageUuid ?? 'unknown'}`,
      'Safety: this summarizes earlier transcript context only; it does not restore files.',
      'Original transcript remains available through normal session history/resume paths.',
      `Confirm: /rewind summarize --confirm ${token} --keep-recent ${plan.keepRecent}`,
    ].join('\n'),
    zh: [
      `rewind summarize dry-run（token=${token}）`,
      `将摘要的消息数：${plan.messagesToSummarize}`,
      `保留最近消息数：${plan.messagesToKeep}`,
      `首条保留消息：${plan.firstKeptUuid ?? 'unknown'}`,
      `最后消息：${plan.lastMessageUuid ?? 'unknown'}`,
      '安全说明：这里只摘要较早的 transcript 上下文；不会恢复或改写文件。',
      '原始 transcript 仍可通过正常会话历史 / resume 路径访问。',
      `确认执行：/rewind summarize --confirm ${token} --keep-recent ${plan.keepRecent}`,
    ].join('\n'),
  })
}

function formatRewindSummarizeApplied(plan: RewindSummarizePlan): string {
  return getLocalizedText({
    en: `Rewind summarize applied: summarized ${plan.messagesToSummarize} earlier messages and kept ${plan.messagesToKeep} recent messages. Run /context to inspect the new context shape.`,
    zh: `rewind summarize 已执行：已摘要 ${plan.messagesToSummarize} 条较早消息，并保留 ${plan.messagesToKeep} 条最近消息。可运行 /context 查看新的上下文结构。`,
  })
}

function formatRewindSummarizeUsage(): string {
  return getLocalizedText({
    en: [
      'Usage:',
      '  /rewind summarize --dry-run [--keep-recent N] [--reason TEXT]',
      '  /rewind summarize --confirm <8hex> [--keep-recent N] [--reason TEXT]',
      '',
      'This is transcript summarization. It is separate from --rewind-files, which restores file state.',
    ].join('\n'),
    zh: [
      '用法：',
      '  /rewind summarize --dry-run [--keep-recent N] [--reason TEXT]',
      '  /rewind summarize --confirm <8hex> [--keep-recent N] [--reason TEXT]',
      '',
      '这是 transcript 摘要能力；它不同于 --rewind-files，后者用于恢复文件状态。',
    ].join('\n'),
  })
}

function parseKeepRecent(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_KEEP_RECENT_MESSAGES
  }
  return clampKeepRecent(parsed)
}

function clampKeepRecent(value: number): number {
  return Math.min(
    MAX_KEEP_RECENT_MESSAGES,
    Math.max(MIN_KEEP_RECENT_MESSAGES, value),
  )
}

function splitArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}
