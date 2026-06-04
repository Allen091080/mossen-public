import { feature } from 'bun:bundle'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import type { ToolUseContext } from '../Tool.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { isBuiltInAgent } from '../tools/AgentTool/loadAgentsDir.js'
import { isEnvTruthy } from './envUtils.js'
import { isInternalOperatorMode } from './internalUserMode.js'
import { asSystemPrompt, type SystemPrompt } from './systemPromptType.js'
import { recordEffectiveSystemPromptAssembly } from '../platform/systemPromptRuntime.js'
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'
import { getActiveSessionGoalPromptSection } from './sessionGoalPrompt.js'

export { asSystemPrompt, type SystemPrompt } from './systemPromptType.js'

// Dead code elimination: conditional import for proactive mode.
// Same pattern as prompts.ts — lazy require to avoid pulling the module
// into non-proactive builds.
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../proactive/index.js') as typeof import('../proactive/index.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

function isProactiveActive_SAFE_TO_CALL_ANYWHERE(): boolean {
  return proactiveModule?.isProactiveActive() ?? false
}

function composePromptWithSessionGoal({
  base,
  appendSystemPrompt,
}: {
  base: string[]
  appendSystemPrompt: string | undefined
}): {
  prompt: string[]
  overlaySources: string[]
} {
  const sessionGoalPrompt = getActiveSessionGoalPromptSection()
  return {
    prompt: [
      ...base,
      ...(sessionGoalPrompt ? [sessionGoalPrompt] : []),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ],
    overlaySources: [
      ...(sessionGoalPrompt ? ['session-goal'] : []),
      ...(appendSystemPrompt ? ['append-system-prompt'] : []),
    ],
  }
}

/**
 * Builds the effective system prompt array based on priority:
 * 0. Override system prompt (if set, e.g., via loop mode - REPLACES all other prompts)
 * 1. Coordinator system prompt (if coordinator mode is active)
 * 2. Agent system prompt (if mainThreadAgentDefinition is set)
 *    - In proactive mode: agent prompt is APPENDED to default (agent adds domain
 *      instructions on top of the autonomous agent prompt, like teammates do)
 *    - Otherwise: agent prompt REPLACES default
 * 3. Custom system prompt (if specified via --system-prompt)
 * 4. Default system prompt (the standard Mossen prompt)
 *
 * Plus appendSystemPrompt is always added at the end if specified (except when override is set).
 */
export function buildEffectiveSystemPrompt({
  mainThreadAgentDefinition,
  toolUseContext,
  customSystemPrompt,
  defaultSystemPrompt,
  appendSystemPrompt,
  overrideSystemPrompt,
}: {
  mainThreadAgentDefinition: AgentDefinition | undefined
  toolUseContext: Pick<ToolUseContext, 'options'>
  customSystemPrompt: string | undefined
  defaultSystemPrompt: string[]
  appendSystemPrompt: string | undefined
  overrideSystemPrompt?: string | null
}): SystemPrompt {
  if (overrideSystemPrompt) {
    const result = asSystemPrompt([overrideSystemPrompt])
    recordEffectiveSystemPromptAssembly({
      baseSource: 'override',
      overlaySources: [],
      itemCount: result.length,
    })
    return result
  }
  // Coordinator mode: use coordinator prompt instead of default
  // Use inline env check instead of coordinatorModule to avoid circular
  // dependency issues during test module loading.
  if (
    feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.MOSSEN_CODE_COORDINATOR_MODE) &&
    !mainThreadAgentDefinition
  ) {
    // Lazy require to avoid circular dependency at module load time
    const { getCoordinatorSystemPrompt } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js')
    const composed = composePromptWithSessionGoal({
      base: [getCoordinatorSystemPrompt()],
      appendSystemPrompt,
    })
    const result = asSystemPrompt(composed.prompt)
    recordEffectiveSystemPromptAssembly({
      baseSource: 'coordinator',
      overlaySources: composed.overlaySources,
      itemCount: result.length,
    })
    return result
  }

  const agentSystemPrompt = mainThreadAgentDefinition
    ? isBuiltInAgent(mainThreadAgentDefinition)
      ? mainThreadAgentDefinition.getSystemPrompt({
          toolUseContext: { options: toolUseContext.options },
        })
      : mainThreadAgentDefinition.getSystemPrompt()
    : undefined

  // Log agent memory loaded event for main loop agents
  if (mainThreadAgentDefinition?.memory) {
    logMossenEvent('mossen.agent.memoryLoaded', {
      ...(isInternalOperatorMode() && {
        agent_type:
          mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      scope:
        mainThreadAgentDefinition.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source:
        'main-thread' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // In proactive mode, agent instructions are appended to the default prompt
  // rather than replacing it. The proactive default prompt is already lean
  // (autonomous agent identity + memory + env + proactive section), and agents
  // add domain-specific behavior on top — same pattern as teammates.
  if (
    agentSystemPrompt &&
    (feature('PROACTIVE') || feature('KAIROS')) &&
    isProactiveActive_SAFE_TO_CALL_ANYWHERE()
  ) {
    const composed = composePromptWithSessionGoal({
      base: [
        ...defaultSystemPrompt,
        `\n# Custom Agent Instructions\n${agentSystemPrompt}`,
      ],
      appendSystemPrompt,
    })
    const result = asSystemPrompt(composed.prompt)
    recordEffectiveSystemPromptAssembly({
      baseSource: 'default',
      overlaySources: [
        'agent-system-prompt',
        ...composed.overlaySources,
      ],
      itemCount: result.length,
    })
    return result
  }

  const baseSource = agentSystemPrompt
    ? 'agent'
    : customSystemPrompt
      ? 'custom'
      : 'default'
  const composed = composePromptWithSessionGoal({
    base: agentSystemPrompt
      ? [agentSystemPrompt]
      : customSystemPrompt
        ? [customSystemPrompt]
        : defaultSystemPrompt,
    appendSystemPrompt,
  })
  const result = asSystemPrompt(composed.prompt)
  recordEffectiveSystemPromptAssembly({
    baseSource,
    overlaySources: composed.overlaySources,
    itemCount: result.length,
  })
  return result
}
