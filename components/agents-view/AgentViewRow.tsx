import React from 'react'
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js'
import { Box, Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { t } from '../../utils/i18n/index.js'
import { truncateVisual, visualWidth } from '../../utils/visualWidth.js'
import type { AgentSupervisorPrStatus } from '../../services/agentSupervisor/prStatus.js'
import {
  getSupervisorAgentPrStatus,
  type SupervisorAgentViewItem,
} from '../tasks/agentSupervisorViewModel.js'
import {
  agentViewStatusLabel,
  formatAgentViewJobAge,
  padVisualEnd,
  shortenPathForAgentView,
} from '../agents/agentViewHelpers.js'
import { formatAgentViewActionToken } from './agentViewInteractionModel.js'

export function AgentViewRow({
  item,
  isSelected,
  prStatus,
  highlightColor,
  compact = false,
}: {
  item: SupervisorAgentViewItem
  isSelected: boolean
  prStatus?: AgentSupervisorPrStatus
  highlightColor?: string
  compact?: boolean
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const maxActivityWidth = Math.max(36, columns - 4)
  const useGreyPointer = isCoordinatorMode()
  const pointer = isSelected ? '› ' : '  '
  const selectedColor = isSelected && !useGreyPointer ? 'suggestion' : undefined
  return (
    <Box flexDirection="row">
      <Text dimColor={useGreyPointer && isSelected}>{pointer}</Text>
      <SupervisorAgentRowContent
        item={item}
        prStatus={prStatus}
        maxActivityWidth={maxActivityWidth}
        color={selectedColor}
        highlightColor={highlightColor}
        compact={compact}
        selected={isSelected}
      />
    </Box>
  )
}

function SupervisorAgentRowContent({
  item,
  prStatus,
  maxActivityWidth,
  color,
  highlightColor,
  compact = false,
  selected = false,
}: {
  item: SupervisorAgentViewItem
  prStatus?: AgentSupervisorPrStatus
  maxActivityWidth: number
  color?: string
  highlightColor?: string
  compact?: boolean
  selected?: boolean
}): React.ReactNode {
  const prLabel = prStatus?.label ?? getSupervisorAgentPrStatus(item)
  const cwd = shortenPathForAgentView(item.cwd)
  const fallbackSummary = item.cwdAvailable ? cwd : `${cwd} · missing cwd`
  const rawSummary =
    item.lastQuestionText?.trim() ||
    item.resultSummary?.trim() ||
    item.lastSummaryLine?.trim() ||
    fallbackSummary
  const summary =
    rawSummary.toLowerCase() === item.label.trim().toLowerCase() ? '' : rawSummary
  const statusLabel = agentViewStatusLabel(item.status)
  const actionHint = formatAgentViewActionToken(
    item.primaryAction.shortcut,
    supervisorRowActionLabel(item.primaryAction.kind),
  )
  const activity = [statusLabel, actionHint, summary].filter(Boolean).join(' · ')
  const rowColor = color ?? highlightColor
  const processShape = item.processAlive ? '✻ ' : '∙ '
  const titlePrefix = `${processShape}${item.pinned ? '★ ' : ''}`
  const prDotWidth = prStatus ? 2 : 0
  const titleWidth = compact
    ? Math.min(28, Math.max(16, Math.floor(maxActivityWidth * 0.35)))
    : Math.min(42, Math.max(20, Math.floor(maxActivityWidth * 0.34)))
  const age = formatAgentViewJobAge(item.updatedAt)
  const ageWidth = age ? visualWidth(age) + 1 : 0
  const titleTextWidth = Math.max(8, titleWidth - prDotWidth)
  const title = padVisualEnd(
    truncateVisual(`${titlePrefix}${item.label}`, titleTextWidth),
    titleTextWidth,
  )
  const rightMetaParts = [
    prLabel,
    item.worktreeLabel,
    item.resultBadge,
    item.agent ? `@${item.agent}` : null,
    item.model,
  ].filter((part): part is string => Boolean(part))
  const rightMeta =
    rightMetaParts.length > 0
      ? truncateVisual(rightMetaParts.join(' · '), compact ? 18 : 30)
      : ''
  const metaWidth = rightMeta ? visualWidth(rightMeta) + 1 : 0
  const summaryWidth = Math.max(
    12,
    maxActivityWidth - titleWidth - ageWidth - metaWidth - prDotWidth - 2,
  )
  const summaryText = truncateVisual(activity, summaryWidth)
  const rowWithoutAge = `${title} ${summaryText}${rightMeta ? ` ${rightMeta}` : ''}`
  const spacer = age
    ? ' '.repeat(
        Math.max(
          1,
          maxActivityWidth -
            prDotWidth -
            visualWidth(rowWithoutAge) -
            visualWidth(age),
        ),
      )
    : ''
  return (
    <Text color={rowColor} dimColor={!rowColor && !selected} inverse={selected}>
      {prStatus && <PrStatusDot status={prStatus.state} />}
      {rowWithoutAge}
      {spacer}
      {age}
    </Text>
  )
}

export function supervisorRowActionLabel(
  kind: SupervisorAgentViewItem['primaryAction']['kind'],
): string {
  switch (kind) {
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

function PrStatusDot({ status }: { status: AgentSupervisorPrStatus['state'] }) {
  if (status === 'checks_running') return <Text color="warning">● </Text>
  if (status === 'checks_passed') return <Text color="success">● </Text>
  if (status === 'merged') return <Text color="suggestion">● </Text>
  return <Text dimColor>● </Text>
}
