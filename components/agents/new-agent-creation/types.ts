/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'
import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'

export type AgentWizardData = {
  location?: any
  method?: 'generate' | 'manual'
  wasGenerated?: boolean
  generationPrompt?: string
  generatedAgent?: any
  isGenerating?: boolean
  agentType?: string
  whenToUse?: string
  systemPrompt?: string
  selectedTools?: string[]
  selectedModel?: string
  selectedColor?: AgentColorName
  selectedMemory?: AgentMemoryScope
  finalAgent?: any
}
