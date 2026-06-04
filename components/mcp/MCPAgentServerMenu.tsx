import figures from 'figures';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { AuthenticationCancelledError, performMCPOAuthFlow } from '../../services/mcp/auth.js';
import { capitalize } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Spinner } from '../Spinner.js';
import type { AgentMcpServerInfo } from './types.js';
type Props = {
  agentServer: AgentMcpServerInfo;
  onCancel: () => void;
  onComplete?: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};

/**
 * Menu for agent-specific MCP servers.
 * These servers are defined in agent frontmatter and only connect when the agent runs.
 * For HTTP/SSE servers, this allows pre-authentication before using the agent.
 */
export function MCPAgentServerMenu({
  agentServer,
  onCancel,
  onComplete
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const authAbortControllerRef = useRef<AbortController | null>(null);

  // Abort OAuth flow on unmount so the callback server is closed even if a
  // parent component's Esc handler navigates away before ours fires.
  useEffect(() => () => authAbortControllerRef.current?.abort(), []);

  // Handle ESC to cancel authentication flow
  const handleEscCancel = useCallback(() => {
    if (isAuthenticating) {
      authAbortControllerRef.current?.abort();
      authAbortControllerRef.current = null;
      setIsAuthenticating(false);
      setAuthorizationUrl(null);
    }
  }, [isAuthenticating]);
  useKeybinding('confirm:no', handleEscCancel, {
    context: 'Confirmation',
    isActive: isAuthenticating
  });
  const handleAuthenticate = useCallback(async () => {
    if (!agentServer.needsAuth || !agentServer.url) {
      return;
    }
    setIsAuthenticating(true);
    setError(null);
    const controller = new AbortController();
    authAbortControllerRef.current = controller;
    try {
      // Create a temporary config for OAuth
      const tempConfig = {
        type: agentServer.transport as 'http' | 'sse',
        url: agentServer.url
      };
      await performMCPOAuthFlow(agentServer.name, tempConfig, setAuthorizationUrl, controller.signal);
      onComplete?.(getLocalizedText({
        en: `Authentication successful for ${agentServer.name}. The server will connect when the agent runs.`,
        zh: `${agentServer.name} 认证成功。该服务器会在代理运行时连接。`
      }));
    } catch (err) {
      // Don't show error if it was a cancellation
      if (err instanceof Error && !(err instanceof AuthenticationCancelledError)) {
        setError(err.message);
      }
    } finally {
      setIsAuthenticating(false);
      authAbortControllerRef.current = null;
    }
  }, [agentServer, onComplete]);
  const capitalizedServerName = capitalize(String(agentServer.name));
  if (isAuthenticating) {
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="mossen">{getLocalizedText({
        en: `Authenticating with ${agentServer.name}…`,
        zh: `正在与 ${agentServer.name} 进行认证…`
      })}</Text>
        <Box>
          <Spinner />
          <Text> {getLocalizedText({
          en: 'A browser window will open for authentication',
          zh: '将打开浏览器窗口完成认证'
        })}</Text>
        </Box>
        {authorizationUrl && <Box flexDirection="column">
            <Text dimColor>
              {getLocalizedText({
              en: 'If your browser doesn’t open automatically, copy this URL manually:',
              zh: '如果浏览器没有自动打开，请手动复制这个链接：'
            })}
            </Text>
            <Link url={authorizationUrl} />
          </Box>}
        <Box marginLeft={3}>
          <Text dimColor>
            {getLocalizedText({
            en: 'Return here after authenticating in your browser.',
            zh: '在浏览器完成认证后回到这里。'
          })}{' '}
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
            en: 'go back',
            zh: '返回'
          })} />
          </Text>
        </Box>
      </Box>;
  }
  const menuOptions = [];

  // Only show authenticate option for HTTP/SSE servers
  if (agentServer.needsAuth) {
    menuOptions.push({
      label: agentServer.isAuthenticated ? getLocalizedText({
        en: 'Re-authenticate',
        zh: '重新认证'
      }) : getLocalizedText({
        en: 'Authenticate',
        zh: '认证'
      }),
      value: 'auth'
    });
  }
  menuOptions.push({
    label: getLocalizedText({
      en: 'Back',
      zh: '返回'
    }),
    value: 'back'
  });
  return <Dialog title={`${capitalizedServerName} MCP Server`} subtitle={getLocalizedText({
    en: 'agent-only',
    zh: '仅限代理'
  })} onCancel={onCancel} inputGuide={exitState => exitState.pending ? <Text>{getLocalizedText({
    en: `Press ${exitState.keyName} again to exit`,
    zh: `再按一次 ${exitState.keyName} 即可退出`
  })}</Text> : <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
            en: 'go back',
            zh: '返回'
          })} />
          </Byline>}>
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text bold>{getLocalizedText({
          en: 'Type: ',
          zh: '类型：'
        })}</Text>
          <Text dimColor>{agentServer.transport}</Text>
        </Box>

        {agentServer.url && <Box>
            <Text bold>URL: </Text>
            <Text dimColor>{agentServer.url}</Text>
          </Box>}

        {agentServer.command && <Box>
            <Text bold>{getLocalizedText({
            en: 'Command: ',
            zh: '命令：'
          })}</Text>
            <Text dimColor>{agentServer.command}</Text>
          </Box>}

        <Box>
          <Text bold>{getLocalizedText({
          en: 'Used by: ',
          zh: '使用方：'
        })}</Text>
          <Text dimColor>{agentServer.sourceAgents.join(', ')}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold>{getLocalizedText({
          en: 'Status: ',
          zh: '状态：'
        })}</Text>
          <Text>
            {color('inactive', theme)(figures.radioOff)} {getLocalizedText({
            en: 'not connected (agent-only)',
            zh: '未连接（仅限代理）'
          })}
          </Text>
        </Box>

        {agentServer.needsAuth && <Box>
            <Text bold>{getLocalizedText({
            en: 'Auth: ',
            zh: '认证：'
          })}</Text>
            {agentServer.isAuthenticated ? <Text>{color('success', theme)(figures.tick)} {getLocalizedText({
              en: 'authenticated',
              zh: '已认证'
            })}</Text> : <Text>
                {color('warning', theme)(figures.triangleUpOutline)} {getLocalizedText({
                en: 'may need authentication',
                zh: '可能需要认证'
              })}
              </Text>}
          </Box>}
      </Box>

      <Box>
        <Text dimColor>{getLocalizedText({
        en: 'This server connects only when running the agent.',
        zh: '该服务器仅会在运行代理时连接。'
      })}</Text>
      </Box>

      {error && <Box>
          <Text color="error">{getLocalizedText({
          en: 'Error: ',
          zh: '错误：'
        })}{error}</Text>
        </Box>}

      <Box>
        <Select options={menuOptions} onChange={async value => {
        switch (value) {
          case 'auth':
            await handleAuthenticate();
            break;
          case 'back':
            onCancel();
            break;
        }
      }} onCancel={onCancel} />
      </Box>
    </Dialog>;
}
