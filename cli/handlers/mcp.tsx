/**
 * MCP subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when the corresponding `mossen mcp *` command runs.
 */
/* eslint-disable no-console -- CLI subcommand handlers intentionally write user-visible output. */

import { stat } from 'fs/promises';
import pMap from 'p-map';
import { cwd } from 'process';
import React from 'react';
import { getProductCliName } from '../../constants/product.js';
import { MCPServerDesktopImportDialog } from '../../components/MCPServerDesktopImportDialog.js';
import { render } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { clearMcpClientConfig, clearServerTokensFromLocalStorage, getMcpClientConfig, readClientSecret, saveMcpClientSecret } from '../../services/mcp/auth.js';
import { connectToServer, getMcpServerConnectionBatchSize } from '../../services/mcp/client.js';
import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, removeMcpConfig } from '../../services/mcp/config.js';
import { describeMcpConnectionError, describeMcpConnectionStatus } from '../../services/mcp/diagnostics.js';
import type { ConfigScope, ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath, ensureConfigScope, getScopeLabel } from '../../services/mcp/utils.js';
import { AppStateProvider } from '../../state/AppState.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig } from '../../utils/config.js';
import { isFsInaccessible } from '../../utils/errors.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { safeParseJSON } from '../../utils/json.js';
import { getPlatform } from '../../utils/platform.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { cliError, cliOk } from '../exit.js';
async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {
  try {
    const result = await connectToServer(name, server);
    return describeMcpConnectionStatus(name, result);
  } catch (error) {
    return describeMcpConnectionError(name, server, error);
  }
}

// mcp serve (lines 4512–4532)
export async function mcpServeHandler({
  debug,
  verbose
}: {
  debug?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const providedCwd = cwd();
  logMossenEvent('mossen.mcp.cliStarted', {});
  try {
    await stat(providedCwd);
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(
        getLocalizedText({
          en: `Error: Directory ${providedCwd} does not exist`,
          zh: `错误：目录 ${providedCwd} 不存在`,
        }),
      );
    }
    throw error;
  }
  try {
    const {
      setup
    } = await import('../../setup.js');
    await setup(providedCwd, 'default', false, false, undefined, false);
    const {
      startMCPServer
    } = await import('../../entrypoints/mcp.js');
    await startMCPServer(providedCwd, debug ?? false, verbose ?? false);
  } catch (error) {
    cliError(
      getLocalizedText({
        en: `Error: Failed to start MCP server: ${error}`,
        zh: `错误：启动 MCP 服务器失败：${error}`,
      }),
    );
  }
}

// mcp remove (lines 4545–4635)
export async function mcpRemoveHandler(name: string, options: {
  scope?: string;
}): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name);
  const cleanupSecureStorage = () => {
    if (serverBeforeRemoval && (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')) {
      clearServerTokensFromLocalStorage(name, serverBeforeRemoval);
      clearMcpClientConfig(name, serverBeforeRemoval);
    }
  };
  try {
    if (options.scope) {
      const scope = ensureConfigScope(options.scope);
      logMossenEvent('mossen.mcp.cliDeleted', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(
        getLocalizedText({
          en: `Removed MCP server ${name} from ${scope} config\n`,
          zh: `已从 ${scope} 配置中移除 MCP 服务器 ${name}\n`,
        }),
      );
      cliOk(
        getLocalizedText({
          en: `File modified: ${describeMcpConfigFilePath(scope)}`,
          zh: `已修改文件：${describeMcpConfigFilePath(scope)}`,
        }),
      );
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig();
    const globalConfig = getGlobalConfig();

    // Check if server exists in project scope (.mcp.json)
    const {
      servers: projectServers
    } = getMcpConfigsByScope('project');
    const mcpJsonExists = !!projectServers[name];

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = [];
    if (projectConfig.mcpServers?.[name]) scopes.push('local');
    if (mcpJsonExists) scopes.push('project');
    if (globalConfig.mcpServers?.[name]) scopes.push('user');
    if (scopes.length === 0) {
      cliError(
        getLocalizedText({
          en: `No MCP server found with name: "${name}"`,
          zh: `未找到名为 "${name}" 的 MCP 服务器`,
        }),
      );
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!;
      logMossenEvent('mossen.mcp.cliDeleted', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(
        getLocalizedText({
          en: `Removed MCP server "${name}" from ${scope} config\n`,
          zh: `已从 ${scope} 配置中移除 MCP 服务器 "${name}"\n`,
        }),
      );
      cliOk(
        getLocalizedText({
          en: `File modified: ${describeMcpConfigFilePath(scope)}`,
          zh: `已修改文件：${describeMcpConfigFilePath(scope)}`,
        }),
      );
    } else {
      // Server exists in multiple scopes
      process.stderr.write(
        getLocalizedText({
          en: `MCP server "${name}" exists in multiple scopes:\n`,
          zh: `MCP 服务器 "${name}" 存在于多个作用域中：\n`,
        }),
      );
      scopes.forEach(scope => {
        process.stderr.write(`  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`);
      });
      process.stderr.write(getLocalizedText({
        en: '\nTo remove from a specific scope, use:\n',
        zh: '\n如需从特定作用域移除，请使用：\n'
      }));
      scopes.forEach(scope => {
        process.stderr.write(`  ${getProductCliName()} mcp remove "${name}" -s ${scope}\n`);
      });
      cliError();
    }
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp list (lines 4641–4688)
export async function mcpListHandler(): Promise<void> {
  logMossenEvent('mossen.mcp.cliListed', {});
  const {
    servers: configs
  } = await getAllMcpConfigs();
  if (Object.keys(configs).length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(getLocalizedText({
      en: `No MCP servers configured. Use \`${getProductCliName()} mcp add\` to add a server.`,
      zh: `当前未配置 MCP 服务器。可使用 \`${getProductCliName()} mcp add\` 添加服务器。`
    }));
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(getLocalizedText({
      en: 'Checking MCP server health...\n',
      zh: '正在检查 MCP 服务器健康状态...\n'
    }));

    // Check servers concurrently
    const entries = Object.entries(configs);
    const results = await pMap(entries, async ([name, server]) => ({
      name,
      server,
      status: await checkMcpServerHealth(name, server)
    }), {
      concurrency: getMcpServerConnectionBatchSize()
    });
    for (const {
      name,
      server,
      status
    } of results) {
      // Intentionally excluding sse-ide servers here since they're internal
      if (server.type === 'sse') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (SSE) - ${status}`);
      } else if (server.type === 'http') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (HTTP) - ${status}`);
      } else if (server.type === 'hosted-proxy') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} - ${status}`);
      } else if (!server.type || server.type === 'stdio') {
        const stdioServer = server as {
          args?: string[];
          command?: string;
        };
        const args = Array.isArray(stdioServer.args) ? stdioServer.args : [];
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${stdioServer.command ?? ''} ${args.join(' ')} - ${status}`);
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp get (lines 4694–4786)
export async function mcpGetHandler(name: string): Promise<void> {
  logMossenEvent('mossen.mcp.cliGot', {
    name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  const server = getMcpConfigByName(name);
  if (!server) {
    cliError(getLocalizedText({
      en: `No MCP server found with name: ${name}`,
      zh: `未找到名为 ${name} 的 MCP 服务器`
    }));
  }

  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${name}:`);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${getLocalizedText({
    en: '  Scope: ',
    zh: '  作用域：'
  })}${getScopeLabel(server.scope)}`);

  // Check server health
  const status = await checkMcpServerHealth(name, server);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${getLocalizedText({
    en: '  Status: ',
    zh: '  状态：'
  })}${status}`);

  // Intentionally excluding sse-ide servers here since they're internal
  if (server.type === 'sse') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(getLocalizedText({
      en: '  Type: sse',
      zh: '  类型：sse'
    }));
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${getLocalizedText({
      en: '  URL: ',
      zh: '  地址：'
    })}${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(getLocalizedText({
        en: '  Headers:',
        zh: '  请求头：'
      }));
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`${getLocalizedText({
        en: '  OAuth: ',
        zh: '  OAuth：'
      })}${parts.join(', ')}`);
    }
  } else if (server.type === 'http') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(getLocalizedText({
      en: '  Type: http',
      zh: '  类型：http'
    }));
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${getLocalizedText({
      en: '  URL: ',
      zh: '  地址：'
    })}${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(getLocalizedText({
        en: '  Headers:',
        zh: '  请求头：'
      }));
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`${getLocalizedText({
        en: '  OAuth: ',
        zh: '  OAuth：'
      })}${parts.join(', ')}`);
    }
  } else if (server.type === 'stdio') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(getLocalizedText({
      en: '  Type: stdio',
      zh: '  类型：stdio'
    }));
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${getLocalizedText({
      en: '  Command: ',
      zh: '  命令：'
    })}${server.command}`);
    const args = Array.isArray(server.args) ? server.args : [];
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${getLocalizedText({
      en: '  Args: ',
      zh: '  参数：'
    })}${args.join(' ')}`);
    if (server.env) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(getLocalizedText({
        en: '  Environment:',
        zh: '  环境变量：'
      }));
      for (const [key, value] of Object.entries(server.env)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}=${value}`);
      }
    }
  }
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(getLocalizedText({
    en: `\nTo remove this server, run: ${getProductCliName()} mcp remove "${name}" -s ${server.scope}`,
    zh: `\n如需移除此服务器，请运行：${getProductCliName()} mcp remove "${name}" -s ${server.scope}`
  }));
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp add-json (lines 4801–4870)
export async function mcpAddJsonHandler(name: string, json: string, options: {
  scope?: string;
  clientSecret?: true;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const parsedJson = safeParseJSON(json);

    // Read secret before writing config so cancellation doesn't leave partial state
    const needsSecret = options.clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string' && 'oauth' in parsedJson && parsedJson.oauth && typeof parsedJson.oauth === 'object' && 'clientId' in parsedJson.oauth;
    const clientSecret = needsSecret ? await readClientSecret() : undefined;
    await addMcpConfig(name, parsedJson, scope);
    const transportType = parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson ? String(parsedJson.type || 'stdio') : 'stdio';
    if (clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string') {
      saveMcpClientSecret(name, {
        type: parsedJson.type,
        url: parsedJson.url
      }, clientSecret);
    }
    logMossenEvent('mossen.mcp.addCommand', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      type: transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    cliOk(`Added ${transportType} MCP server ${name} to ${scope} config`);
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp add-from-mossen-desktop (lines 4881–4927)
export async function mcpAddFromDesktopHandler(options: {
  scope?: string;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const platform = getPlatform();
    logMossenEvent('mossen.mcp.addCommand', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    const {
      readMossenDesktopMcpServers
    } = await import('../../utils/mossenDesktop.js');
    const servers = await readMossenDesktopMcpServers();
    if (Object.keys(servers).length === 0) {
      cliOk('No MCP servers found in the desktop companion configuration, or the configuration file does not exist.');
    }
    const {
      unmount
    } = await render(<AppStateProvider>
        <KeybindingSetup>
          <MCPServerDesktopImportDialog servers={servers} scope={scope} onDone={() => {
          unmount();
        }} />
        </KeybindingSetup>
      </AppStateProvider>, {
      exitOnCtrlC: true
    });
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp reset-project-choices (lines 4935–4952)
export async function mcpResetChoicesHandler(): Promise<void> {
  logMossenEvent('mossen.mcp.cliResetProjectChoices', {});
  saveCurrentProjectConfig(current => ({
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false
  }));
  cliOk('All project-scoped (.mcp.json) server approvals and rejections have been reset.\n' + 'You will be prompted for approval next time you start Mossen.');
}
