import React, { useCallback, useState } from 'react'
import { useTerminalSize } from 'src/hooks/useTerminalSize.js'
import {
  type CodeSession,
  fetchCodeSessionsFromSessionsAPI,
} from 'src/utils/teleport/api.js'
import { Box, Text, useInput } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js'
import { getProductAssistantName } from '../constants/product.js'
import { logForDebugging } from '../utils/debug.js'
import { detectCurrentRepository } from '../utils/detectRepository.js'
import { formatRelativeTime } from '../utils/format.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Spinner } from './Spinner.js'
import { TeleportError } from './TeleportError.js'

type Props = {
  onSelect: (session: CodeSession) => void
  onCancel: () => void
  isEmbedded?: boolean
}

type LoadErrorType = 'network' | 'auth' | 'api' | 'other'

const UPDATED_STRING = getLocalizedText({ en: 'Updated', zh: '更新时间' })
const SPACE_BETWEEN_TABLE_COLUMNS = '  '

export function ResumeTask({
  onSelect,
  onCancel,
  isEmbedded = false,
}: Props): React.ReactNode {
  const assistantName = getProductAssistantName()
  const { rows } = useTerminalSize()
  const [sessions, setSessions] = useState<CodeSession[]>([])
  const [currentRepo, setCurrentRepo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErrorType, setLoadErrorType] = useState<LoadErrorType | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [hasCompletedTeleportErrorFlow, setHasCompletedTeleportErrorFlow] =
    useState(false)
  const [focusedIndex, setFocusedIndex] = useState(1)
  const escKey = useShortcutDisplay('confirm:no', 'Confirmation', 'Esc')

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true)
      setLoadErrorType(null)

      const detectedRepo = await detectCurrentRepository()
      setCurrentRepo(detectedRepo)
      logForDebugging(
        `Current repository: ${detectedRepo || 'not detected'}`,
      )

      const codeSessions = await fetchCodeSessionsFromSessionsAPI()
      let filteredSessions = codeSessions
      if (detectedRepo) {
        filteredSessions = codeSessions.filter(session => {
          if (!session.repo) {
            return false
          }
          const sessionRepo = `${session.repo.owner.login}/${session.repo.name}`
          return sessionRepo === detectedRepo
        })
        logForDebugging(
          `Filtered ${filteredSessions.length} sessions for repo ${detectedRepo} from ${codeSessions.length} total`,
        )
      }

      const sortedSessions = [...filteredSessions].sort((a, b) => {
        const dateA = new Date(a.updated_at)
        const dateB = new Date(b.updated_at)
        return dateB.getTime() - dateA.getTime()
      })
      setSessions(sortedSessions)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logForDebugging(`Error loading code sessions: ${errorMessage}`)
      setLoadErrorType(determineErrorType(errorMessage))
    } finally {
      setLoading(false)
      setRetrying(false)
    }
  }, [])

  const handleRetry = () => {
    setRetrying(true)
    void loadSessions()
  }

  useKeybinding('confirm:no', onCancel, { context: 'Confirmation' })

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel()
      return
    }

    if (key.ctrl && input === 'r' && loadErrorType) {
      handleRetry()
      return
    }

    if (loadErrorType !== null && key.return) {
      onCancel()
    }
  })

  const handleErrorComplete = useCallback(() => {
    setHasCompletedTeleportErrorFlow(true)
    void loadSessions()
  }, [loadSessions])

  if (!hasCompletedTeleportErrorFlow) {
    return <TeleportError onComplete={handleErrorComplete} />
  }

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="row">
          <Spinner />
          <Text bold>
            {getLocalizedText({
              en: `Loading ${assistantName} sessions...`,
              zh: `正在加载 ${assistantName} 会话...`,
            })}
          </Text>
        </Box>
        <Text dimColor>
          {retrying
            ? getLocalizedText({ en: 'Retrying...', zh: '正在重试...' })
            : getLocalizedText({
                en: `Fetching your ${assistantName} sessions...`,
                zh: `正在获取你的 ${assistantName} 会话...`,
              })}
        </Text>
      </Box>
    )
  }

  if (loadErrorType) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          {getLocalizedText({
            en: `Error loading ${assistantName} sessions`,
            zh: `加载 ${assistantName} 会话时出错`,
          })}
        </Text>

        {renderErrorSpecificGuidance(loadErrorType, assistantName)}

        <Text dimColor>
          {getLocalizedText({ en: 'Press ', zh: '按 ' })}
          <Text bold>Ctrl+R</Text>
          {getLocalizedText({ en: ' to retry · Press ', zh: ' 重试 · 按 ' })}
          <Text bold>{escKey}</Text>
          {getLocalizedText({ en: ' to cancel', zh: ' 取消' })}
        </Text>
      </Box>
    )
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>
          {getLocalizedText({
            en: `No ${assistantName} sessions found`,
            zh: `未找到 ${assistantName} 会话`,
          })}
          {currentRepo && (
            <Text>
              {getLocalizedText({
                en: ` for ${currentRepo}`,
                zh: `（仓库：${currentRepo}）`,
              })}
            </Text>
          )}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            {getLocalizedText({ en: 'Press ', zh: '按 ' })}
            <Text bold>{escKey}</Text>
            {getLocalizedText({ en: ' to cancel', zh: ' 取消' })}
          </Text>
        </Box>
      </Box>
    )
  }

  const sessionMetadata = sessions.map(session => ({
    ...session,
    timeString: formatRelativeTime(new Date(session.updated_at)),
  }))
  const maxTimeStringLength = Math.max(
    UPDATED_STRING.length,
    ...sessionMetadata.map(meta => meta.timeString.length),
  )
  const options = sessionMetadata.map(({ timeString, title, id }) => {
    const paddedTime = timeString.padEnd(maxTimeStringLength, ' ')
    return {
      label: `${paddedTime}  ${title}`,
      value: id,
    }
  })

  const layoutOverhead = 7
  const maxVisibleOptions = Math.max(
    1,
    isEmbedded
      ? Math.min(sessions.length, 5, rows - 6 - layoutOverhead)
      : Math.min(sessions.length, rows - 1 - layoutOverhead),
  )
  const maxHeight = maxVisibleOptions + layoutOverhead
  const showScrollPosition = sessions.length > maxVisibleOptions

  return (
    <Box flexDirection="column" padding={1} height={maxHeight}>
      <Text bold>
        {getLocalizedText({
          en: 'Select a session to resume',
          zh: '选择要恢复的会话',
        })}
        {showScrollPosition && (
          <Text dimColor>
            {' '}
            {getLocalizedText({
              en: `(${focusedIndex} of ${sessions.length})`,
              zh: `（第 ${focusedIndex} / ${sessions.length} 个）`,
            })}
          </Text>
        )}
        {currentRepo && <Text dimColor> ({currentRepo})</Text>}
        {getLocalizedText({ en: ':', zh: '：' })}
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Box marginLeft={2}>
          <Text bold>
            {UPDATED_STRING.padEnd(maxTimeStringLength, ' ')}
            {SPACE_BETWEEN_TABLE_COLUMNS}
            {getLocalizedText({ en: 'Session Title', zh: '会话标题' })}
          </Text>
        </Box>
        <Select
          visibleOptionCount={maxVisibleOptions}
          options={options}
          onChange={value => {
            const session = sessions.find(s => s.id === value)
            if (session) {
              onSelect(session)
            }
          }}
          onFocus={value => {
            const index = options.findIndex(o => o.value === value)
            if (index >= 0) {
              setFocusedIndex(index + 1)
            }
          }}
        />
      </Box>
      <Box flexDirection="row">
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Confirmation"
              fallback="Esc"
              description={getLocalizedText({ en: 'cancel', zh: '取消' })}
            />
          </Byline>
        </Text>
      </Box>
    </Box>
  )
}

function determineErrorType(errorMessage: string): LoadErrorType {
  const message = errorMessage.toLowerCase()
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return 'network'
  }
  if (
    message.includes('auth') ||
    message.includes('token') ||
    message.includes('permission') ||
    message.includes('not authenticated') ||
    message.includes('hosted adapter') ||
    message.includes('console account') ||
    message.includes('403')
  ) {
    return 'auth'
  }
  if (
    message.includes('api') ||
    message.includes('rate limit') ||
    message.includes('500') ||
    message.includes('529')
  ) {
    return 'api'
  }
  return 'other'
}

function renderErrorSpecificGuidance(
  errorType: LoadErrorType,
  assistantName: string,
): React.ReactNode {
  switch (errorType) {
    case 'network':
      return (
        <Box marginY={1} flexDirection="column">
          <Text dimColor>
            {getLocalizedText({
              en: 'Check your internet connection',
              zh: '请检查你的网络连接',
            })}
          </Text>
        </Box>
      )
    case 'auth':
      return (
        <Box marginY={1} flexDirection="column">
          <Text dimColor>
            {getLocalizedText({
              en: 'Teleport requires a configured Mossen bridge adapter.',
              zh: 'Teleport 需要配置 Mossen bridge adapter。',
            })}
          </Text>
          <Text dimColor>
            {getLocalizedText({
              en: 'Set MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 with your Mossen-managed bridge token, or use your own Mossen bridge endpoint.',
              zh: '设置 MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 并提供 Mossen 管理的 bridge token，或使用你自己的 Mossen bridge endpoint。',
            })}
          </Text>
        </Box>
      )
    case 'api':
      return (
        <Box marginY={1} flexDirection="column">
          <Text dimColor>
            {getLocalizedText({
              en: `Sorry, ${assistantName} encountered an error`,
              zh: `抱歉，${assistantName} 遇到了错误`,
            })}
          </Text>
        </Box>
      )
    case 'other':
      return (
        <Box marginY={1} flexDirection="row">
          <Text dimColor>
            {getLocalizedText({
              en: `Sorry, ${assistantName} encountered an error`,
              zh: `抱歉，${assistantName} 遇到了错误`,
            })}
          </Text>
        </Box>
      )
  }
}
