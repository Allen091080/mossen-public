/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Main entrypoint for Mossen Agent SDK types.
 *
 * This file re-exports the public SDK API from:
 * - sdk/coreTypes.ts - Common serializable types (messages, configs)
 * - sdk/runtimeTypes.ts - Non-serializable types (callbacks, interfaces)
 *
 * SDK builders who need control protocol types should import from
 * sdk/controlTypes.ts directly.
 */

import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'crypto'

// Control protocol types for SDK builders (bridge subpath consumers)
/** @alpha */
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'
// Re-export runtime types (callbacks, interfaces with methods)
export * from './sdk/runtimeTypes.js'

type LooseSdkRecord = any

export type SDKAssistantMessage = LooseSdkRecord
export type SDKAssistantMessageError = LooseSdkRecord
export type SDKCompactBoundaryMessage = LooseSdkRecord
export type SDKPartialAssistantMessage = LooseSdkRecord
export type SDKPermissionDenial = LooseSdkRecord
export type SDKRateLimitInfo = LooseSdkRecord
export type SDKStatusMessage = LooseSdkRecord
export type SDKSystemMessage = LooseSdkRecord
export type SDKToolProgressMessage = LooseSdkRecord

export type ApiKeySource = string
export type McpServerConfigForProcessTransport = LooseSdkRecord
export type McpServerStatus = LooseSdkRecord
export type ModelInfo = LooseSdkRecord
export type ModelUsage = LooseSdkRecord
export type PermissionMode = string
export type PermissionResult = LooseSdkRecord
export type PermissionUpdate = LooseSdkRecord
export type RewindFilesResult = LooseSdkRecord

export type HookInput = LooseSdkRecord
export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}
export type SyncHookJSONOutput = {
  async?: false
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  continueOnBlock?: boolean
  systemMessage?: string
  terminalSequence?: string
  hookSpecificOutput?: {
    hookEventName?: string
    worktreePath?: string
    watchPaths?: string[]
    hookSpecificOutput?: unknown
    [key: string]: any
  }
}
export type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
export type NotificationHookInput = LooseSdkRecord
export type PostToolUseHookInput = LooseSdkRecord
export type PostToolUseFailureHookInput = LooseSdkRecord
export type PermissionDeniedHookInput = LooseSdkRecord
export type PreCompactHookInput = LooseSdkRecord
export type PostCompactHookInput = LooseSdkRecord
export type PreToolUseHookInput = LooseSdkRecord
export type SessionStartHookInput = LooseSdkRecord
export type SessionEndHookInput = LooseSdkRecord
export type SetupHookInput = LooseSdkRecord
export type StopHookInput = LooseSdkRecord
export type StopFailureHookInput = LooseSdkRecord
export type SubagentStartHookInput = LooseSdkRecord
export type SubagentStopHookInput = LooseSdkRecord
export type TeammateIdleHookInput = LooseSdkRecord
export type TaskCreatedHookInput = LooseSdkRecord
export type TaskCompletedHookInput = LooseSdkRecord
export type ConfigChangeHookInput = LooseSdkRecord
export type CwdChangedHookInput = LooseSdkRecord
export type FileChangedHookInput = LooseSdkRecord
export type InstructionsLoadedHookInput = LooseSdkRecord
export type UserPromptSubmitHookInput = LooseSdkRecord
export type PermissionRequestHookInput = LooseSdkRecord
export type ElicitationHookInput = LooseSdkRecord
export type ElicitationResultHookInput = LooseSdkRecord

// Re-export settings types (generated from settings JSON schema)
export type { Settings } from './sdk/settingsTypes.generated.js'
// Re-export tool types (all marked @internal until SDK API stabilizes)
export * from './sdk/toolTypes.js'

// ============================================================================
// Functions
// ============================================================================

import type {
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from './sdk/runtimeTypes.js'
// Import types needed for function signatures
import type {
  AnyZodRawShape,
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  InferShape,
  InternalOptions,
  InternalQuery,
  ListSessionsOptions,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKSession,
  SDKSessionInfo,
  SDKSessionOptions,
  SdkMcpToolDefinition,
  SessionMessage,
  SessionMutationOptions,
} from './sdk/runtimeTypes.js'

export type {
  ListSessionsOptions,
  GetSessionInfoOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SDKSessionInfo,
}

export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('SDK tool name cannot be empty')
  if (!description.trim()) throw new Error('SDK tool description cannot be empty')
  return {
    name: trimmedName,
    description,
    inputSchema,
    handler: handler as SdkMcpToolDefinition<Schema>['handler'],
    ...extras,
  }
}

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Array<SdkMcpToolDefinition<any>>
}

/**
 * Creates an MCP server instance that can be used with the SDK transport.
 * This allows SDK users to define custom tools that run in the same process.
 *
 * If your SDK MCP calls will run longer than 60s, override MOSSEN_CODE_STREAM_CLOSE_TIMEOUT
 */
export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  const name = options.name.trim()
  if (!name) throw new Error('SDK MCP server name cannot be empty')
  const version = options.version?.trim() || '0.0.0'
  const tools = (options.tools ?? []) as Array<SdkMcpToolDefinition<unknown>>
  return {
    name,
    version,
    tools,
    instance: {
      name,
      version,
      tools,
    },
  }
}

export class AbortError extends Error {}

type SdkOptionsRecord = Record<string, unknown> | undefined
type SdkQueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions | Options | SDKSessionOptions
}
type AbortSignalLike = {
  aborted: boolean
  addEventListener?: (
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ) => void
  removeEventListener?: (type: 'abort', listener: () => void) => void
}

function optionString(
  options: SdkOptionsRecord,
  key: string,
): string | undefined {
  const value = options?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionBoolean(options: SdkOptionsRecord, key: string): boolean {
  return options?.[key] === true
}

function optionNonNegativeInteger(
  options: SdkOptionsRecord,
  key: string,
): number | undefined {
  const value = options?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

function optionAbortSignal(options: SdkOptionsRecord): AbortSignalLike | undefined {
  const value = options?.signal
  if (typeof value !== 'object' || value === null || !('aborted' in value)) {
    return undefined
  }
  return value as AbortSignalLike
}

function optionStringArray(options: SdkOptionsRecord, key: string): string[] {
  const value = options?.[key]
  if (typeof value === 'string' && value.length > 0) return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function appendOption(args: string[], flag: string, value: string | undefined): void {
  if (value) args.push(flag, value)
}

function appendRepeatedOption(
  args: string[],
  flag: string,
  values: readonly string[],
): void {
  for (const value of values) args.push(flag, value)
}

function appendBooleanOption(
  args: string[],
  options: SdkOptionsRecord,
  key: string,
  flag: string,
): void {
  if (optionBoolean(options, key)) args.push(flag)
}

function buildSdkQueryArgs(params: SdkQueryParams): string[] {
  const options = params.options as SdkOptionsRecord
  const args = ['--print', '--output-format', 'stream-json', '--verbose']
  if (typeof params.prompt === 'string') {
    args.push(params.prompt)
  } else {
    args.push('--input-format', 'stream-json')
  }

  appendOption(args, '--model', optionString(options, 'model'))
  appendOption(args, '--fallback-model', optionString(options, 'fallbackModel'))
  appendOption(args, '--permission-mode', optionString(options, 'permissionMode'))
  appendOption(args, '--system-prompt', optionString(options, 'systemPrompt'))
  appendOption(args, '--append-system-prompt', optionString(options, 'appendSystemPrompt'))
  appendOption(args, '--session-id', optionString(options, 'sessionId'))
  appendOption(args, '--resume-session-at', optionString(options, 'resumeSessionAt'))
  appendOption(args, '--name', optionString(options, 'name'))
  appendOption(args, '--agent', optionString(options, 'agent'))
  appendOption(args, '--settings', optionString(options, 'settings'))
  appendOption(args, '--workload', optionString(options, 'workload'))

  const resume = optionString(options, 'resume')
  if (resume) args.push('--resume', resume)
  if (optionBoolean(options, 'continue')) args.push('--continue')
  if (optionBoolean(options, 'forkSession')) args.push('--fork-session')

  const maxTurns = optionNonNegativeInteger(options, 'maxTurns')
  if (maxTurns !== undefined) args.push('--max-turns', String(maxTurns))

  appendRepeatedOption(args, '--allowedTools', optionStringArray(options, 'allowedTools'))
  appendRepeatedOption(args, '--disallowedTools', optionStringArray(options, 'disallowedTools'))
  appendRepeatedOption(args, '--tools', optionStringArray(options, 'tools'))
  appendRepeatedOption(args, '--mcp-config', optionStringArray(options, 'mcpConfig'))
  appendRepeatedOption(args, '--add-dir', optionStringArray(options, 'addDir'))
  appendBooleanOption(args, options, 'includePartialMessages', '--include-partial-messages')
  appendBooleanOption(args, options, 'includeHookEvents', '--include-hook-events')
  appendBooleanOption(args, options, 'noSessionPersistence', '--no-session-persistence')

  return args
}

async function writeSdkQueryInput(
  stdin: { write(data: string): boolean; once(event: 'drain', listener: () => void): void; end(): void },
  prompt: string | AsyncIterable<SDKUserMessage>,
): Promise<void> {
  if (typeof prompt === 'string') {
    stdin.end()
    return
  }
  for await (const message of prompt) {
    const line = `${JSON.stringify(message)}\n`
    if (!stdin.write(line)) {
      await new Promise<void>(resolve => stdin.once('drain', resolve))
    }
  }
  stdin.end()
}

function createSdkSession(
  sessionId: string,
  baseOptions: SDKSessionOptions,
): SDKSession {
  const withSession = (options?: SDKSessionOptions): SDKSessionOptions => ({
    ...baseOptions,
    ...options,
    sessionId,
  })
  return {
    id: sessionId,
    query(prompt, options) {
      return query({ prompt, options: withSession(options) })
    },
    prompt(message, options) {
      return unstable_v2_prompt(message, withSession(options))
    },
  }
}

async function appendSdkSessionEntry(
  filePath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const { appendFile } = await import('fs/promises')
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

/** @internal */
export function query(_params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions
}): InternalQuery
export function query(_params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
export function query(params: SdkQueryParams): Query {
  return runSdkQuery(params)
}

async function* runSdkQuery(params: SdkQueryParams): AsyncGenerator<SDKMessage> {
  const options = params.options as SdkOptionsRecord
  const signal = optionAbortSignal(options)
  if (signal?.aborted) return

  const [{ spawn }, { fileURLToPath }, { dirname, resolve }] = await Promise.all([
    import('child_process'),
    import('url'),
    import('path'),
  ])
  if (signal?.aborted) return

  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const child = spawn(resolve(rootDir, 'run-mossen.sh'), buildSdkQueryArgs(params), {
    cwd: optionString(options, 'cwd') ?? process.cwd(),
    env: {
      ...process.env,
      ...((options?.env && typeof options.env === 'object'
        ? options.env
        : {}) as Record<string, string>),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exitPromise = new Promise<number | null>(resolveExit => {
    child.once('exit', code => resolveExit(code))
  })

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })

  const abort = (): void => {
    child.kill('SIGTERM')
  }
  signal?.addEventListener?.('abort', abort, { once: true })

  const inputDone = writeSdkQueryInput(child.stdin, params.prompt)
  child.stdout.setEncoding('utf8')
  let buffer = ''
  try {
    for await (const chunk of child.stdout) {
      buffer += String(chunk)
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield JSON.parse(line) as SDKMessage
        newline = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail) yield JSON.parse(tail) as SDKMessage
    await inputDone
    const code = await exitPromise
    if (signal?.aborted) throw new AbortError('SDK query aborted')
    if (code !== 0) {
      const message = stderr.trim() || `SDK query exited with code ${code}`
      throw new Error(message)
    }
  } finally {
    signal?.removeEventListener?.('abort', abort)
  }
}

/**
 * V2 API - UNSTABLE
 * Create a persistent session for multi-turn conversations.
 * @alpha
 */
export function unstable_v2_createSession(
  options: SDKSessionOptions,
): SDKSession {
  const explicitId = optionString(options, 'sessionId')
  const id = explicitId ?? randomUUID()
  return createSdkSession(id, options)
}

/**
 * V2 API - UNSTABLE
 * Resume an existing session by ID.
 * @alpha
 */
export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession {
  const id = sessionId.trim()
  if (!id) throw new Error('sessionId cannot be empty')
  return createSdkSession(id, {
    ...options,
    resume: id,
  })
}

// @[MODEL LAUNCH]: Update the example model ID in this docstring.
/**
 * V2 API - UNSTABLE
 * One-shot convenience function for single prompts.
 * @alpha
 *
 * @example
 * ```typescript
 * const result = await unstable_v2_prompt("What files are here?", {
 *   model: 'mossen-sonnet-4-6'
 * })
 * ```
 */
export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  let result: SDKResultMessage | undefined
  for await (const event of query({ prompt: message, options })) {
    const sdkEvent = event as SDKMessage
    if (sdkEvent.type === 'result') {
      result = sdkEvent as SDKResultMessage
    }
  }
  if (!result) throw new Error('SDK prompt completed without a result message')
  return result
}

/**
 * Reads a session's conversation messages from its JSONL transcript file.
 *
 * Parses the transcript, builds the conversation chain via parentUuid links,
 * and returns user/assistant messages in chronological order. Set
 * `includeSystemMessages: true` in options to also include system messages.
 *
 * @param sessionId - UUID of the session to read
 * @param options - Optional dir, limit, offset, and includeSystemMessages
 * @returns Array of messages, or empty array if session not found
 */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const { validateUuid, resolveSessionFilePath } = await import(
    '../utils/sessionStoragePortable.js'
  )
  const { buildConversationChain, loadTranscriptFile } = await import(
    '../utils/sessionStorage.js'
  )

  const validSessionId = validateUuid(sessionId)
  if (!validSessionId) return []

  const resolved = await resolveSessionFilePath(
    validSessionId,
    optionString(options, 'dir'),
  )
  if (!resolved) return []

  const { messages, leafUuids } = await loadTranscriptFile(resolved.filePath)
  const requestedLeaf = validateUuid(optionString(options, 'leafUuid'))
  const includeSystemMessages = optionBoolean(options, 'includeSystemMessages')
  const transcriptMessages = [...messages.values()]
  const leaves = [...leafUuids]
    .map(uuid => messages.get(uuid))
    .filter(message => message !== undefined)

  const leafMessage = requestedLeaf
    ? messages.get(requestedLeaf)
    : (includeSystemMessages ? transcriptMessages : leaves).reduce<
        (typeof transcriptMessages)[number] | undefined
      >((latest, message) => {
        if (!latest) return message
        return Date.parse(message.timestamp) > Date.parse(latest.timestamp)
          ? message
          : latest
      }, undefined)

  if (!leafMessage) return []

  const offset = optionNonNegativeInteger(options, 'offset') ?? 0
  const limit = optionNonNegativeInteger(options, 'limit')

  const chain = buildConversationChain(messages, leafMessage).filter(message => {
    if (message.type === 'user' || message.type === 'assistant') return true
    return includeSystemMessages && message.type === 'system'
  })
  const page =
    limit && limit > 0 ? chain.slice(offset, offset + limit) : chain.slice(offset)
  return page as unknown as SessionMessage[]
}

/**
 * List sessions with metadata.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Use `limit` and `offset` for pagination.
 *
 * @example
 * ```typescript
 * // List sessions for a specific project
 * const sessions = await listSessions({ dir: '/path/to/project' })
 *
 * // Paginate
 * const page1 = await listSessions({ limit: 50 })
 * const page2 = await listSessions({ limit: 50, offset: 50 })
 * ```
 */
export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  const { listSessionsImpl } = await import('../utils/listSessionsImpl.js')
  return (await listSessionsImpl(
    options as Parameters<typeof listSessionsImpl>[0],
  )) as unknown as SDKSessionInfo[]
}

/**
 * Reads metadata for a single session by ID. Unlike `listSessions`, this only
 * reads the single session file rather than every session in the project.
 * Returns undefined if the session file is not found, is a sidechain session,
 * or has no extractable summary.
 *
 * @param sessionId - UUID of the session
 * @param options - `{ dir?: string }` project path; omit to search all project directories
 */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  const { parseSessionInfoFromLite } = await import(
    '../utils/listSessionsImpl.js'
  )
  const { readSessionLite, resolveSessionFilePath, validateUuid } = await import(
    '../utils/sessionStoragePortable.js'
  )

  const validSessionId = validateUuid(sessionId)
  if (!validSessionId) return undefined

  const resolved = await resolveSessionFilePath(
    validSessionId,
    optionString(options, 'dir'),
  )
  if (!resolved) return undefined

  const lite = await readSessionLite(resolved.filePath)
  if (!lite) return undefined

  return (
    parseSessionInfoFromLite(validSessionId, lite, resolved.projectPath) ??
    undefined
  ) as SDKSessionInfo | undefined
}

/**
 * Rename a session. Appends a custom-title entry to the session's JSONL file.
 * @param sessionId - UUID of the session
 * @param title - New title
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) throw new Error('Session title cannot be empty')

  const { resolveSessionFilePath, validateUuid } = await import(
    '../utils/sessionStoragePortable.js'
  )
  const validSessionId = validateUuid(sessionId)
  if (!validSessionId) throw new Error('Invalid session ID')

  const resolved = await resolveSessionFilePath(
    validSessionId,
    optionString(options, 'dir'),
  )
  if (!resolved) throw new Error('Session not found')

  await appendSdkSessionEntry(resolved.filePath, {
    type: 'custom-title',
    sessionId: validSessionId,
    customTitle: trimmedTitle,
  })
}

/**
 * Tag a session. Pass null to clear the tag.
 * @param sessionId - UUID of the session
 * @param tag - Tag string, or null to clear
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  const normalizedTag = tag === null ? '' : tag.trim()

  const { resolveSessionFilePath, validateUuid } = await import(
    '../utils/sessionStoragePortable.js'
  )
  const validSessionId = validateUuid(sessionId)
  if (!validSessionId) throw new Error('Invalid session ID')

  const resolved = await resolveSessionFilePath(
    validSessionId,
    optionString(options, 'dir'),
  )
  if (!resolved) throw new Error('Session not found')

  await appendSdkSessionEntry(resolved.filePath, {
    type: 'tag',
    sessionId: validSessionId,
    tag: normalizedTag,
  })
}

/**
 * Fork a session into a new branch with fresh UUIDs.
 *
 * Copies transcript messages from the source session into a new session file,
 * remapping every message UUID and preserving the parentUuid chain. Supports
 * `upToMessageId` for branching from a specific point in the conversation.
 *
 * Forked sessions start without undo history (file-history snapshots are not
 * copied).
 *
 * @param sessionId - UUID of the source session
 * @param options - `{ dir?, upToMessageId?, title? }`
 * @returns `{ sessionId }` — UUID of the new forked session
 */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const { randomUUID } = await import('crypto')
  const { mkdir, writeFile } = await import('fs/promises')
  const { dirname, join } = await import('path')
  const { validateUuid, resolveSessionFilePath } = await import(
    '../utils/sessionStoragePortable.js'
  )
  const { buildConversationChain, loadTranscriptFile } = await import(
    '../utils/sessionStorage.js'
  )

  const validSessionId = validateUuid(sessionId)
  if (!validSessionId) throw new Error('Invalid session ID')

  const resolved = await resolveSessionFilePath(
    validSessionId,
    optionString(options, 'dir'),
  )
  if (!resolved) throw new Error('Session not found')

  const { messages, leafUuids } = await loadTranscriptFile(resolved.filePath)
  const requestedLeaf = validateUuid(optionString(options, 'upToMessageId'))
  let leafMessage = requestedLeaf ? messages.get(requestedLeaf) : undefined
  if (!leafMessage && !requestedLeaf) {
    for (const uuid of leafUuids) {
      const message = messages.get(uuid)
      if (!message) continue
      if (
        !leafMessage ||
        Date.parse(message.timestamp) > Date.parse(leafMessage.timestamp)
      ) {
        leafMessage = message
      }
    }
  }

  if (!leafMessage) {
    throw new Error(
      requestedLeaf ? 'Message not found' : 'Session has no messages',
    )
  }

  const chain = buildConversationChain(messages, leafMessage).filter(
    message => message.type === 'user' || message.type === 'assistant',
  )
  if (chain.length === 0) throw new Error('Session has no forkable messages')

  const forkSessionId = randomUUID()
  const uuidMap = new Map<string, string>()
  for (const message of chain) {
    uuidMap.set(message.uuid, randomUUID())
  }

  const lines = chain.map(message => {
    const forkedMessage: Record<string, unknown> = {
      ...message,
      uuid: uuidMap.get(message.uuid),
      sessionId: forkSessionId,
      parentUuid: message.parentUuid
        ? (uuidMap.get(message.parentUuid) ?? null)
        : null,
      logicalParentUuid: message.logicalParentUuid
        ? (uuidMap.get(message.logicalParentUuid) ?? null)
        : message.logicalParentUuid,
      isSidechain: false,
      forkedFrom: {
        sessionId: validSessionId,
        messageUuid: message.uuid,
      },
    }
    return JSON.stringify(forkedMessage)
  })

  const title = optionString(options, 'title')?.trim()
  if (title) {
    lines.push(
      JSON.stringify({
        type: 'custom-title',
        sessionId: forkSessionId,
        customTitle: title,
      }),
    )
  }

  const forkPath = join(dirname(resolved.filePath), `${forkSessionId}.jsonl`)
  await mkdir(dirname(forkPath), { recursive: true, mode: 0o700 })
  await writeFile(forkPath, `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })

  return { sessionId: forkSessionId } as ForkSessionResult
}

// ============================================================================
// Assistant daemon primitives (internal)
// ============================================================================

/**
 * A scheduled task from `<dir>/.mossen/scheduled_tasks.json`.
 * @internal
 */
export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
}

/**
 * Cron scheduler tuning knobs (jitter + expiry). Sourced at runtime from the
 * the native cron jitter config in CLI sessions; daemon hosts
 * pass this through `watchScheduledTasks({ getJitterConfig })` to get the
 * same tuning.
 * @internal
 */
export type CronJitterConfig = {
  recurringFrac: number
  recurringCapMs: number
  oneShotMaxMs: number
  oneShotFloorMs: number
  oneShotMinuteMod: number
  recurringMaxAgeMs: number
}

/**
 * Event yielded by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTaskEvent =
  | { type: 'fire'; task: CronTask }
  | { type: 'missed'; tasks: CronTask[] }

/**
 * Handle returned by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTasksHandle = {
  /** Async stream of fire/missed events. Drain with `for await`. */
  events(): AsyncGenerator<ScheduledTaskEvent>
  /**
   * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
   * if nothing is scheduled. Useful for deciding whether to tear down an
   * idle agent subprocess or keep it warm for an imminent fire.
   */
  getNextFireTime(): number | null
}

/**
 * Watch `<dir>/.mossen/scheduled_tasks.json` and yield events as tasks fire.
 *
 * Acquires the per-directory scheduler lock (PID-based liveness) so a REPL
 * session in the same dir won't double-fire. Releases the lock and closes
 * the file watcher when the signal aborts.
 *
 * - `fire` — a task whose cron schedule was met. One-shot tasks are already
 *   deleted from the file when this yields; recurring tasks are rescheduled
 *   (or deleted if aged out).
 * - `missed` — one-shot tasks whose window passed while the daemon was down.
 *   Yielded once on initial load; a background delete removes them from the
 *   file shortly after.
 *
 * Intended for daemon architectures that own the scheduler externally and
 * spawn the agent via `query()`; the agent subprocess (`-p` mode) does not
 * run its own scheduler.
 *
 * @internal
 */
export function watchScheduledTasks(_opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle {
  const opts = _opts
  const queue: ScheduledTaskEvent[] = []
  let wake: (() => void) | undefined
  let stopped = false
  let scheduler: { start(): void; stop(): void; getNextFireTime(): number | null } | undefined

  function notify(): void {
    const resolve = wake
    wake = undefined
    resolve?.()
  }

  function push(event: ScheduledTaskEvent): void {
    if (stopped) return
    queue.push(event)
    notify()
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    scheduler?.stop()
    notify()
  }

  opts.signal.addEventListener('abort', stop, { once: true })

  void Promise.all([
    import('crypto'),
    import('../utils/cronScheduler.js'),
  ])
    .then(([{ randomUUID }, { createCronScheduler }]) => {
      if (stopped) return
      scheduler = createCronScheduler({
        dir: opts.dir,
        lockIdentity: randomUUID(),
        assistantMode: true,
        isLoading: () => false,
        getJitterConfig: opts.getJitterConfig,
        onFire: prompt =>
          push({
            type: 'fire',
            task: {
              id: randomUUID().slice(0, 8),
              cron: '* * * * *',
              prompt,
              createdAt: Date.now(),
            },
          }),
        onFireTask: task => push({ type: 'fire', task }),
        onMissed: tasks => push({ type: 'missed', tasks }),
      })
      scheduler.start()
    })
    .catch(stop)

  return {
    async *events(): AsyncGenerator<ScheduledTaskEvent> {
      while (!stopped || queue.length > 0) {
        const event = queue.shift()
        if (event) {
          yield event
          continue
        }
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
    },
    getNextFireTime(): number | null {
      return scheduler?.getNextFireTime() ?? null
    },
  }
}

/**
 * Format missed one-shot tasks into a prompt that asks the model to confirm
 * with the user (via AskUserQuestion) before executing.
 * @internal
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
  const plural = missed.length > 1
  const header =
    `The following one-shot scheduled task${plural ? 's were' : ' was'} missed while Mossen was not running. ` +
    `${plural ? 'They have' : 'It has'} already been removed from .mossen/scheduled_tasks.json.\n\n` +
    `Do NOT execute ${plural ? 'these prompts' : 'this prompt'} yet. ` +
    `First use the AskUserQuestion tool to ask whether to run ${plural ? 'each one' : 'it'} now. ` +
    `Only execute if the user confirms.`

  const blocks = missed.map(task => {
    const meta = `[${task.cron}, created ${new Date(task.createdAt).toLocaleString()}]`
    const backtickRuns: string[] = task.prompt.match(/`+/g) ?? []
    let longestRun = 0
    for (const run of backtickRuns) {
      longestRun = Math.max(longestRun, run.length)
    }
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `${meta}\n${fence}\n${task.prompt}\n${fence}`
  })

  return `${header}\n\n${blocks.join('\n\n')}`
}

/**
 * A user message typed in the hosted web app, extracted from the bridge WS.
 * @internal
 * @deprecated Mossen 个人版不实现 hosted web app, 此类型不会被构造或消费。
 *   保留以维持 SDK type surface 完整性 (NEEDS-DESIGN-005)。
 */
export type InboundPrompt = {
  content: string | unknown[]
  uuid?: string
}

/**
 * Options for connectRemoteControl.
 * @internal
 * @deprecated Mossen 个人版不实现 hosted remote control (NEEDS-DESIGN-005)。
 */
export type ConnectRemoteControlOptions = {
  dir: string
  name?: string
  workerType?: string
  branch?: string
  gitRepoUrl?: string | null
  getAccessToken: () => string | undefined
  baseUrl: string
  orgUUID: string
  model: string
}

/**
 * Handle returned by connectRemoteControl. Write query() yields in,
 * read inbound prompts out. See src/assistant/daemonBridge.ts for full
 * field documentation.
 * @internal
 * @deprecated Mossen 个人版不实现 hosted remote control (NEEDS-DESIGN-005)。
 */
export type RemoteControlHandle = {
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  sendControlRequest(req: unknown): void
  sendControlResponse(res: unknown): void
  sendControlCancelRequest(requestId: string): void
  inboundPrompts(): AsyncGenerator<InboundPrompt>
  controlRequests(): AsyncGenerator<unknown>
  permissionResponses(): AsyncGenerator<unknown>
  onStateChange(
    cb: (
      state: 'ready' | 'connected' | 'reconnecting' | 'failed',
      detail?: string,
    ) => void,
  ): void
  teardown(): Promise<void>
}

/**
 * Hold a hosted remote-control bridge connection from a daemon process.
 *
 * The daemon owns the WebSocket in the PARENT process — if the agent
 * subprocess (spawned via `query()`) crashes, the daemon respawns it while
 * the hosted web app keeps the same session. Contrast with `query.enableRemoteControl`
 * which puts the WS in the CHILD process (dies with the agent).
 *
 * Pipe `query()` yields through `write()` + `sendResult()`. Read
 * `inboundPrompts()` (user typed in the hosted web app) into `query()`'s input
 * stream. Handle `controlRequests()` locally (interrupt → abort, set_model
 * → reconfigure).
 *
 * Skips the remote bridge gate and policy-limits check — @internal
 * caller is pre-entitled. OAuth is still required (env var or keychain).
 *
 * Returns null on no-OAuth or registration failure.
 *
 * @internal
 * @deprecated Mossen 个人版不实现; 函数体始终 throw 'not implemented' (NEEDS-DESIGN-005)。
 *   保留 stub 以维持 SDK type surface 兼容。
 */
export async function connectRemoteControl(
  _opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  throw new Error('not implemented')
}
