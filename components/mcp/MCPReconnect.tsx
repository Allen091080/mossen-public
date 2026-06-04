import figures from 'figures'
import React, { useEffect, useState } from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Box, color, Text, useTheme } from '../../ink.js'
import { useMcpReconnect } from '../../services/mcp/MCPConnectionManager.js'
import { useAppStateStore } from '../../state/AppState.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { Spinner } from '../Spinner.js'

type Props = {
  serverName: string
  onComplete: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

export function MCPReconnect({
  serverName,
  onComplete,
}: Props): React.ReactNode {
  const [theme] = useTheme()
  const store = useAppStateStore()
  const reconnectMcpServer = useMcpReconnect()
  const [isReconnecting, setIsReconnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const serverNotFoundMessage = getLocalizedText({
    en: `MCP server "${serverName}" not found`,
    zh: `未找到 MCP 服务器“${serverName}”`,
  })
  const reconnectSuccessMessage = getLocalizedText({
    en: `Successfully reconnected to ${serverName}`,
    zh: `已成功重新连接到 ${serverName}`,
  })
  const needsAuthMessage = getLocalizedText({
    en: `${serverName} requires authentication`,
    zh: `${serverName} 需要认证`,
  })
  const needsAuthCompleteMessage = getLocalizedText({
    en: `${serverName} requires authentication. Use /mcp to authenticate.`,
    zh: `${serverName} 需要认证。请使用 /mcp 完成认证。`,
  })
  const reconnectFailedMessage = getLocalizedText({
    en: `Failed to reconnect to ${serverName}`,
    zh: `重新连接到 ${serverName} 失败`,
  })
  const reconnectingLabel = getLocalizedText({
    en: 'Reconnecting to',
    zh: '正在重新连接到',
  })
  const reconnectingDetail = getLocalizedText({
    en: 'Establishing connection to MCP server',
    zh: '正在建立到 MCP 服务器的连接',
  })
  const errorPrefix = getLocalizedText({ en: 'Error: ', zh: '错误：' })

  useEffect(() => {
    async function attemptReconnect() {
      try {
        const server = store
          .getState()
          .mcp.clients.find(c => c.name === serverName)

        if (!server) {
          setError(serverNotFoundMessage)
          setIsReconnecting(false)
          onComplete(serverNotFoundMessage)
          return
        }

        const result = await reconnectMcpServer(serverName)

        switch (result.client.type) {
          case 'connected':
            setIsReconnecting(false)
            onComplete(reconnectSuccessMessage)
            break
          case 'needs-auth':
            setError(needsAuthMessage)
            setIsReconnecting(false)
            onComplete(needsAuthCompleteMessage)
            break
          case 'pending':
          case 'failed':
          case 'disabled':
            setError(reconnectFailedMessage)
            setIsReconnecting(false)
            onComplete(reconnectFailedMessage)
            break
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setError(errorMessage)
        setIsReconnecting(false)
        onComplete(`${errorPrefix}${errorMessage}`)
      }
    }

    void attemptReconnect()
  }, [
    errorPrefix,
    needsAuthCompleteMessage,
    needsAuthMessage,
    onComplete,
    reconnectFailedMessage,
    reconnectMcpServer,
    reconnectSuccessMessage,
    serverName,
    serverNotFoundMessage,
    store,
  ])

  if (isReconnecting) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          {reconnectingLabel} <Text bold>{serverName}</Text>
        </Text>
        <Box>
          <Spinner />
          <Text> {reconnectingDetail}</Text>
        </Box>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box>
          <Text>{color('error', theme)(figures.cross)} </Text>
          <Text color="error">{reconnectFailedMessage}</Text>
        </Box>
        <Text dimColor>
          {errorPrefix}
          {error}
        </Text>
      </Box>
    )
  }

  return null
}
