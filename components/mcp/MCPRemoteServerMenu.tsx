import figures from 'figures';
import React, { useEffect, useRef, useState } from 'react';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js';
import type { CommandResultDisplay } from '../../commands.js';
import { getOauthConfig } from '../../constants/oauth.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { setClipboard } from '../../ink/termio/osc.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw j/k/arrow menu navigation
import { Box, color, Link, Text, useInput, useTheme } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { AuthenticationCancelledError, performMCPOAuthFlow, revokeServerTokens } from '../../services/mcp/auth.js';
import { clearServerCache } from '../../services/mcp/client.js';
import { useMcpReconnect, useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { describeMcpConfigFilePath, excludeCommandsByServer, excludeResourcesByServer, excludeToolsByServer, filterMcpPromptsByServer } from '../../services/mcp/utils.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getProductAssistantName } from '../../constants/product.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { getHostedPlatformUrls, isCustomBackendEnabled } from '../../utils/customBackend.js';
import { errorMessage } from '../../utils/errors.js';
import { logMCPDebug } from '../../utils/log.js';
import { capitalize } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { Spinner } from '../Spinner.js';
import TextInput from '../TextInput.js';
import { CapabilitiesSection } from './CapabilitiesSection.js';
import type { HostedServerInfo, HTTPServerInfo, SSEServerInfo } from './types.js';
import { handleReconnectError, handleReconnectResult } from './utils/reconnectHelpers.js';
type Props = {
  server: SSEServerInfo | HTTPServerInfo | HostedServerInfo;
  serverToolsCount: number;
  onViewTools: () => void;
  onCancel: () => void;
  onComplete?: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  borderless?: boolean;
};
export function MCPRemoteServerMenu({
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false
}: Props): React.ReactNode {
  const assistantName = getProductAssistantName();
  const [theme] = useTheme();
  const exitState = useExitOnCtrlCDWithKeybindings();
  const {
    columns: terminalColumns
  } = useTerminalSize();
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mcp = useAppState(s => s.mcp);
  const setAppState = useSetAppState();
  const [authorizationUrl, setAuthorizationUrl] = React.useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const authAbortControllerRef = useRef<AbortController | null>(null);
  const [isHostedAuthenticating, setIsHostedAuthenticating] = useState(false);
  const [hostedAuthUrl, setHostedAuthUrl] = useState<string | null>(null);
  const [isHostedClearingAuth, setIsHostedClearingAuth] = useState(false);
  const [hostedClearAuthUrl, setHostedClearAuthUrl] = useState<string | null>(null);
  const [hostedClearAuthBrowserOpened, setHostedClearAuthBrowserOpened] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unmountedRef = useRef(false);
  const [callbackUrlInput, setCallbackUrlInput] = useState('');
  const [callbackUrlCursorOffset, setCallbackUrlCursorOffset] = useState(0);
  const [manualCallbackSubmit, setManualCallbackSubmit] = useState<((url: string) => void) | null>(null);

  // If the component unmounts mid-auth (e.g. a parent component's Esc handler
  // navigates away before ours fires), abort the OAuth flow so the callback
  // server is closed. Without this, the server stays bound and the process
  // can outlive the terminal. Also clear the copy-feedback timer and mark
  // unmounted so the async setClipboard callback doesn't setUrlCopied /
  // schedule a new timer after unmount.
  useEffect(() => () => {
    unmountedRef.current = true;
    authAbortControllerRef.current?.abort();
    if (copyTimeoutRef.current !== undefined) {
      clearTimeout(copyTimeoutRef.current);
    }
  }, []);

  // A server is effectively authenticated if:
  // 1. It has OAuth tokens (server.isAuthenticated), OR
  // 2. It's connected and has tools (meaning it's working via some auth mechanism)
  const isEffectivelyAuthenticated = server.isAuthenticated || server.client.type === 'connected' && serverToolsCount > 0;
  const reconnectMcpServer = useMcpReconnect();
  const handleHostedAuthComplete = React.useCallback(async () => {
    setIsHostedAuthenticating(false);
    setHostedAuthUrl(null);
    setIsReconnecting(true);
    try {
      const result = await reconnectMcpServer(server.name);
      const success = result.client.type === 'connected';
      logMossenEvent('mossen.mcp.hostedAuthCompleted', {
        success
      });
      if (success) {
        onComplete?.(getLocalizedText({
          en: `Authentication successful. Connected to ${server.name}.`,
          zh: `认证成功。已连接到 ${server.name}。`
        }));
      } else if (result.client.type === 'needs-auth') {
        onComplete?.(getLocalizedText({
          en: `Authentication successful, but the server still requires authentication. You may need to manually restart ${assistantName}.`,
          zh: `认证成功，但服务器仍然需要认证。你可能需要手动重启 ${assistantName}。`
        }));
      } else {
        onComplete?.(getLocalizedText({
          en: `Authentication successful, but the server reconnection failed. You may need to manually restart ${assistantName} for the changes to take effect.`,
          zh: `认证成功，但服务器重新连接失败。你可能需要手动重启 ${assistantName} 以让更改生效。`
        }));
      }
    } catch (err) {
      logMossenEvent('mossen.mcp.hostedAuthCompleted', {
        success: false
      });
      onComplete?.(handleReconnectError(err, server.name));
    } finally {
      setIsReconnecting(false);
    }
  }, [assistantName, reconnectMcpServer, server.name, onComplete]);
  const handleHostedClearAuthComplete = React.useCallback(async () => {
    await clearServerCache(server.name, {
      ...server.config,
      scope: server.scope
    });
    setAppState(prev => {
      const newClients = prev.mcp.clients.map(c => c.name === server.name ? {
        ...c,
        type: 'needs-auth' as const
      } : c);
      const newTools = excludeToolsByServer(prev.mcp.tools, server.name);
      const newCommands = excludeCommandsByServer(prev.mcp.commands, server.name);
      const newResources = excludeResourcesByServer(prev.mcp.resources, server.name);
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: newClients,
          tools: newTools,
          commands: newCommands,
          resources: newResources
        }
      };
    });
    logMossenEvent('mossen.mcp.hostedClearAuthCompleted', {});
    onComplete?.(getLocalizedText({
      en: `Disconnected from ${server.name}.`,
      zh: `已断开与 ${server.name} 的连接。`
    }));
    setIsHostedClearingAuth(false);
    setHostedClearAuthUrl(null);
    setHostedClearAuthBrowserOpened(false);
  }, [server.name, server.config, server.scope, setAppState, onComplete]);

  // Escape to cancel authentication flow
  useKeybinding('confirm:no', () => {
    authAbortControllerRef.current?.abort();
    authAbortControllerRef.current = null;
    setIsAuthenticating(false);
    setAuthorizationUrl(null);
  }, {
    context: 'Confirmation',
    isActive: isAuthenticating
  });

  // Escape to cancel hosted authentication
  useKeybinding('confirm:no', () => {
    setIsHostedAuthenticating(false);
    setHostedAuthUrl(null);
  }, {
    context: 'Confirmation',
    isActive: isHostedAuthenticating
  });

  // Escape to cancel hosted clear auth
  useKeybinding('confirm:no', () => {
    setIsHostedClearingAuth(false);
    setHostedClearAuthUrl(null);
    setHostedClearAuthBrowserOpened(false);
  }, {
    context: 'Confirmation',
    isActive: isHostedClearingAuth
  });

  // Return key handling for authentication flows and 'c' to copy URL
  useInput((input, key) => {
    if (key.return && isHostedAuthenticating) {
      void handleHostedAuthComplete();
    }
    if (key.return && isHostedClearingAuth) {
      if (hostedClearAuthBrowserOpened) {
        void handleHostedClearAuthComplete();
      } else {
        // First Enter: open the browser
        const connectorsUrl = isCustomBackendEnabled() ? getHostedPlatformUrls().connectorsUrl : `${getOauthConfig().HOSTED_ORIGIN}/settings/connectors`;
        setHostedClearAuthUrl(connectorsUrl);
        setHostedClearAuthBrowserOpened(true);
        void openBrowser(connectorsUrl);
      }
    }
    if (input === 'c' && !urlCopied) {
      const urlToCopy = authorizationUrl || hostedAuthUrl || hostedClearAuthUrl;
      if (urlToCopy) {
        void setClipboard(urlToCopy).then(raw => {
          if (unmountedRef.current) return;
          if (raw) process.stdout.write(raw);
          setUrlCopied(true);
          if (copyTimeoutRef.current !== undefined) {
            clearTimeout(copyTimeoutRef.current);
          }
          copyTimeoutRef.current = setTimeout(setUrlCopied, 2000, false);
        });
      }
    }
  });
  const capitalizedServerName = capitalize(String(server.name));

  // Count MCP prompts for this server (skills are shown in /skills, not here)
  const serverCommandsCount = filterMcpPromptsByServer(mcp.commands, server.name).length;
  const toggleMcpServer = useMcpToggleEnabled();
  const handleHostedAuth = React.useCallback(async () => {
    const hostedBaseUrl = getOauthConfig().HOSTED_ORIGIN;
    const accountInfo = getOauthAccountInfo();
    const orgUuid = accountInfo?.organizationUuid;
    let authUrl: string;
    if (orgUuid && server.config.type === 'hosted-proxy' && server.config.id) {
      // Use the direct auth URL with org and server IDs
      // Replace 'mcprs' prefix with 'mcpsrv' if present
      const serverId = server.config.id.startsWith('mcprs') ? 'mcpsrv' + server.config.id.slice(5) : server.config.id;
      const productSurface = encodeURIComponent(process.env.MOSSEN_CODE_ENTRYPOINT || 'cli');
      authUrl = `${hostedBaseUrl}/api/organizations/${orgUuid}/mcp/start-auth/${serverId}?product_surface=${productSurface}`;
    } else {
      // Fall back to settings/connectors if we don't have the required IDs
      authUrl = `${hostedBaseUrl}/settings/connectors`;
    }
    setHostedAuthUrl(authUrl);
    setIsHostedAuthenticating(true);
    logMossenEvent('mossen.mcp.hostedAuthStarted', {});
    await openBrowser(authUrl);
  }, [server.config]);
  const handleHostedClearAuth = React.useCallback(() => {
    setIsHostedClearingAuth(true);
    logMossenEvent('mossen.mcp.hostedClearAuthStarted', {});
  }, []);
  const handleToggleEnabled = React.useCallback(async () => {
    const wasEnabled = server.client.type !== 'disabled';
    try {
      await toggleMcpServer(server.name);
      if (server.config.type === 'hosted-proxy') {
        logMossenEvent('mossen.mcp.hostedToggle', {
          new_state: (wasEnabled ? 'disabled' : 'enabled') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }

      // Return to the server list so user can continue managing other servers
      onCancel();
    } catch (err_0) {
      const action = wasEnabled ? 'disable' : 'enable';
      onComplete?.(getLocalizedText({
        en: `Failed to ${action} MCP server '${server.name}': ${errorMessage(err_0)}`,
        zh: `${wasEnabled ? '禁用' : '启用'} MCP 服务器“${server.name}”失败：${errorMessage(err_0)}`
      }));
    }
  }, [server.client.type, server.config.type, server.name, toggleMcpServer, onCancel, onComplete]);
  const handleAuthenticate = React.useCallback(async () => {
    if (server.config.type === 'hosted-proxy') return;
    setIsAuthenticating(true);
    setError(null);
    const controller = new AbortController();
    authAbortControllerRef.current = controller;
    try {
      // Revoke existing tokens if re-authenticating, but preserve step-up
      // auth state so the next OAuth flow can reuse cached scope/discovery.
      if (server.isAuthenticated && server.config) {
        await revokeServerTokens(server.name, server.config, {
          preserveStepUpState: true
        });
      }
      if (server.config) {
        await performMCPOAuthFlow(server.name, server.config, setAuthorizationUrl, controller.signal, {
          onWaitingForCallback: submit => {
            setManualCallbackSubmit(() => submit);
          }
        });
        logMossenEvent('mossen.mcp.authConfigAuthenticate', {
          wasAuthenticated: server.isAuthenticated
        });
        const result_0 = await reconnectMcpServer(server.name);
        if (result_0.client.type === 'connected') {
          const message = isEffectivelyAuthenticated ? getLocalizedText({
            en: `Authentication successful. Reconnected to ${server.name}.`,
            zh: `认证成功。已重新连接到 ${server.name}。`
          }) : getLocalizedText({
            en: `Authentication successful. Connected to ${server.name}.`,
            zh: `认证成功。已连接到 ${server.name}。`
          });
          onComplete?.(message);
        } else if (result_0.client.type === 'needs-auth') {
          onComplete?.(getLocalizedText({
            en: `Authentication successful, but the server still requires authentication. You may need to manually restart ${assistantName}.`,
            zh: `认证成功，但服务器仍然需要认证。你可能需要手动重启 ${assistantName}。`
          }));
        } else {
          // result.client.type === 'failed'
          logMCPDebug(server.name, `Reconnection failed after authentication`);
          onComplete?.(getLocalizedText({
            en: `Authentication successful, but the server reconnection failed. You may need to manually restart ${assistantName} for the changes to take effect.`,
            zh: `认证成功，但服务器重新连接失败。你可能需要手动重启 ${assistantName} 以让更改生效。`
          }));
        }
      }
    } catch (err_1) {
      // Don't show error if it was a cancellation
      if (err_1 instanceof Error && !(err_1 instanceof AuthenticationCancelledError)) {
        setError(err_1.message);
      }
    } finally {
      setIsAuthenticating(false);
      authAbortControllerRef.current = null;
      setManualCallbackSubmit(null);
      setCallbackUrlInput('');
    }
  }, [assistantName, server.isAuthenticated, server.config, server.name, onComplete, reconnectMcpServer, isEffectivelyAuthenticated]);
  const handleClearAuth = async () => {
    if (server.config.type === 'hosted-proxy') return;
    if (server.config) {
      // First revoke the authentication tokens and clear all auth state
      await revokeServerTokens(server.name, server.config);
      logMossenEvent('mossen.mcp.authConfigClear', {});

      // Disconnect the client and clear the cache
      await clearServerCache(server.name, {
        ...server.config,
        scope: server.scope
      });

      // Update app state to remove the disconnected server's tools, commands, and resources
      setAppState(prev_0 => {
        const newClients_0 = prev_0.mcp.clients.map(c_0 =>
        // 'failed' is a misnomer here, but we don't really differentiate between "not connected" and "failed" at the moment
        c_0.name === server.name ? {
          ...c_0,
          type: 'failed' as const
        } : c_0);
        const newTools_0 = excludeToolsByServer(prev_0.mcp.tools, server.name);
        const newCommands_0 = excludeCommandsByServer(prev_0.mcp.commands, server.name);
        const newResources_0 = excludeResourcesByServer(prev_0.mcp.resources, server.name);
        return {
          ...prev_0,
          mcp: {
            ...prev_0.mcp,
            clients: newClients_0,
            tools: newTools_0,
            commands: newCommands_0,
            resources: newResources_0
          }
        };
      });
      onComplete?.(getLocalizedText({
        en: `Authentication cleared for ${server.name}.`,
        zh: `已清除 ${server.name} 的认证信息。`
      }));
    }
  };
  if (isAuthenticating) {
    // XAA: silent exchange (cached id_token → no browser), so don't claim
    // one will open. If IdP login IS needed, authorizationUrl populates and
    // the URL fallback block below still renders.
    const authCopy = getLocalizedText(server.config.type !== 'hosted-proxy' && server.config.oauth?.xaa ? {
      en: 'Authenticating via your identity provider',
      zh: '正在通过你的身份提供方进行认证'
    } : {
      en: 'A browser window will open for authentication',
      zh: '将打开浏览器窗口完成认证'
    });
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="mossen">{getLocalizedText({
        en: `Authenticating with ${server.name}…`,
        zh: `正在与 ${server.name} 进行认证…`
      })}</Text>
        <Box>
          <Spinner />
          <Text> {authCopy}</Text>
        </Box>
        {authorizationUrl && <Box flexDirection="column">
            <Box>
              <Text dimColor>
                {getLocalizedText({
                en: 'If your browser doesn’t open automatically, copy this URL manually',
                zh: '如果浏览器没有自动打开，请手动复制这个链接'
              })}{' '}
              </Text>
              {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                  <KeyboardShortcutHint shortcut="c" action="copy" parens />
                </Text>}
            </Box>
            <Link url={authorizationUrl} />
          </Box>}
        {isAuthenticating && authorizationUrl && manualCallbackSubmit && <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              {getLocalizedText({
              en: 'If the redirect page shows a connection error, paste the URL from your browser’s address bar:',
              zh: '如果重定向页面显示连接错误，请粘贴浏览器地址栏中的 URL：'
            })}
            </Text>
            <Box>
              <Text dimColor>{getLocalizedText({
              en: 'URL > ',
              zh: '链接 > '
            })}</Text>
              <TextInput value={callbackUrlInput} onChange={setCallbackUrlInput} onSubmit={(value: string) => {
            manualCallbackSubmit(value.trim());
            setCallbackUrlInput('');
          }} cursorOffset={callbackUrlCursorOffset} onChangeCursorOffset={setCallbackUrlCursorOffset} columns={terminalColumns - 8} />
            </Box>
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
  if (isHostedAuthenticating) {
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="mossen">{getLocalizedText({
        en: `Authenticating with ${server.name}…`,
        zh: `正在与 ${server.name} 进行认证…`
      })}</Text>
        <Box>
          <Spinner />
          <Text> {getLocalizedText({
          en: 'A browser window will open for authentication',
          zh: '将打开浏览器窗口完成认证'
        })}</Text>
        </Box>
        {hostedAuthUrl && <Box flexDirection="column">
            <Box>
              <Text dimColor>
                {getLocalizedText({
                en: 'If your browser doesn’t open automatically, copy this URL manually',
                zh: '如果浏览器没有自动打开，请手动复制这个链接'
              })}{' '}
              </Text>
              {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                  <KeyboardShortcutHint shortcut="c" action="copy" parens />
                </Text>}
            </Box>
            <Link url={hostedAuthUrl} />
          </Box>}
        <Box marginLeft={3} flexDirection="column">
          <Text color="permission">
            {getLocalizedText({
            en: 'Press ',
            zh: '按 '
          })}<Text bold>Enter</Text>{getLocalizedText({
            en: ' after authenticating in your browser.',
            zh: '，在浏览器完成认证后继续。'
          })}
          </Text>
          <Text dimColor italic>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
            en: 'back',
            zh: '返回'
          })} />
          </Text>
        </Box>
      </Box>;
  }
  if (isHostedClearingAuth) {
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="mossen">{getLocalizedText({
        en: `Clear authentication for ${server.name}`,
        zh: `清除 ${server.name} 的认证`
      })}</Text>
        {hostedClearAuthBrowserOpened ? <>
            <Text>
              {getLocalizedText({
              en: 'Find the MCP server in the browser and click "Disconnect".',
              zh: '在浏览器中找到该 MCP 服务器并点击“断开连接”。'
            })}
            </Text>
            {hostedClearAuthUrl && <Box flexDirection="column">
                <Box>
                  <Text dimColor>
                    {getLocalizedText({
                    en: 'If your browser didn’t open automatically, copy this URL manually',
                    zh: '如果浏览器没有自动打开，请手动复制这个链接'
                  })}{' '}
                  </Text>
                  {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                      <KeyboardShortcutHint shortcut="c" action="copy" parens />
                    </Text>}
                </Box>
                <Link url={hostedClearAuthUrl} />
              </Box>}
            <Box marginLeft={3} flexDirection="column">
              <Text color="permission">
                {getLocalizedText({
                en: 'Press ',
                zh: '完成后按 '
              })}<Text bold>Enter</Text>{getLocalizedText({
                en: ' when done.',
                zh: '。'
              })}
              </Text>
              <Text dimColor italic>
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
                en: 'back',
                zh: '返回'
              })} />
              </Text>
            </Box>
          </> : <>
            <Text>
              {getLocalizedText({
              en: 'This will open the hosted integrations page in the browser. Find the MCP server in the list and click "Disconnect".',
              zh: '这会在浏览器中打开托管集成页面。请在列表里找到该 MCP 服务器并点击“断开连接”。'
            })}
            </Text>
            <Box marginLeft={3} flexDirection="column">
              <Text color="permission">
                {getLocalizedText({
                en: 'Press ',
                zh: '按 '
              })}<Text bold>Enter</Text>{getLocalizedText({
                en: ' to open the browser.',
                zh: ' 以打开浏览器。'
              })}
              </Text>
              <Text dimColor italic>
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
                en: 'back',
                zh: '返回'
              })} />
              </Text>
            </Box>
          </>}
      </Box>;
  }
  if (isReconnecting) {
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          {getLocalizedText({
          en: 'Connecting to ',
          zh: '正在连接到 '
        })}<Text bold>{server.name}</Text>…
        </Text>
        <Box>
          <Spinner />
          <Text> {getLocalizedText({
          en: 'Establishing connection to MCP server',
          zh: '正在建立与 MCP 服务器的连接'
        })}</Text>
        </Box>
        <Text dimColor>{getLocalizedText({
        en: 'This may take a few moments.',
        zh: '这可能需要几秒钟。'
      })}</Text>
      </Box>;
  }
  const menuOptions = [];

  // If server is disabled, show Enable first as the primary action
  if (server.client.type === 'disabled') {
    menuOptions.push({
      label: getLocalizedText({
        en: 'Enable',
        zh: '启用'
      }),
      value: 'toggle-enabled'
    });
  }
  if (server.client.type === 'connected' && serverToolsCount > 0) {
    menuOptions.push({
      label: getLocalizedText({
        en: 'View tools',
        zh: '查看工具'
      }),
      value: 'tools'
    });
  }
  if (server.config.type === 'hosted-proxy') {
    if (server.client.type === 'connected') {
      menuOptions.push({
        label: getLocalizedText({
          en: 'Clear authentication',
          zh: '清除认证'
        }),
        value: 'hosted-clear-auth'
      });
    } else if (server.client.type !== 'disabled') {
      menuOptions.push({
        label: getLocalizedText({
          en: 'Authenticate',
          zh: '认证'
        }),
        value: 'hosted-auth'
      });
    }
  } else {
    if (isEffectivelyAuthenticated) {
      menuOptions.push({
        label: getLocalizedText({
          en: 'Re-authenticate',
          zh: '重新认证'
        }),
        value: 'reauth'
      });
      menuOptions.push({
        label: getLocalizedText({
          en: 'Clear authentication',
          zh: '清除认证'
        }),
        value: 'clear-auth'
      });
    }
    if (!isEffectivelyAuthenticated) {
      menuOptions.push({
        label: getLocalizedText({
          en: 'Authenticate',
          zh: '认证'
        }),
        value: 'auth'
      });
    }
  }
  if (server.client.type !== 'disabled') {
    if (server.client.type !== 'needs-auth') {
      menuOptions.push({
        label: getLocalizedText({
          en: 'Reconnect',
          zh: '重新连接'
        }),
        value: 'reconnectMcpServer'
      });
    }
    menuOptions.push({
      label: getLocalizedText({
        en: 'Disable',
        zh: '禁用'
      }),
      value: 'toggle-enabled'
    });
  }

  // If there are no other options, add a back option so Select handles escape
  if (menuOptions.length === 0) {
    menuOptions.push({
      label: getLocalizedText({
        en: 'Back',
        zh: '返回'
      }),
      value: 'back'
    });
  }
  return <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} borderStyle={borderless ? undefined : 'round'}>
        <Box marginBottom={1}>
          <Text bold>{getLocalizedText({
          en: `${capitalizedServerName} MCP Server`,
          zh: `${capitalizedServerName} MCP 服务器`
        })}</Text>
        </Box>

        <Box flexDirection="column" gap={0}>
          <Box>
            <Text bold>{getLocalizedText({
            en: 'Status: ',
            zh: '状态：'
          })}</Text>
            {server.client.type === 'disabled' ? <Text>{color('inactive', theme)(figures.radioOff)} {getLocalizedText({
              en: 'disabled',
              zh: '已禁用'
            })}</Text> : server.client.type === 'connected' ? <Text>{color('success', theme)(figures.tick)} {getLocalizedText({
              en: 'connected',
              zh: '已连接'
            })}</Text> : server.client.type === 'pending' ? <>
                <Text dimColor>{figures.radioOff}</Text>
                <Text> {getLocalizedText({
                en: 'connecting…',
                zh: '连接中…'
              })}</Text>
              </> : server.client.type === 'needs-auth' ? <Text>
                {color('warning', theme)(figures.triangleUpOutline)} {getLocalizedText({
                en: 'needs authentication',
                zh: '需要认证'
              })}
              </Text> : <Text>{color('error', theme)(figures.cross)} {getLocalizedText({
              en: 'failed',
              zh: '失败'
            })}</Text>}
          </Box>

          {server.transport !== 'hosted-proxy' && <Box>
              <Text bold>{getLocalizedText({
              en: 'Auth: ',
              zh: '认证：'
            })}</Text>
              {isEffectivelyAuthenticated ? <Text>
                  {color('success', theme)(figures.tick)} {getLocalizedText({
                en: 'authenticated',
                zh: '已认证'
              })}
                </Text> : <Text>
                  {color('error', theme)(figures.cross)} {getLocalizedText({
                en: 'not authenticated',
                zh: '未认证'
              })}
                </Text>}
            </Box>}

          <Box>
            <Text bold>{getLocalizedText({
            en: 'URL: ',
            zh: '链接：'
          })}</Text>
            <Text dimColor>{server.config.url}</Text>
          </Box>

          <Box>
            <Text bold>{getLocalizedText({
            en: 'Config location: ',
            zh: '配置位置：'
          })}</Text>
            <Text dimColor>{describeMcpConfigFilePath(server.scope)}</Text>
          </Box>

          {server.client.type === 'connected' && <CapabilitiesSection serverToolsCount={serverToolsCount} serverPromptsCount={serverCommandsCount} serverResourcesCount={mcp.resources[server.name]?.length || 0} />}

          {server.client.type === 'connected' && serverToolsCount > 0 && <Box>
              <Text bold>{getLocalizedText({
              en: 'Tools: ',
              zh: '工具：'
            })}</Text>
              <Text dimColor>{getLocalizedText({
              en: `${serverToolsCount} tools`,
              zh: `${serverToolsCount} 个工具`
            })}</Text>
            </Box>}
        </Box>

        {error && <Box marginTop={1}>
            <Text color="error">{getLocalizedText({
            en: 'Error: ',
            zh: '错误：'
          })}{error}</Text>
          </Box>}

        {menuOptions.length > 0 && <Box marginTop={1}>
            <Select options={menuOptions} onChange={async value_0 => {
          switch (value_0) {
            case 'tools':
              onViewTools();
              break;
            case 'auth':
            case 'reauth':
              await handleAuthenticate();
              break;
            case 'clear-auth':
              await handleClearAuth();
              break;
            case 'hosted-auth':
              await handleHostedAuth();
              break;
            case 'hosted-clear-auth':
              handleHostedClearAuth();
              break;
            case 'reconnectMcpServer':
              setIsReconnecting(true);
              try {
                const result_1 = await reconnectMcpServer(server.name);
                if (server.config.type === 'hosted-proxy') {
                  logMossenEvent('mossen.mcp.hostedReconnect', {
                    success: result_1.client.type === 'connected'
                  });
                }
                const {
                  message: message_0
                } = handleReconnectResult(result_1, server.name);
                onComplete?.(message_0);
              } catch (err_2) {
                if (server.config.type === 'hosted-proxy') {
                  logMossenEvent('mossen.mcp.hostedReconnect', {
                    success: false
                  });
                }
                onComplete?.(handleReconnectError(err_2, server.name));
              } finally {
                setIsReconnecting(false);
              }
              break;
            case 'toggle-enabled':
              await handleToggleEnabled();
              break;
            case 'back':
              onCancel();
              break;
          }
        }} onCancel={onCancel} />
          </Box>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor italic>
          {exitState.pending ? <>{getLocalizedText({
          en: `Press ${exitState.keyName} again to exit`,
          zh: `再按一次 ${exitState.keyName} 即可退出`
        })}</> : <Byline>
              <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
              <KeyboardShortcutHint shortcut="Enter" action="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
              en: 'back',
              zh: '返回'
            })} />
            </Byline>}
        </Text>
      </Box>
    </Box>;
}
