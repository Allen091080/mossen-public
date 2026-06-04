import { getOriginalCwd } from '../bootstrap/state.js'
import { getAgentDefinitionsWithOverrides } from '../tools/AgentTool/loadAgentsDir.js'
import type { AgentsRuntimeSnapshot } from './runtimeTypes.js'

export async function getAgentsRuntimeSnapshot(): Promise<AgentsRuntimeSnapshot> {
  const result = await getAgentDefinitionsWithOverrides(getOriginalCwd())
  const activeAgents = result.activeAgents

  return {
    entrypoint: process.env.MOSSEN_CODE_ENTRYPOINT ?? null,
    active: activeAgents.length,
    total: result.allAgents.length,
    parseErrors: result.failedFiles?.length ?? 0,
    includesCodeGuide: activeAgents.some(
      agent => agent.agentType === 'mossen-code-guide',
    ),
  }
}
