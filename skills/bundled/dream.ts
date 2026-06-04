import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { recordConsolidation } from '../../services/autoDream/consolidationLock.js'
import { registerBundledSkill } from '../bundledSkills.js'

function getTranscriptDir(): string {
  return `${process.env.HOME ?? ''}/.mossen/session-transcripts`
}

export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Consolidate recent session learning into durable memory files and refresh the memory index.',
    whenToUse:
      'Use when the user wants to consolidate recent work into memory, refresh MEMORY.md, or run a reflective memory cleanup pass.',
    userInvocable: true,
    isEnabled: () => isAutoMemoryEnabled(),
    async getPromptForCommand(args) {
      await recordConsolidation()
      const prompt = buildConsolidationPrompt(
        getAutoMemPath(),
        getTranscriptDir(),
        args,
      )
      return [{ type: 'text', text: prompt }]
    },
  })
}
