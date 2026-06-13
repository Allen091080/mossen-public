import { describe, expect, test } from 'bun:test'
import {
  buildAgentViewShortcutActions,
  getAgentViewSelectionHint,
  supervisorActionLabel,
} from '../agentViewInteractionModel.js'
import { t } from '../../../utils/i18n/index.js'

const attachAction = {
  kind: 'attach' as const,
  label: 'attach terminal',
  shortcut: 'Enter/→',
}

const previewAction = {
  kind: 'peek' as const,
  label: 'preview card',
  shortcut: 'Space',
}

const reviewAction = {
  kind: 'review' as const,
  label: 'review',
  shortcut: 'Space',
}

describe('getAgentViewSelectionHint', () => {
  test('keeps completed result rows on review-only wording', () => {
    expect(
      getAgentViewSelectionHint({
        inputMode: 'dispatch',
        currentSelection: null,
      }),
    ).toBe(t('ui.agentView.nextDispatch'))

    expect(
      getAgentViewSelectionHint({
        inputMode: 'idle',
        currentSelection: {
          type: 'supervisor_agent',
          status: 'completed',
          statusContext: 'ready_result',
          primaryAction: reviewAction,
          secondaryAction: null,
        },
      }),
    ).toBe(t('ui.agentView.nextReadyResult'))
  })

  test('only live result rows advertise terminal attach', () => {
    expect(
      getAgentViewSelectionHint({
        inputMode: 'idle',
        currentSelection: {
          type: 'supervisor_agent',
          status: 'idle',
          statusContext: 'ready_result',
          primaryAction: reviewAction,
          secondaryAction: attachAction,
        },
      }),
    ).toBe(t('ui.agentView.nextReadyResultLive'))
  })

  test('maps non-supervisor rows to their own next-step copy', () => {
    expect(
      getAgentViewSelectionHint({
        inputMode: 'idle',
        currentSelection: { type: 'leader' },
      }),
    ).toBe(t('ui.agentView.nextLeader'))
    expect(
      getAgentViewSelectionHint({
        inputMode: 'idle',
        currentSelection: { type: 'local_bash' },
      }),
    ).toBe(t('ui.agentView.nextShell'))
  })
})

describe('buildAgentViewShortcutActions', () => {
  test('shows generic dashboard actions when no supervisor row is selected', () => {
    expect(
      buildAgentViewShortcutActions({
        currentSupervisorSelection: null,
        dismissPending: false,
      }),
    ).toEqual([
      { key: 'enter', shortcut: 'Enter/→', action: t('ui.agentView.attach') },
      { key: 'space', shortcut: 'Space', action: t('ui.agentView.peek') },
      { key: 'stop', shortcut: 'Ctrl+X', action: t('ui.agentView.stop') },
      { key: 'help', shortcut: '?', action: t('ui.agentView.help') },
    ])
  })

  test('uses row-specific primary and secondary actions', () => {
    expect(supervisorActionLabel(attachAction)).toBe(t('ui.agentView.actionAttach'))
    expect(supervisorActionLabel(previewAction)).toBe(t('ui.agentView.actionPeek'))
    expect(
      buildAgentViewShortcutActions({
        currentSupervisorSelection: {
          primaryAction: attachAction,
          secondaryAction: previewAction,
        },
        dismissPending: true,
      }),
    ).toEqual([
      { key: 'primary', shortcut: 'Enter/→', action: t('ui.agentView.actionAttach') },
      { key: 'secondary', shortcut: 'Space', action: t('ui.agentView.actionPeek') },
      { key: 'stop', shortcut: 'Ctrl+X', action: t('ui.agentView.confirmDismiss') },
      { key: 'help', shortcut: '?', action: t('ui.agentView.help') },
    ])
  })
})
