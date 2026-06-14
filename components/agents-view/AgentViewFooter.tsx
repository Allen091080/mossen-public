import React from 'react'
import { Box, Text } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import { truncateVisual } from '../../utils/visualWidth.js'
import {
  formatAgentViewRefreshAge,
  renderAgentViewHelpSections,
  type AgentViewCommandPaletteItem,
  type AgentViewInputMode,
} from '../agents/agentViewHelpers.js'
import {
  formatAgentViewShortcutGuide,
  type AgentViewShortcutAction,
} from './agentViewInteractionModel.js'
import { AgentViewComposer } from './AgentViewComposer.js'

export function AgentViewFooter({
  helpVisible,
  renameText,
  inputMode,
  commandPaletteItems,
  commandPaletteIndex,
  terminalColumns,
  dispatching,
  loadError,
  dispatchError,
  selectionHint,
  query,
  cursorOffset,
  dispatchActive,
  lastRefreshAt,
  dispatchDefaultsLabel,
  supervisorGroupCount,
  supervisorJobCount,
  highDensity,
  actions,
}: {
  helpVisible: boolean
  renameText: string | null
  inputMode: AgentViewInputMode
  commandPaletteItems: AgentViewCommandPaletteItem[]
  commandPaletteIndex: number
  terminalColumns: number
  dispatching: boolean
  loadError: string | null
  dispatchError: string | null
  selectionHint: string | null
  query: string
  cursorOffset: number
  dispatchActive: boolean
  lastRefreshAt: number | null
  dispatchDefaultsLabel: string | null
  supervisorGroupCount: number
  supervisorJobCount: number
  highDensity: boolean
  actions: AgentViewShortcutAction[]
}): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      {helpVisible && renderAgentViewHelpSections()}
      {renameText && (
        <Text color="suggestion">
          {t('ui.agentView.renamePrompt')} {renameText}
        </Text>
      )}
      {inputMode === 'command' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>{t('ui.agentView.paletteTitle')}</Text>
          {commandPaletteItems.length === 0 ? (
            <Text dimColor>{t('ui.agentView.paletteEmpty')}</Text>
          ) : (
            commandPaletteItems.map((item, index) => (
              <Box key={item.name}>
                <Text color={index === commandPaletteIndex ? 'success' : undefined}>
                  {index === commandPaletteIndex ? '› ' : '  '}/{item.name}
                </Text>
                <Text dimColor>
                  {' '}
                  · {item.kindLabel} ·{' '}
                  {truncateVisual(
                    item.description,
                    Math.max(24, terminalColumns - item.name.length - 18),
                  )}
                </Text>
              </Box>
            ))
          )}
          <Text dimColor>{t('ui.agentView.paletteHint')}</Text>
        </Box>
      )}
      {dispatching && <Text dimColor>{t('ui.agentView.dispatching')}</Text>}
      {loadError && (
        <Text color="warning">
          {t('ui.agentView.supervisorLoadError')}: {loadError}
        </Text>
      )}
      {dispatchError && <Text color="warning">{dispatchError}</Text>}
      {selectionHint && (
        <Text dimColor wrap="truncate-end">
          {t('ui.agentView.nextStep')}: {selectionHint}
        </Text>
      )}
      <AgentViewComposer
        query={query}
        cursorOffset={cursorOffset}
        inputMode={inputMode}
        dispatchActive={dispatchActive}
      />
      {helpVisible && (
        <Text dimColor wrap="truncate-end">
          {t('ui.agentView.lastRefresh')}:{' '}
          {formatAgentViewRefreshAge(lastRefreshAt)}
          {dispatchDefaultsLabel ? (
            <>
              {' '}
              · {t('ui.agentView.dispatchDefaults')}: {dispatchDefaultsLabel}
            </>
          ) : null}
          {supervisorJobCount > 0 ? (
            <>
              {' '}
              ·{' '}
              {t('ui.agentView.density', {
                groups: String(supervisorGroupCount),
                rows: String(supervisorJobCount),
              })}
            </>
          ) : null}
          {highDensity ? <> · {t('ui.agentView.highDensityMode')}</> : null}
        </Text>
      )}
      <Text dimColor italic wrap="truncate-end">
        {formatAgentViewShortcutGuide(actions)}
      </Text>
    </Box>
  )
}
