import React, { useMemo, useState } from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { Box, Text, useInput } from '../../ink.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import {
  killWorkflowTask,
  pauseWorkflowTask,
  retryWorkflowAgent,
  skipWorkflowAgent,
  type LocalWorkflowTaskState,
  type WorkflowAgentTaskProgress,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  listWorkflowRuns,
  loadRunLog,
  runScriptPath,
  type WorkflowRunMeta,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import { formatDuration, formatNumber } from '../../utils/format.js'
import { t } from '../../utils/i18n/index.js'
import { Byline } from '../../components/design-system/Byline.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { deriveWorkflowSaveName, saveRun } from './saveWorkflow.js'
import {
  buildWorkflowResumeResult,
  resumeRunFromJournal,
} from './resumeWorkflow.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

type WorkflowRunItem =
  | {
      kind: 'live'
      id: string
      runId: string
      name: string
      status: string
      task: LocalWorkflowTaskState
    }
  | {
      kind: 'history'
      id: string
      runId: string
      name: string
      status: WorkflowRunMeta['status']
      meta: WorkflowRunMeta
    }

type SaveScope = 'project' | 'user'

export type WorkflowDialogMode = 'list' | 'run' | 'phase' | 'agent' | 'save'

type WorkflowMainViewState =
  | { mode: 'list' }
  | { mode: 'run'; runId: string }
  | { mode: 'phase'; runId: string; phase: string }
  | { mode: 'agent'; runId: string; agentNumber: number }

type ViewState =
  | WorkflowMainViewState
  | {
      mode: 'save'
      runId: string
      scope: SaveScope
      previous: WorkflowMainViewState
    }

function isWorkflowTask(task: unknown): task is LocalWorkflowTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    (task as { type?: string }).type === 'local_workflow'
  )
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return '>'
    case 'paused':
      return '||'
    case 'completed':
      return 'ok'
    case 'failed':
      return '!!'
    case 'killed':
      return 'x'
    default:
      return '-'
  }
}

function statusColor(status: string): 'success' | 'error' | 'warning' | 'background' {
  switch (status) {
    case 'completed':
    case 'cached':
      return 'success'
    case 'failed':
    case 'killed':
      return 'error'
    case 'paused':
    case 'skipped':
    case 'retry_requested':
      return 'warning'
    default:
      return 'background'
  }
}

function elapsedMs(startTime?: number, endTime?: number, pausedMs = 0): number {
  if (!startTime) return 0
  return Math.max(0, (endTime ?? Date.now()) - startTime - pausedMs)
}

function compact(value: unknown, maxLength = 140): string | null {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function phaseTitles(task: LocalWorkflowTaskState): string[] {
  const titles: string[] = []
  const add = (title: unknown) => {
    const value = typeof title === 'string' ? title.trim() : ''
    if (value && !titles.includes(value)) titles.push(value)
  }
  for (const phase of task.phaseDefinitions ?? []) add(phase.title)
  for (const phase of task.phases ?? []) add(phase)
  for (const agent of task.agents ?? []) add(agent.phase ?? undefined)
  return titles
}

function agentElapsed(agent: WorkflowAgentTaskProgress): number {
  if (typeof agent.durationMs === 'number') return Math.max(0, agent.durationMs)
  if (!agent.startedAt) return 0
  return Math.max(0, Date.now() - agent.startedAt)
}

function sumAgents(
  agents: readonly WorkflowAgentTaskProgress[],
  field: 'tokens' | 'toolCalls',
): number {
  return agents.reduce((sum, agent) => sum + (agent[field] ?? 0), 0)
}

function statusSummary(agents: readonly WorkflowAgentTaskProgress[]): string {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
}

function findRun(items: readonly WorkflowRunItem[], runId: string): WorkflowRunItem | null {
  return items.find(item => item.runId === runId || item.id === runId) ?? null
}

function runPhases(item: WorkflowRunItem): string[] {
  return item.kind === 'live' ? phaseTitles(item.task) : []
}

function selectedAgent(
  item: WorkflowRunItem | null,
  selectedIndex: number,
  phase?: string,
): WorkflowAgentTaskProgress | null {
  if (!item || item.kind !== 'live') return null
  const agents = phase
    ? item.task.agents.filter(agent => agent.phase === phase)
    : item.task.agents
  return agents[selectedIndex] ?? null
}

export function shouldRouteWorkflowAgentControl(
  mode: WorkflowDialogMode,
): boolean {
  return mode === 'phase' || mode === 'agent'
}

function inputGuide(mode: WorkflowDialogMode) {
  return () => (
    <Byline>
      {mode === 'save' ? (
        <>
          <KeyboardShortcutHint shortcut="Tab" action="switch scope" />
          <KeyboardShortcutHint shortcut="Enter" action="save" />
          <KeyboardShortcutHint shortcut="Esc" action="back" />
        </>
      ) : (
        <>
          <KeyboardShortcutHint shortcut="up/down" action="select" />
          <KeyboardShortcutHint shortcut="Enter/right" action="open" />
          <KeyboardShortcutHint shortcut="Esc/left" action="back" />
          {mode === 'agent' ? <KeyboardShortcutHint shortcut="j/k" action="scroll" /> : null}
          <KeyboardShortcutHint shortcut="p" action="pause/resume" />
          <KeyboardShortcutHint shortcut="x" action="stop" />
          <KeyboardShortcutHint shortcut="r" action="retry agent" />
          <KeyboardShortcutHint shortcut="s" action="save" />
        </>
      )}
    </Byline>
  )
}

export function WorkflowRunsDialog({ onDone }: Props): React.ReactNode {
  const tasks = useAppState(state => state.tasks)
  const setAppState = useSetAppState()
  const [view, setView] = useState<ViewState>({ mode: 'list' })
  const [selectedRunIndex, setSelectedRunIndex] = useState(0)
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0)
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0)
  const [agentScroll, setAgentScroll] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  const items = useMemo<WorkflowRunItem[]>(() => {
    const live = Object.values(tasks ?? {})
      .filter(isWorkflowTask)
      .map(task => ({
        kind: 'live' as const,
        id: task.id,
        runId: task.workflowRunId ?? task.runId,
        name: task.workflowName,
        status: task.paused ? 'paused' : task.status,
        task,
      }))
      .sort((a, b) => b.task.startTime - a.task.startTime)
    const liveRunIds = new Set(live.map(item => item.runId))
    const history = listWorkflowRuns()
      .filter(run => !liveRunIds.has(run.runId))
      .map(run => ({
        kind: 'history' as const,
        id: run.runId,
        runId: run.runId,
        name: run.workflowName,
        status: run.status,
        meta: run,
      }))
    return [...live, ...history]
  }, [tasks])

  const selectedRun =
    view.mode === 'list'
      ? items[selectedRunIndex] ?? null
      : findRun(items, view.runId)
  const phases = selectedRun ? runPhases(selectedRun) : []
  const agents =
    selectedRun?.kind === 'live'
      ? view.mode === 'phase'
        ? selectedRun.task.agents.filter(agent => agent.phase === view.phase)
        : selectedRun.task.agents
      : []
  const currentAgent =
    view.mode === 'agent'
      ? selectedRun?.kind === 'live'
        ? selectedRun.task.agents.find(agent => agent.agentNumber === view.agentNumber) ?? null
        : null
      : selectedAgent(selectedRun, selectedAgentIndex, view.mode === 'phase' ? view.phase : undefined)

  const close = (result = t('cmd.workflows.dismissed')) =>
    onDone(result, { display: 'system' })

  const saveSelectedRun = (runId: string, scope: SaveScope) => {
    const result = saveRun(scope === 'user' ? [runId, '--user'] : [runId])
    setMessage(result)
    onDone(result, { display: 'system' })
  }

  const openSaveDialog = (run: WorkflowRunItem) => {
    const previous: WorkflowMainViewState =
      view.mode === 'save' ? view.previous : view
    setView({
      mode: 'save',
      runId: run.runId,
      scope: 'project',
      previous,
    })
  }

  const resumeSelectedRun = (run: WorkflowRunItem) => {
    const result =
      run.kind === 'live'
        ? buildWorkflowResumeResult(
            run.runId,
            run.task.scriptPath ?? runScriptPath(run.runId),
            run.task.args,
          )
        : resumeRunFromJournal(run.runId)
    onDone(result.message, {
      display: 'system',
      ...(result.nextInput
        ? { nextInput: result.nextInput, submitNextInput: true }
        : {}),
    })
  }

  useInput((_input, key) => {
    if (key.escape || key.leftArrow) {
      if (view.mode === 'save') {
        setView(view.previous)
        return
      }
      if (view.mode === 'agent') {
        setView({ mode: 'phase', runId: view.runId, phase: currentAgent?.phase ?? '' })
        setAgentScroll(0)
        return
      }
      if (view.mode === 'phase') {
        setView({ mode: 'run', runId: view.runId })
        return
      }
      if (view.mode === 'run') {
        setView({ mode: 'list' })
        return
      }
      close()
      return
    }

    if (view.mode === 'save') {
      if (key.tab) {
        setView({
          ...view,
          scope: view.scope === 'project' ? 'user' : 'project',
        })
        return
      }
      if (key.return) {
        saveSelectedRun(view.runId, view.scope)
      }
      return
    }

    if (_input === 's' && selectedRun) {
      openSaveDialog(selectedRun)
      return
    }

    const liveRun = selectedRun?.kind === 'live' ? selectedRun : null
    if (_input === 'p') {
      if (liveRun && liveRun.task.status === 'running' && !liveRun.task.paused) {
        const ok = pauseWorkflowTask(liveRun.task.id, setAppState)
        setMessage(ok ? t('cmd.workflows.paused', { runId: liveRun.runId }) : null)
      } else if (selectedRun) {
        resumeSelectedRun(selectedRun)
      }
      return
    }
    if (_input === 'x' && liveRun) {
      if (shouldRouteWorkflowAgentControl(view.mode) && currentAgent) {
        skipWorkflowAgent(liveRun.task.id, currentAgent.agentNumber, setAppState)
        setMessage(
          t('cmd.workflows.agentStopped', {
            runId: liveRun.runId,
            agentNumber: String(currentAgent.agentNumber),
          }),
        )
      } else {
        killWorkflowTask(liveRun.task.id, setAppState)
        setMessage(t('cmd.workflows.stopped', { runId: liveRun.runId }))
      }
      return
    }
    if (
      _input === 'r' &&
      liveRun &&
      shouldRouteWorkflowAgentControl(view.mode) &&
      currentAgent
    ) {
      if (currentAgent.status !== 'running') {
        setMessage(
          t('cmd.workflows.agentNotRunning', {
            runId: liveRun.runId,
            agentNumber: String(currentAgent.agentNumber),
          }),
        )
        return
      }
      retryWorkflowAgent(liveRun.task.id, currentAgent.agentNumber, setAppState)
      setMessage(
        t('cmd.workflows.agentRetryQueued', {
          runId: liveRun.runId,
          agentNumber: String(currentAgent.agentNumber),
        }),
      )
      return
    }

    if (view.mode === 'list') {
      if (key.upArrow) setSelectedRunIndex(index => Math.max(0, index - 1))
      if (key.downArrow) {
        setSelectedRunIndex(index => Math.min(Math.max(0, items.length - 1), index + 1))
      }
      if ((key.return || key.rightArrow) && selectedRun) {
        setView({ mode: 'run', runId: selectedRun.runId })
        setSelectedPhaseIndex(0)
        setSelectedAgentIndex(0)
      }
      return
    }

    if (view.mode === 'run') {
      if (key.upArrow) setSelectedPhaseIndex(index => Math.max(0, index - 1))
      if (key.downArrow) {
        setSelectedPhaseIndex(index => Math.min(Math.max(0, phases.length - 1), index + 1))
      }
      if ((key.return || key.rightArrow) && phases[selectedPhaseIndex]) {
        setView({ mode: 'phase', runId: view.runId, phase: phases[selectedPhaseIndex]! })
        setSelectedAgentIndex(0)
      }
    }

    if (view.mode === 'phase') {
      if (key.upArrow) setSelectedAgentIndex(index => Math.max(0, index - 1))
      if (key.downArrow) {
        setSelectedAgentIndex(index => Math.min(Math.max(0, agents.length - 1), index + 1))
      }
      if ((key.return || key.rightArrow) && currentAgent) {
        setView({
          mode: 'agent',
          runId: view.runId,
          agentNumber: currentAgent.agentNumber,
        })
        setAgentScroll(0)
      }
    }

    if (view.mode === 'agent') {
      if (_input === 'j' || key.downArrow) setAgentScroll(offset => offset + 1)
      if (_input === 'k' || key.upArrow) setAgentScroll(offset => Math.max(0, offset - 1))
    }
  })

  const subtitle = selectedRun ? (
    <Text>
      <Text color={statusColor(selectedRun.status)}>{statusGlyph(selectedRun.status)} {selectedRun.status}</Text>
      <Text dimColor> · {selectedRun.runId}</Text>
    </Text>
  ) : undefined

  return (
    <Dialog
      title={t('cmd.workflows.dialogTitle')}
      subtitle={subtitle}
      onCancel={() => close()}
      color="background"
      inputGuide={inputGuide(view.mode)}
    >
      {items.length === 0 ? (
        <Box flexDirection="column">
          <Text>{t('cmd.workflows.empty')}</Text>
          <Text dimColor>{t('cmd.workflows.emptyHint')}</Text>
        </Box>
      ) : null}
      {items.length > 0 && view.mode === 'list' ? (
        <Box flexDirection="column">
          {items.map((item, index) => (
            <Text key={item.id} color={index === selectedRunIndex ? 'suggestion' : undefined}>
              {index === selectedRunIndex ? '> ' : '  '}
              {statusGlyph(item.status)} {item.name}{' '}
              <Text dimColor>
                {item.runId} · {item.status}
                {item.kind === 'live'
                  ? ` · ${formatNumber(item.task.agentCount)} agents · ${formatNumber(item.task.tokensSpent)} tok`
                  : item.meta.agentCount != null
                    ? ` · ${formatNumber(item.meta.agentCount)} agents`
                    : ''}
              </Text>
            </Text>
          ))}
          {message ? <Text color="warning">{message}</Text> : null}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'run' ? (
        <Box flexDirection="column">
          <Text bold>{selectedRun.name}</Text>
          {selectedRun.kind === 'live' ? (
            <>
              <Text dimColor>
                {formatNumber(selectedRun.task.agentCount)} agents ·{' '}
                {formatNumber(selectedRun.task.tokensSpent)} tok ·{' '}
                {formatNumber(selectedRun.task.totalToolCalls)} tools ·{' '}
                {formatDuration(
                  elapsedMs(
                    selectedRun.task.startTime,
                    selectedRun.task.endTime,
                    selectedRun.task.totalPausedMs ?? 0,
                  ),
                  { mostSignificantOnly: true },
                )}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {phases.map((phase, index) => {
                  const phaseAgents = selectedRun.task.agents.filter(agent => agent.phase === phase)
                  const selected = index === selectedPhaseIndex
                  return (
                    <Text key={phase} color={selected ? 'suggestion' : undefined}>
                      {selected ? '> ' : '  '}
                      {phase}{' '}
                      <Text dimColor>
                        · {phaseAgents.length} agents · {statusSummary(phaseAgents)}
                        {' '}· {formatNumber(sumAgents(phaseAgents, 'tokens'))} tok
                        {' '}· {formatNumber(sumAgents(phaseAgents, 'toolCalls'))} tools
                      </Text>
                    </Text>
                  )
                })}
              </Box>
            </>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>
                {selectedRun.meta.agentCount ?? 0} agents · ~
                {selectedRun.meta.tokensSpent ?? 0} tok
              </Text>
              {loadRunLog(selectedRun.runId).slice(-8).map(line => (
                <Text key={line} dimColor>{line}</Text>
              ))}
            </Box>
          )}
          {message ? <Text color="warning">{message}</Text> : null}
        </Box>
      ) : null}
      {selectedRun?.kind === 'live' && view.mode === 'phase' ? (
        <Box flexDirection="column">
          <Text bold>{view.phase}</Text>
          {agents.map((agent, index) => (
            <Text key={agent.agentNumber} color={index === selectedAgentIndex ? 'suggestion' : undefined}>
              {index === selectedAgentIndex ? '> ' : '  '}
              #{agent.agentNumber} {agent.label}{' '}
              <Text color={statusColor(agent.status)}>{agent.status}</Text>
              <Text dimColor>
                {' '}· {formatNumber(agent.tokens)} tok · {formatNumber(agent.toolCalls)} tools
              </Text>
            </Text>
          ))}
        </Box>
      ) : null}
      {selectedRun?.kind === 'live' && view.mode === 'agent' && currentAgent ? (
        <Box flexDirection="column">
          <Text bold>#{currentAgent.agentNumber} {currentAgent.label}</Text>
          <Text color={statusColor(currentAgent.status)}>
            {currentAgent.status}
            <Text dimColor>
              {' '}· {formatNumber(currentAgent.tokens)} tok ·{' '}
              {formatNumber(currentAgent.toolCalls)} tools ·{' '}
              {formatDuration(agentElapsed(currentAgent), { mostSignificantOnly: true })}
            </Text>
          </Text>
          {[
            currentAgent.promptPreview ? `Prompt: ${currentAgent.promptPreview}` : null,
            currentAgent.lastToolName
              ? `Tool: ${currentAgent.lastToolName}${currentAgent.lastToolSummary ? ` ${currentAgent.lastToolSummary}` : ''}`
              : null,
            currentAgent.resultPreview ? `Result: ${currentAgent.resultPreview}` : null,
            currentAgent.error ? `Error: ${currentAgent.error}` : null,
          ]
            .filter((line): line is string => Boolean(line))
            .slice(agentScroll, agentScroll + 8)
            .map(line => (
              <Text key={line} wrap="wrap">{compact(line, 220)}</Text>
            ))}
        </Box>
      ) : null}
      {selectedRun && view.mode === 'save' ? (
        <Box flexDirection="column">
          <Text bold>{t('cmd.workflows.saveDialogTitle')}</Text>
          <Text>
            {t('cmd.workflows.saveDialogRun')}: {selectedRun.name}{' '}
            <Text dimColor>{selectedRun.runId}</Text>
          </Text>
          <Text>
            {t('cmd.workflows.saveDialogName')}: /
            {deriveWorkflowSaveName({
              runId: selectedRun.runId,
              metaName: selectedRun.name,
            })}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {(['project', 'user'] as const).map(scope => (
              <Text key={scope} color={view.scope === scope ? 'suggestion' : undefined}>
                {view.scope === scope ? '> ' : '  '}
                {scope === 'project'
                  ? t('cmd.workflows.saveScopeProject')
                  : t('cmd.workflows.saveScopeUser')}
              </Text>
            ))}
          </Box>
          <Text dimColor>{t('cmd.workflows.saveDialogHint')}</Text>
        </Box>
      ) : null}
    </Dialog>
  )
}
