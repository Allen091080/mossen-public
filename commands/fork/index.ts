import type { MossenContentBlockParam as ContentBlockParam } from 'src/services/api/mossenSdk.js'
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function normalizeForkPrompt(args: string): string {
  return args.trim()
}

const fork: Command = {
  type: 'prompt',
  name: 'fork',
  description: t('cmd.fork.description'),
  argumentHint: '<prompt>',
  progressMessage: 'running forked agent',
  contentLength: 0,
  context: 'fork',
  agent: 'general-purpose',
  source: 'builtin',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    const prompt = normalizeForkPrompt(args)
    if (!prompt) {
      throw new Error(
        getLocalizedText({
          en: 'Usage: /fork <prompt>',
          zh: '用法：/fork <提示>',
        }),
      )
    }
    return [{ type: 'text', text: prompt }]
  },
}

export default fork
