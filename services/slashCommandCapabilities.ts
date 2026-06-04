export type StreamJsonSlashCommandArgsMode =
  | 'none'
  | 'confirm_only'
  | 'read_only_no_args'
  | 'profile_name'

export type StreamJsonSlashCommandSideEffect =
  | 'none'
  | 'clears_conversation'
  | 'switches_session_model'
  | 'read_only'
  | 'writes_config'
  | 'writes_files'
  | 'installs_package'
  | 'starts_process'
  | 'network'
  | 'auth_state'
  | 'unknown'

export type StreamJsonSlashCommandResultKind =
  | 'help'
  | 'capabilities'
  | 'status'
  | 'model'
  | 'clear'
  | 'cost'
  | 'skills'
  | 'mcp'
  | 'plugin'
  | 'agents'
  | 'permissions'
  | 'hooks'
  | 'memory'
  | 'error'

export type StreamJsonSlashCommandStatus =
  | 'available'
  | 'blocked'
  | 'unavailable'
  | 'preview'

export const STREAM_JSON_SLASH_CAPABILITY_MANIFEST_VERSION = 2

export type StreamJsonSlashCommandCapability = {
  id: string
  command: string
  title: string
  kind: 'slash_command'
  protocol: 'stream_json'
  aliases?: readonly string[]
  status: StreamJsonSlashCommandStatus
  readOnly: boolean
  requiresConfirmation: boolean
  argsMode: StreamJsonSlashCommandArgsMode
  acceptedArgs: readonly string[]
  sideEffect: StreamJsonSlashCommandSideEffect
  resultKind: StreamJsonSlashCommandResultKind
  payloadKeys: readonly string[]
  errorTags: readonly string[]
  source: string
  lastVerifiedBySmoke: string
  summary: string
  reason?: string
}

export type StreamJsonSlashCommandCapabilityPayload = {
  id: string
  command: string
  title: string
  kind: 'slash_command'
  protocol: 'stream_json'
  aliases: readonly string[]
  status: StreamJsonSlashCommandStatus
  readOnly: boolean
  requiresConfirmation: boolean
  argsMode: StreamJsonSlashCommandArgsMode
  acceptedArgs: readonly string[]
  sideEffect: StreamJsonSlashCommandSideEffect
  resultKind: StreamJsonSlashCommandResultKind
  payloadKeys: readonly string[]
  errorTags: readonly string[]
  source: string
  lastVerifiedBySmoke: string
  summary: string
  reason?: string
}

const W29B = 'wave_w29b_slash_command_smoke'
const W40 = 'wave_w40_slash_bridge_batch_smoke'
const W42 = 'wave_w42_capability_slash_wrappers_smoke'
const W43 = 'wave_w43_slash_capability_manifest_smoke'
const W44 = 'wave_w44_cost_slash_smoke'
const W45 = 'wave_w45_capability_protocol_matrix_smoke'

export const STREAM_JSON_SLASH_COMMAND_CAPABILITIES = [
  {
    id: 'slash.help',
    command: 'help',
    title: 'List slash commands',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'help',
    payloadKeys: ['commands', 'streamJsonCapabilities'],
    errorTags: [],
    source: 'cli/print.ts:slash_command/help',
    lastVerifiedBySmoke: W29B,
    summary: 'List stream-json slash command capabilities.',
  },
  {
    id: 'slash.capabilities',
    command: 'capabilities',
    title: 'Capability manifest',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: ['capability'],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'capabilities',
    payloadKeys: ['capabilities'],
    errorTags: [],
    source: 'cli/print.ts:slash_command/capabilities',
    lastVerifiedBySmoke: W43,
    summary: 'Return the machine-readable stream-json slash capability manifest.',
  },
  {
    id: 'slash.status',
    command: 'status',
    title: 'Runtime status',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'status',
    payloadKeys: ['runtime'],
    errorTags: [],
    source: 'cli/print.ts:slash_command/status',
    lastVerifiedBySmoke: W29B,
    summary: 'Return runtime status for the current stream-json session.',
  },
  {
    id: 'slash.model',
    command: 'model',
    title: 'Model / profile',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'profile_name',
    acceptedArgs: [],
    sideEffect: 'switches_session_model',
    resultKind: 'model',
    payloadKeys: ['model'],
    errorTags: [
      'unsupported_slash_command_args: model',
      'model_profile_not_found',
    ],
    source: 'cli/print.ts:slash_command/model',
    lastVerifiedBySmoke: W29B,
    summary: 'Return current model/profile state or switch to a named session profile.',
  },
  {
    id: 'slash.clear',
    command: 'clear',
    title: 'Clear conversation',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: false,
    requiresConfirmation: true,
    argsMode: 'confirm_only',
    acceptedArgs: ['--confirm'],
    sideEffect: 'clears_conversation',
    resultKind: 'clear',
    payloadKeys: ['clear'],
    errorTags: [
      'confirmation_required: clear',
      'session_not_idle: clear',
    ],
    source: 'cli/print.ts:slash_command/clear',
    lastVerifiedBySmoke: W40,
    summary: 'Clear the current conversation when --confirm is provided.',
  },
  {
    id: 'slash.cost',
    command: 'cost',
    title: 'Session cost / usage',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'cost',
    payloadKeys: ['cost'],
    errorTags: ['unsupported_slash_command_args: cost'],
    source: 'cli/print.ts:slash_command/cost',
    lastVerifiedBySmoke: W44,
    summary: 'Return current session cost and usage totals.',
  },
  {
    id: 'slash.skills',
    command: 'skills',
    title: 'Skills inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'skills',
    payloadKeys: ['skills'],
    errorTags: ['unsupported_slash_command_args: skills'],
    source: 'cli/print.ts:slash_command/skills',
    lastVerifiedBySmoke: W42,
    summary: 'Return available model-facing skills without skill content.',
  },
  {
    id: 'slash.mcp',
    command: 'mcp',
    title: 'MCP server inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'mcp',
    payloadKeys: ['mcp'],
    errorTags: ['unsupported_slash_command_args: mcp'],
    source: 'cli/print.ts:slash_command/mcp',
    lastVerifiedBySmoke: W42,
    summary: 'Return MCP server and tool status without raw server config.',
  },
  {
    id: 'slash.plugin',
    command: 'plugin',
    title: 'Plugin inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: ['plugins'],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'plugin',
    payloadKeys: ['plugins'],
    errorTags: ['unsupported_slash_command_args: plugin'],
    source: 'cli/print.ts:slash_command/plugin',
    lastVerifiedBySmoke: W42,
    summary: 'Return plugin inventory without installing or changing config.',
  },
  {
    id: 'slash.agents',
    command: 'agents',
    title: 'Agent inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'agents',
    payloadKeys: ['agents'],
    errorTags: ['unsupported_slash_command_args: agents'],
    source: 'cli/print.ts:slash_command/agents',
    lastVerifiedBySmoke: W42,
    summary: 'Return active agent definitions without prompts or local paths.',
  },
  {
    id: 'slash.permissions',
    command: 'permissions',
    title: 'Permission rules summary',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: ['allowed-tools'],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'permissions',
    payloadKeys: ['permissions'],
    errorTags: ['unsupported_slash_command_args: permissions'],
    source: 'cli/print.ts:slash_command/permissions',
    lastVerifiedBySmoke: W45,
    summary: 'Return current permission mode and per-source rule counts (no rule patterns).',
  },
  {
    id: 'slash.hooks',
    command: 'hooks',
    title: 'Hooks inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'hooks',
    payloadKeys: ['hooks'],
    errorTags: ['unsupported_slash_command_args: hooks'],
    source: 'cli/print.ts:slash_command/hooks',
    lastVerifiedBySmoke: W45,
    summary: 'Return hook event/source/type counts without command/url/prompt bodies.',
  },
  {
    id: 'slash.memory',
    command: 'memory',
    title: 'Memory file inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'available',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'read_only_no_args',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'memory',
    payloadKeys: ['memory'],
    errorTags: ['unsupported_slash_command_args: memory'],
    source: 'cli/print.ts:slash_command/memory',
    lastVerifiedBySmoke: W45,
    summary: 'Return memory file paths, types, and sizes without file content.',
  },
  {
    id: 'slash.compact',
    command: 'compact',
    title: 'Compact conversation',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['unsupported_slash_command: compact'],
    source: 'cli/print.ts:slash_command/compact',
    lastVerifiedBySmoke: W29B,
    summary: 'Context compaction is not exposed through stream-json slash_command.',
    reason: 'use control_request subtype "compact_conversation" — currently returns blocked_control_request; real compaction requires idle ToolUseContext with LLM/hook orchestration deferred to a follow-up wave',
  },
  {
    id: 'slash.context',
    command: 'context',
    title: 'Context usage breakdown',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: context'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Context usage is exposed through the dedicated control_request subtype.',
    reason: 'use control_request subtype "get_context_usage" — slash wrapper would duplicate the dedicated builder',
  },
  {
    id: 'slash.config',
    command: 'config',
    title: 'Settings inspector',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: ['settings'],
    status: 'blocked',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: config'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Settings inspection is exposed through dedicated control_request subtypes.',
    reason: 'use control_request subtype "get_config_summary" for redacted summary or "get_settings" for full effective+sources view (clients must redact secrets themselves)',
  },
  {
    id: 'slash.profile',
    command: 'profile',
    title: 'Profile inventory',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: true,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'none',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: profile'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Profile state is already covered by /model.',
    reason: 'duplicate of /model (returns profiles[] and current/default markers)',
  },
  {
    id: 'slash.doctor',
    command: 'doctor',
    title: 'Installation diagnostics',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'network',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: doctor'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Doctor diagnostics are exposed through the dedicated control_request subtype.',
    reason: 'use control_request subtype "runtime_doctor_summary" — returns structured checks (cwd/session/model/permission_mode/mcp/memory/hooks); includeNetworkProbes=true adds opt-in timeout-bounded reachability probes without auth headers',
  },
  {
    id: 'slash.diff',
    command: 'diff',
    title: 'Uncommitted diff viewer',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'starts_process',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: diff'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Git diff summary is exposed through the dedicated control_request subtype.',
    reason: 'use control_request subtype "git_diff_summary" — bounded git status/shortstat (5s timeout, 200-file cap); patch contents are never echoed, clients run their own git diff for patch text',
  },
  {
    id: 'slash.ide',
    command: 'ide',
    title: 'IDE integration status',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'starts_process',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: ide'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'IDE state depends on async MCP IDE handshake and is not surfaced as a slash result.',
    reason: 'use mcp_status control_request — IDE is exposed there as an MCP server',
  },
  {
    id: 'slash.init',
    command: 'init',
    title: 'Project memory initializer',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'writes_files',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: init'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Init would write project memory files; no safe stream-json gate exists.',
    reason: 'init writes project memory and metadata — needs a dedicated mutation protocol with confirmation',
  },
  {
    id: 'slash.login',
    command: 'login',
    title: 'Backend login',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'auth_state',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: login'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Login mutates auth state and runs an interactive flow; not exposed through stream-json.',
    reason: 'auth flow requires interactive UI and credential write; use existing CLI guidance',
  },
  {
    id: 'slash.logout',
    command: 'logout',
    title: 'Backend logout',
    kind: 'slash_command',
    protocol: 'stream_json',
    aliases: [],
    status: 'blocked',
    readOnly: false,
    requiresConfirmation: false,
    argsMode: 'none',
    acceptedArgs: [],
    sideEffect: 'auth_state',
    resultKind: 'error',
    payloadKeys: [],
    errorTags: ['blocked_slash_command: logout'],
    source: 'cli/print.ts:slash_command/blocked',
    lastVerifiedBySmoke: W45,
    summary: 'Logout mutates locally cached auth state; not exposed through stream-json.',
    reason: 'auth state mutation; needs a dedicated confirmation protocol before exposing',
  },
] as const satisfies readonly StreamJsonSlashCommandCapability[]

export function getStreamJsonSlashCommandCapabilities(): readonly StreamJsonSlashCommandCapability[] {
  return STREAM_JSON_SLASH_COMMAND_CAPABILITIES
}

export function serializeStreamJsonSlashCommandCapability(
  capability: StreamJsonSlashCommandCapability,
): StreamJsonSlashCommandCapabilityPayload {
  return {
    id: capability.id,
    command: capability.command,
    title: capability.title,
    kind: capability.kind,
    protocol: capability.protocol,
    aliases: capability.aliases ?? [],
    status: capability.status,
    readOnly: capability.readOnly,
    requiresConfirmation: capability.requiresConfirmation,
    argsMode: capability.argsMode,
    acceptedArgs: capability.acceptedArgs,
    sideEffect: capability.sideEffect,
    resultKind: capability.resultKind,
    payloadKeys: capability.payloadKeys,
    errorTags: capability.errorTags,
    source: capability.source,
    lastVerifiedBySmoke: capability.lastVerifiedBySmoke,
    summary: capability.summary,
    ...(capability.reason ? { reason: capability.reason } : {}),
  }
}

export function getStreamJsonSlashCommandCapabilityManifest(): readonly StreamJsonSlashCommandCapabilityPayload[] {
  return STREAM_JSON_SLASH_COMMAND_CAPABILITIES.map(
    serializeStreamJsonSlashCommandCapability,
  )
}

export function normalizeStreamJsonSlashCommand(command: string): string {
  const normalized = command.trim().replace(/^\/+/, '').toLowerCase()
  const match = STREAM_JSON_SLASH_COMMAND_CAPABILITIES.find(
    capability =>
      capability.command === normalized ||
      (capability.aliases as readonly string[]).includes(normalized),
  )
  return match?.command ?? normalized
}

export function getStreamJsonSlashCommandCapability(
  command: string,
): StreamJsonSlashCommandCapability | undefined {
  const normalized = normalizeStreamJsonSlashCommand(command)
  return STREAM_JSON_SLASH_COMMAND_CAPABILITIES.find(
    capability => capability.command === normalized,
  )
}

export function isStreamJsonSlashCommandAvailable(command: string): boolean {
  return getStreamJsonSlashCommandCapability(command)?.status === 'available'
}

export function isStreamJsonSlashCommandBlocked(command: string): boolean {
  return getStreamJsonSlashCommandCapability(command)?.status === 'blocked'
}

export function formatAvailableStreamJsonSlashCommands(): string {
  return STREAM_JSON_SLASH_COMMAND_CAPABILITIES.filter(
    capability => capability.status === 'available',
  )
    .map(capability => capability.command)
    .join(', ')
}
