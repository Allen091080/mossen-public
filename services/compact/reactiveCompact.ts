import type { Message } from '../../types/message.js'
import type { CompactionResult } from './compact.js'

export function isReactiveCompactEnabled(): boolean {
  return false
}

export function isReactiveOnlyMode(): boolean {
  return false
}

export function isWithheldPromptTooLong(_message: unknown): boolean {
  return false
}

export function isWithheldMediaSizeError(_message: unknown): boolean {
  return false
}

export async function tryReactiveCompact(_options: unknown): Promise<CompactionResult | null> {
  return null
}

type ReactiveCompactOutcome = {
  ok: boolean
  result: CompactionResult
  reason: 'too_few_groups' | 'aborted' | 'exhausted' | 'error' | 'media_unstrippable'
}

// The real implementation is feature-gated out of this build; this fallback is
// never expected to compact, but it preserves the dormant callsite contract.
export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: unknown,
  _options?: unknown,
): Promise<ReactiveCompactOutcome> {
  return {
    ok: false,
    reason: 'too_few_groups',
    result: undefined as unknown as CompactionResult,
  }
}
