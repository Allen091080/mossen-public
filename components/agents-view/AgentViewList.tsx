import React from 'react'
import { Box, Text } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import {
  agentViewGroupStageLabel,
  type SupervisorAgentDisplayGroup,
} from '../agents/agentViewHelpers.js'
import type { SupervisorAgentViewItem } from '../tasks/agentSupervisorViewModel.js'

export function AgentViewList({
  hasItems,
  emptyMessage,
  supervisorGroups,
  collapsedGroups,
  renderSupervisorItem,
  legacySections,
}: {
  hasItems: boolean
  emptyMessage: string
  supervisorGroups: SupervisorAgentDisplayGroup[]
  collapsedGroups: Set<string>
  renderSupervisorItem: (item: SupervisorAgentViewItem) => React.ReactNode
  legacySections: React.ReactNode
}): React.ReactNode {
  if (!hasItems) {
    return <Text dimColor>{emptyMessage}</Text>
  }

  return (
    <Box flexDirection="column">
      {supervisorGroups.length > 0 && (
        <Box flexDirection="column">
          {supervisorGroups.map((group, index) => (
            <Box
              key={group.key}
              flexDirection="column"
              marginTop={index === 0 ? 0 : 1}
            >
              <Text dimColor>
                {collapsedGroups.has(group.key) ? '▸ ' : ''}
                <Text bold>{agentViewGroupStageLabel(group.stage)}</Text>
              </Text>
              {!collapsedGroups.has(group.key) &&
                group.items.map(item => renderSupervisorItem(item))}
              {!collapsedGroups.has(group.key) && group.hiddenCount ? (
                <Text dimColor>
                  {'  '}…{' '}
                  {t('ui.agentView.moreCompleted', {
                    count: String(group.hiddenCount),
                  })}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
      {legacySections}
    </Box>
  )
}
