import type { Message } from '../../types/message.js'

export const SNIP_NUDGE_TEXT =
  'Use the Snip tool to hide old low-value context when the conversation gets large.'

export function isSnipRuntimeEnabled(): boolean {
  return false
}

export function shouldNudgeForSnips(_messages: Message[]): boolean {
  return false
}

export function isSnipMarkerMessage(_message: Message): boolean {
  return false
}

export function snipCompactIfNeeded<T extends Message>(
  messages: T[],
  _options?: { force?: boolean },
): {
  messages: T[]
  tokensFreed: number
  executed: boolean
  boundaryMessage?: Message
} {
  return { messages, tokensFreed: 0, executed: false }
}
