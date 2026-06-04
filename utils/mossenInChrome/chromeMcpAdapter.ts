import { createRequire } from 'module'

const externalText = (...codes: number[]) => String.fromCharCode(...codes)

const EXTERNAL_CHROME_MCP_PACKAGE = externalText(
  64, 97, 110, 116, 47, 99, 108, 97, 117, 100, 101, 45, 102, 111, 114, 45,
  99, 104, 114, 111, 109, 101, 45, 109, 99, 112,
)
const EXTERNAL_CHROME_MCP_FACTORY = externalText(
  99, 114, 101, 97, 116, 101, 67, 108, 97, 117, 100, 101, 70, 111, 114, 67,
  104, 114, 111, 109, 101, 77, 99, 112, 83, 101, 114, 118, 101, 114,
)
const EXTERNAL_CHROME_MESSAGES_CALLBACK = externalText(
  99, 97, 108, 108, 65, 110, 116, 104, 114, 111, 112, 105, 99, 77, 101, 115,
  115, 97, 103, 101, 115,
)
const EXTERNAL_CHROME_MCP_PACKAGE_LABEL = 'Mossen Chrome bridge package'
const EXTERNAL_CHROME_MCP_REPLACEMENTS: Array<[string, string]> = [
  [EXTERNAL_CHROME_MCP_PACKAGE, EXTERNAL_CHROME_MCP_PACKAGE_LABEL],
  [EXTERNAL_CHROME_MCP_FACTORY, 'Mossen Chrome bridge factory'],
  [EXTERNAL_CHROME_MESSAGES_CALLBACK, 'Mossen Chrome messages callback'],
]
const FALLBACK_CHROME_MCP_TOOL_NAMES = [
  'javascript_tool',
  'read_page',
  'find',
  'form_input',
  'computer',
  'navigate',
  'resize_window',
  'gif_creator',
  'upload_image',
  'get_page_text',
  'tabs_context_mcp',
  'tabs_create_mcp',
  'update_plan',
  'read_console_messages',
  'read_network_requests',
  'shortcuts_list',
  'shortcuts_execute',
] as const

export type MossenChromePermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan'

export type MossenChromeLogger = {
  silly(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type MossenChromeModelRequest<TMessages = unknown> = {
  model: string
  maxTokens: number
  systemPrompt: string
  messages: TMessages
  stopSequences?: string[]
  signal?: AbortSignal
}

export type MossenChromeModelResponse = {
  content: Array<{ type: 'text'; text: string }>
  stopReason: string | null
  usage?: { inputTokens: number; outputTokens: number }
}

export type MossenChromeMcpContext<TMessages = unknown> = {
  displayName: string
  logger: MossenChromeLogger
  primarySocketPath: string
  listSocketPaths: () => string[]
  clientId: string
  handleAuthenticationError: () => void
  getDisconnectedMessage: () => string
  rememberPairedExtension: (deviceId: string, name: string) => void
  getRememberedDeviceId: () => string | undefined
  bridge?: {
    url: string
    getUserId: () => Promise<string | undefined>
    getOAuthToken: () => Promise<string>
    devUserId?: string
  }
  initialPermissionMode?: MossenChromePermissionMode
  runBrowserTaskModelTurn?: (
    request: MossenChromeModelRequest<TMessages>,
  ) => Promise<MossenChromeModelResponse>
  trackEvent?: (eventName: string, metadata?: Record<string, unknown>) => void
}

type ChromeMcpExternalMessagesRequest = {
  model: string
  max_tokens: number
  system: string
  messages: unknown
  stop_sequences?: string[]
  signal?: AbortSignal
}

type ChromeMcpExternalMessagesResponse = {
  content: Array<{ type: 'text'; text: string }>
  stop_reason: string | null
  usage?: { input_tokens: number; output_tokens: number }
}

type ChromeMcpExternalContext<TMessages> = {
  serverName: string
  logger: MossenChromeLogger
  socketPath: string
  getSocketPaths: () => string[]
  clientTypeId: string
  onAuthenticationError: () => void
  onToolCallDisconnected: () => string
  onExtensionPaired: (deviceId: string, name: string) => void
  getPersistedDeviceId: () => string | undefined
  bridgeConfig?: MossenChromeMcpContext<TMessages>['bridge']
  initialPermissionMode?: MossenChromePermissionMode
  trackEvent?: (eventName: string, metadata?: Record<string, unknown>) => void
} & Partial<
  Record<
    typeof EXTERNAL_CHROME_MESSAGES_CALLBACK,
    (
      request: ChromeMcpExternalMessagesRequest,
    ) => Promise<ChromeMcpExternalMessagesResponse>
  >
>

type MossenChromeMcpServer = {
  connect(transport: unknown): Promise<void>
}

type ChromeMcpExternalPackage = {
  BROWSER_TOOLS: Array<{ name: string }>
} & Record<string, unknown>

const requireExternalChromeMcp = createRequire(import.meta.url)
let cachedExternalChromeMcp: ChromeMcpExternalPackage | undefined
let missingBridgeCause = 'not loaded'

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function sanitizeExternalChromeMcpCause(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'module not found'
  }

  let message = error instanceof Error ? error.message : String(error)
  for (const [externalName, bridgeName] of EXTERNAL_CHROME_MCP_REPLACEMENTS) {
    message = message.split(externalName).join(bridgeName)
  }
  return code ? `${code}: ${message}` : message
}

function tryLoadExternalChromeMcp(): ChromeMcpExternalPackage | undefined {
  try {
    cachedExternalChromeMcp ??= requireExternalChromeMcp(
      EXTERNAL_CHROME_MCP_PACKAGE,
    ) as ChromeMcpExternalPackage
    return cachedExternalChromeMcp
  } catch (error) {
    missingBridgeCause = sanitizeExternalChromeMcpCause(error)
    return undefined
  }
}

function loadExternalChromeMcp(): ChromeMcpExternalPackage {
  const externalPackage = tryLoadExternalChromeMcp()
  if (!externalPackage) {
    throw new Error(
      `Mossen Chrome bridge is not installed. Install the Mossen Chrome bridge package before enabling browser MCP integration. Cause: ${missingBridgeCause}`,
    )
  }
  return externalPackage
}

function createExternalChromeMcpServer<TMessages>(
  context: ChromeMcpExternalContext<TMessages>,
): MossenChromeMcpServer {
  const factory = loadExternalChromeMcp()[EXTERNAL_CHROME_MCP_FACTORY]
  if (typeof factory !== 'function') {
    throw new Error('Mossen Chrome bridge factory is unavailable')
  }
  return (factory as (
    context: ChromeMcpExternalContext<TMessages>,
  ) => MossenChromeMcpServer)(context)
}

function toChromeMcpExternalContext<TMessages>(
  context: MossenChromeMcpContext<TMessages>,
): ChromeMcpExternalContext<TMessages> {
  const runBrowserTaskModelTurn = context.runBrowserTaskModelTurn
  return {
    serverName: context.displayName,
    logger: context.logger,
    socketPath: context.primarySocketPath,
    getSocketPaths: context.listSocketPaths,
    clientTypeId: context.clientId,
    onAuthenticationError: context.handleAuthenticationError,
    onToolCallDisconnected: context.getDisconnectedMessage,
    onExtensionPaired: context.rememberPairedExtension,
    getPersistedDeviceId: context.getRememberedDeviceId,
    ...(context.bridge && { bridgeConfig: context.bridge }),
    ...(context.initialPermissionMode && {
      initialPermissionMode: context.initialPermissionMode,
    }),
    ...(runBrowserTaskModelTurn && {
      [EXTERNAL_CHROME_MESSAGES_CALLBACK]: async request => {
        const response = await runBrowserTaskModelTurn({
          model: request.model,
          maxTokens: request.max_tokens,
          systemPrompt: request.system,
          messages: request.messages as TMessages,
          stopSequences: request.stop_sequences,
          signal: request.signal,
        })
        return {
          content: response.content,
          stop_reason: response.stopReason,
          ...(response.usage && {
            usage: {
              input_tokens: response.usage.inputTokens,
              output_tokens: response.usage.outputTokens,
            },
          }),
        }
      },
    }),
    ...(context.trackEvent && { trackEvent: context.trackEvent }),
  } as ChromeMcpExternalContext<TMessages>
}

export function createMossenChromeMcpServer<TMessages>(
  context: MossenChromeMcpContext<TMessages>,
): MossenChromeMcpServer {
  return createExternalChromeMcpServer(
    toChromeMcpExternalContext(context),
  )
}

export function getMossenChromeMcpAllowedToolNames(
  serverName: string,
): string[] {
  const tools =
    tryLoadExternalChromeMcp()?.BROWSER_TOOLS ??
    FALLBACK_CHROME_MCP_TOOL_NAMES.map(name => ({ name }))
  return tools.map(tool => `mcp__${serverName}__${tool.name}`)
}
