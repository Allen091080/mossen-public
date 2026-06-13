import React, { useEffect, useRef, useState } from 'react'
import {
  appendAgentSupervisorChoice,
  appendAgentSupervisorUserMessage,
  readAgentSupervisorPeekSnapshot,
  type AgentSupervisorPeekSnapshot,
} from '../../services/agentSupervisor/interaction.js'
import {
  readAgentSupervisorWorktreeMetadata,
} from '../../services/agentSupervisor/worktreeIsolation.js'
import type { AgentSupervisorWorktree } from '../../services/agentSupervisor/schema.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text, useInput } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import { truncateVisual } from '../../utils/visualWidth.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import TextInput from '../TextInput.js'

type Props = {
  jobId: string
  onBack: () => void
  onAttach?: (jobId: string) => void
}

const REFRESH_MS = 2000
const PEEK_OUTPUT_LINE_LIMIT = 4
const PEEK_EVENT_LINE_LIMIT = 6

function optionKeyMatches(input: string, key: string): boolean {
  return input.toLowerCase() === key.toLowerCase()
}

function hasInputReceivedAck(snapshot: AgentSupervisorPeekSnapshot): boolean {
  return snapshot.eventLines.some(line => line.includes('input received'))
}

function formatDetailValue(value: string | null | undefined): string {
  return value?.trim() || '—'
}

function formatResultArtifact(
  artifact: NonNullable<AgentSupervisorPeekSnapshot['resultPayload']>['artifacts'][number],
): string {
  const target = artifact.url ?? artifact.path
  return target ? `${artifact.label}: ${target}` : artifact.label
}

function formatWorktreeLine(worktree: AgentSupervisorWorktree | null): string {
  if (!worktree?.path) return t('ui.agentView.worktreeNone')
  const parts = [
    worktree.path,
    worktree.baseBranch ? `branch ${worktree.baseBranch}` : null,
    worktree.dirty === true
      ? t('ui.agentView.worktreeDirty')
      : worktree.dirty === false
        ? t('ui.agentView.worktreeClean')
        : t('ui.agentView.worktreeUnknown'),
    worktree.cleanupEligible
      ? t('ui.agentView.worktreeCleanupEligible')
      : t('ui.agentView.worktreeKeepByDefault'),
    worktree.ownedByMossen
      ? t('ui.agentView.worktreeOwned')
      : t('ui.agentView.worktreeUnverifiedOwner'),
  ].filter((part): part is string => Boolean(part))
  return parts.join(' · ')
}

function isAttachable(snapshot: AgentSupervisorPeekSnapshot): boolean {
  return (
    snapshot.job.status === 'working' ||
    snapshot.job.status === 'queued' ||
    snapshot.job.status === 'needs_input' ||
    snapshot.job.status === 'idle'
  )
}

function buildActionSummary({
  snapshot,
  worktree,
  replyMode,
}: {
  snapshot: AgentSupervisorPeekSnapshot
  worktree: AgentSupervisorWorktree | null
  replyMode: boolean
}): string {
  const actions: string[] = []
  if (snapshot.lastQuestion) actions.push(t('ui.agentView.peekActionReply'))
  else if (!replyMode) actions.push(t('ui.agentView.peekActionFollowUp'))
  if (isAttachable(snapshot)) actions.push(t('ui.agentView.peekActionAttach'))
  if (snapshot.resultPayload) actions.push(t('ui.agentView.peekActionReview'))
  if (worktree?.path) {
    actions.push(
      worktree.dirty
        ? t('ui.agentView.peekActionKeepDirtyWorktree')
        : worktree.cleanupEligible
          ? t('ui.agentView.peekActionCleanupWorktree')
          : t('ui.agentView.peekActionKeepWorktree'),
    )
  }
  if (snapshot.job.status === 'failed' || snapshot.job.status === 'stopped') {
    actions.push(t('ui.agentView.peekActionRespawn'))
  }
  return actions.join(' · ')
}

export function AgentViewPeek({
  jobId,
  onBack,
  onAttach,
}: Props): React.ReactNode {
  const [snapshot, setSnapshot] = useState<AgentSupervisorPeekSnapshot | null>(null)
  const [worktree, setWorktree] = useState<AgentSupervisorWorktree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyCursorOffset, setReplyCursorOffset] = useState(0)
  const replyRef = useRef('')
  const replyCursorOffsetRef = useRef(0)
  const [sending, setSending] = useState(false)
  const [lastSentReply, setLastSentReply] = useState<string | null>(null)
  const [lastSentReplyAcked, setLastSentReplyAcked] = useState(false)
  const [activityLogVisible, setActivityLogVisible] = useState(false)
  const [manualReplyMode, setManualReplyMode] = useState(false)
  const { columns: terminalColumns } = useTerminalSize()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      try {
        const [nextSnapshot, nextWorktree] = await Promise.all([
          readAgentSupervisorPeekSnapshot(jobId),
          readAgentSupervisorWorktreeMetadata(jobId).catch(() => null),
        ])
        if (cancelled) return
        setSnapshot(nextSnapshot)
        setWorktree(nextWorktree)
        if (lastSentReply && !lastSentReplyAcked && hasInputReceivedAck(nextSnapshot)) {
          setLastSentReplyAcked(true)
        }
        setError(null)
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void refresh()
          }, REFRESH_MS)
        }
      }
    }
    void refresh()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId, lastSentReply, lastSentReplyAcked])

  const replyMode = Boolean(snapshot?.lastQuestion) || manualReplyMode

  const setReplyValue = (value: string, cursorOffset = value.length): void => {
    const safeOffset = Math.max(0, Math.min(cursorOffset, value.length))
    replyRef.current = value
    replyCursorOffsetRef.current = safeOffset
    setReply(value)
    setReplyCursorOffset(safeOffset)
  }

  const sendReply = async (overrideContent?: string): Promise<void> => {
    const content = (overrideContent ?? replyRef.current).trim()
    if (!content) return
    setSending(true)
    setError(null)
    try {
      setLastSentReplyAcked(false)
      await appendAgentSupervisorUserMessage(jobId, content)
      setLastSentReply(content)
      setReplyValue('', 0)
      setManualReplyMode(false)
      const nextSnapshot = await readAgentSupervisorPeekSnapshot(jobId)
      setLastSentReplyAcked(hasInputReceivedAck(nextSnapshot))
      setSnapshot(nextSnapshot)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError))
    } finally {
      setSending(false)
    }
  }

  const sendChoice = async (choiceKey: string): Promise<void> => {
    setSending(true)
    setError(null)
    try {
      setLastSentReplyAcked(false)
      await appendAgentSupervisorChoice(jobId, choiceKey)
      setLastSentReply(choiceKey)
      setReplyValue('', 0)
      const nextSnapshot = await readAgentSupervisorPeekSnapshot(jobId)
      setLastSentReplyAcked(hasInputReceivedAck(nextSnapshot))
      setSnapshot(nextSnapshot)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError))
    } finally {
      setSending(false)
    }
  }

  const leaveReplyOrBack = (): void => {
    if (manualReplyMode && !snapshot?.lastQuestion && replyRef.current.length === 0) {
      setManualReplyMode(false)
      return
    }
    onBack()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrl && e.key === 'e') {
      e.preventDefault()
      setActivityLogVisible(value => !value)
      return
    }
    if (e.key === 'escape' || (e.key === 'left' && reply.length === 0)) {
      e.preventDefault()
      leaveReplyOrBack()
      return
    }
    if (e.key === 'return' && !replyMode && snapshot && onAttach && isAttachable(snapshot)) {
      e.preventDefault()
      onAttach(jobId)
      return
    }
    if ((e.key === 'r' || e.key === 'f') && !replyMode) {
      e.preventDefault()
      setManualReplyMode(true)
      return
    }
    if (e.key === 'tab' && replyMode && snapshot?.lastQuestion?.suggestedReply) {
      e.preventDefault()
      setReplyValue(snapshot.lastQuestion.suggestedReply)
      return
    }
    if (!replyMode || e.ctrl || e.meta || e.key.length !== 1) return
    const option = snapshot?.lastQuestion?.options.find(item =>
      optionKeyMatches(e.key, item.key),
    )
    if (reply.length === 0 && option) {
      e.preventDefault()
      void sendChoice(option.key)
    }
  }

  const handleReplyChange = (value: string): void => {
    setReplyValue(value, Math.min(replyCursorOffsetRef.current, value.length))
    setError(null)
  }

  const handleReplySubmit = (): void => {
    void sendReply()
  }

  const handleReplyCursorOffsetChange = (value: number): void => {
    replyCursorOffsetRef.current = value
    setReplyCursorOffset(value)
  }

  useInput((input, key, event) => {
    if (!replyMode) return
    if (key.ctrl || key.meta) return
    if (key.escape || (key.leftArrow && replyRef.current.length === 0)) {
      event.stopImmediatePropagation()
      leaveReplyOrBack()
      return
    }
    if (key.backspace || key.delete) {
      const current = replyRef.current
      if (!current) return
      event.stopImmediatePropagation()
      const cursor = Math.max(0, Math.min(replyCursorOffsetRef.current, current.length))
      const start = key.backspace ? Math.max(0, cursor - 1) : cursor
      const end = key.backspace ? cursor : Math.min(current.length, cursor + 1)
      setReplyValue(`${current.slice(0, start)}${current.slice(end)}`, start)
      setError(null)
      return
    }
    if (key.leftArrow) {
      event.stopImmediatePropagation()
      setReplyValue(replyRef.current, Math.max(0, replyCursorOffsetRef.current - 1))
      return
    }
    if (key.rightArrow) {
      event.stopImmediatePropagation()
      setReplyValue(
        replyRef.current,
        Math.min(replyRef.current.length, replyCursorOffsetRef.current + 1),
      )
      return
    }
    if (key.tab && snapshot?.lastQuestion?.suggestedReply) {
      event.stopImmediatePropagation()
      setReplyValue(snapshot.lastQuestion.suggestedReply)
      return
    }
    if (key.return) {
      event.stopImmediatePropagation()
      void sendReply()
      return
    }
    if (!input) return
    if (input === ' ' && replyRef.current.length === 0) return
    event.stopImmediatePropagation()
    const current = replyRef.current
    const cursor = Math.max(0, Math.min(replyCursorOffsetRef.current, current.length))
    const newlineIndex = input.search(/[\r\n]/)
    const insertedText = newlineIndex >= 0 ? input.slice(0, newlineIndex) : input
    const next = `${current.slice(0, cursor)}${insertedText}${current.slice(cursor)}`
    setReplyValue(next, cursor + insertedText.length)
    setError(null)
    if (newlineIndex >= 0) {
      void sendReply(next)
    }
  })

  if (!snapshot) return null

  const recentOutputLines = snapshot.outputLines.slice(-PEEK_OUTPUT_LINE_LIMIT)
  const recentEventLines = snapshot.eventLines.slice(-PEEK_EVENT_LINE_LIMIT)
  const resultPayload = snapshot.resultPayload ?? null
  const actionSummary = buildActionSummary({ snapshot, worktree, replyMode })
  const title = `${t('ui.agentView.peekPanel')} · ${snapshot.job.status} · ${snapshot.job.title}`
  const inputGuide = () => (
    <Byline>
      <KeyboardShortcutHint shortcut="←/Esc" action={t('ui.agentView.back')} />
      {replyMode ? (
        <KeyboardShortcutHint shortcut="Enter" action={t('ui.agentView.sendReply')} />
      ) : (
        <KeyboardShortcutHint shortcut="r/f" action={t('ui.agentView.peekFollowUp')} />
      )}
      {snapshot.lastQuestion?.suggestedReply ? (
        <KeyboardShortcutHint shortcut="Tab" action={t('ui.agentView.acceptSuggestion')} />
      ) : null}
      {onAttach && isAttachable(snapshot) && !replyMode ? (
        <KeyboardShortcutHint shortcut="Enter" action={t('ui.agentView.attach')} />
      ) : null}
      <KeyboardShortcutHint
        shortcut="Ctrl+E"
        action={activityLogVisible ? t('ui.agentView.hideActivity') : t('ui.agentView.showActivity')}
      />
    </Byline>
  )

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title={title} onCancel={onBack} color="background" inputGuide={inputGuide}>
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{t('ui.agentView.detailStatus')}</Text>
            <Text dimColor wrap="truncate-end">
              {t('ui.agentView.detailStatusLine', {
                status: snapshot.job.status,
                model: formatDetailValue(snapshot.job.model),
                agent: formatDetailValue(snapshot.job.agent),
                permission: formatDetailValue(snapshot.job.permissionMode),
              })}
            </Text>
            <Text dimColor wrap="truncate-end">
              {t('ui.agentView.detailCwd')}: {snapshot.job.cwd}
            </Text>
            <Text dimColor wrap="truncate-end">
              {t('ui.agentView.detailSession')}: {formatDetailValue(snapshot.job.sessionId)}
            </Text>
            {snapshot.job.promptPreview && (
              <Text wrap="truncate-end">
                {t('ui.agentView.promptPreview')}: {snapshot.job.promptPreview}
              </Text>
            )}
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={worktree?.dirty ? 'warning' : undefined}>
              {t('ui.agentView.worktree')}
            </Text>
            <Text color={worktree?.dirty ? 'warning' : undefined} wrap="truncate-end">
              {formatWorktreeLine(worktree)}
            </Text>
          </Box>

          {snapshot.lastQuestion && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="warning">{t('ui.agentView.pendingQuestion')}</Text>
              <Text wrap="wrap">{snapshot.lastQuestion.text}</Text>
              {snapshot.lastQuestion.options.length > 0 && (
                <Text dimColor>
                  {t('ui.agentView.questionOptions')}: {' '}
                  {snapshot.lastQuestion.options
                    .map(option => `${option.key}: ${option.label}`)
                    .join(' · ')}
                </Text>
              )}
              {snapshot.lastQuestion.suggestedReply && (
                <Text dimColor wrap="truncate-end">
                  {t('ui.agentView.suggestedReply')}: {snapshot.lastQuestion.suggestedReply}
                </Text>
              )}
            </Box>
          )}

          {resultPayload && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>{t('ui.agentView.resultPayload')}</Text>
              <Text wrap="wrap">{resultPayload.summary}</Text>
              {resultPayload.artifacts.length > 0 && (
                <Text dimColor wrap="truncate-end">
                  {t('ui.agentView.resultArtifacts')}: {resultPayload.artifacts.map(formatResultArtifact).join(' · ')}
                </Text>
              )}
              {resultPayload.risks.length > 0 && (
                <Text color="warning" wrap="truncate-end">
                  {t('ui.agentView.resultRisks')}: {resultPayload.risks.join(' · ')}
                </Text>
              )}
              {resultPayload.nextActions.length > 0 && (
                <Text dimColor wrap="truncate-end">
                  {t('ui.agentView.resultNextActions')}: {resultPayload.nextActions.join(' · ')}
                </Text>
              )}
            </Box>
          )}

          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{t('ui.agentView.peekActions')}</Text>
            <Text wrap="truncate-end">{actionSummary || t('ui.agentView.peekActionInspect')}</Text>
          </Box>

          <Text bold>{t('ui.agentView.detailOutput')}</Text>
          {recentOutputLines.length > 0 ? (
            recentOutputLines.map((line, index) => (
              <Text key={`out-${index}`} wrap="truncate-end">
                {truncateVisual(line, Math.max(24, terminalColumns - 4))}
              </Text>
            ))
          ) : (
            <Text dimColor>{t('ui.agentView.noRecentOutput')}</Text>
          )}

          {snapshot.eventLines.length > 0 && !activityLogVisible && (
            <Box marginTop={1}>
              <Text dimColor>
                {t('ui.agentView.activityLogCollapsed', { count: snapshot.eventLines.length })}
              </Text>
            </Box>
          )}
          {activityLogVisible && snapshot.eventLines.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>{t('ui.agentView.detailEvents')}</Text>
              {recentEventLines.map((line, index) => (
                <Text key={`event-${index}`} dimColor wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          )}
          {activityLogVisible && snapshot.eventLines.length === 0 && (
            <Box marginTop={1}>
              <Text dimColor>{t('ui.agentView.noRecentEvents')}</Text>
            </Box>
          )}

          {replyMode ? (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text dimColor>{t('ui.agentView.detailReplyChannel')} · {t('ui.agentView.replyPrompt')} </Text>
                <TextInput
                  value={reply}
                  onChange={handleReplyChange}
                  onSubmit={handleReplySubmit}
                  columns={Math.max(20, terminalColumns - 18)}
                  cursorOffset={replyCursorOffset}
                  onChangeCursorOffset={handleReplyCursorOffsetChange}
                  focus
                  showCursor
                  maxVisibleLines={3}
                  placeholder={t('ui.agentView.replyPlaceholder')}
                />
              </Box>
              <Text dimColor>{t('ui.agentView.replySelectedJobOnly', { jobId: snapshot.job.id })}</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor>{t('ui.agentView.replyHiddenUntilRequested')}</Text>
            </Box>
          )}

          {lastSentReply && (
            <Text dimColor>
              {t('ui.agentView.replySent')}
              {lastSentReplyAcked ? `/${t('ui.agentView.replyAcked')}` : ''}: {lastSentReply}
            </Text>
          )}
          {sending && <Text dimColor>{t('ui.agentView.sendingReply')}</Text>}
          {error && <Text color="warning">{error}</Text>}
        </Box>
      </Dialog>
    </Box>
  )
}
