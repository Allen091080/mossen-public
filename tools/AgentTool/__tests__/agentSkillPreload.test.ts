import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import type { Command } from '../../../types/command.js'
import type { AgentDefinition } from '../loadAgentsDir.js'
import {
  AgentSkillPreloadError,
  preloadAgentSkillsFromCommands,
  resolveAgentSkillName,
} from '../agentSkillPreload.js'

function agent(
  skills: string[],
  agentType = 'proof-plugin:proof-agent',
): AgentDefinition {
  return {
    agentType,
    whenToUse: 'test',
    source: 'flagSettings',
    skills,
    getSystemPrompt: () => 'test agent',
  }
}

function promptSkill(
  name: string,
  marker = `MARKER:${name}`,
  overrides: Partial<Command> = {},
): Command {
  return {
    type: 'prompt',
    name,
    description: 'test skill',
    progressMessage: 'loading',
    contentLength: marker.length,
    source: 'bundled',
    loadedFrom: 'skills',
    getPromptForCommand: async () => [{ type: 'text', text: marker }],
    ...overrides,
  } as Command
}

function localCommand(name: string): Command {
  return {
    type: 'local',
    name,
    description: 'not a prompt skill',
    supportsNonInteractive: true,
    load: async () => ({
      call: async () => ({ type: 'skip' as const }),
    }),
  }
}

function contextWithTools(toolNames: string[]): ToolUseContext {
  return {
    options: {
      tools: toolNames.map(name => ({ name })),
    },
  } as unknown as ToolUseContext
}

describe('main-thread Agent skill preload', () => {
  test('resolves exact aliases, Agent plugin prefixes, and namespaced suffixes', () => {
    const commands = [
      promptSkill('canonical', 'exact', { aliases: ['alias'] }),
      promptSkill('proof-plugin:prefixed'),
      promptSkill('other:suffix'),
    ]

    expect(resolveAgentSkillName('alias', commands, agent([]))).toBe('canonical')
    expect(resolveAgentSkillName('prefixed', commands, agent([]))).toBe(
      'proof-plugin:prefixed',
    )
    expect(resolveAgentSkillName('suffix', commands, agent([]))).toBe(
      'other:suffix',
    )
  })

  test('injects metadata and skill content while leaving tool inventory unchanged', async () => {
    const toolUseContext = contextWithTools(['Read'])
    const beforeTools = toolUseContext.options.tools

    const result = await preloadAgentSkillsFromCommands({
      agentDefinition: agent(['role-runtime-proof']),
      allSkills: [
        promptSkill(
          'role-runtime-proof',
          'ROLE_SKILL_PRELOAD_MARKER_7C4F',
        ),
      ],
      toolUseContext,
      strict: true,
    })

    expect(result.evidence).toEqual({
      agentType: 'proof-plugin:proof-agent',
      requestedSkillIds: ['role-runtime-proof'],
      resolvedSkillIds: ['role-runtime-proof'],
      preloadedSkillIds: ['role-runtime-proof'],
    })
    expect(JSON.stringify(result.messages)).toContain(
      'ROLE_SKILL_PRELOAD_MARKER_7C4F',
    )
    expect(JSON.stringify(result.messages)).toContain(
      '<command-name>role-runtime-proof</command-name>',
    )
    expect(toolUseContext.options.tools).toBe(beforeTools)
    expect(toolUseContext.options.tools.map(tool => tool.name)).toEqual(['Read'])
  })

  test('fails closed before loading any skill when one requested ID is missing', async () => {
    let loadCount = 0
    const valid = promptSkill('valid', 'VALID', {
      getPromptForCommand: async () => {
        loadCount += 1
        return [{ type: 'text', text: 'VALID' }]
      },
    })

    try {
      await preloadAgentSkillsFromCommands({
        agentDefinition: agent(['valid', 'missing']),
        allSkills: [valid],
        toolUseContext: contextWithTools([]),
        strict: true,
      })
      throw new Error('expected strict preload failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentSkillPreloadError)
      const preloadError = error as AgentSkillPreloadError
      expect(preloadError.code).toBe('agent_skill_preload_failed')
      expect(preloadError.evidence).toEqual({
        agentType: 'proof-plugin:proof-agent',
        requestedSkillIds: ['valid', 'missing'],
        resolvedSkillIds: ['valid'],
        preloadedSkillIds: [],
        failedSkillIds: ['missing'],
        failures: [{ skillId: 'missing', reason: 'not_found' }],
      })
      expect(loadCount).toBe(0)
    }
  })

  test('retains delegated warning-and-skip resolution behavior', async () => {
    const result = await preloadAgentSkillsFromCommands({
      agentDefinition: agent(['valid', 'missing']),
      allSkills: [promptSkill('valid')],
      toolUseContext: contextWithTools([]),
      strict: false,
    })

    expect(result.evidence.requestedSkillIds).toEqual(['valid', 'missing'])
    expect(result.evidence.preloadedSkillIds).toEqual(['valid'])
    expect(result.messages).toHaveLength(1)
  })

  test('reports non-prompt and prompt-load failures as typed errors', async () => {
    await expect(
      preloadAgentSkillsFromCommands({
        agentDefinition: agent(['local-only']),
        allSkills: [localCommand('local-only')],
        toolUseContext: contextWithTools([]),
        strict: true,
      }),
    ).rejects.toMatchObject({
      code: 'agent_skill_preload_failed',
      evidence: {
        failedSkillIds: ['local-only'],
        failures: [{ skillId: 'local-only', reason: 'not_prompt' }],
      },
    })

    await expect(
      preloadAgentSkillsFromCommands({
        agentDefinition: agent(['broken']),
        allSkills: [
          promptSkill('broken', '', {
            getPromptForCommand: async () => {
              throw new Error('test load failure')
            },
          }),
        ],
        toolUseContext: contextWithTools([]),
        strict: true,
      }),
    ).rejects.toMatchObject({
      code: 'agent_skill_preload_failed',
      evidence: {
        failedSkillIds: ['broken'],
        failures: [{ skillId: 'broken', reason: 'load_failed' }],
      },
    })
  })
})
