import { feature } from 'bun:bundle'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { getSdkBetas, getSessionId } from 'src/bootstrap/state.js'
import { DEFAULT_OUTPUT_STYLE_NAME } from 'src/constants/outputStyles.js'
import type {
  ApiKeySource,
  PermissionMode,
  SDKMessage,
} from 'src/entrypoints/agentSdkTypes.js'
import type { MemoryType } from 'src/utils/memory/types.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from 'src/tools/AgentTool/constants.js'
import type { AgentSkillPreloadEvidence } from 'src/tools/AgentTool/agentSkillPreload.js'
import { getMossenApiKeyWithSource } from '../auth.js'
import { getCwd } from '../cwd.js'
import { getFastModeState } from '../fastMode.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

// TODO(next-minor): remove this translation once SDK consumers have migrated
// to the 'Agent' tool name. The wire name was renamed Task → Agent in #19647,
// but emitting the new name in init/result events broke SDK consumers on a
// patch-level release. Keep emitting 'Task' until the next minor.
export function sdkCompatToolName(name: string): string {
  return name === AGENT_TOOL_NAME ? LEGACY_AGENT_TOOL_NAME : name
}

type CommandLike = {
  name: string
  userInvocable?: boolean
  // Optional discriminator fields so we can filter headless-incapable
  // commands out of `slash_commands` for SDK consumers. Missing → permissive.
  type?: 'prompt' | 'local' | 'local-jsx'
  supportsNonInteractive?: boolean
  disableNonInteractive?: boolean
}

// Mirror the headless command filter at main.tsx (the `commandsHeadless`
// expression that decides which commands `-p` mode can actually execute).
// If the SDK consumer renders /clear in its slash menu and the user clicks
// it, mossen responds "Unknown skill: clear" because the non-interactive
// path refuses to run it. Avoid that round-trip by hiding such commands.
//
// Skill plugins / MCP commands may arrive without `type` populated; treat
// missing fields as permissive (assume runnable) — we only filter commands
// we KNOW are non-interactive-blocked.
export function isCommandRunnableNonInteractive(c: CommandLike): boolean {
  if (c.type === 'prompt') return c.disableNonInteractive !== true
  if (c.type === 'local') return c.supportsNonInteractive === true
  if (c.type === 'local-jsx') return c.name === 'goal'
  return true
}

export type MemoryFileLoadInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string
}

export type MemoryFileAccessInfo = {
  accessCount: number
  lastAccessed: string
}

const memoryFileAccessStats = new Map<string, MemoryFileAccessInfo>()

function memoryAccessKey(file: Pick<MemoryFileLoadInfo, 'path' | 'type'>): string {
  return `${file.type}\0${file.path}`
}

export function recordMemoryFileAccesses(
  files: ReadonlyArray<MemoryFileLoadInfo>,
  now: Date = new Date(),
): Map<string, MemoryFileAccessInfo> {
  const timestamp = now.toISOString()
  const result = new Map<string, MemoryFileAccessInfo>()
  for (const file of files) {
    const key = memoryAccessKey(file)
    const previous = memoryFileAccessStats.get(key)
    const next = {
      accessCount: (previous?.accessCount ?? 0) + 1,
      lastAccessed: timestamp,
    }
    memoryFileAccessStats.set(key, next)
    result.set(key, next)
  }
  return result
}

export function getMemoryFileAccessInfo(
  file: Pick<MemoryFileLoadInfo, 'path' | 'type'>,
): MemoryFileAccessInfo | undefined {
  return memoryFileAccessStats.get(memoryAccessKey(file))
}

export function __resetMemoryFileAccessStatsForTests(): void {
  memoryFileAccessStats.clear()
}

// Replace the user's $HOME prefix with `~` so SDK consumers can render the
// memory source without exposing the absolute home path (which can leak the
// account / username if the transcript is shared). Best-effort: when
// homedir() returns an empty string (some sandboxes), pass the path through.
export function toDisplayablePath(path: string): string {
  const home = homedir()
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

export type SystemInitInputs = {
  tools: ReadonlyArray<{ name: string }>
  mcpClients: ReadonlyArray<{ name: string; type: string }>
  model: string
  permissionMode: PermissionMode
  commands: ReadonlyArray<CommandLike>
  agents: ReadonlyArray<{ agentType: string }>
  skills: ReadonlyArray<CommandLike>
  plugins: ReadonlyArray<{ name: string; path: string; source: string }>
  fastMode: boolean | undefined
  // Per-file attribution for MOSSEN.md / rules content that landed in the
  // system prompt this turn. Optional — older callers don't need to pass it
  // and the wire field is omitted when undefined / empty.
  memoryFiles?: ReadonlyArray<MemoryFileLoadInfo>
  /** Evidence for explicit main-thread AgentDefinition.skills preloading. */
  agentSkillPreload?: AgentSkillPreloadEvidence
}

/**
 * Build the `system/init` SDKMessage — the first message on the SDK stream
 * carrying session metadata (cwd, tools, model, commands, etc.) that remote
 * clients use to render pickers and gate UI.
 *
 * Called from two paths that must produce identical shapes:
 *   - QueryEngine (spawn-bridge / print-mode / SDK) — yielded as the first
 *     stream message per query turn
 *   - useReplBridge (REPL Remote Control) — sent via writeSdkMessages() on
 *     bridge connect, since REPL uses query() directly and never hits the
 *     QueryEngine SDKMessage layer
 */
export function buildSystemInitMessage(inputs: SystemInitInputs): SDKMessage {
  const settings = getSettings_DEPRECATED()
  const outputStyle = settings?.outputStyle ?? DEFAULT_OUTPUT_STYLE_NAME

  // Compute snapshot values once so snake_case and camelCase aliases stay
  // bit-for-bit identical (W442 dual-emit contract).
  const sessionId = getSessionId()
  const mossenVersion = MACRO.VERSION
  const toolsList = inputs.tools.map(tool => sdkCompatToolName(tool.name))
  const mcpServersList = inputs.mcpClients.map(client => ({
    name: client.name,
    status: client.type,
  }))
  const slashCommandsList = inputs.commands
    .filter(c => c.userInvocable !== false)
    .filter(isCommandRunnableNonInteractive)
    .map(c => c.name)

  const initMessage: SDKMessage = {
    type: 'system',
    subtype: 'init',
    cwd: getCwd(),
    // W442 dual-emit (camelCase = stable, snake_case = deprecated_since 1.0.0,
    // removed in 1.2.0 per Distribution Plan §6.2 deprecation policy).
    session_id: sessionId,
    sessionId,
    tools: toolsList,
    mcp_servers: mcpServersList,
    mcpServers: mcpServersList,
    model: inputs.model,
    permissionMode: inputs.permissionMode,
    slash_commands: slashCommandsList,
    slashCommands: slashCommandsList,
    apiKeySource: getMossenApiKeyWithSource().source as ApiKeySource,
    betas: getSdkBetas(),
    mossen_code_version: mossenVersion,
    mossenVersion,
    output_style: outputStyle,
    outputStyle,
    agents: inputs.agents.map(agent => agent.agentType),
    skills: inputs.skills
      .filter(s => s.userInvocable !== false)
      .map(skill => skill.name),
    plugins: inputs.plugins.map(plugin => ({
      name: plugin.name,
      path: plugin.path,
      source: plugin.source,
    })),
    agentSkillPreload: inputs.agentSkillPreload,
    uuid: randomUUID(),
  }
  // Emit memory_files only when there's actual content to attribute, so the
  // field stays absent for older builds and zero-memory invocations
  // (keeps the envelope quiet for clients that don't render attribution).
  if (inputs.memoryFiles && inputs.memoryFiles.length > 0) {
    const accessStats = recordMemoryFileAccesses(inputs.memoryFiles)
    const memoryFilesList = inputs.memoryFiles.map(file => {
      const access = accessStats.get(memoryAccessKey(file))
      return {
        path: toDisplayablePath(file.path),
        type: file.type,
        charLen: file.content.length,
        ...(access
          ? {
              accessCount: access.accessCount,
              lastAccessed: access.lastAccessed,
            }
          : {}),
        ...(file.parent ? { parent: toDisplayablePath(file.parent) } : {}),
      }
    })
    // W442 dual-emit
    ;(initMessage as Record<string, unknown>).memory_files = memoryFilesList
    ;(initMessage as Record<string, unknown>).memoryFiles = memoryFilesList
  }
  // Hidden from public SDK types — internal-only UDS messaging socket path
  if (feature('UDS_INBOX')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const sockPath = require('../udsMessaging.js').getUdsMessagingSocketPath()
    /* eslint-enable @typescript-eslint/no-require-imports */
    // W442 dual-emit
    ;(initMessage as Record<string, unknown>).messaging_socket_path = sockPath
    ;(initMessage as Record<string, unknown>).messagingSocketPath = sockPath
  }
  const fastState = getFastModeState(inputs.model, inputs.fastMode)
  initMessage.fast_mode_state = fastState
  // W442 dual-emit
  ;(initMessage as Record<string, unknown>).fastModeState = fastState
  return initMessage
}
