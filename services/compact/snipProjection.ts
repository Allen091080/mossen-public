import type { Message } from '../../types/message.js'

export function projectSnippedView<T extends Message>(messages: T[]): T[] {
  return messages
}

export function isSnipBoundaryMessage(_message: Message): boolean {
  return false
}
