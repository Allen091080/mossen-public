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
  return (
    <Text wrap="truncate-end">
      #{agent.agentNumber} {agent.phase ? `[${agent.phase}] ` : ''}
      {agent.label}{' '}
      <Text color={agentStatusColor(agent.status)}>{agent.status}</Text>
      {agent.agentType ? <Text dimColor> · {agent.agentType}</Text> : null}
      {agent.model ? <Text dimColor> · {agent.model}</Text> : null}
      {agent.isolation ? <Text dimColor> · {agent.isolation}</Text> : null}
        {agent.tokens > 0 ? (
          <Text dimColor> · {formatNumber(agent.tokens)} tokens</Text>
        ) : null}
        {agent.toolCalls > 0 ? (
          <Text dimColor> · {formatNumber(agent.toolCalls)} tools</Text>
        ) : null}
        {agent.lastToolName ? (
          <Text dimColor>
            {' '}
            · {agent.lastToolName}
            {agent.lastToolSummary ? ` ${agent.lastToolSummary}` : ''}
          </Text>
        ) : null}
        {agent.resultPreview ? (
          <Text dimColor> · {agent.resultPreview}</Text>
        ) : null}
        {agent.durationMs !== undefined ? (
          <Text dimColor> · {formatDuration(agent.durationMs)}</Text>
        ) : null}
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
        {' '}
        · {elapsedTime} · {formatNumber(workflow.tokensSpent)} tokens ·{' '}
        {formatNumber(workflow.totalToolCalls)} tools ·{' '}
        {workflow.agentCount} {workflow.agentCount === 1 ? 'agent' : 'agents'}
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
