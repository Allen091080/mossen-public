/**
 * MCP add CLI subcommand
 *
 * Extracted from main.tsx to enable direct testing.
 */
import { type Command, Option } from '@commander-js/extra-typings'
import { cliError, cliOk } from '../../cli/exit.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import {
  readClientSecret,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js'
import { addMcpConfig } from '../../services/mcp/config.js'
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  ensureTransport,
  parseHeaders,
} from '../../services/mcp/utils.js'
import {
  getXaaIdpSettings,
  isXaaEnabled,
} from '../../services/mcp/xaaIdpLogin.js'
import { getProductCliName, getProductDisplayName } from '../../constants/product.js'
import { parseEnvVars } from '../../utils/envUtils.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function getMcpAddDescription(): string {
  return getLocalizedText({
    en:
      `Add an MCP server to ${getProductDisplayName()}.\n\n` +
      'Examples:\n' +
      '  # Add HTTP server:\n' +
      `  ${getProductCliName()} mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n` +
      '  # Add HTTP server with headers:\n' +
      `  ${getProductCliName()} mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n` +
      '  # Add stdio server with environment variables:\n' +
      `  ${getProductCliName()} mcp add -e API_KEY=xxx my-server -- npx my-mcp-server\n\n` +
      '  # Add stdio server with subprocess flags:\n' +
      `  ${getProductCliName()} mcp add my-server -- my-command --some-flag arg1`,
    zh:
      `向 ${getProductDisplayName()} 添加一个 MCP 服务器。\n\n` +
      '示例：\n' +
      '  # 添加 HTTP 服务器：\n' +
      `  ${getProductCliName()} mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n` +
      '  # 添加带请求头的 HTTP 服务器：\n' +
      `  ${getProductCliName()} mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n` +
      '  # 添加带环境变量的 stdio 服务器：\n' +
      `  ${getProductCliName()} mcp add -e API_KEY=xxx my-server -- npx my-mcp-server\n\n` +
      '  # 添加带子进程参数的 stdio 服务器：\n' +
      `  ${getProductCliName()} mcp add my-server -- my-command --some-flag arg1`,
  })
}

/**
 * Registers the `mcp add` subcommand on the given Commander command.
 */
export function registerMcpAddCommand(mcp: Command): void {
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .description(getMcpAddDescription())
    .option(
      '-s, --scope <scope>',
      getLocalizedText({
        en: 'Configuration scope (local, user, or project)',
        zh: '配置作用域（local、user 或 project）',
      }),
      'local',
    )
    .option(
      '-t, --transport <transport>',
      getLocalizedText({
        en: 'Transport type (stdio, sse, http). Defaults to stdio if not specified.',
        zh: '传输类型（stdio、sse、http）。未指定时默认为 stdio。',
      }),
    )
    .option(
      '-e, --env <env...>',
      getLocalizedText({
        en: 'Set environment variables (e.g. -e KEY=value)',
        zh: '设置环境变量（例如 -e KEY=value）',
      }),
    )
    .option(
      '-H, --header <header...>',
      getLocalizedText({
        en: 'Set WebSocket headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
        zh: '设置 WebSocket 请求头（例如 -H "X-Api-Key: abc123" -H "X-Custom: value"）',
      }),
    )
    .option(
      '--client-id <clientId>',
      getLocalizedText({
        en: 'OAuth client ID for HTTP/SSE servers',
        zh: 'HTTP/SSE 服务器的 OAuth client ID',
      }),
    )
    .option(
      '--client-secret',
      getLocalizedText({
        en: 'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
        zh: '提示输入 OAuth client secret（或设置 MCP_CLIENT_SECRET 环境变量）',
      }),
    )
    .option(
      '--callback-port <port>',
      getLocalizedText({
        en: 'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)',
        zh: '为 OAuth 回调指定固定端口（适用于要求预注册重定向 URI 的服务器）',
      }),
    )
    .helpOption(
      '-h, --help',
      getLocalizedText({
        en: 'Display help for command',
        zh: '显示命令帮助',
      }),
    )
    .addOption(
      new Option(
        '--xaa',
        getLocalizedText({
          en: `Enable XAA (SEP-990) for this server. Requires '${getProductCliName()} mcp xaa setup' first. Also requires --client-id and --client-secret (for the MCP server's AS).`,
          zh: `为此服务器启用 XAA（SEP-990）。需先运行 '${getProductCliName()} mcp xaa setup'，并同时提供 --client-id 与 --client-secret（供 MCP 服务器的 AS 使用）。`,
        }),
      ).hideHelp(!isXaaEnabled()),
    )
    .action(async (name, commandOrUrl, args, options) => {
      const cliName = getProductCliName()
      // Commander.js handles -- natively: it consumes -- and everything after becomes args
      const actualCommand = commandOrUrl
      const actualArgs = args

      // If no name is provided, error
      if (!name) {
        cliError(
          getLocalizedText({
            en:
              'Error: Server name is required.\n' +
              `Usage: ${cliName} mcp add <name> <command> [args...]`,
            zh:
              '错误：必须提供服务器名称。\n' +
              `用法：${cliName} mcp add <name> <command> [args...]`,
          }),
        )
      } else if (!actualCommand) {
        cliError(
          getLocalizedText({
            en:
              'Error: Command is required when server name is provided.\n' +
              `Usage: ${cliName} mcp add <name> <command> [args...]`,
            zh:
              '错误：提供服务器名称后，还必须提供命令。\n' +
              `用法：${cliName} mcp add <name> <command> [args...]`,
          }),
        )
      }

      try {
        const scope = ensureConfigScope(options.scope)
        const transport = ensureTransport(options.transport)

        // XAA fail-fast: validate at add-time, not auth-time.
        if (options.xaa && !isXaaEnabled()) {
          cliError(
            getLocalizedText({
              en: 'Error: --xaa requires MOSSEN_CODE_ENABLE_XAA=1 in your environment',
              zh: '错误：--xaa 需要在环境中设置 MOSSEN_CODE_ENABLE_XAA=1。',
            }),
          )
        }
        const xaa = Boolean(options.xaa)
        if (xaa) {
          const missing: string[] = []
          if (!options.clientId) missing.push('--client-id')
          if (!options.clientSecret) missing.push('--client-secret')
          if (!getXaaIdpSettings()) {
            missing.push(
              `'${cliName} mcp xaa setup' (settings.xaaIdp not configured)`,
            )
          }
          if (missing.length) {
            cliError(
              getLocalizedText({
                en: `Error: --xaa requires: ${missing.join(', ')}`,
                zh: `错误：--xaa 需要满足以下条件：${missing.join('、')}`,
              }),
            )
          }
        }

        // Check if transport was explicitly provided
        const transportExplicit = options.transport !== undefined

        // Check if the command looks like a URL (likely incorrect usage)
        const looksLikeUrl =
          actualCommand.startsWith('http://') ||
          actualCommand.startsWith('https://') ||
          actualCommand.startsWith('localhost') ||
          actualCommand.endsWith('/sse') ||
          actualCommand.endsWith('/mcp')

        logMossenEvent('mossen.mcp.addCommand', {
          type: transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          scope:
            scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source:
            'command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transport:
            transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transportExplicit: transportExplicit,
          looksLikeUrl: looksLikeUrl,
        })

        if (transport === 'sse') {
          if (!actualCommand) {
            cliError(
              getLocalizedText({
                en: 'Error: URL is required for SSE transport.',
                zh: '错误：SSE 传输必须提供 URL。',
              }),
            )
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'sse' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            getLocalizedText({
              en: `Added SSE MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
              zh: `已将 SSE MCP 服务器 ${name}（URL：${actualCommand}）添加到 ${scope} 配置中\n`,
            }),
          )
          if (headers) {
            process.stdout.write(
              getLocalizedText({
                en: `Headers: ${jsonStringify(headers, null, 2)}\n`,
                zh: `请求头：${jsonStringify(headers, null, 2)}\n`,
              }),
            )
          }
        } else if (transport === 'http') {
          if (!actualCommand) {
            cliError(
              getLocalizedText({
                en: 'Error: URL is required for HTTP transport.',
                zh: '错误：HTTP 传输必须提供 URL。',
              }),
            )
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'http' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            getLocalizedText({
              en: `Added HTTP MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
              zh: `已将 HTTP MCP 服务器 ${name}（URL：${actualCommand}）添加到 ${scope} 配置中\n`,
            }),
          )
          if (headers) {
            process.stdout.write(
              getLocalizedText({
                en: `Headers: ${jsonStringify(headers, null, 2)}\n`,
                zh: `请求头：${jsonStringify(headers, null, 2)}\n`,
              }),
            )
          }
        } else {
          if (
            options.clientId ||
            options.clientSecret ||
            options.callbackPort ||
            options.xaa
          ) {
            process.stderr.write(
              getLocalizedText({
                en: 'Warning: --client-id, --client-secret, --callback-port, and --xaa are only supported for HTTP/SSE transports and will be ignored for stdio.\n',
                zh: '警告：--client-id、--client-secret、--callback-port 和 --xaa 仅适用于 HTTP/SSE 传输，stdio 模式下会被忽略。\n',
              }),
            )
          }

          // Warn if this looks like a URL but transport wasn't explicitly specified
          if (!transportExplicit && looksLikeUrl) {
            process.stderr.write(
              getLocalizedText({
                en: `\nWarning: The command "${actualCommand}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.\n`,
                zh: `\n警告：命令 "${actualCommand}" 看起来像 URL，但由于未指定 --transport，它会被当作 stdio 服务器处理。\n`,
              }),
            )
            process.stderr.write(
              getLocalizedText({
                en: `If this is an HTTP server, use: ${cliName} mcp add --transport http ${name} ${actualCommand}\n`,
                zh: `如果这是 HTTP 服务器，请使用：${cliName} mcp add --transport http ${name} ${actualCommand}\n`,
              }),
            )
            process.stderr.write(
              getLocalizedText({
                en: `If this is an SSE server, use: ${cliName} mcp add --transport sse ${name} ${actualCommand}\n`,
                zh: `如果这是 SSE 服务器，请使用：${cliName} mcp add --transport sse ${name} ${actualCommand}\n`,
              }),
            )
          }

          const env = parseEnvVars(options.env)
          await addMcpConfig(
            name,
            { type: 'stdio', command: actualCommand, args: actualArgs, env },
            scope,
          )

          process.stdout.write(
            getLocalizedText({
              en: `Added stdio MCP server ${name} with command: ${actualCommand} ${actualArgs.join(' ')} to ${scope} config\n`,
              zh: `已将 stdio MCP 服务器 ${name}（命令：${actualCommand} ${actualArgs.join(' ')}）添加到 ${scope} 配置中\n`,
            }),
          )
        }
        cliOk(
          getLocalizedText({
            en: `File modified: ${describeMcpConfigFilePath(scope)}`,
            zh: `已修改文件：${describeMcpConfigFilePath(scope)}`,
          }),
        )
      } catch (error) {
        cliError((error as Error).message)
      }
    })
}
