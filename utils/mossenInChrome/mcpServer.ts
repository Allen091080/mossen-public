import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { format } from 'util'
import { shutdownDatadog } from '../../services/analytics/datadog.js'
import { shutdown1PEventLogging } from '../../services/analytics/firstPartyEventLogger.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/config/dynamicConfig.js'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import { initializeAnalyticsSink } from '../../services/analytics/sink.js'
import { getHostedOAuthTokens } from '../auth.js'
import { enableConfigs, getGlobalConfig, saveGlobalConfig } from '../config.js'
import {
  getChromeIntegrationUrls,
  getCustomBackendName,
} from '../customBackend.js'
import { getProductAssistantName } from '../../constants/product.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { isInternalOperatorMode } from '../internalUserMode.js'
import { sideQuery } from '../sideQuery.js'
import {
  createMossenChromeMcpServer,
  type MossenChromeLogger,
  type MossenChromeMcpContext,
  type MossenChromePermissionMode,
} from './chromeMcpAdapter.js'
import { getAllSocketPaths, getSecureSocketPath } from './common.js'

// String metadata keys safe to forward to analytics. Keys like error_message
// are excluded because they could contain page content or user data.
const SAFE_BRIDGE_STRING_KEYS = new Set([
  'bridge_status',
  'error_type',
  'tool_name',
])

const PERMISSION_MODES: readonly MossenChromePermissionMode[] = [
  'ask',
  'skip_all_permission_checks',
  'follow_a_plan',
]

function isPermissionMode(raw: string): raw is MossenChromePermissionMode {
  return PERMISSION_MODES.some(m => m === raw)
}

/**
 * Resolves the Chrome bridge URL based on environment and feature flag.
 * Bridge is used when the feature flag is enabled; internal operators always
 * get bridge. API key / 3P users fall back to native messaging.
 */
function getChromeBridgeUrl(): string | undefined {
  const bridgeEnabled =
    isInternalOperatorMode() ||
    getFeatureValue_CACHED_MAY_BE_STALE('mossen.browser.copperBridgeEnabled', false)

  if (!bridgeEnabled) {
    return undefined
  }

  if (
    isEnvTruthy(process.env.USE_LOCAL_OAUTH) ||
    isEnvTruthy(process.env.LOCAL_BRIDGE)
  ) {
    return 'ws://localhost:8765'
  }

  if (isEnvTruthy(process.env.USE_STAGING_OAUTH)) {
    return 'wss://bridge-staging.mossen.invalid'
  }

  return 'wss://bridge.mossen.invalid'
}

function isLocalBridge(): boolean {
  return (
    isEnvTruthy(process.env.USE_LOCAL_OAUTH) ||
    isEnvTruthy(process.env.LOCAL_BRIDGE)
  )
}

/**
 * Build the browser integration context used by both the subprocess MCP server
 * and the in-process path in the MCP client.
 */
export function createChromeContext(
  env?: Record<string, string>,
): MossenChromeMcpContext<Parameters<typeof sideQuery>[0]['messages']> {
  const logger = new DebugLogger()
  const { docsUrl, extensionUrl } = getChromeIntegrationUrls()
  const chromeBridgeUrl = getChromeBridgeUrl()
  logger.info(`Bridge URL: ${chromeBridgeUrl ?? 'none (using native socket)'}`)
  const rawPermissionMode =
    env?.MOSSEN_CHROME_PERMISSION_MODE ??
    process.env.MOSSEN_CHROME_PERMISSION_MODE
  let initialPermissionMode: MossenChromePermissionMode | undefined
  if (rawPermissionMode) {
    if (isPermissionMode(rawPermissionMode)) {
      initialPermissionMode = rawPermissionMode
    } else {
      logger.warn(
        `Invalid MOSSEN_CHROME_PERMISSION_MODE "${rawPermissionMode}". Valid values: ${PERMISSION_MODES.join(', ')}`,
      )
    }
  }
  return {
    displayName: 'Chrome browser integration',
    logger,
    primarySocketPath: getSecureSocketPath(),
    listSocketPaths: getAllSocketPaths,
    clientId: 'mossen-code',
    handleAuthenticationError: () => {
      logger.warn(
        `Authentication error occurred. Please ensure you are signed into the browser integration with the same ${getCustomBackendName()} session or credentials as ${getProductAssistantName()}.`,
      )
    },
    getDisconnectedMessage: () => {
      return `Browser integration is not connected. Please ensure the browser extension is installed and running (${extensionUrl}). If this is your first time connecting to Chrome, you may need to restart Chrome for the installation to take effect. If issues continue, review the browser integration guide: ${docsUrl}`
    },
    rememberPairedExtension: (deviceId: string, name: string) => {
      saveGlobalConfig(config => {
        if (
          config.chromeExtension?.pairedDeviceId === deviceId &&
          config.chromeExtension?.pairedDeviceName === name
        ) {
          return config
        }
        return {
          ...config,
          chromeExtension: {
            pairedDeviceId: deviceId,
            pairedDeviceName: name,
          },
        }
      })
      logger.info(`Paired with "${name}" (${deviceId.slice(0, 8)})`)
    },
    getRememberedDeviceId: () => {
      return getGlobalConfig().chromeExtension?.pairedDeviceId
    },
    ...(chromeBridgeUrl && {
      bridge: {
        url: chromeBridgeUrl,
        getUserId: async () => {
          return getGlobalConfig().oauthAccount?.accountUuid
        },
        getOAuthToken: async () => {
          return getHostedOAuthTokens()?.accessToken ?? ''
        },
        ...(isLocalBridge() && { devUserId: 'dev_user_local' }),
      },
    }),
    ...(initialPermissionMode && { initialPermissionMode }),
    // Wire inference for the browser_task tool — the chrome-mcp server runs
    // a lightning-mode agent loop in Node and calls the extension's
    // lightning_turn tool once per iteration for execution.
    //
    // Internal-only: the extension's lightning_turn is build-time-gated via
    // import.meta.env.INTERNAL_ONLY_BUILD — the whole lightning/ module graph is
    // tree-shaken from the public extension build (build:prod greps for a
    // marker to verify). Without this injection, the Node MCP server's
    // ListTools also filters browser_task + lightning_turn out, so external
    // users never see the tools advertised. Three independent gates.
    ...(isInternalOperatorMode() && {
      runBrowserTaskModelTurn: async req => {
        // sideQuery handles OAuth attribution fingerprint, proxy, model betas.
        // skipSystemPromptPrefix: the lightning prompt is complete on its own;
        // the CLI prefix would dilute the batching instructions.
        // tools: [] is load-bearing — without it Sonnet emits
        // <function_calls> XML before the text commands. Original
        // lightning-harness.js (apps repo) does the same.
        const response = await sideQuery({
          model: req.model,
          system: req.systemPrompt,
          messages: req.messages,
          max_tokens: req.maxTokens,
          stop_sequences: req.stopSequences,
          signal: req.signal,
          skipSystemPromptPrefix: true,
          tools: [],
          querySource: 'chrome_mcp',
        })
        // BetaContentBlock is TextBlock | ThinkingBlock | ToolUseBlock | ...
        // Only text blocks carry the model's command output.
        const textBlocks: Array<{ type: 'text'; text: string }> = []
        for (const b of response.content) {
          if (b.type === 'text') {
            textBlocks.push({ type: 'text', text: b.text })
          }
        }
        return {
          content: textBlocks,
          stopReason: response.stop_reason,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        }
      },
    }),
    trackEvent: (eventName, metadata) => {
      const safeMetadata: {
        [key: string]:
          | boolean
          | number
          | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          | undefined
      } = {}
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          // Rename 'status' to 'bridge_status' to avoid Datadog's reserved field
          const safeKey = key === 'status' ? 'bridge_status' : key
          if (typeof value === 'boolean' || typeof value === 'number') {
            safeMetadata[safeKey] = value
          } else if (
            typeof value === 'string' &&
            SAFE_BRIDGE_STRING_KEYS.has(safeKey)
          ) {
            // Only forward allowlisted string keys — fields like error_message
            // could contain page content or user data
            safeMetadata[safeKey] =
              value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          }
        }
      }
      logMossenEvent(eventName, safeMetadata)
    },
  }
}

export async function runMossenInChromeMcpServer(): Promise<void> {
  enableConfigs()
  initializeAnalyticsSink()
  const context = createChromeContext()

  const server = createMossenChromeMcpServer(context)
  const transport = new StdioServerTransport()

  // Exit when parent process dies (stdin pipe closes).
  // Flush analytics before exiting so final-batch events (e.g. disconnect) aren't lost.
  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) {
      return
    }
    exiting = true
    await shutdown1PEventLogging()
    await shutdownDatadog()
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  logForDebugging('[Chrome integration] Starting MCP server')
  await server.connect(transport)
  logForDebugging('[Chrome integration] MCP server started')
}

class DebugLogger implements MossenChromeLogger {
  silly(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  info(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'info' })
  }
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'warn' })
  }
  error(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'error' })
  }
}
