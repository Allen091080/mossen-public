import { getProjectRoot } from '../../bootstrap/state.js'
import { findCommand, getSkillToolCommands } from '../../commands.js'
import type { MossenContentBlockParam as ContentBlockParam } from '../../services/api/mossenSdk.js'
import { loadExplicitProjectSkillCommands } from '../../skills/loadSkillsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Command } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { createUserMessage } from '../../utils/messages.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export const AGENT_SKILL_PRELOAD_ERROR_CODE =
  'agent_skill_preload_failed' as const

export type AgentSkillPreloadFailureReason =
  | 'not_found'
  | 'not_prompt'
  | 'load_failed'

export type AgentSkillPreloadFailure = {
  skillId: string
  reason: AgentSkillPreloadFailureReason
}

export type AgentSkillPreloadEvidence = {
  agentType: string
  requestedSkillIds: string[]
  resolvedSkillIds: string[]
  preloadedSkillIds: string[]
}

export type AgentSkillPreloadErrorEvidence = AgentSkillPreloadEvidence & {
  failedSkillIds: string[]
  failures: AgentSkillPreloadFailure[]
}

export type AgentSkillPreloadState = {
  key?: string
  evidence?: AgentSkillPreloadEvidence
}

export class AgentSkillPreloadError extends Error {
  readonly code = AGENT_SKILL_PRELOAD_ERROR_CODE
  readonly evidence: AgentSkillPreloadErrorEvidence

  constructor(
    agentType: string,
    evidence: AgentSkillPreloadErrorEvidence,
    options?: { cause?: unknown },
  ) {
    const failureSummary = evidence.failures
      .map(failure => `${failure.skillId} (${failure.reason})`)
      .join(', ')
    super(
      `Failed to preload skills for Agent '${agentType}': ${failureSummary}`,
      options,
    )
    this.name = 'AgentSkillPreloadError'
    this.evidence = evidence
  }
}

export function getAgentSkillPreloadStateKey(
  agentDefinition: AgentDefinition,
): string {
  return JSON.stringify([
    agentDefinition.agentType,
    agentDefinition.skills ?? [],
  ])
}

/**
 * Resolve a requested Agent skill to its canonical registered command name.
 *
 * Resolution matches the historical delegated-Agent behavior:
 * 1. exact command name, display name, or alias;
 * 2. the Agent plugin namespace prefix;
 * 3. the historical first-match suffix lookup.
 */
export function resolveAgentSkillName(
  skillName: string,
  allSkills: readonly Command[],
  agentDefinition: AgentDefinition,
): string | null {
  const exact = findCommand(skillName, [...allSkills])
  if (exact) return exact.name

  const pluginPrefix = agentDefinition.agentType.split(':')[0]
  if (pluginPrefix) {
    const qualified = findCommand(`${pluginPrefix}:${skillName}`, [
      ...allSkills,
    ])
    if (qualified) return qualified.name
  }

  const suffix = `:${skillName}`
  return allSkills.find(command => command.name.endsWith(suffix))?.name ?? null
}

type ResolvedPromptSkill = {
  requestedSkillId: string
  resolvedSkillId: string
  skill: Command & { type: 'prompt' }
}

export async function preloadAgentSkillsFromCommands({
  agentDefinition,
  allSkills,
  toolUseContext,
  strict,
}: {
  agentDefinition: AgentDefinition
  allSkills: readonly Command[]
  toolUseContext: ToolUseContext
  strict: boolean
}): Promise<{
  messages: Message[]
  evidence: AgentSkillPreloadEvidence
}> {
  const requestedSkillIds = [...(agentDefinition.skills ?? [])]
  const resolved: ResolvedPromptSkill[] = []
  const failures: AgentSkillPreloadFailure[] = []

  for (const requestedSkillId of requestedSkillIds) {
    const resolvedSkillId = resolveAgentSkillName(
      requestedSkillId,
      allSkills,
      agentDefinition,
    )
    if (!resolvedSkillId) {
      failures.push({ skillId: requestedSkillId, reason: 'not_found' })
      continue
    }

    const skill = allSkills.find(command => command.name === resolvedSkillId)
    if (!skill || skill.type !== 'prompt') {
      failures.push({ skillId: requestedSkillId, reason: 'not_prompt' })
      continue
    }
    resolved.push({ requestedSkillId, resolvedSkillId, skill })
  }

  const resolvedSkillIds = resolved.map(item => item.resolvedSkillId)
  if (strict && failures.length > 0) {
    throw new AgentSkillPreloadError(agentDefinition.agentType, {
      agentType: agentDefinition.agentType,
      requestedSkillIds,
      resolvedSkillIds,
      preloadedSkillIds: [],
      failedSkillIds: failures.map(failure => failure.skillId),
      failures,
    })
  }

  if (!strict) {
    for (const failure of failures) {
      logForDebugging(
        `[Agent: ${agentDefinition.agentType}] Warning: Skill '${failure.skillId}' specified in frontmatter was ${failure.reason === 'not_prompt' ? 'not a prompt-based skill' : 'not found'}`,
        { level: 'warn' },
      )
    }
  }

  if (resolved.length === 0) {
    return {
      messages: [],
      evidence: {
        agentType: agentDefinition.agentType,
        requestedSkillIds,
        resolvedSkillIds,
        preloadedSkillIds: [],
      },
    }
  }

  const { formatSkillLoadingMetadata } = await import(
    '../../utils/processUserInput/processSlashCommand.js'
  )

  const loadResults = await Promise.all(
    resolved.map(async item => {
      try {
        return {
          ok: true as const,
          item,
          content: await item.skill.getPromptForCommand('', toolUseContext),
        }
      } catch (cause) {
        return { ok: false as const, item, cause }
      }
    }),
  )
  const failedLoads = loadResults.filter(result => !result.ok)
  if (failedLoads.length > 0) {
    const loadFailures = failedLoads.map(result => ({
      skillId: result.item.requestedSkillId,
      reason: 'load_failed' as const,
    }))
    const combinedFailures = [...failures, ...loadFailures]
    throw new AgentSkillPreloadError(
      agentDefinition.agentType,
      {
        agentType: agentDefinition.agentType,
        requestedSkillIds,
        resolvedSkillIds,
        preloadedSkillIds: [],
        failedSkillIds: combinedFailures.map(failure => failure.skillId),
        failures: combinedFailures,
      },
      { cause: failedLoads[0]?.cause },
    )
  }
  const loaded: Array<ResolvedPromptSkill & { content: ContentBlockParam[] }> =
    loadResults
      .filter(result => result.ok)
      .map(result => ({ ...result.item, content: result.content }))

  const messages = loaded.map(item => {
    logForDebugging(
      `[Agent: ${agentDefinition.agentType}] Preloaded skill '${item.requestedSkillId}' as '${item.resolvedSkillId}'`,
    )
    const metadata = formatSkillLoadingMetadata(
      item.requestedSkillId,
      item.skill.progressMessage,
    )
    return createUserMessage({
      content: [{ type: 'text', text: metadata }, ...item.content],
      isMeta: true,
    })
  })

  return {
    messages,
    evidence: {
      agentType: agentDefinition.agentType,
      requestedSkillIds,
      resolvedSkillIds,
      preloadedSkillIds: loaded.map(item => item.resolvedSkillId),
    },
  }
}

export async function preloadAgentSkills({
  agentDefinition,
  toolUseContext,
  strict,
}: {
  agentDefinition: AgentDefinition
  toolUseContext: ToolUseContext
  strict: boolean
}): Promise<{
  messages: Message[]
  evidence: AgentSkillPreloadEvidence
}> {
  if (!agentDefinition.skills?.length) {
    return {
      messages: [],
      evidence: {
        agentType: agentDefinition.agentType,
        requestedSkillIds: [],
        resolvedSkillIds: [],
        preloadedSkillIds: [],
      },
    }
  }
  let allSkills: Command[]
  try {
    allSkills = await getSkillToolCommands(getProjectRoot())
    if (isBareMode()) {
      const explicitProjectSkills = await loadExplicitProjectSkillCommands(
        getProjectRoot(),
        agentDefinition.skills,
      )
      const registeredNames = new Set(allSkills.map(skill => skill.name))
      allSkills = [
        ...allSkills,
        ...explicitProjectSkills.filter(
          skill => !registeredNames.has(skill.name),
        ),
      ]
    }
  } catch (cause) {
    const requestedSkillIds = [...(agentDefinition.skills ?? [])]
    const failures = requestedSkillIds.map(skillId => ({
      skillId,
      reason: 'load_failed' as const,
    }))
    throw new AgentSkillPreloadError(
      agentDefinition.agentType,
      {
        agentType: agentDefinition.agentType,
        requestedSkillIds,
        resolvedSkillIds: [],
        preloadedSkillIds: [],
        failedSkillIds: requestedSkillIds,
        failures,
      },
      { cause },
    )
  }
  return preloadAgentSkillsFromCommands({
    agentDefinition,
    allSkills,
    toolUseContext,
    strict,
  })
}
