import React from 'react'
import { Box, Text } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import type { AgentViewInputMode } from '../agents/agentViewHelpers.js'

export function AgentViewComposer({
  query,
  cursorOffset,
  inputMode,
  dispatchActive,
}: {
  query: string
  cursorOffset: number
  inputMode: AgentViewInputMode
  dispatchActive: boolean
}): React.ReactNode {
  const modeColor = dispatchActive
    ? 'success'
    : inputMode === 'command'
      ? 'warning'
      : 'suggestion'
  const cursor = Math.max(0, Math.min(cursorOffset, query.length))
  if (!query) {
    return (
      <Box>
        <Text color={modeColor}>› </Text>
        <Text inverse> </Text>
        <Text dimColor>{t('ui.agentView.inputPlaceholder')}</Text>
      </Box>
    )
  }

  const cursorChar = query[cursor] ?? ' '
  return (
    <Box>
      <Text color={modeColor}>› </Text>
      {query.slice(0, cursor) && <Text>{query.slice(0, cursor)}</Text>}
      <Text inverse>{cursorChar}</Text>
      {cursor < query.length && <Text>{query.slice(cursor + 1)}</Text>}
    </Box>
  )
}
