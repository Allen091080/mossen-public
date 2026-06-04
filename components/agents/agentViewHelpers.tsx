/**
 * Agent View pure helpers extracted from BackgroundTasksDialog.
 *
 * Phase 8b of the live-multiplex refactor moves Agent View specific helpers
 * (input mode classification, grouping, label formatting, notification
 * decisions, and the help-section render block) out of the 1870-line
 * BackgroundTasksDialog into a dedicated module so the legacy dialog can
 * eventually be split into separate Agent View / legacy components and so
 * future Agent View wave smokes can import these helpers directly.
 *
 * Nothing in this module touches React state or refs — every function is
 * pure or only reads process.env / i18n strings. State-bound logic
 * (dispatch handler, polling effect, supervisor row state machine) stays
 * in BackgroundTasksDialog and will be migrated in later sub-waves only if
 * concrete user-visible bugs justify the risk.
 */

import React, { type ReactNode } from 'react'
import type { Command } from '../../types/command.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import type { TerminalFocusState } from 'src/ink/terminal-focus-state.js'
import { Box, Text } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import { visualWidth } from '../../utils/visualWidth.js'
import type { AgentSupervisorStatus } from 'src/services/agentSupervisor/schema.js'
import {
  getSupervisorAgentPrStatus,
  type SupervisorAgentGroupStage,
  type SupervisorAgentViewItem,
} from '../tasks/agentSupervisorViewModel.js'

export type AgentViewInputMode = 'idle' | 'dispatch' | 'filter' | 'command'
export type AgentViewNotificationMode = 'off' | 'needs_input' | 'all'

export type AgentViewCommandPaletteItem = {
  command: Command
  name: string
  description: string
  kindLabel: string
}

export type SupervisorAgentDisplayStage = 'pinned' | SupervisorAgentGroupStage

export type SupervisorAgentDisplayGroup = {
  key: SupervisorAgentDisplayStage
  stage: SupervisorAgentDisplayStage
  items: SupervisorAgentViewItem[]
  hiddenCount?: number
  totalCount?: number
}

export const AGENT_VIEW_FILTER_PREFIXES = [
  'a:',
  'agent:',
  's:',
  'status:',
  'cwd:',
  'dir:',
  'd:',
]
export const AGENT_VIEW_COMMAND_PALETTE_LIMIT = 8
export const AGENT_VIEW_LOCAL_COMMANDS = new Set(['exit', 'quit'])
export const AGENT_VIEW_SKILL_LIKE_SOURCES = new Set([
  'skills',
  'plugin',
  'bundled',
  'managed',
  'mcp',
  'commands_DEPRECATED',
])
export const AGENT_VIEW_STAGE_ORDER: SupervisorAgentGroupStage[] = [
  'ready_for_review',
  'needs_input',
  'working',
  'completed',
  'stopped_failed',
]
export const AGENT_VIEW_COMPLETED_VISIBLE_LIMIT = 4
export const RESERVED_AGENT_VIEW_ACTION_KEYS = new Set([' '])

export function getAgentViewInputMode(query: string): AgentViewInputMode {
  const trimmed = query.trimStart()
  if (!trimmed) return 'idle'
  if (trimmed.startsWith('/')) {
    return /\s/.test(trimmed.slice(1)) ? 'dispatch' : 'command'
  }
  if (trimmed.startsWith('>')) return 'dispatch'
  const normalized = trimmed.toLowerCase()
  if (trimmed.startsWith('#')) return 'filter'
  if (AGENT_VIEW_FILTER_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return 'filter'
  }
  return 'dispatch'
}

export function getAgentViewDispatchPrompt(query: string): string {
  const trimmed = query.trim()
  return trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed
}

export function getAgentViewFilterQuery(query: string): string {
  const trimmed = query.trim()
  return trimmed
}

export function isAgentViewExitCommand(query: string): boolean {
  const normalized = query.trim().toLowerCase()
  return (
    normalized.startsWith('/') && AGENT_VIEW_LOCAL_COMMANDS.has(normalized.slice(1))
  )
}

export function getAgentViewCommandPaletteQuery(query: string): string {
  const trimmed = query.trimStart()
  if (!trimmed.startsWith('/')) return ''
  return trimmed.slice(1).trim().toLowerCase()
}

export function isAgentViewPaletteCommand(cmd: Command): boolean {
  if (cmd.isHidden || cmd.userInvocable === false) return false
  if (cmd.type !== 'prompt') return false
  if (cmd.source === 'builtin') return false
  return Boolean(
    (cmd.loadedFrom && AGENT_VIEW_SKILL_LIKE_SOURCES.has(cmd.loadedFrom)) ||
      cmd.hasUserSpecifiedDescription ||
      cmd.whenToUse,
  )
}

export function getAgentViewPaletteKindLabel(cmd: Command): string {
  return cmd.loadedFrom === 'commands_DEPRECATED'
    ? t('ui.agentView.paletteKindTemplate')
    : t('ui.agentView.paletteKindSkill')
}

export function getAgentViewSlashCommandName(prompt: string): string | null {
  const trimmed = prompt.trimStart()
  if (!trimmed.startsWith('/')) return null
  const name = trimmed.slice(1).split(/\s+/)[0]?.trim().toLowerCase()
  return name || null
}

export function matchesAgentViewPaletteCommandName(
  name: string,
  item: AgentViewCommandPaletteItem,
): boolean {
  return (
    item.name.toLowerCase() === name ||
    item.command.name.toLowerCase() === name ||
    (item.command.aliases ?? []).some(alias => alias.toLowerCase() === name)
  )
}

export function agentViewGroupStageLabel(
  stage: SupervisorAgentDisplayStage,
): string {
  switch (stage) {
    case 'pinned':
      return t('ui.agentView.groupStagePinned')
    case 'needs_input':
      return t('ui.agentView.groupStageNeedsInput')
    case 'ready_for_review':
      return t('ui.agentView.groupStageReadyForReview')
    case 'working':
      return t('ui.agentView.groupStageWorking')
    case 'completed':
      return t('ui.agentView.groupStageCompleted')
    case 'stopped_failed':
      return t('ui.agentView.groupStageStoppedFailed')
  }
}

export function agentViewStatusLabel(status: AgentSupervisorStatus): string {
  switch (status) {
    case 'queued':
      return t('ui.agentView.statusQueued')
    case 'working':
      return t('ui.agentView.statusWorking')
    case 'idle':
      return t('ui.agentView.statusIdle')
    case 'needs_input':
      return t('ui.agentView.statusNeedsInput')
    case 'completed':
      return t('ui.agentView.statusCompleted')
    case 'failed':
      return t('ui.agentView.statusFailed')
    case 'stopped':
      return t('ui.agentView.statusStopped')
  }
}

export function getAgentViewStage(
  status: AgentSupervisorStatus,
): SupervisorAgentGroupStage {
  if (status === 'needs_input') return 'needs_input'
  if (status === 'working' || status === 'queued') return 'working'
  if (status === 'idle') return 'ready_for_review'
  if (status === 'completed') return 'completed'
  return 'stopped_failed'
}

export function groupSupervisorAgentViewItemsForDashboard(
  items: SupervisorAgentViewItem[],
  expandedGroups: Set<string> = new Set(),
): SupervisorAgentDisplayGroup[] {
  const groups = new Map<SupervisorAgentGroupStage, SupervisorAgentViewItem[]>()
  const pinned: SupervisorAgentViewItem[] = []
  for (const item of items) {
    if (item.pinned) {
      pinned.push(item)
      continue
    }
    const hasPrReference = getSupervisorAgentPrStatus(item) !== null
    const stage =
      hasPrReference && (item.status === 'completed' || item.status === 'idle')
        ? 'ready_for_review'
        : getAgentViewStage(item.status)
    const group = groups.get(stage)
    if (group) group.push(item)
    else groups.set(stage, [item])
  }
  const orderedGroups = AGENT_VIEW_STAGE_ORDER.flatMap(stage => {
    const groupItems = groups.get(stage) ?? []
    if (groupItems.length === 0) return []
    if (
      stage !== 'completed' ||
      expandedGroups.has(stage) ||
      groupItems.length <= AGENT_VIEW_COMPLETED_VISIBLE_LIMIT
    ) {
      return [
        { key: stage, stage, items: groupItems, totalCount: groupItems.length },
      ]
    }
    return [
      {
        key: stage,
        stage,
        items: groupItems.slice(0, AGENT_VIEW_COMPLETED_VISIBLE_LIMIT),
        hiddenCount: groupItems.length - AGENT_VIEW_COMPLETED_VISIBLE_LIMIT,
        totalCount: groupItems.length,
      },
    ]
  })
  return pinned.length > 0
    ? [
        { key: 'pinned', stage: 'pinned', items: pinned, totalCount: pinned.length },
        ...orderedGroups,
      ]
    : orderedGroups
}

export function shortenPathForAgentView(path: string): string {
  const home = process.env.HOME
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

export function isPlainAgentViewTextKey(e: KeyboardEvent): boolean {
  return !e.meta && !e.ctrl && e.key.length === 1 && e.key !== ' ' && e.key !== '?'
}

export function hasExplicitExternalEditor(): boolean {
  return Boolean(process.env.VISUAL?.trim() || process.env.EDITOR?.trim())
}

export function formatAgentViewRefreshAge(timestamp: number | null): string {
  if (!timestamp) return t('ui.agentView.refreshNever')
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 1) return t('ui.agentView.refreshJustNow')
  return t('ui.agentView.refreshSecondsAgo', { seconds })
}

export function formatAgentViewJobAge(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '<1m'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function padVisualEnd(text: string, targetWidth: number): string {
  return `${text}${' '.repeat(Math.max(0, targetWidth - visualWidth(text)))}`
}

export function shouldUseAgentViewHighDensity(
  rowCount: number,
  columns: number,
): boolean {
  return rowCount >= 12 || columns < 110
}

export function getSupervisorStatusFlashColor(
  status: AgentSupervisorStatus,
): string | null {
  if (status === 'needs_input') return 'warning'
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  return null
}

export function getAgentViewNotificationMode(
  raw: string | undefined = process.env.MOSSEN_AGENT_VIEW_NOTIFICATIONS,
): AgentViewNotificationMode {
  if (raw === '0' || raw === 'off' || raw === 'false') return 'off'
  if (raw === 'all') return 'all'
  return 'needs_input'
}

export function shouldNotifyAgentViewStatusTransition({
  previous,
  current,
  focusState,
  mode = getAgentViewNotificationMode(),
}: {
  previous: AgentSupervisorStatus | undefined
  current: AgentSupervisorStatus
  focusState: TerminalFocusState
  mode?: AgentViewNotificationMode
}): boolean {
  if (!previous || previous === current) return false
  if (focusState !== 'blurred') return false
  if (mode === 'off') return false
  if (current === 'needs_input') return true
  return mode === 'all' && (current === 'completed' || current === 'failed')
}

export function agentViewNotificationDedupeKey(
  id: string,
  status: AgentSupervisorStatus,
): string {
  return `${id}:${status}`
}

export function agentViewNotificationMessage(item: SupervisorAgentViewItem): string {
  return t('ui.agentView.notification.needsInput', {
    id: item.id,
  })
}

export function renderAgentViewHelpSections(): ReactNode {
  return (
    <Box flexDirection="column">
      <Text dimColor>
        <Text bold>{t('ui.agentView.helpCreateTitle')}</Text>{' '}
        {t('ui.agentView.helpCreate')}
      </Text>
      <Text dimColor>
        <Text bold>{t('ui.agentView.helpBrowseTitle')}</Text>{' '}
        {t('ui.agentView.helpBrowse')}
      </Text>
      <Text dimColor>
        <Text bold>{t('ui.agentView.helpInteractTitle')}</Text>{' '}
        {t('ui.agentView.helpInteract')}
      </Text>
      <Text dimColor>
        <Text bold>{t('ui.agentView.helpOrganizeTitle')}</Text>{' '}
        {t('ui.agentView.helpOrganize')}
      </Text>
      <Text dimColor>
        <Text bold>{t('ui.agentView.helpShellTitle')}</Text>{' '}
        {t('ui.agentView.helpShell')}
      </Text>
    </Box>
  )
}
