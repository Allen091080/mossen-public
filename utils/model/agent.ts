import type { PermissionMode } from '../permissions/PermissionMode.js'
import {
  getCustomBackendModel,
  isCustomBackendEnabled,
} from '../customBackend.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES, type ModelAlias } from './aliases.js'
import { applyBedrockRegionPrefix, getBedrockRegionPrefix } from './bedrock.js'
import {
  getCanonicalName,
  getRuntimeMainLoopModel,
  parseUserSpecifiedModel,
} from './model.js'
import { getAPIProvider } from './providers.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * Get the effective model string for an agent.
 *
 * For Bedrock, if the parent model uses a cross-region inference prefix (e.g., "eu.", "us."),
 * that prefix is inherited by subagents using alias models (e.g., "sonnet", "haiku", "opus").
 * This ensures subagents use the same region as the parent, which is necessary when
 * IAM permissions are scoped to specific cross-region inference profiles.
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: ModelAlias,
  permissionMode?: PermissionMode,
): string {
  if (process.env.MOSSEN_CODE_SUBAGENT_MODEL) {
    return parseUserSpecifiedModel(process.env.MOSSEN_CODE_SUBAGENT_MODEL)
  }

  // Custom backend mode exposes a single configured model contract to the UI.
  // Built-in agents still describe themselves with Mossen family aliases
  // like "sonnet" and "haiku"; resolving those literally would switch a
  // DashScope/OpenAI-compatible session back to a first-party Mossen model ID
  // that the backend does not support. Keep subagents on the active custom
  // backend model unless the user explicitly overrides via
  // MOSSEN_CODE_SUBAGENT_MODEL above.
  if (isCustomBackendEnabled()) {
    return getCustomBackendModel() ?? parentModel
  }

  // Extract Bedrock region prefix from parent model to inherit for subagents.
  // This ensures subagents use the same cross-region inference profile (e.g., "eu.", "us.")
  // as the parent, which is required when IAM permissions only allow specific regions.
  const parentRegionPrefix = getBedrockRegionPrefix(parentModel)

  // Helper to apply parent region prefix for Bedrock models.
  // `originalSpec` is the raw model string before resolution (alias or full ID).
  // If the user explicitly specified a full model ID that already carries its own
  // region prefix, we preserve it instead of overwriting
  // with the parent's prefix. This prevents silent data-residency violations when
  // an agent config intentionally pins to a different region than the parent.
  const applyParentRegionPrefix = (
    resolvedModel: string,
    originalSpec: string,
  ): string => {
    if (parentRegionPrefix && getAPIProvider() === 'bedrock') {
      if (getBedrockRegionPrefix(originalSpec)) return resolvedModel
      return applyBedrockRegionPrefix(resolvedModel, parentRegionPrefix)
    }
    return resolvedModel
  }

  // Prioritize tool-specified model if provided
  if (toolSpecifiedModel) {
    if (aliasMatchesParentTier(toolSpecifiedModel, parentModel)) {
      return parentModel
    }
    const model = parseUserSpecifiedModel(toolSpecifiedModel)
    return applyParentRegionPrefix(model, toolSpecifiedModel)
  }

  const agentModelWithExp = agentModel ?? getDefaultSubagentModel()

  if (agentModelWithExp === 'inherit') {
    // Apply runtime model resolution for inherit to get the effective model
    // This ensures agents using 'inherit' get plan-mode Frontier resolution in plan mode.
    return getRuntimeMainLoopModel({
      permissionMode: permissionMode ?? 'default',
      mainLoopModel: parentModel,
      exceeds200kTokens: false,
    })
  }

  if (aliasMatchesParentTier(agentModelWithExp, parentModel)) {
    return parentModel
  }
  const model = parseUserSpecifiedModel(agentModelWithExp)
  return applyParentRegionPrefix(model, agentModelWithExp)
}

/**
 * Check if a bare tier alias (frontier/balanced/fast) matches the parent model's
 * tier. When it does, the subagent inherits the parent's exact model string
 * instead of resolving the alias to a provider default.
 *
 * Prevents surprising downgrades: a Vertex user on Mossen Frontier 4.6 (via /model) who
 * spawns a subagent with `model: opus` should get Frontier 4.6, not whatever
 * getDefaultOpusModel() returns for 3P.
 * See mossen/mossen-code#30815.
 *
 * Only bare tier aliases match. `opus[1m]`, `best`, `opusplan` fall through
 * since they carry semantics beyond "same tier as parent".
 */
function aliasMatchesParentTier(alias: string, parentModel: string): boolean {
  const canonical = getCanonicalName(parentModel)
  switch (alias.toLowerCase()) {
    case 'opus':
      return canonical.includes('opus')
    case 'sonnet':
      return canonical.includes('sonnet')
    case 'haiku':
      return canonical.includes('haiku')
    default:
      return false
  }
}

export function getAgentModelDisplay(model: string | undefined): string {
  // When model is omitted, getDefaultSubagentModel() returns 'inherit' at runtime
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  if (model === 'sonnet') return 'Mossen Balanced'
  if (model === 'opus') return 'Mossen Frontier'
  if (model === 'haiku') return 'Mossen Fast'
  return capitalize(model)
}

/**
 * Get available model options for agents
 */
export function getAgentModelOptions(): AgentModelOption[] {
  return [
    {
      value: 'sonnet',
      label: 'Mossen Balanced',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'opus',
      label: 'Mossen Frontier',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'haiku',
      label: 'Mossen Fast',
      description: 'Fast and efficient for simple tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
}
