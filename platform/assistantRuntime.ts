import { feature } from 'bun:bundle'
import { discoverAssistantSessions } from '../assistant/sessionDiscovery.js'
import { isCustomBackendEnabled } from '../utils/customBackend.js'
import type { AssistantRuntimeSnapshot } from './runtimeTypes.js'
import { getRemoteRuntimeSnapshot } from './remoteRuntime.js'

export async function getAssistantRuntimeSnapshot(): Promise<AssistantRuntimeSnapshot> {
  if (feature('KAIROS')) {
    const customBackend = isCustomBackendEnabled()
    if (customBackend) {
      return {
        featureEnabled: true,
        commandExposed: false,
        discoveryAvailable: false,
        discoveredSessions: 0,
        attachAvailable: false,
        statusReason:
          'Assistant attach requires hosted bridge sessions and is unavailable on the current custom backend.',
      }
    }

    let discoveryAvailable = false
    let discoveredSessions = 0
    let discoveryError: string | null = null

    try {
      const sessions = await discoverAssistantSessions()
      discoveryAvailable = true
      discoveredSessions = sessions.length
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : String(error)
    }

    const remote = await getRemoteRuntimeSnapshot()
    const commandExposed = true
    const attachAvailable = commandExposed && remote.bridgeAvailable

    let statusReason: string | null = null
    if (!remote.bridgeAvailable) {
      statusReason =
        remote.disabledReason ??
        'Assistant attach requires a running bridge session.'
    } else if (!discoveryAvailable && discoveryError) {
      statusReason = `Assistant session discovery failed: ${discoveryError}`
    }

    return {
      featureEnabled: true,
      commandExposed,
      discoveryAvailable,
      discoveredSessions,
      attachAvailable,
      statusReason,
    }
  }

  return {
    featureEnabled: false,
    commandExposed: false,
    discoveryAvailable: false,
    discoveredSessions: 0,
    attachAvailable: false,
    statusReason: 'Assistant mode is not available in this build.',
  }
}
