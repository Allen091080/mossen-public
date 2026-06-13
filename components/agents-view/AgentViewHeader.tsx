import React from 'react'
import { Text } from '../../ink.js'
import { getDisplayAppVersion } from '../../utils/version.js'
import { shortenPathForAgentView } from '../agents/agentViewHelpers.js'

function joinHeaderParts(parts: React.ReactNode[]): React.ReactNode {
  return parts.flatMap((part, index) =>
    index === 0 ? [part] : [<Text key={`separator-${index}`}> · </Text>, part],
  )
}

export function AgentViewHeader({
  cwd,
  dispatchDefaultsLabel,
  awaitingInputCount,
  workingCount,
  completedCount,
  totalCount,
}: {
  cwd: string
  dispatchDefaultsLabel: string | null
  awaitingInputCount: number
  workingCount: number
  completedCount: number
  totalCount: number
}): React.ReactNode {
  return (
    <>
      {joinHeaderParts([
        <Text key="version">Mossen v{getDisplayAppVersion()}</Text>,
        <Text key="context">
          {dispatchDefaultsLabel ? `${dispatchDefaultsLabel} · ` : ''}
          {shortenPathForAgentView(cwd)}
        </Text>,
        <Text key="counts">
          {awaitingInputCount} awaiting input · {workingCount} working ·{' '}
          {completedCount} completed
        </Text>,
        ...(totalCount > 0 ? [<Text key="total">{totalCount} sessions</Text>] : []),
      ])}
    </>
  )
}
