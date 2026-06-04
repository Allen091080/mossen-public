import { getSessionCreatedTeams } from '../bootstrap/state.js'
import { getAgentName, getTeamName, isTeammate } from '../utils/teammate.js'
import type { SwarmRuntimeSnapshot } from './runtimeTypes.js'

export function getSwarmRuntimeSnapshot(): SwarmRuntimeSnapshot {
  return {
    teammate: isTeammate(),
    teamName: getTeamName() ?? null,
    agentName: getAgentName() ?? null,
    sessionCreatedTeams: getSessionCreatedTeams().size,
  }
}
