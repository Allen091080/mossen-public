import type { Tools } from '../../Tool.js'
import { resolveAgentTools } from '../../tools/AgentTool/agentToolUtils.js'
import type {
  AgentDefinition,
  CustomAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { getAgentSourceDisplayName } from './utils.js'

export type AgentValidationResult = {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export function validateAgentType(agentType: string): string | null {
  if (!agentType) {
    return getLocalizedText({
      en: 'Agent type is required',
      zh: 'agent 类型不能为空',
    })
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(agentType)) {
    return getLocalizedText({
      en: 'Agent type must start and end with alphanumeric characters and contain only letters, numbers, and hyphens',
      zh: 'agent 类型必须以字母或数字开头和结尾，并且只能包含字母、数字和连字符',
    })
  }

  if (agentType.length < 3) {
    return getLocalizedText({
      en: 'Agent type must be at least 3 characters long',
      zh: 'agent 类型长度至少需要 3 个字符',
    })
  }

  if (agentType.length > 50) {
    return getLocalizedText({
      en: 'Agent type must be less than 50 characters',
      zh: 'agent 类型长度必须小于 50 个字符',
    })
  }

  return null
}

export function validateAgent(
  agent: Omit<CustomAgentDefinition, 'location'>,
  availableTools: Tools,
  existingAgents: AgentDefinition[],
): AgentValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate agent type
  if (!agent.agentType) {
    errors.push(
      getLocalizedText({
        en: 'Agent type is required',
        zh: 'agent 类型不能为空',
      }),
    )
  } else {
    const typeError = validateAgentType(agent.agentType)
    if (typeError) {
      errors.push(typeError)
    }

    // Check for duplicates (excluding self for editing)
    const duplicate = existingAgents.find(
      a => a.agentType === agent.agentType && a.source !== agent.source,
    )
    if (duplicate) {
      errors.push(
        getLocalizedText({
          en: `Agent type "${agent.agentType}" already exists in ${getAgentSourceDisplayName(duplicate.source)}`,
          zh: `agent 类型“${agent.agentType}”已存在于 ${getAgentSourceDisplayName(duplicate.source)}`,
        }),
      )
    }
  }

  // Validate description
  if (!agent.whenToUse) {
    errors.push(
      getLocalizedText({
        en: 'Description is required',
        zh: '描述不能为空',
      }),
    )
  } else if (agent.whenToUse.length < 10) {
    warnings.push(
      getLocalizedText({
        en: 'Description should be more descriptive (at least 10 characters)',
        zh: '描述建议写得更完整一些（至少 10 个字符）',
      }),
    )
  } else if (agent.whenToUse.length > 5000) {
    warnings.push(
      getLocalizedText({
        en: 'Description is very long (over 5000 characters)',
        zh: '描述过长（超过 5000 个字符）',
      }),
    )
  }

  // Validate tools
  if (agent.tools !== undefined && !Array.isArray(agent.tools)) {
    errors.push(
      getLocalizedText({
        en: 'Tools must be an array',
        zh: '工具列表必须是数组',
      }),
    )
  } else {
    if (agent.tools === undefined) {
      warnings.push(
        getLocalizedText({
          en: 'Agent has access to all tools',
          zh: '这个 agent 将访问所有工具',
        }),
      )
    } else if (agent.tools.length === 0) {
      warnings.push(
        getLocalizedText({
          en: 'No tools selected - agent will have very limited capabilities',
          zh: '未选择任何工具，这个 agent 的能力会非常有限',
        }),
      )
    }

    // Check for invalid tools
    const resolvedTools = resolveAgentTools(agent, availableTools, false)

    if (resolvedTools.invalidTools.length > 0) {
      errors.push(
        getLocalizedText({
          en: `Invalid tools: ${resolvedTools.invalidTools.join(', ')}`,
          zh: `无效工具：${resolvedTools.invalidTools.join(', ')}`,
        }),
      )
    }
  }

  // Validate system prompt
  const systemPrompt = agent.getSystemPrompt()
  if (!systemPrompt) {
    errors.push(
      getLocalizedText({
        en: 'System prompt is required',
        zh: '系统提示词不能为空',
      }),
    )
  } else if (systemPrompt.length < 20) {
    errors.push(
      getLocalizedText({
        en: 'System prompt is too short (minimum 20 characters)',
        zh: '系统提示词过短（至少需要 20 个字符）',
      }),
    )
  } else if (systemPrompt.length > 10000) {
    warnings.push(
      getLocalizedText({
        en: 'System prompt is very long (over 10,000 characters)',
        zh: '系统提示词过长（超过 10,000 个字符）',
      }),
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
