/**
 * Agents subcommand handler — prints the list of configured agents.
 * Dynamically imported only when `mossen agents` runs.
 */
/* eslint-disable no-console -- CLI subcommand handlers intentionally write user-visible output. */

import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  type ResolvedAgent,
  resolveAgentModelDisplay,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { stat } from 'fs/promises'
import * as path from 'path'
import {
  formatAgentSupervisorDoctorStatus,
  getAgentSupervisorDoctorStatus,
} from '../../services/agentSupervisor/daemon.js'
import { readAgentSupervisorRosterWithSummaries } from '../../services/agentSupervisor/summary.js'
import { agentSupervisorGcHandler } from './agentSupervisor.js'
import {
  agentViewRowsToJson,
  buildAgentViewSnapshot,
  formatAgentViewCounts,
  type AgentViewDispatchDefaults,
  type AgentViewRow,
} from '../../components/agents-view/agentViewModel.js'

export type AgentsHandlerOptions = {
  doctor?: boolean
  gc?: boolean
  json?: boolean
  all?: boolean
  before?: string
  dryRun?: boolean
  confirm?: string
  cwd?: string
  model?: string
  permissionMode?: string
  effort?: string
  agent?: string
  settings?: string
  addDir?: string | string[]
  mcpConfig?: string | string[]
  pluginDir?: string | string[]
  strictMcpConfig?: boolean
  fallbackModel?: string
  allowDangerouslySkipPermissions?: boolean
  dangerouslySkipPermissions?: boolean
}

export type ResolvedAgentsCwd = {
  cwd: string
  warning?: string
}

export async function resolveAgentsCwdOverride(
  requestedCwd?: string,
): Promise<ResolvedAgentsCwd> {
  const fallbackCwd = getCwd()
  if (!requestedCwd?.trim()) return { cwd: fallbackCwd }
  const resolved = path.resolve(requestedCwd)
  try {
    const stats = await stat(resolved)
    if (stats.isDirectory()) return { cwd: resolved }
    return {
      cwd: fallbackCwd,
      warning: getLocalizedText({
        en: `Requested Agent View cwd is not a directory: ${resolved}. Using current cwd: ${fallbackCwd}.`,
        zh: `请求的 Agent View cwd 不是目录：${resolved}。已改用当前 cwd：${fallbackCwd}。`,
      }),
    }
  } catch {
    return {
      cwd: fallbackCwd,
      warning: getLocalizedText({
        en: `Requested Agent View cwd is unavailable: ${resolved}. Using current cwd: ${fallbackCwd}.`,
        zh: `请求的 Agent View cwd 不可用：${resolved}。已改用当前 cwd：${fallbackCwd}。`,
      }),
    }
  }
}

function formatAgent(agent: ResolvedAgent): string {
  const model = resolveAgentModelDisplay(agent)
  const parts = [agent.agentType]
  if (model) {
    parts.push(model)
  }
  if (agent.memory) {
    parts.push(`${agent.memory} memory`)
  }
  return parts.join(' · ')
}

function formatSupervisorJob(job: AgentViewRow): string {
  const summary =
    job.lastQuestion?.text ?? job.result.summary ?? job.lastActivity ?? null
  const summaryText = summary ? ` — ${summary}` : ''
  const agent = job.agent ? ` · ${job.agent}` : ''
  const worktree =
    job.worktree?.path
      ? ' · worktree'
      : job.worktree?.isolationReason
        ? ` · no worktree: ${job.worktree.isolationReason}`
        : ''
  return `  ${job.id} · ${job.stage}${agent}${worktree} · ${job.title}${summaryText}`
}

function optionCount(value: string | string[] | undefined): number {
  if (Array.isArray(value)) return value.filter(Boolean).length
  return value ? 1 : 0
}

function formatDispatchDefaults(options: AgentsHandlerOptions): string | null {
  const parts: string[] = []
  if (options.model) parts.push(`model=${options.model}`)
  if (options.effort) parts.push(`effort=${options.effort}`)
  if (options.permissionMode) parts.push(`permission=${options.permissionMode}`)
  if (options.agent) parts.push(`agent=${options.agent}`)
  if (options.settings) parts.push('settings')
  const addDirCount = optionCount(options.addDir)
  if (addDirCount > 0) parts.push(`add-dir=${addDirCount}`)
  const mcpCount = optionCount(options.mcpConfig)
  if (mcpCount > 0) parts.push(`mcp=${mcpCount}`)
  const pluginCount = optionCount(options.pluginDir)
  if (pluginCount > 0) parts.push(`plugins=${pluginCount}`)
  if (options.dangerouslySkipPermissions) {
    parts.push(
      getLocalizedText({
        en: 'skip permissions',
        zh: '跳过权限',
      }),
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value ? [value] : []
}

function getDispatchDefaults(
  options: AgentsHandlerOptions,
): AgentViewDispatchDefaults {
  return {
    model: options.model ?? null,
    permissionMode: options.permissionMode ?? null,
    effort: options.effort ?? null,
    agent: options.agent ?? null,
    settings: options.settings ?? null,
    addDirs: normalizeStringArray(options.addDir),
    mcpConfig: normalizeStringArray(options.mcpConfig),
    pluginDirs: normalizeStringArray(options.pluginDir),
    strictMcpConfig: options.strictMcpConfig === true,
    fallbackModel: options.fallbackModel ?? null,
    allowDangerouslySkipPermissions:
      options.allowDangerouslySkipPermissions === true,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions === true,
  }
}

export async function agentsHandler(
  options: AgentsHandlerOptions = {},
): Promise<void> {
  if (options.gc) {
    await agentSupervisorGcHandler(options)
    return
  }
  if (options.doctor) {
    const status = await getAgentSupervisorDoctorStatus()
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(formatAgentSupervisorDoctorStatus(status))
    return
  }

  const roster = await readAgentSupervisorRosterWithSummaries()
  const { cwd, warning } = await resolveAgentsCwdOverride(options.cwd)
  const snapshot = await buildAgentViewSnapshot(roster, {
    cwd,
    dispatchDefaults: getDispatchDefaults(options),
    includeAllCwds: options.all === true,
  })

  if (options.json) {
    if (warning) {
      // Keep JSON stdout clean for scripts.
      console.error(warning)
    }
    console.log(JSON.stringify(agentViewRowsToJson(snapshot.rows), null, 2))
    return
  }

  const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(allAgents)
  const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)

  const lines: string[] = []
  let totalActive = 0

  lines.push('Agent View:')
  if (warning) {
    lines.push(`  ${warning}`)
  }
  lines.push(
    getLocalizedText({
      en: '  Tip: run `mossen agents` in a TTY for the full Agent View TUI; press `?` there for shortcuts.',
      zh: '  提示：在 TTY 终端运行 `mossen agents` 可打开完整 Agent View TUI；进入后按 `?` 查看快捷键。',
    }),
  )
  const dispatchDefaults = formatDispatchDefaults(options)
  if (dispatchDefaults) {
    lines.push(
      getLocalizedText({
        en: `  Dispatch defaults: ${dispatchDefaults}`,
        zh: `  派发默认值：${dispatchDefaults}`,
      }),
    )
  }
  lines.push(`  ${formatAgentViewCounts(snapshot.counts)}`)
  if (snapshot.rows.length === 0) {
    lines.push(
      getLocalizedText({
        en: '  No supervisor jobs yet. Type a task in `mossen agents`, or run `mossen --bg "<prompt>"`.',
        zh: '  暂无 supervisor 任务。可在 `mossen agents` 中输入任务，或运行 `mossen --bg "<prompt>"`。',
      }),
    )
  } else {
    for (const job of snapshot.rows) {
      lines.push(formatSupervisorJob(job))
    }
  }
  lines.push('')

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
    const groupAgents = resolvedAgents
      .filter(a => a.source === source)
      .sort(compareAgentsByName)

    if (groupAgents.length === 0) continue

    lines.push(`${label}:`)
    for (const agent of groupAgents) {
      if (agent.overriddenBy) {
        const winnerSource = getOverrideSourceLabel(agent.overriddenBy)
        lines.push(`  (shadowed by ${winnerSource}) ${formatAgent(agent)}`)
      } else {
        lines.push(`  ${formatAgent(agent)}`)
        totalActive++
      }
    }
    lines.push('')
  }

  if (totalActive === 0 && snapshot.rows.length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(lines.join('\n').trimEnd())
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${snapshot.rows.length} supervisor jobs · ${totalActive} active agents\n`)
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(lines.join('\n').trimEnd())
  }
}
