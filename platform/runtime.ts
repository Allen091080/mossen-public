import { getSystemPrompt } from '../constants/prompts.js'
import { getCustomBackendModel } from '../utils/customBackend.js'
import { getDefaultSonnetModel } from '../utils/model/model.js'
import { buildEffectiveSystemPrompt } from '../utils/systemPrompt.js'
import { getAgentsRuntimeSnapshot } from './agentsRuntime.js'
import { getAssistantRuntimeSnapshot } from './assistantRuntime.js'
import { getChromeRuntimeSnapshot } from './chromeRuntime.js'
import { PLATFORM_CAPABILITY_MANIFEST } from './manifest.js'
import { getCompressionRuntimeSnapshot } from './compressionRuntime.js'
import { getDirectConnectRuntimeSnapshot } from './directConnectRuntime.js'
import { getFeatureGatesRuntimeSnapshot } from './featureGatesRuntime.js'
import { getLocalGitRuntimeSnapshot } from './localGitRuntime.js'
import { getMcpRuntimeSnapshot } from './mcpRuntime.js'
import { getMemoryRuntimeSnapshot } from './memoryRuntime.js'
import { getPluginsRuntimeSnapshot } from './pluginsRuntime.js'
import { getProviderRuntimeSnapshot } from './providerRuntime.js'
import { getRemoteRuntimeSnapshot } from './remoteRuntime.js'
import { getSecurityRuntimeSnapshot } from './securityRuntime.js'
import { getSessionsRuntimeSnapshot } from './sessionsRuntime.js'
import { getSkillsRuntimeSnapshot } from './skillsRuntime.js'
import { getSSHRuntimeSnapshot } from './sshRuntime.js'
import { getSwarmRuntimeSnapshot } from './swarmRuntime.js'
import { getSystemPromptRuntimeSnapshot } from './systemPromptRuntime.js'
import { getTeamMemoryRuntimeSnapshot } from './teamMemoryRuntime.js'
import type {
  PlatformCapabilityManifestEntry,
  PlatformRuntimeSnapshot,
} from './runtimeTypes.js'
import { getVoiceRuntimeSnapshot } from './voiceRuntime.js'

function buildEffectiveManifest(
  directConnect: ReturnType<typeof getDirectConnectRuntimeSnapshot>,
  sshRemote: ReturnType<typeof getSSHRuntimeSnapshot>,
  remote: Awaited<ReturnType<typeof getRemoteRuntimeSnapshot>>,
  assistant: Awaited<ReturnType<typeof getAssistantRuntimeSnapshot>>,
): PlatformCapabilityManifestEntry[] {
  return PLATFORM_CAPABILITY_MANIFEST.map(entry => {
    if (
      entry.id === 'direct-connect' &&
      !directConnect.recoverableFromLocalCache &&
      (!directConnect.serverRuntimeAvailable ||
        !directConnect.openRuntimeAvailable)
    ) {
      return { ...entry, status: 'snapshot-missing' }
    }
    if (
      entry.id === 'ssh-remote' &&
      !sshRemote.recoverableFromLocalCache &&
      (!sshRemote.localTestAvailable || !sshRemote.remoteSessionAvailable)
    ) {
      return { ...entry, status: 'snapshot-missing' }
    }
    if (entry.id === 'remote' && !remote.bridgeAvailable) {
      return { ...entry, status: 'disabled' }
    }
    if (entry.id === 'assistant' && !assistant.commandExposed) {
      return { ...entry, status: 'disabled' }
    }
    return entry
  })
}

export async function primePlatformRuntimeObservability(): Promise<void> {
  const model = getCustomBackendModel() ?? getDefaultSonnetModel()
  const defaultSystemPrompt = await getSystemPrompt([], model, [], [])

  // Prime the existing prompt assembly state so doctor/auth diagnostics can
  // report how the source runtime is currently composing the session prompt.
  buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: undefined,
    toolUseContext: { options: {} } as never,
    customSystemPrompt: undefined,
    defaultSystemPrompt,
    appendSystemPrompt: undefined,
  })

  await getMemoryRuntimeSnapshot()
  getSkillsRuntimeSnapshot()
}

export async function getPlatformRuntimeSnapshot(
  opts: { prime?: boolean } = {},
): Promise<PlatformRuntimeSnapshot> {
  if (opts.prime) {
    await primePlatformRuntimeObservability()
  }

  const [memory, plugins, remote, assistant, chrome, voice, agents, sessions, localGit] = await Promise.all([
    getMemoryRuntimeSnapshot(),
    getPluginsRuntimeSnapshot(),
    getRemoteRuntimeSnapshot(),
    getAssistantRuntimeSnapshot(),
    getChromeRuntimeSnapshot(),
    getVoiceRuntimeSnapshot(),
    getAgentsRuntimeSnapshot(),
    getSessionsRuntimeSnapshot(),
    getLocalGitRuntimeSnapshot(),
  ])
  const directConnect = getDirectConnectRuntimeSnapshot()
  const sshRemote = getSSHRuntimeSnapshot()
  const manifest = buildEffectiveManifest(directConnect, sshRemote, remote, assistant)

  return {
    provider: getProviderRuntimeSnapshot(),
    localGit,
    directConnect,
    sshRemote,
    systemPrompt: getSystemPromptRuntimeSnapshot(),
    memory,
    compression: getCompressionRuntimeSnapshot(),
    skills: getSkillsRuntimeSnapshot(),
    security: getSecurityRuntimeSnapshot(),
    plugins,
    mcp: getMcpRuntimeSnapshot(),
    remote,
    assistant,
    chrome,
    voice,
    teamMemory: getTeamMemoryRuntimeSnapshot(),
    agents,
    sessions,
    swarm: getSwarmRuntimeSnapshot(),
    featureGates: getFeatureGatesRuntimeSnapshot(),
    manifest,
  }
}
