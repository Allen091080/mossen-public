import {
  getMossenChromeMcpAllowedToolNames,
} from '../../utils/mossenInChrome/chromeMcpAdapter.js'
import { MOSSEN_IN_CHROME_MCP_SERVER_NAME } from '../../utils/mossenInChrome/common.js'
import { BASE_CHROME_PROMPT } from '../../utils/mossenInChrome/prompt.js'
import { shouldAutoEnableMossenInChrome } from '../../utils/mossenInChrome/setup.js'
import { registerBundledSkill } from '../bundledSkills.js'

const MOSSEN_IN_CHROME_MCP_TOOLS = getMossenChromeMcpAllowedToolNames(
  MOSSEN_IN_CHROME_MCP_SERVER_NAME,
)

const SKILL_ACTIVATION_MESSAGE = `
Now that this skill is invoked, you have access to Chrome browser automation tools. You can now use the mcp__mossen-in-chrome__* tools to interact with web pages.

IMPORTANT: Start by calling mcp__mossen-in-chrome__tabs_context_mcp to get information about the user's current browser tabs.
`

export function registerMossenInChromeSkill(): void {
  registerBundledSkill({
    name: 'mossen-in-chrome',
    description:
      'Automates your Chrome browser to interact with web pages - clicking elements, filling forms, capturing screenshots, reading console logs, and navigating sites. Opens pages in new tabs within your existing Chrome session. Requires site-level permissions before executing (configured in the extension).',
    whenToUse:
      'When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions. Always invoke BEFORE attempting to use any mcp__mossen-in-chrome__* tools.',
    allowedTools: MOSSEN_IN_CHROME_MCP_TOOLS,
    userInvocable: true,
    isEnabled: () => shouldAutoEnableMossenInChrome(),
    async getPromptForCommand(args) {
      let prompt = `${BASE_CHROME_PROMPT}\n${SKILL_ACTIVATION_MESSAGE}`
      if (args) {
        prompt += `\n## Task\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
