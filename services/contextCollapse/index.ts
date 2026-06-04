export type ContextCollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: {
    totalSpawns: number
    totalErrors: number
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
    lastError?: string
  }
}

const EMPTY_STATS: ContextCollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export function getStats(): ContextCollapseStats {
  return EMPTY_STATS
}

export function subscribe(_callback: () => void): () => void {
  return () => {}
}

export function resetContextCollapse(): void {}

export function projectView<T>(messages: T[]): T[] {
  return messages
}

export function initContextCollapse(): void {}

export async function applyCollapsesIfNeeded<T>(
  messages: T[],
  _toolUseContext?: unknown,
  _querySource?: string,
): Promise<{ messages: T[] }> {
  return { messages }
}

export function isWithheldPromptTooLong(
  _message: unknown,
  _predicate?: (message: unknown) => boolean,
  _querySource?: string,
): boolean {
  return false
}

export function recoverFromOverflow<T>(
  messages: T[],
  _querySource?: string,
): { messages: T[]; committed: number } {
  return { messages, committed: 0 }
}
