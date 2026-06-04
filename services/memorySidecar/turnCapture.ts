import { getSessionId } from '../../bootstrap/state.js'
import {
  getDefaultMemorySidecarConfigPath,
  ingestAdapterPayloads,
  listUnconsumedDirtyMarkers,
  loadMemorySidecarConfig,
  projectIdFromCwd,
  runMemoryAgentOnce,
  shouldScheduleMemoryAgent,
  type MemoryAdapterPayload,
} from '../../memory-sidecar/src/index.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { extractTextContent, isSyntheticMessage } from '../../utils/messages.js'
import {
  isAssistantControlOutput,
  isControlPlaneMessage,
  stripInternalReasoning,
} from './captureFilters.js'
import { emitMemoryCaptured } from './captureEvents.js'

// W121-A item 9 (L6): re-export so existing external callers keep working.
export { stripInternalReasoning } from './captureFilters.js'

const capturedSourceEventIds = new Set<string>()
let workerRunInFlight = false

type CapturableMessage = {
  type: string
  uuid?: string
  timestamp?: string
  message?: {
    model?: string
    content?: string | Array<{ type: string; text?: string }>
  }
  isMeta?: true
  isVirtual?: true
  isVisibleInTranscriptOnly?: true
  isCompactSummary?: true
  isApiErrorMessage?: true
  toolUseResult?: unknown
  permissionMode?: string
}

export type MemorySidecarTurnCaptureResult =
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'captured'
      accepted: number
      skipped: number
      failed: number
      scheduledWorker: boolean
    }

export async function captureTurnForMemorySidecar(
  context: REPLHookContext,
): Promise<MemorySidecarTurnCaptureResult> {
  if (context.toolUseContext.agentId) {
    return { status: 'skipped', reason: 'subagent' }
  }
  if (
    context.querySource &&
    !context.querySource.startsWith('repl_main_thread') &&
    context.querySource !== 'sdk'
  ) {
    return { status: 'skipped', reason: `query_source:${context.querySource}` }
  }

  let config
  try {
    config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
  } catch (error) {
    logForDebugging(
      `[memory-sidecar] failed to load config: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return { status: 'skipped', reason: 'config_error' }
  }

  if (!config.enabled || !config.adapter.enabled) {
    return { status: 'skipped', reason: 'disabled' }
  }

  const cwd = getCwd()
  const projectId = projectIdFromCwd(cwd)
  const sessionId = getSessionId()
  const permissionMode =
    context.toolUseContext.getAppState().toolPermissionContext.mode
  const payloads = messagesToAdapterPayloads({
    messages: context.messages,
    projectId,
    sessionId,
    cwd,
    permissionMode,
    maxTextChars: config.adapter.maxTextChars,
  })

  if (payloads.length === 0) {
    return { status: 'skipped', reason: 'no_new_text_messages' }
  }

  try {
    const result = await ingestAdapterPayloads({
      rootDir: config.homeDir,
      payloads,
      defaultProjectId: projectId,
      enabled: config.adapter.enabled,
      maxPayloadBytes: config.adapter.maxPayloadBytes,
      maxTextChars: config.adapter.maxTextChars,
      rejectToolPayloads: config.adapter.rejectToolPayloads,
      deadLetter: config.adapter.deadLetter,
    })

    const scheduledWorker = await maybeRunMemoryWorker({
      rootDir: config.homeDir,
      projectId,
      llmProviderConfig: config.classification.llm
        ? config.classification.llmProviderConfig
        : undefined,
      llmProviderConfigByJob: config.classification.llm
        ? config.classification.perJobProvider
        : undefined,
      dirtyCountThreshold: config.agent.schedule.dirtyCountThreshold,
      maxDirtyAgeMsThreshold: config.agent.schedule.maxDirtyAgeMsThreshold,
    })

    // W418 S1 — Surface the most-recent captured turn to any TUI subscriber so
    // a transient toast can show "📝 已记忆 ...". Best-effort; never blocks.
    // W419 — Also pair the toast event with the archiveEventId so /undo can
    // target the exact JSONL entry. IngressEventAck.archiveEventId is already
    // populated by the ingest pipeline; we walk result.events backwards to
    // find the last 'accepted' ack and pair it with the payload that
    // produced it (matched by sourceEventId).
    if (result.accepted > 0) {
      const acceptedAck = [...result.events]
        .reverse()
        .find(ack => ack.status === 'accepted' && ack.archiveEventId)
      const representative =
        (acceptedAck?.sourceEventId
          ? payloads.find(p => p.sourceEventId === acceptedAck.sourceEventId)
          : undefined) ??
        [...payloads].reverse().find(p => p.role === 'assistant') ??
        payloads[payloads.length - 1]
      if (representative) {
        emitMemoryCaptured({
          sourceEventId: representative.sourceEventId ?? `mossen:${sessionId}`,
          archiveEventId: acceptedAck?.archiveEventId,
          text: representative.text,
          scope: representative.scope ?? 'project',
          kind: 'auto',
          acceptedCount: result.accepted,
          projectId,
          sessionId,
          createdAt: representative.createdAt ?? new Date().toISOString(),
        })
      }
    }

    return {
      status: 'captured',
      accepted: result.accepted,
      skipped: result.skipped,
      failed: result.failed,
      scheduledWorker,
    }
  } catch (error) {
    logForDebugging(
      `[memory-sidecar] turn capture failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return { status: 'skipped', reason: 'ingest_error' }
  }
}

export function _resetMemorySidecarTurnCaptureForTesting(): void {
  capturedSourceEventIds.clear()
  workerRunInFlight = false
}

function messagesToAdapterPayloads({
  messages,
  projectId,
  sessionId,
  cwd,
  permissionMode,
  maxTextChars,
}: {
  messages: CapturableMessage[]
  projectId: string
  sessionId: string
  cwd: string
  permissionMode: string
  maxTextChars: number
}): MemoryAdapterPayload[] {
  const payloads: MemoryAdapterPayload[] = []
  for (const message of messages) {
    const payload = messageToAdapterPayload({
      message,
      projectId,
      sessionId,
      cwd,
      permissionMode,
      maxTextChars,
    })
    if (!payload) continue
    if (capturedSourceEventIds.has(payload.sourceEventId!)) continue
    capturedSourceEventIds.add(payload.sourceEventId!)
    payloads.push(payload)
  }
  return payloads
}

function messageToAdapterPayload({
  message,
  projectId,
  sessionId,
  cwd,
  permissionMode,
  maxTextChars,
}: {
  message: CapturableMessage
  projectId: string
  sessionId: string
  cwd: string
  permissionMode: string
  maxTextChars: number
}): MemoryAdapterPayload | undefined {
  if (message.type !== 'user' && message.type !== 'assistant') return undefined
  if (isSyntheticMessage(message as never)) return undefined

  if (message.type === 'user') {
    return userMessageToPayload({
      message,
      projectId,
      sessionId,
      cwd,
      permissionMode,
      maxTextChars,
    })
  }

  return assistantMessageToPayload({
    message,
    projectId,
    sessionId,
    cwd,
    permissionMode,
    maxTextChars,
  })
}

function userMessageToPayload({
  message,
  projectId,
  sessionId,
  cwd,
  permissionMode,
  maxTextChars,
}: {
  message: CapturableMessage
  projectId: string
  sessionId: string
  cwd: string
  permissionMode: string
  maxTextChars: number
}): MemoryAdapterPayload | undefined {
  if (
    message.isMeta ||
    message.isVirtual ||
    message.isVisibleInTranscriptOnly ||
    message.isCompactSummary ||
    message.toolUseResult !== undefined
  ) {
    return undefined
  }
  if (Array.isArray(message.message?.content)) {
    const hasToolResult = message.message.content.some(
      block => block.type === 'tool_result',
    )
    if (hasToolResult) return undefined
  }
  if (!message.uuid) return undefined
  const text = extractMessageText(message).slice(0, maxTextChars).trim()
  if (!text) return undefined

  // Skip control-plane messages that should not be long-term memory
  if (isControlPlaneMessage(text)) return undefined

  return {
    schemaVersion: 1,
    adapter: 'mossen-hook',
    sourceEventId: `mossen:${message.uuid}`,
    projectId,
    sessionId,
    // W431 anchor — Scope is hardcoded to 'project' here. Future escalation
    // (writing into 'user'/'workspace'/'team' scope based on captureFilters
    // policy) lands at THIS line. Toast pre-disclosure in W431 already
    // displays scope-aware labels, so once escalation lands the UX warning
    // ("user · across all projects (private)") fires automatically.
    scope: 'project',
    cwd,
    role: 'user',
    kind: 'message',
    channel: 'conversation',
    text,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
    createdAt: message.timestamp,
    permissionMode: message.permissionMode ?? permissionMode,
  }
}

function assistantMessageToPayload({
  message,
  projectId,
  sessionId,
  cwd,
  permissionMode,
  maxTextChars,
}: {
  message: CapturableMessage
  projectId: string
  sessionId: string
  cwd: string
  permissionMode: string
  maxTextChars: number
}): MemoryAdapterPayload | undefined {
  if (message.isVirtual || message.isApiErrorMessage) return undefined
  if (!message.uuid) return undefined
  const text = extractMessageText(message).slice(0, maxTextChars).trim()
  if (!text) return undefined

  // Skip assistant responses to control-plane instructions
  if (isAssistantControlOutput(text)) return undefined

  return {
    schemaVersion: 1,
    adapter: 'mossen-hook',
    sourceEventId: `mossen:${message.uuid}`,
    projectId,
    sessionId,
    // W431 anchor — assistant-side counterpart to the user-side hardcoded
    // scope. Same escalation hook point applies; toast already handles
    // scope-aware label rendering.
    scope: 'project',
    cwd,
    role: 'assistant',
    kind: 'message',
    channel: 'conversation',
    text,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
    createdAt: message.timestamp,
    model: message.message?.model,
    permissionMode,
  }
}

function extractMessageText(message: CapturableMessage): string {
  const content = message.message?.content
  if (typeof content === 'string') return stripInternalReasoning(content)
  if (!Array.isArray(content)) return ''
  return stripInternalReasoning(extractTextContent(content as never, '\n').trim())
}

async function maybeRunMemoryWorker({
  rootDir,
  projectId,
  llmProviderConfig,
  llmProviderConfigByJob,
  dirtyCountThreshold,
  maxDirtyAgeMsThreshold,
}: {
  rootDir: string
  projectId: string
  llmProviderConfig: Parameters<typeof runMemoryAgentOnce>[0]['llmProviderConfig']
  llmProviderConfigByJob: Parameters<typeof runMemoryAgentOnce>[0]['llmProviderConfigByJob']
  dirtyCountThreshold: number
  maxDirtyAgeMsThreshold: number
}): Promise<boolean> {
  if (workerRunInFlight) return false
  const dirtyMarkers = await listUnconsumedDirtyMarkers({ rootDir, projectId })
  const schedule = shouldScheduleMemoryAgent({
    dirtyMarkers,
    dirtyCountThreshold,
    maxDirtyAgeMsThreshold,
  })
  if (!schedule.shouldSchedule) return false

  workerRunInFlight = true
  try {
    await runMemoryAgentOnce({
      rootDir,
      projectId,
      llmProviderConfig,
      llmProviderConfigByJob,
    })
    return true
  } catch (error) {
    logForDebugging(
      `[memory-sidecar] worker run failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return false
  } finally {
    workerRunInFlight = false
  }
}
