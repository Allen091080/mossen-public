export type PlatformCapabilityStatus =
  | 'wired'
  | 'degraded'
  | 'disabled'
  | 'snapshot-missing'

export type PlatformCapabilityDomain =
  | 'provider'
  | 'local-git'
  | 'direct-connect'
  | 'ssh-remote'
  | 'system-prompt'
  | 'memory'
  | 'compression'
  | 'skills'
  | 'security'
  | 'plugins'
  | 'mcp'
  | 'remote'
  | 'assistant'
  | 'chrome'
  | 'voice'
  | 'team-memory'
  | 'agents'
  | 'sessions'
  | 'swarm'

export const MESSAGES_COMPATIBLE_PROTOCOL = 'messages-compatible' as const

export type ProviderProtocol =
  | 'mossen-compatible'
  | 'openai-compatible'
  | typeof MESSAGES_COMPATIBLE_PROTOCOL
  | 'private'

export type ModelTier = 'local' | 'cloud'

export type ProviderRuntimeSnapshot = {
  kind: 'custom-backend' | 'first-party' | 'bedrock' | 'vertex' | 'foundry'
  name: string
  tier: ModelTier
  protocol: ProviderProtocol | null
  baseUrl: string | null
  model: string | null
  capabilities: {
    streaming: boolean
    toolUse: boolean
    structuredOutput: boolean
    auth: boolean
  }
}

export type DirectConnectRuntimeSnapshot = {
  featureEnabled: boolean
  serverCommandExposed: boolean
  openCommandExposed: boolean
  serverRuntimeAvailable: boolean
  openRuntimeAvailable: boolean
  clientSessionCreateAvailable: boolean
  clientSessionManagerAvailable: boolean
  replHookAvailable: boolean
  missingServerModules: string[]
  missingOpenModules: string[]
  cachePathsChecked: string[]
  cachePathsPresent: string[]
  recoverableSourceHits: string[]
  recoverableFromLocalCache: boolean
  statusReason: string | null
}

export type LocalGitRuntimeSnapshot = {
  gitInstalled: boolean
  gitPath: string | null
  ghInstalled: boolean
  ghPath: string | null
  ghAuthenticated: boolean
  commitPushPrCommandExposed: boolean
  localGitReady: boolean
  localPrReady: boolean
  statusReason: string | null
}

export type SSHRuntimeSnapshot = {
  featureEnabled: boolean
  commandExposed: boolean
  localTestAvailable: boolean
  remoteSessionAvailable: boolean
  replHookAvailable: boolean
  sessionFactoryAvailable: boolean
  sessionManagerAvailable: boolean
  missingModules: string[]
  missingAdjacentModules: string[]
  cachePathsChecked: string[]
  cachePathsPresent: string[]
  recoverableSourceHits: string[]
  recoverableFromLocalCache: boolean
  statusReason: string | null
}

export type SystemPromptLayerSnapshot = {
  layer: string
  label: string
  sectionNames: string[]
  itemCount: number
}

export type SystemPromptRuntimeSnapshot = {
  defaultAssembly: SystemPromptLayerSnapshot[]
  effectiveAssembly: {
    baseSource:
      | 'default'
      | 'custom'
      | 'agent'
      | 'coordinator'
      | 'override'
      | 'unknown'
    overlaySources: string[]
    itemCount: number
  } | null
}

export type MemoryRuntimeSnapshot = {
  enabled: boolean
  autoMemoryPath: string | null
  promptLoaded: boolean
  entrypoint: string
  dailyLogMode: boolean
}

export type CompressionRuntimeSnapshot = {
  available: boolean
  postCompactTokenBudget: number
  postCompactMaxFilesToRestore: number
  postCompactMaxTokensPerFile: number
  invokedSkillCount: number
}

export type SkillsRuntimeSnapshot = {
  bundledRegistered: number
  dynamicDiscovered: number
  conditionalPending: number
}

export type SecurityRuntimeSnapshot = {
  defaultPermissionMode: string | null
  availablePermissionModes: string[]
  sessionTrustAccepted: boolean
  sandboxEnabled: boolean
  unsandboxedCommandsAllowed: boolean
  bypassPermissionsRequested: boolean
  hardDenyRuleCount: number
  hardDenySettingsMode: 'managed-only' | 'all-enabled'
}

export type PluginsRuntimeSnapshot = {
  enabled: number
  disabled: number
  errors: number
}

export type McpRuntimeSnapshot = {
  enterpriseServers: number
  userServers: number
  projectServers: number
  localServers: number
  totalErrors: number
  pluginOnly: boolean
  managedOnly: boolean
}

export type RemoteRuntimeSnapshot = {
  policyAllowed: boolean
  bridgeAvailable: boolean
  disabledReason: string | null
  runningInRemoteSession: boolean
  remoteEnvironmentType: string | null
  teleportedSession: boolean
  teleportedSessionId: string | null
  unixSocketAuthProxy: boolean
}

export type AssistantRuntimeSnapshot = {
  featureEnabled: boolean
  commandExposed: boolean
  discoveryAvailable: boolean
  discoveredSessions: number
  attachAvailable: boolean
  statusReason: string | null
}

export type ChromeRuntimeSnapshot = {
  cliOverride: boolean | null
  shouldEnable: boolean
  autoEnable: boolean
  extensionInstalled: boolean
  nativeHostInstalled: boolean
  nativeHostWrapperExists: boolean
  nativeHostManifestCount: number
  installUrl: string | null
  statusReason: string | null
}

export type VoiceRuntimeSnapshot = {
  visible: boolean
  rolloutEnabled: boolean
  authAvailable: boolean
  streamAvailable: boolean
  recordingAvailable: boolean
  recordingReason: string | null
  userEnabled: boolean
}

export type TeamMemoryRuntimeSnapshot = {
  buildEnabled: boolean
  enabled: boolean
  syncAvailable: boolean
  autoMemoryEnabled: boolean
  rolloutEnabled: boolean
  path: string | null
  entrypoint: string | null
  statusReason: string | null
}

export type AgentsRuntimeSnapshot = {
  entrypoint: string | null
  active: number
  total: number
  parseErrors: number
  includesCodeGuide: boolean
}

export type SessionsRuntimeSnapshot = {
  currentTranscriptPath: string
  projectSessions: number
  projectsDir: string
}

export type SwarmRuntimeSnapshot = {
  teammate: boolean
  teamName: string | null
  agentName: string | null
  sessionCreatedTeams: number
}

export type FeatureGatesRuntimeSnapshot = {
  directConnect: boolean
  sshRemote: boolean
  kairos: boolean
  kairosBrief: boolean
  transcriptClassifier: boolean
  chicagoMcp: boolean
  voiceMode: boolean
  daemon: boolean
}

export type PlatformCapabilityManifestEntry = {
  id: PlatformCapabilityDomain
  title: string
  status: PlatformCapabilityStatus
  modules: string[]
  validation: string[]
}

export type PlatformRuntimeSnapshot = {
  provider: ProviderRuntimeSnapshot
  localGit: LocalGitRuntimeSnapshot
  directConnect: DirectConnectRuntimeSnapshot
  sshRemote: SSHRuntimeSnapshot
  systemPrompt: SystemPromptRuntimeSnapshot
  memory: MemoryRuntimeSnapshot
  compression: CompressionRuntimeSnapshot
  skills: SkillsRuntimeSnapshot
  security: SecurityRuntimeSnapshot
  plugins: PluginsRuntimeSnapshot
  mcp: McpRuntimeSnapshot
  remote: RemoteRuntimeSnapshot
  assistant: AssistantRuntimeSnapshot
  chrome: ChromeRuntimeSnapshot
  voice: VoiceRuntimeSnapshot
  teamMemory: TeamMemoryRuntimeSnapshot
  agents: AgentsRuntimeSnapshot
  sessions: SessionsRuntimeSnapshot
  swarm: SwarmRuntimeSnapshot
  featureGates: FeatureGatesRuntimeSnapshot
  manifest: PlatformCapabilityManifestEntry[]
}
