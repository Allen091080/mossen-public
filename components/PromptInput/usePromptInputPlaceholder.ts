import { feature } from 'bun:bundle'
import { useMemo } from 'react'
import { useCommandQueue } from 'src/hooks/useCommandQueue.js'
import {
  getSessionGoalState,
  type MossenGoalState,
} from 'src/bootstrap/state.js'
import { useAppState } from 'src/state/AppState.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { t } from 'src/utils/i18n/index.js'
import type { InteractiveLanguageTag } from 'src/utils/uiLanguage.js'
import { isQueuedCommandEditable } from 'src/utils/messageQueueManager.js'
import { truncateToGraphemeCount } from 'src/utils/truncate.js'

const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null

type Props = {
  input: string
  hasMessages: boolean
  isLoading: boolean
  submitCount: number
  viewingAgentName?: string
}

type PromptInputPlaceholder = {
  placeholder?: string
  completion?: string
}

const NUM_TIMES_QUEUE_HINT_SHOWN = 3
const MAX_TEAMMATE_NAME_LENGTH = 20
const MAX_CONTEXT_PLACEHOLDER_GRAPHEMES = 34

type ContextAwarePromptPlaceholderInput = {
  input: string
  hasEditableQueuedCommands: boolean
  queueHintEligible: boolean
  hasMessages: boolean
  isLoading: boolean
  proactiveActive: boolean
  promptSuggestionEnabled: boolean
  submitCount: number
  viewingAgentName?: string
  sessionGoal?: Pick<MossenGoalState, 'text' | 'status'> | null
}

function formatShortContext(value: string): string {
  return truncateToGraphemeCount(value.trim().replace(/\s+/g, ' '), MAX_CONTEXT_PLACEHOLDER_GRAPHEMES)
}

export function buildContextAwarePromptPlaceholder(
  args: ContextAwarePromptPlaceholderInput,
  langOverride?: InteractiveLanguageTag,
): PromptInputPlaceholder {
  if (args.input !== '') {
    return {}
  }

  if (args.viewingAgentName) {
    const displayName =
      args.viewingAgentName.length > MAX_TEAMMATE_NAME_LENGTH
        ? args.viewingAgentName.slice(0, MAX_TEAMMATE_NAME_LENGTH - 3) + '...'
        : args.viewingAgentName
    return {
      placeholder: t('ui.promptInput.context.teammate', {
        name: displayName,
      }, langOverride),
    }
  }

  if (args.hasEditableQueuedCommands && args.queueHintEligible) {
    return { placeholder: t('ui.promptQueue.upHint', undefined, langOverride) }
  }

  if (args.isLoading) {
    return {
      placeholder: t('ui.promptInput.context.busy', undefined, langOverride),
    }
  }

  const goal =
    args.sessionGoal &&
    (args.sessionGoal.status === 'active' ||
      args.sessionGoal.status === 'paused' ||
      args.sessionGoal.status === 'blocked')
      ? formatShortContext(args.sessionGoal.text)
      : ''
  if (goal) {
    const goalPlaceholderKey =
      args.sessionGoal?.status === 'blocked'
        ? 'ui.promptInput.context.goalBlocked'
        : args.sessionGoal?.status === 'paused'
          ? 'ui.promptInput.context.goalPaused'
          : 'ui.promptInput.context.goalActive'
    return {
      placeholder: t(
        goalPlaceholderKey,
        { goal },
        langOverride,
      ),
    }
  }

  if (args.hasMessages) {
    return {
      placeholder: t('ui.promptInput.context.next', undefined, langOverride),
    }
  }

  if (
    args.submitCount < 1 &&
    args.promptSuggestionEnabled &&
    !args.proactiveActive
  ) {
    return {
      placeholder: t('ui.promptInput.context.start', undefined, langOverride),
    }
  }

  return {}
}

export function usePromptInputPlaceholder({
  input,
  hasMessages,
  isLoading,
  submitCount,
  viewingAgentName,
}: Props): PromptInputPlaceholder {
  const queuedCommands = useCommandQueue()
  const promptSuggestionEnabled = useAppState(s => s.promptSuggestionEnabled)
  const sessionGoal = getSessionGoalState()
  const hasEditableQueuedCommands = queuedCommands.some(isQueuedCommandEditable)
  const queueHintEligible =
    (getGlobalConfig().queuedCommandUpHintCount || 0) <
    NUM_TIMES_QUEUE_HINT_SHOWN
  const placeholder = useMemo<PromptInputPlaceholder>(() => {
    // Default watermark is a local UI hint, not a model-generated action.
    // Real post-turn suggestions still override this surface in PromptInput.
    return buildContextAwarePromptPlaceholder({
      input,
      hasEditableQueuedCommands,
      queueHintEligible,
      hasMessages,
      isLoading,
      proactiveActive: !!proactiveModule?.isProactiveActive(),
      promptSuggestionEnabled,
      sessionGoal,
      submitCount,
      viewingAgentName,
    })
  }, [
    hasEditableQueuedCommands,
    hasMessages,
    input,
    isLoading,
    queueHintEligible,
    promptSuggestionEnabled,
    sessionGoal,
    submitCount,
    viewingAgentName,
  ])

  return placeholder
}
