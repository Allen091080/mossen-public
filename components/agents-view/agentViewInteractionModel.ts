import { t } from '../../utils/i18n/index.js'
import type { AgentViewInputMode } from '../agents/agentViewHelpers.js'
import type {
  SupervisorAgentViewAction,
  SupervisorAgentViewItem,
} from '../tasks/agentSupervisorViewModel.js'

type AgentViewSelectionForInteraction = {
  type: string
  status?: string
  statusContext?: string
  primaryAction?: SupervisorAgentViewAction
  secondaryAction?: SupervisorAgentViewAction | null
}

export type AgentViewShortcutAction = {
  key: string
  shortcut: string
  action: string
}

function compactAgentViewShortcutText(text: string): string {
  return text
    .trim()
    .replace(/→/g, 'right')
    .replace(/←/g, 'left')
    .replace(/↑/g, 'up')
    .replace(/↓/g, 'down')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

export function formatAgentViewActionToken(
  shortcut: string,
  action: string,
): string {
  return `${compactAgentViewShortcutText(shortcut)}:${compactAgentViewShortcutText(action)}`
}

export function formatAgentViewShortcutGuide(
  actions: readonly AgentViewShortcutAction[],
): string {
  return actions
    .map(action => formatAgentViewActionToken(action.shortcut, action.action))
    .join(' | ')
}

export function supervisorActionLabel(
  action: Pick<SupervisorAgentViewAction, 'kind'>,
): string {
  switch (action.kind) {
    case 'attach':
      return t('ui.agentView.actionAttach')
    case 'inspect':
      return t('ui.agentView.actionInspect')
    case 'peek':
      return t('ui.agentView.actionPeek')
    case 'reply':
      return t('ui.agentView.actionReply')
    case 'review':
      return t('ui.agentView.actionReview')
  }
}

export function getAgentViewSelectionHint({
  inputMode,
  currentSelection,
}: {
  inputMode: AgentViewInputMode
  currentSelection: AgentViewSelectionForInteraction | null
}): string {
  if (inputMode === 'filter') return t('ui.agentView.nextFilter')
  if (inputMode === 'command') return t('ui.agentView.nextCommand')
  if (inputMode === 'dispatch') return t('ui.agentView.nextDispatch')
  if (!currentSelection) return t('ui.agentView.nextEmpty')
  if (currentSelection.type === 'supervisor_agent') {
    if (currentSelection.statusContext === 'blocked_question') {
      return t('ui.agentView.nextNeedsInput')
    }
    if (currentSelection.statusContext === 'ready_result') {
      if (currentSelection.secondaryAction?.kind === 'attach') {
        return t('ui.agentView.nextReadyResultLive')
      }
      return t('ui.agentView.nextReadyResult')
    }
    if (currentSelection.statusContext === 'running') {
      return t('ui.agentView.nextRunning')
    }
    if (currentSelection.status === 'failed' || currentSelection.status === 'stopped') {
      return t('ui.agentView.nextFailed')
    }
    return t('ui.agentView.nextTerminal')
  }
  if (currentSelection.type === 'leader') return t('ui.agentView.nextLeader')
  if (currentSelection.type === 'local_bash') return t('ui.agentView.nextShell')
  if (
    currentSelection.type === 'local_agent' ||
    currentSelection.type === 'in_process_teammate'
  ) {
    return t('ui.agentView.nextLocalAgent')
  }
  return t('ui.agentView.nextGenericTask')
}

export function buildAgentViewShortcutActions({
  currentSupervisorSelection,
  dismissPending,
}: {
  currentSupervisorSelection:
    | Pick<SupervisorAgentViewItem, 'primaryAction' | 'secondaryAction'>
    | null
  dismissPending: boolean
}): AgentViewShortcutAction[] {
  const selectionActions: AgentViewShortcutAction[] = currentSupervisorSelection
    ? [
        {
          key: 'primary',
          shortcut: currentSupervisorSelection.primaryAction.shortcut,
          action: supervisorActionLabel(currentSupervisorSelection.primaryAction),
        },
        ...(currentSupervisorSelection.secondaryAction
          ? [
              {
                key: 'secondary',
                shortcut: currentSupervisorSelection.secondaryAction.shortcut,
                action: supervisorActionLabel(currentSupervisorSelection.secondaryAction),
              },
            ]
          : []),
      ]
    : [
        {
          key: 'enter',
          shortcut: 'Enter/→',
          action: t('ui.agentView.attach'),
        },
        {
          key: 'space',
          shortcut: 'Space',
          action: t('ui.agentView.peek'),
        },
      ]

  return [
    ...selectionActions,
    {
      key: 'stop',
      shortcut: 'Ctrl+X',
      action: dismissPending
        ? t('ui.agentView.confirmDismiss')
        : t('ui.agentView.stop'),
    },
    {
      key: 'help',
      shortcut: '?',
      action: t('ui.agentView.help'),
    },
  ]
}
