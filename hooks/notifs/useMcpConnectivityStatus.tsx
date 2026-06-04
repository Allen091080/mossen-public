import * as React from 'react'
import { useEffect } from 'react'
import { useNotifications } from 'src/context/notifications.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { Text } from '../../ink.js'
import { hasHostedMcpEverConnected } from '../../services/mcp/hosted.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'

type Props = {
  mcpClients?: MCPServerConnection[]
}

const EMPTY_MCP_CLIENTS: MCPServerConnection[] = []

export function useMcpConnectivityStatus({
  mcpClients = EMPTY_MCP_CLIENTS,
}: Props): void {
  const { addNotification } = useNotifications()

  useEffect(() => {
    if (getIsRemoteMode()) {
      return
    }

    const failedLocalClients = mcpClients.filter(
      client =>
        client.type === 'failed' &&
        client.config.type !== 'sse-ide' &&
        client.config.type !== 'ws-ide' &&
        client.config.type !== 'hosted-proxy',
    )
    const failedHostedConnectorClients = mcpClients.filter(
      client =>
        client.type === 'failed' &&
        client.config.type === 'hosted-proxy' &&
        hasHostedMcpEverConnected(client.name),
    )
    const needsAuthLocalServers = mcpClients.filter(
      client =>
        client.type === 'needs-auth' &&
        client.config.type !== 'hosted-proxy',
    )
    const needsAuthHostedConnectorServers = mcpClients.filter(
      client =>
        client.type === 'needs-auth' &&
        client.config.type === 'hosted-proxy' &&
        hasHostedMcpEverConnected(client.name),
    )

    if (
      failedLocalClients.length === 0 &&
      failedHostedConnectorClients.length === 0 &&
      needsAuthLocalServers.length === 0 &&
      needsAuthHostedConnectorServers.length === 0
    ) {
      return
    }

    if (failedLocalClients.length > 0) {
      addNotification({
        key: 'mcp-failed',
        jsx: (
          <>
            <Text color="error">
              {failedLocalClients.length} MCP{' '}
              {failedLocalClients.length === 1 ? 'server' : 'servers'} failed
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      })
    }

    if (failedHostedConnectorClients.length > 0) {
      addNotification({
        key: 'mcp-hosted-failed',
        jsx: (
          <>
            <Text color="error">
              {failedHostedConnectorClients.length} hosted{' '}
              {failedHostedConnectorClients.length === 1
                ? 'connector'
                : 'connectors'}{' '}
              unavailable
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      })
    }

    if (needsAuthLocalServers.length > 0) {
      addNotification({
        key: 'mcp-needs-auth',
        jsx: (
          <>
            <Text color="warning">
              {needsAuthLocalServers.length} MCP{' '}
              {needsAuthLocalServers.length === 1
                ? 'server needs'
                : 'servers need'}{' '}
              auth
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      })
    }

    if (needsAuthHostedConnectorServers.length > 0) {
      addNotification({
        key: 'mcp-hosted-needs-auth',
        jsx: (
          <>
            <Text color="warning">
              {needsAuthHostedConnectorServers.length} hosted{' '}
              {needsAuthHostedConnectorServers.length === 1
                ? 'connector needs'
                : 'connectors need'}{' '}
              auth
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      })
    }
  }, [addNotification, mcpClients])
}
