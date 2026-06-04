import * as React from 'react'
import { useInterval } from 'usehooks-ts'
import {
  getIsRemoteMode,
  getIsScrollDraining,
} from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import { Text } from '../../ink.js'
import {
  getInitializationStatus,
  getLspServerManager,
} from '../../services/lsp/manager.js'
import { useSetAppState } from '../../state/AppState.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

const LSP_POLL_INTERVAL_MS = 5000

function shouldSuppressLspNotification(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase()
  return (
    normalized.includes("enoent") ||
    normalized.includes("command not found") ||
    normalized.includes("not found in path") ||
    normalized.includes("spawn ") && normalized.includes(" not found")
  )
}

/**
 * Hook that polls LSP status and shows a notification when:
 * 1. Manager initialization fails
 * 2. Any LSP server enters an error state
 *
 * Also adds errors to appState.plugins.errors for /doctor display.
 *
 * Only active when ENABLE_LSP_TOOL is set.
 */
export function useLspInitializationNotification(): void {
  const { addNotification } = useNotifications()
  const setAppState = useSetAppState()
  const [shouldPoll, setShouldPoll] = React.useState(() =>
    isEnvTruthy('true'),
  )
  const notifiedErrorsRef = React.useRef<Set<string>>(new Set())

  const addError = React.useCallback(
    (source: string, errorMessage: string) => {
      const errorKey = `${source}:${errorMessage}`
      if (notifiedErrorsRef.current.has(errorKey)) {
        return
      }
      notifiedErrorsRef.current.add(errorKey)

      logForDebugging(`LSP error: ${source} - ${errorMessage}`)

      setAppState(prev => {
        const existingKeys = new Set(
          prev.plugins.errors.map(e => {
            if (e.type === 'generic-error') {
              return `generic-error:${e.source}:${e.error}`
            }
            return `${e.type}:${e.source}`
          }),
        )

        const stateErrorKey = `generic-error:${source}:${errorMessage}`
        if (existingKeys.has(stateErrorKey)) {
          return prev
        }

        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            errors: [
              ...prev.plugins.errors,
              {
                type: 'generic-error' as const,
                source,
                error: errorMessage,
              },
            ],
          },
        }
      })

      const displayName = source.startsWith('plugin:')
        ? (source.split(':')[1] ?? source)
        : source

      if (shouldSuppressLspNotification(errorMessage)) {
        logForDebugging(
          `Suppressing user-visible LSP notification for soft failure: ${source} - ${errorMessage}`,
        )
        return
      }

      addNotification({
        key: `lsp-error-${source}`,
        jsx: (
          <>
            <Text color="warning">
              {getLocalizedText({
                en: `Code intelligence for ${displayName} is temporarily unavailable`,
                zh: `${displayName} 的代码智能暂时不可用`,
              })}
            </Text>
            <Text dimColor>
              {getLocalizedText({
                en: ' · /plugin for details',
                zh: ' · /plugin 查看详情',
              })}
            </Text>
          </>
        ),
        priority: 'low',
        timeoutMs: 5000,
      })
    },
    [addNotification, setAppState],
  )

  const poll = React.useCallback(() => {
    if (getIsRemoteMode()) return
    if (getIsScrollDraining()) return

    const status = getInitializationStatus()
    if (status.status === 'failed') {
      addError('lsp-manager', status.error.message)
      setShouldPoll(false)
      return
    }

    if (status.status === 'pending' || status.status === 'not-started') {
      return
    }

    const manager = getLspServerManager()
    if (manager) {
      const servers = manager.getAllServers()
      for (const [serverName, server] of servers) {
        if (server.state === 'error' && server.lastError) {
          addError(serverName, server.lastError.message)
        }
      }
    }
  }, [addError])

  useInterval(poll, shouldPoll ? LSP_POLL_INTERVAL_MS : null)

  React.useEffect(() => {
    if (getIsRemoteMode() || !shouldPoll) return
    poll()
  }, [poll, shouldPoll])
}
