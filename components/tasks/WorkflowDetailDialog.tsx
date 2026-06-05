import React from 'react'
import type { ReadonlyDeep as DeepImmutable } from 'type-fest'
import { useElapsedTime } from '../../hooks/useElapsedTime.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import type {
  LocalWorkflowTaskState,
  WorkflowAgentTaskProgress,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { formatDuration, formatNumber } from '../../utils/format.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import {
  getTaskStatusColor,
  getTaskStatusIcon,
} from './taskStatusUtils.js'
import { plural } from '../../utils/stringUtils.js'

type Props = {
  key?: React.Key
  workflow: DeepImmutable<LocalWorkflowTaskState>
  onDone: LocalJSXCommandOnDone
  onKill?: () => void
  onPause?: () => void
  onResume?: () => void
  onRetryAgent?: (agentId: string) => void
  onSave?: () => void
  onBack?: () => void
}

type WorkflowDetailActionState = Pick<
  LocalWorkflowTaskState,
  'status' | 'paused'
>

type WorkflowPhaseSummaryAgent = Pick<
  WorkflowAgentTaskProgress,
  'phase' | 'status' | 'tokens' | 'toolCalls' | 'durationMs' | 'startedAt'
>

type WorkflowPhaseSummaryInput = {
  phaseDefinitions?: readonly { readonly title?: unknown }[]
  phases?: readonly unknown[]
  agents: readonly WorkflowPhaseSummaryAgent[]
}

type WorkflowDetailRunSummaryInput = {
  agentCount: number
  tokensSpent: number
  totalToolCalls: number
  agents: readonly Pick<WorkflowAgentTaskProgress, 'tokens' | 'toolCalls'>[]
}

type WorkflowDetailRunSummary = {
  agentCount: number
  tokens: number
  toolCalls: number
}

type WorkflowPhaseSummary = {
  title: string
  agentCount: number
  statusSummary: string
  tokens: number
  toolCalls: number
  elapsedMs: number
}

function agentElapsedMs(agent: WorkflowPhaseSummaryAgent): number {
  if (typeof agent.durationMs === 'number') return Math.max(0, agent.durationMs)
  if (!agent.startedAt) return 0
  return Math.max(0, Date.now() - agent.startedAt)
}

function phaseStatusSummary(agents: readonly WorkflowPhaseSummaryAgent[]): string {
  const counts = new Map<WorkflowAgentTaskProgress['status'], number>()
  for (const agent of agents) {
    counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
}

function latestToolCallLabel(
  agent: DeepImmutable<WorkflowAgentTaskProgress>,
): string | null {
  const recent = agent.recentToolCalls?.length
    ? agent.recentToolCalls
    : agent.lastToolName
      ? [
          {
            name: agent.lastToolName,
            ...(agent.lastToolSummary ? { summary: agent.lastToolSummary } : {}),
          },
        ]
      : []
  const latest = recent.at(-1)
  return latest ? `${latest.name}${latest.summary ? ` ${latest.summary}` : ''}` : null
}

export function workflowAgentDetailParts(
  agent: DeepImmutable<WorkflowAgentTaskProgress>,
): string[] {
  const latestTool = latestToolCallLabel(agent)
  const parts: string[] = []
  if (agent.agentType) parts.push(agent.agentType)
  if (agent.model) parts.push(agent.model)
  if (agent.isolation) parts.push(agent.isolation)
  if (agent.promptPreview) parts.push(`prompt: ${agent.promptPreview}`)
  if (agent.tokens > 0) parts.push(`${formatNumber(agent.tokens)} tokens`)
  if (agent.toolCalls > 0) parts.push(`${formatNumber(agent.toolCalls)} tools`)
  if (latestTool) parts.push(`tool: ${latestTool}`)
  if (agent.resultPreview) parts.push(`result: ${agent.resultPreview}`)
  if (agent.durationMs !== undefined) {
    parts.push(formatDuration(agent.durationMs))
  }
  return parts
}

export function workflowDetailRunSummary(
  workflow: WorkflowDetailRunSummaryInput,
): WorkflowDetailRunSummary {
  const agentTokens = workflow.agents.reduce(
    (sum, agent) => sum + agent.tokens,
    0,
  )
  const agentToolCalls = workflow.agents.reduce(
    (sum, agent) => sum + agent.toolCalls,
    0,
  )
  return {
    agentCount: Math.max(workflow.agentCount, workflow.agents.length),
    tokens: Math.max(workflow.tokensSpent, agentTokens),
    toolCalls: Math.max(workflow.totalToolCalls, agentToolCalls),
  }
}

export function workflowPhaseSummaries(
  workflow: WorkflowPhaseSummaryInput,
): WorkflowPhaseSummary[] {
  const titles: string[] = []
  const addTitle = (title: unknown) => {
    const value = typeof title === 'string' ? title.trim() : ''
    if (value && !titles.includes(value)) titles.push(value)
  }

  for (const phase of workflow.phaseDefinitions ?? []) addTitle(phase.title)
  for (const phase of workflow.phases ?? []) addTitle(phase)
  for (const agent of workflow.agents) addTitle(agent.phase)

  return titles.map(title => {
    const agents = workflow.agents.filter(agent => agent.phase === title)
    return {
      title,
      agentCount: agents.length,
      statusSummary: phaseStatusSummary(agents),
      tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
      toolCalls: agents.reduce((sum, agent) => sum + agent.toolCalls, 0),
      elapsedMs: agents.reduce((sum, agent) => sum + agentElapsedMs(agent), 0),
    }
  })
}

export function canPauseWorkflowDetail(
  workflow: WorkflowDetailActionState,
): boolean {
  return workflow.status === 'running' && !workflow.paused
}

export function canResumeWorkflowDetail(
  workflow: WorkflowDetailActionState,
): boolean {
  return workflow.status === 'paused' || (
    workflow.status === 'running' && workflow.paused === true
  )
}

export function canStopWorkflowDetail(
  workflow: WorkflowDetailActionState,
): boolean {
  return workflow.status === 'running' || workflow.status === 'paused'
}

function agentStatusColor(
  status: WorkflowAgentTaskProgress['status'],
): 'success' | 'error' | 'warning' | 'background' {
  switch (status) {
    case 'completed':
    case 'cached':
      return 'success'
    case 'failed':
      return 'error'
    case 'skipped':
    case 'retry_requested':
      return 'warning'
    case 'queued':
    case 'running':
      return 'background'
  }
}

function AgentRow({
  agent,
}: {
  key?: React.Key
  agent: DeepImmutable<WorkflowAgentTaskProgress>
}): React.ReactNode {
  const detailParts = workflowAgentDetailParts(agent)
  return (
    <Text wrap="truncate-end">
      #{agent.agentNumber} {agent.phase ? `[${agent.phase}] ` : ''}
      {agent.label}{' '}
      <Text color={agentStatusColor(agent.status)}>{agent.status}</Text>
      {detailParts.map(part => (
        <Text key={part} dimColor>
          {' '}· {part}
        </Text>
      ))}
      {agent.error ? <Text color="error"> · {agent.error}</Text> : null}
    </Text>
  )
}

function pickRunningAgent(
  workflow: DeepImmutable<LocalWorkflowTaskState>,
): WorkflowAgentTaskProgress | undefined {
  return workflow.agents.find(agent => agent.status === 'running') as
    | WorkflowAgentTaskProgress
    | undefined
}

export function WorkflowDetailDialog({
  workflow,
  onDone,
  onKill,
  onPause,
  onResume,
  onRetryAgent,
  onSave,
  onBack,
}: Props): React.ReactNode {
  const elapsedTime = useElapsedTime(
    workflow.startTime,
    workflow.status === 'running',
    1000,
    workflow.totalPausedMs ?? 0,
  )
  const runningAgent = pickRunningAgent(workflow)
  const canStopWorkflow = canStopWorkflowDetail(workflow)
  const canPauseWorkflow = canPauseWorkflowDetail(workflow)
  const canResumeWorkflow = canResumeWorkflowDetail(workflow)
  const runSummary = workflowDetailRunSummary(workflow)
  const phaseSummaries = workflowPhaseSummaries(workflow)
  const handleClose = () =>
    onDone('Workflow details dismissed', { display: 'system' })
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === ' ') {
      event.preventDefault()
      handleClose()
      return
    }
    if (event.key === 'left' && onBack) {
      event.preventDefault()
      onBack()
      return
    }
    if (event.key === 'x' && canStopWorkflow && onKill) {
      event.preventDefault()
      onKill()
      return
    }
    if (event.key === 'p' && canResumeWorkflow && onResume) {
      event.preventDefault()
      onResume()
      return
    }
    if (event.key === 'p' && canPauseWorkflow && onPause) {
      event.preventDefault()
      onPause()
      return
    }
    if (event.key === 's' && onSave) {
      event.preventDefault()
      onSave()
      return
    }
    if (event.key === 'r' && runningAgent && onRetryAgent) {
      event.preventDefault()
      onRetryAgent(String(runningAgent.agentNumber))
    }
  }

  const displayStatus = workflow.paused ? 'paused' : workflow.status
  const subtitle = (
    <Text>
      <Text color={workflow.paused ? 'warning' : getTaskStatusColor(workflow.status)}>
        {getTaskStatusIcon(workflow.status)} {displayStatus}
      </Text>
      <Text dimColor>
        {' '}· {elapsedTime} · {formatNumber(runSummary.tokens)} tokens ·{' '}
        {formatNumber(runSummary.toolCalls)} tools · {runSummary.agentCount}{' '}
        {runSummary.agentCount === 1 ? 'agent' : 'agents'}
      </Text>
    </Text>
  )
  const inputGuide = () => (
    <Byline>
      {onBack ? <KeyboardShortcutHint shortcut="←" action="go back" /> : null}
      <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
      {canStopWorkflow && onKill ? (
        <KeyboardShortcutHint shortcut="x" action="stop" />
      ) : null}
      {canResumeWorkflow && onResume ? (
        <KeyboardShortcutHint shortcut="p" action="resume" />
      ) : null}
      {canPauseWorkflow && onPause ? (
        <KeyboardShortcutHint shortcut="p" action="pause" />
      ) : null}
      {onSave ? (
        <KeyboardShortcutHint shortcut="s" action="save" />
      ) : null}
      {runningAgent && onRetryAgent ? (
        <KeyboardShortcutHint shortcut="r" action="restart current agent" />
      ) : null}
    </Byline>
  )

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title={`Workflow: ${workflow.workflowName}`}
        subtitle={subtitle}
        onCancel={handleClose}
        color="background"
        inputGuide={inputGuide}
      >
        <Box flexDirection="column">
          <Text wrap="wrap">{workflow.description}</Text>
          {workflow.currentPhase ? (
            <Text>
              <Text bold>Current phase:</Text> {workflow.currentPhase}
            </Text>
          ) : null}
          {phaseSummaries.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>
                Phases
              </Text>
              {phaseSummaries.map(phase => (
                <Text key={phase.title} wrap="truncate-end">
                  {phase.title}
                  <Text dimColor>
                    {' '}· {phase.agentCount} {plural(phase.agentCount, 'agent')}
                    {phase.statusSummary ? ` · ${phase.statusSummary}` : ''}
                    {' '}· {formatNumber(phase.tokens)} tokens
                    {' '}· {formatNumber(phase.toolCalls)} tools
                    {phase.elapsedMs > 0
                      ? ` · ${formatDuration(phase.elapsedMs, { mostSignificantOnly: true })}`
                      : ''}
                  </Text>
                </Text>
              ))}
            </Box>
          ) : null}
          {workflow.agents.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>
                Agents
              </Text>
              {workflow.agents.map(agent => (
                <AgentRow key={agent.agentNumber} agent={agent} />
              ))}
            </Box>
          ) : null}
          {workflow.log.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>
                Recent progress
              </Text>
              {workflow.log.slice(-8).map((line, index) => (
                <Text key={`${index}-${line}`} dimColor wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          ) : null}
          {workflow.error ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="error">
                Error
              </Text>
              <Text color="error" wrap="wrap">
                {workflow.error}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Dialog>
    </Box>
  )
}
