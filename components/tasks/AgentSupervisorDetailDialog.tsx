import React, { useEffect, useRef, useState } from 'react'
import {
  appendAgentSupervisorChoice,
  appendAgentSupervisorUserMessage,
  readAgentSupervisorPeekSnapshot,
  type AgentSupervisorPeekSnapshot,
} from '../../services/agentSupervisor/interaction.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text, useInput } from '../../ink.js'
import { t } from '../../utils/i18n/index.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import TextInput from '../TextInput.js'

type Props = {
  jobId: string
  onBack: () => void
}

const REFRESH_MS = 2000

function formatDiagnostics(snapshot: AgentSupervisorPeekSnapshot): string | null {
  const {
    malformedOutputLines,
    partialOutputLine,
    malformedEventLines,
    partialEventLine,
  } = snapshot.diagnostics
  if (
    malformedOutputLines === 0 &&
    !partialOutputLine &&
    malformedEventLines === 0 &&
    !partialEventLine
  ) {
    return null
  }
  return `outputBad=${malformedOutputLines} outputPartial=${partialOutputLine} eventBad=${malformedEventLines} eventPartial=${partialEventLine}`
}

function optionKeyMatches(input: string, key: string): boolean {
  return input.toLowerCase() === key.toLowerCase()
}

function hasInputReceivedAck(snapshot: AgentSupervisorPeekSnapshot): boolean {
  return snapshot.eventLines.some(line => line.includes('input received'))
}

function formatDetailValue(value: string | null | undefined): string {
  return value?.trim() || '—'
}

export function AgentSupervisorDetailDialog({
  jobId,
  onBack,
}: Props): React.ReactNode {
  const [snapshot, setSnapshot] = useState<AgentSupervisorPeekSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyCursorOffset, setReplyCursorOffset] = useState(0)
  const replyRef = useRef('')
  const replyCursorOffsetRef = useRef(0)
  const [sending, setSending] = useState(false)
  const [lastSentReply, setLastSentReply] = useState<string | null>(null)
  const [lastSentReplyAcked, setLastSentReplyAcked] = useState(false)
  const { columns: terminalColumns } = useTerminalSize()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      try {
        const next = await readAgentSupervisorPeekSnapshot(jobId)
        if (cancelled) return
        setSnapshot(next)
        if (lastSentReply && !lastSentReplyAcked && hasInputReceivedAck(next)) {
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'escape' || (e.key === 'left' && reply.length === 0)) {
      e.preventDefault()
      onBack()
      return
    }
    if (e.key === 'tab' && snapshot?.lastQuestion?.suggestedReply) {
      e.preventDefault()
      setReplyValue(snapshot.lastQuestion.suggestedReply)
      return
    }
    if (e.ctrl || e.meta || e.key.length !== 1) return
    const option = snapshot?.lastQuestion?.options.find(item =>
      optionKeyMatches(e.key, item.key),
    )
    if (reply.length === 0 && option) {
      e.preventDefault()
      void sendChoice(option.key)
      return
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
    if (key.ctrl || key.meta) return
    if (key.escape || (key.leftArrow && replyRef.current.length === 0)) {
      event.stopImmediatePropagation()
      onBack()
      return
    }
    if (key.backspace || key.delete) {
      const current = replyRef.current
      if (!current) return
      event.stopImmediatePropagation()
      const cursor = Math.max(
        0,
        Math.min(replyCursorOffsetRef.current, current.length),
      )
      const start = key.backspace ? Math.max(0, cursor - 1) : cursor
      const end = key.backspace ? cursor : Math.min(current.length, cursor + 1)
      setReplyValue(`${current.slice(0, start)}${current.slice(end)}`, start)
      setError(null)
      return
    }
    if (key.leftArrow) {
      event.stopImmediatePropagation()
      setReplyValue(
        replyRef.current,
        Math.max(0, replyCursorOffsetRef.current - 1),
      )
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
    const cursor = Math.max(
      0,
      Math.min(replyCursorOffsetRef.current, current.length),
    )
    const newlineIndex = input.search(/[\r\n]/)
    const insertedText = newlineIndex >= 0 ? input.slice(0, newlineIndex) : input
    const next = `${current.slice(0, cursor)}${insertedText}${current.slice(cursor)}`
    setReplyValue(next, cursor + insertedText.length)
    setError(null)
    if (newlineIndex >= 0) {
      void sendReply(next)
    }
  })

  const inputLines = snapshot?.inputLines ?? []
  const outputLines = snapshot?.outputLines ?? []
  const eventLines = snapshot?.eventLines ?? []
  const resultPayload = snapshot?.resultPayload ?? null
  const diagnostics = snapshot ? formatDiagnostics(snapshot) : null
  const title = snapshot
    ? `${snapshot.job.id} · ${snapshot.job.status} · ${snapshot.job.title}`
    : `${jobId} · ${t('ui.agentView.loading')}`
  const inputGuide = () => (
    <Byline>
      <KeyboardShortcutHint shortcut="←/Esc" action={t('ui.agentView.back')} />
      <KeyboardShortcutHint shortcut="Enter" action={t('ui.agentView.sendReply')} />
      <KeyboardShortcutHint shortcut="Tab" action={t('ui.agentView.acceptSuggestion')} />
    </Byline>
  )

  // Two-pass rendering used to cause visible character overlap when the
  // dialog mounted: pass 1 (snapshot=null) drew a short layout, pass 2
  // (snapshot loaded) drew a much taller layout. Ink's differential
  // renderer wrote the additional rows using cursor-forward sequences
  // that landed on screen cells previously occupied by the dashboard
  // frame, leaving artefacts like "Cmpleted" (the 'o' character had been
  // skipped instead of overwritten). Returning null until the first
  // snapshot arrives keeps Ink from committing the short frame at all,
  // so the first paint is the full layout — eliminating the "文字叠加
  // 重叠" Allen reported. The polling effect above is mounted first via
  // a parent ref, so this null return does not stall the load.
  if (!snapshot) {
    return null
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title={title} onCancel={onBack} color="background" inputGuide={inputGuide}>
        <Box flexDirection="column">
          {snapshot && (
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
              <Text dimColor>{t('ui.agentView.detailControls')}</Text>
            </Box>
          )}
          {snapshot?.lastQuestion && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>{t('ui.agentView.pendingQuestion')}</Text>
              <Text wrap="wrap">{snapshot.lastQuestion.text}</Text>
              {snapshot.lastQuestion.options.length > 0 && (
                <Text dimColor>
                  {snapshot.lastQuestion.options
                    .map(option => `${option.key}: ${option.label}`)
                    .join(' · ')}
                </Text>
              )}
            </Box>
          )}
          {inputLines.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold dimColor>
                {t('ui.agentView.detailInputs')}
              </Text>
              {inputLines.map((line, index) => (
                <Text key={`input-${index}`} dimColor wrap="truncate-end">
                  › {line}
                </Text>
              ))}
            </Box>
          )}
          {resultPayload && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>{t('ui.agentView.resultPayload')}</Text>
              <Text wrap="wrap">{resultPayload.summary}</Text>
              {resultPayload.artifacts.length > 0 && (
                <Text dimColor wrap="truncate-end">
                  {t('ui.agentView.resultArtifacts')}: {resultPayload.artifacts.map(item => item.label).join(' · ')}
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
          <Text bold dimColor>
            {t('ui.agentView.detailOutput')}
          </Text>
          {outputLines.length > 0 ? (
            outputLines.map((line, index) => (
              <Text key={`out-${index}`} wrap="truncate-end">
                {line}
              </Text>
            ))
          ) : (
            <Text dimColor>{t('ui.agentView.noRecentOutput')}</Text>
          )}
          {eventLines.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>
                {t('ui.agentView.detailEvents')}
              </Text>
              {eventLines.map((line, index) => (
                <Text key={`event-${index}`} dimColor wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
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
          {lastSentReply && (
            <Text dimColor>
              {t('ui.agentView.replySent')}
              {lastSentReplyAcked ? `/${t('ui.agentView.replyAcked')}` : ''}: {lastSentReply}
            </Text>
          )}
          {sending && <Text dimColor>{t('ui.agentView.sendingReply')}</Text>}
          {diagnostics && <Text color="warning">{diagnostics}</Text>}
          {error && <Text color="warning">{error}</Text>}
        </Box>
      </Dialog>
    </Box>
  )
}
