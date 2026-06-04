import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import type { Command, LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { getBuiltinMcpTemplates } from '../../services/mcp/builtinTemplates.js'
import { useAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { describePluginStatus, type PluginStatusSummary } from '../../utils/plugins/statusOps.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type ExtensionMode = 'help' | 'examples' | 'status' | 'doctor' | 'report'
type McpSnapshot = ReturnType<typeof useMcpSnapshot>

function useMcpSnapshot() {
  return useAppState(state => state.mcp)
}

function isSkillCommand(cmd: Command): boolean {
  return cmd.type === 'prompt' && (
    cmd.loadedFrom === 'skills' ||
    cmd.loadedFrom === 'commands_DEPRECATED' ||
    cmd.loadedFrom === 'bundled' ||
    cmd.loadedFrom === 'plugin' ||
    cmd.loadedFrom === 'mcp'
  )
}

function countSkills(commands: Command[]): {
  total: number
  bundled: number
  fileBased: number
  plugin: number
  mcp: number
} {
  const counts = {
    total: 0,
    bundled: 0,
    fileBased: 0,
    plugin: 0,
    mcp: 0,
  }
  for (const command of commands) {
    if (!isSkillCommand(command)) continue
    counts.total += 1
    if (command.loadedFrom === 'bundled') counts.bundled += 1
    if (command.loadedFrom === 'skills' || command.loadedFrom === 'commands_DEPRECATED') {
      counts.fileBased += 1
    }
    if (command.loadedFrom === 'plugin') counts.plugin += 1
    if (command.loadedFrom === 'mcp') counts.mcp += 1
  }
  return counts
}

function countMcp(mcp: McpSnapshot): {
  total: number
  connected: number
  pending: number
  failed: number
  disabled: number
  needsAuth: number
  tools: number
  prompts: number
  resources: number
} {
  const counts = {
    total: mcp.clients.length,
    connected: 0,
    pending: 0,
    failed: 0,
    disabled: 0,
    needsAuth: 0,
    tools: mcp.tools.length,
    prompts: mcp.commands.length,
    resources: Object.values(mcp.resources).flat().length,
  }
  for (const client of mcp.clients) {
    switch (client.type) {
      case 'connected':
        counts.connected += 1
        break
      case 'pending':
        counts.pending += 1
        break
      case 'failed':
        counts.failed += 1
        break
      case 'disabled':
        counts.disabled += 1
        break
      case 'needs-auth':
        counts.needsAuth += 1
        break
    }
  }
  return counts
}

function formatExtensionsHelp(): string {
  return [
    getLocalizedText({
      en: `${figures.info} Extensions (read-only)`,
      zh: `${figures.info} 扩展能力（只读）`,
    }),
    '',
    getLocalizedText({
      en: 'Skills — task instructions and workflows. No server connection required.',
      zh: 'Skills —— 任务说明与工作流。不需要连接 server。',
    }),
    '  /skills',
    '  /skills install <github-url>',
    '  /skills install --confirm <token>',
    '',
    getLocalizedText({
      en: 'MCP — external tools such as browser automation, databases, and APIs.',
      zh: 'MCP —— 浏览器自动化、数据库、API 等外部工具。',
    }),
    '  /mcp status',
    '  /mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
    '  /mcp add --confirm <token>',
    '  /mcp reconnect <server>',
    '',
    getLocalizedText({
      en: 'Plugins — bundles that can contain skills, MCP servers, commands, hooks, and settings.',
      zh: 'Plugins —— 可组合 skills、MCP servers、commands、hooks 与 settings 的能力包。',
    }),
    '  /plugin status',
    '  /plugin sources',
    '  /plugin install --dry-run <plugin@marketplace|github-url>',
    '  /plugin install --confirm <token>',
    '',
    getLocalizedText({
      en: 'Rule of thumb: install with dry-run first, confirm with the printed token, then check status or list again.',
      zh: '使用规则：先 dry-run，按返回 token confirm，然后再查看 status 或列表。',
    }),
    getLocalizedText({
      en: 'Copyable walkthroughs: /extensions examples',
      zh: '可复制示例：/extensions examples',
    }),
    getLocalizedText({
      en: 'Health check: /extensions doctor',
      zh: '健康检查：/extensions doctor',
    }),
    getLocalizedText({
      en: 'Copyable report: /extensions report',
      zh: '可复制报告：/extensions report',
    }),
    getLocalizedText({
      en: 'This command only prints guidance. It does not install, reconnect, enable, disable, or edit config.',
      zh: '本命令只展示说明，不会安装、reconnect、启用、禁用或修改配置。',
    }),
  ].join('\n')
}

function mcpDoctorFindings(mcp: McpSnapshot): string[] {
  const mcpCounts = countMcp(mcp)
  const findings: string[] = []
  if (mcpCounts.total === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.warning} MCP: no servers are loaded. Add one with /mcp add or inspect examples with /extensions examples.`,
        zh: `${figures.warning} MCP: 当前没有加载 server。可用 /mcp add 添加，或运行 /extensions examples 查看示例。`,
      }),
    )
    return findings
  }
  if (mcpCounts.failed > 0) {
    const failed = mcp.clients
      .filter(client => client.type === 'failed')
      .map(client => client.name)
      .sort()
      .join(', ')
    findings.push(
      getLocalizedText({
        en: `${figures.cross} MCP: failed server(s): ${failed}. Run /mcp status, fix the command/config, then /mcp reconnect <server>.`,
        zh: `${figures.cross} MCP: 失败 server: ${failed}。先运行 /mcp status，修复命令/配置后执行 /mcp reconnect <server>。`,
      }),
    )
  }
  if (mcpCounts.pending > 0) {
    const pending = mcp.clients
      .filter(client => client.type === 'pending')
      .map(client => client.name)
      .sort()
      .join(', ')
    findings.push(
      getLocalizedText({
        en: `${figures.info} MCP: still connecting: ${pending}. Wait briefly, then run /mcp status again.`,
        zh: `${figures.info} MCP: 仍在连接: ${pending}。稍等后再运行 /mcp status。`,
      }),
    )
  }
  if (mcpCounts.needsAuth > 0) {
    const needsAuth = mcp.clients
      .filter(client => client.type === 'needs-auth')
      .map(client => client.name)
      .sort()
      .join(', ')
    findings.push(
      getLocalizedText({
        en: `${figures.warning} MCP: authentication required: ${needsAuth}. Complete auth before expecting tools.`,
        zh: `${figures.warning} MCP: 需要认证: ${needsAuth}。完成认证后才会暴露工具。`,
      }),
    )
  }
  if (mcpCounts.disabled > 0) {
    const disabled = mcp.clients
      .filter(client => client.type === 'disabled')
      .map(client => client.name)
      .sort()
      .join(', ')
    findings.push(
      getLocalizedText({
        en: `${figures.warning} MCP: disabled server(s): ${disabled}. Enable with /mcp enable <server> if needed.`,
        zh: `${figures.warning} MCP: 已禁用 server: ${disabled}。如需使用，执行 /mcp enable <server>。`,
      }),
    )
  }
  if (mcpCounts.connected > 0 && mcpCounts.tools + mcpCounts.prompts + mcpCounts.resources === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.warning} MCP: server(s) are connected but expose 0 tools/prompts/resources. Try /mcp reconnect <server> or restart Mossen.`,
        zh: `${figures.warning} MCP: 有 server 已连接但暴露 0 个工具/prompt/资源。可尝试 /mcp reconnect <server> 或重启 Mossen。`,
      }),
    )
  }
  if (findings.length === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.tick} MCP: no obvious issues. Details: /mcp status`,
        zh: `${figures.tick} MCP: 未发现明显问题。详情：/mcp status`,
      }),
    )
  }
  return findings
}

function pluginDoctorFindings(plugin: PluginStatusSummary | { error: string }): string[] {
  if ('error' in plugin) {
    return [
      getLocalizedText({
        en: `${figures.cross} Plugins: status helper failed (${plugin.error}). Run /plugin status for the raw error.`,
        zh: `${figures.cross} Plugins: status helper 失败（${plugin.error}）。运行 /plugin status 查看原始错误。`,
      }),
    ]
  }
  const findings: string[] = []
  if (!plugin.installedRegistryLoadable) {
    findings.push(
      getLocalizedText({
        en: `${figures.cross} Plugins: installed registry is not loadable. Run /plugin status before installing more plugins.`,
        zh: `${figures.cross} Plugins: installed registry 无法加载。继续安装前先运行 /plugin status。`,
      }),
    )
  }
  // W154-C: surface plugin load errors (count + suggest fix lookup).
  // The actual fix hints + per-error redacted summaries live in
  // /plugin status (W154-B); doctor just routes the operator there.
  if (plugin.loadErrors.count > 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.cross} Plugins: ${plugin.loadErrors.count} plugin load error(s). Run /plugin status to see per-error fix hints.`,
        zh: `${figures.cross} Plugins: ${plugin.loadErrors.count} 个插件加载错误。运行 /plugin status 查看每个错误的修复提示。`,
      }),
    )
  }
  // W154-C: surface explicitly disabled plugins (W154-B
  // disabledPluginCount field). Distinct from "uninstalled" — a
  // disabled plugin's record stays put but its commands won't load.
  if (plugin.disabledPluginCount > 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.info} Plugins: ${plugin.disabledPluginCount} plugin(s) are disabled. Re-enable with /plugin enable <plugin@marketplace>.`,
        zh: `${figures.info} Plugins: ${plugin.disabledPluginCount} 个插件已禁用。用 /plugin enable <plugin@marketplace> 重新启用。`,
      }),
    )
  }
  if (plugin.pruneEligible) {
    findings.push(
      getLocalizedText({
        en: `${figures.info} Plugins: orphaned cache entries are present. Review with /plugin prune.`,
        zh: `${figures.info} Plugins: 存在 orphan cache。用 /plugin prune 查看并清理。`,
      }),
    )
  }
  if (plugin.installedRecordCount === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.info} Plugins: no installed plugin records. Install with /plugin install --dry-run <plugin@marketplace|github-url>.`,
        zh: `${figures.info} Plugins: 当前没有已安装插件记录。可用 /plugin install --dry-run <plugin@marketplace|github-url> 安装。`,
      }),
    )
  }
  if (findings.length === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.tick} Plugins: no obvious issues. Details: /plugin status`,
        zh: `${figures.tick} Plugins: 未发现明显问题。详情：/plugin status`,
      }),
    )
  }
  return findings
}

// W154-C: built-in MCP template discoverability. The doctor surfaces
// the count of available templates so an operator who has zero
// connected MCP servers (or who just doesn't know what's available)
// gets a single explicit pointer to /mcp templates instead of
// searching docs. Templates are inert config fragments; nothing here
// installs or enables them.
function mcpTemplatesDoctorFindings(mcp: McpSnapshot): string[] {
  const templates = getBuiltinMcpTemplates()
  const findings: string[] = []
  const mcpCounts = countMcp(mcp)
  if (templates.length > 0 && mcpCounts.connected === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.info} MCP templates: ${templates.length} built-in template(s) available. Browse with /mcp templates, then /mcp add ...`,
        zh: `${figures.info} MCP templates: 内置 ${templates.length} 个模板。用 /mcp templates 浏览，再用 /mcp add ... 添加。`,
      }),
    )
  } else if (templates.length > 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.tick} MCP templates: ${templates.length} built-in template(s) available (/mcp templates).`,
        zh: `${figures.tick} MCP templates: 内置 ${templates.length} 个模板（/mcp templates）。`,
      }),
    )
  }
  return findings
}

function skillDoctorFindings(commands: Command[]): string[] {
  const skills = countSkills(commands)
  const findings: string[] = []
  if (skills.total === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.warning} Skills: no visible skills. Run /skills, or install one with /skills install <github-url>.`,
        zh: `${figures.warning} Skills: 当前没有可见 skill。运行 /skills，或用 /skills install <github-url> 安装。`,
      }),
    )
    return findings
  }
  findings.push(
    getLocalizedText({
      en:
        `${figures.tick} Skills: ${skills.total} visible ` +
        `(${skills.bundled} bundled, ${skills.fileBased} file-based, ${skills.plugin} plugin, ${skills.mcp} MCP).`,
      zh:
        `${figures.tick} Skills: ${skills.total} 个可见 ` +
        `（${skills.bundled} 个内置，${skills.fileBased} 个文件，${skills.plugin} 个 plugin，${skills.mcp} 个 MCP）。`,
    }),
  )
  if (skills.fileBased + skills.plugin + skills.mcp === 0) {
    findings.push(
      getLocalizedText({
        en: `${figures.info} Skills: only bundled skills are visible. For user-added workflows, use /skills install <github-url>.`,
        zh: `${figures.info} Skills: 目前只有内置 skill 可见。用户自定义工作流可用 /skills install <github-url> 安装。`,
      }),
    )
  }
  return findings
}

function formatExtensionsDoctor({
  commands,
  mcp,
  plugin,
}: {
  commands: Command[]
  mcp: McpSnapshot
  plugin: PluginStatusSummary | { error: string }
}): string {
  return [
    getLocalizedText({
      en: `${figures.info} Extensions doctor (read-only)`,
      zh: `${figures.info} 扩展诊断（只读）`,
    }),
    '',
    ...skillDoctorFindings(commands),
    ...mcpDoctorFindings(mcp),
    ...mcpTemplatesDoctorFindings(mcp),
    ...pluginDoctorFindings(plugin),
    '',
    getLocalizedText({
      en: 'Next commands: /extensions status, /skills, /mcp status, /mcp templates, /plugin status, /extensions examples',
      zh: '下一步命令：/extensions status、/skills、/mcp status、/mcp templates、/plugin status、/extensions examples',
    }),
    getLocalizedText({
      en: 'This doctor is read-only. It does not install, reconnect, enable, disable, prune, reload, or edit config.',
      zh: '本 doctor 只读。它不会安装、reconnect、启用、禁用、prune、reload 或修改配置。',
    }),
  ].join('\n')
}

function formatExtensionsReport({
  commands,
  mcp,
  plugin,
}: {
  commands: Command[]
  mcp: McpSnapshot
  plugin: PluginStatusSummary | { error: string }
}): string {
  return [
    getLocalizedText({
      en: `${figures.info} Extensions report (read-only)`,
      zh: `${figures.info} 扩展报告（只读）`,
    }),
    getLocalizedText({
      en: 'Copy this report when asking for help with Skill/MCP/Plugin setup.',
      zh: '排查 Skill/MCP/Plugin 配置时，可以复制这份报告。',
    }),
    '',
    '--- status ---',
    formatExtensionsStatus({ commands, mcp, plugin }),
    '',
    '--- doctor ---',
    formatExtensionsDoctor({ commands, mcp, plugin }),
    '',
    getLocalizedText({
      en: 'This report is read-only. It does not install, reconnect, enable, disable, prune, reload, or edit config.',
      zh: '本报告只读。它不会安装、reconnect、启用、禁用、prune、reload 或修改配置。',
    }),
  ].join('\n')
}

function formatExtensionsExamples(): string {
  return [
    getLocalizedText({
      en: `${figures.info} Extension examples (read-only)`,
      zh: `${figures.info} 扩展示例（只读）`,
    }),
    '',
    getLocalizedText({
      en: '1. Playwright MCP — browser automation',
      zh: '1. Playwright MCP —— 浏览器自动化',
    }),
    '  /mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
    '  /mcp add --confirm <token>',
    '  /mcp reconnect playwright',
    '  /mcp status',
    getLocalizedText({
      en: '  Then ask: open https://example.com with Playwright and tell me the page title.',
      zh: '  然后问：用 Playwright 打开 https://example.com，告诉我页面标题。',
    }),
    '',
    getLocalizedText({
      en: '2. GitHub skill — local workflow instructions',
      zh: '2. GitHub skill —— 本地工作流说明',
    }),
    '  /skills install https://github.com/<owner>/<repo>/tree/<branch>/<skill-path>',
    '  /skills install --confirm <token>',
    '  /skills',
    '',
    getLocalizedText({
      en: '3. GitHub plugin — bundled skills/MCP/commands/hooks',
      zh: '3. GitHub plugin —— 组合 skills/MCP/commands/hooks',
    }),
    '  /plugin install --dry-run https://github.com/<owner>/<repo>',
    '  /plugin install --confirm <token>',
    '  /reload-plugins',
    '  /plugin status',
    '',
    getLocalizedText({
      en: 'If a command prints a token, copy the exact confirm command it returns. Tokens expire after 10 minutes.',
      zh: '如果命令返回 token，请复制它返回的完整 confirm 命令。token 10 分钟后过期。',
    }),
    getLocalizedText({
      en: 'These examples only print guidance. Nothing is installed from /extensions examples.',
      zh: '这些示例只展示说明。/extensions examples 不会安装任何内容。',
    }),
  ].join('\n')
}

function formatPluginSummary(plugin: PluginStatusSummary | { error: string }): string[] {
  if ('error' in plugin) {
    return [
      getLocalizedText({
        en: `  status helper: failed (${plugin.error})`,
        zh: `  status helper: 失败（${plugin.error}）`,
      }),
      '  /plugin status',
    ]
  }
  if (plugin.cache.zipCacheMode) {
    return [
      getLocalizedText({
        en: `  installed registry: ${plugin.installedRecordCount} records, ${plugin.installedVersionCount} versions`,
        zh: `  installed 注册表: ${plugin.installedRecordCount} 条，${plugin.installedVersionCount} 个版本`,
      }),
      getLocalizedText({
        en: '  cache: zip-cache mode active',
        zh: '  cache: zip-cache 模式启用',
      }),
      '  /plugin status',
    ]
  }
  return [
    getLocalizedText({
      en: `  installed registry: ${plugin.installedRecordCount} records, ${plugin.installedVersionCount} versions`,
      zh: `  installed 注册表: ${plugin.installedRecordCount} 条，${plugin.installedVersionCount} 个版本`,
    }),
    getLocalizedText({
      en:
        `  cache: ${plugin.cache.cacheVersionCount} versions, ` +
        `${plugin.cache.expiredOrphanCount} expired orphans, ` +
        `${plugin.cache.unmarkedOrphanCount} unmarked orphans`,
      zh:
        `  cache: ${plugin.cache.cacheVersionCount} 个版本，` +
        `${plugin.cache.expiredOrphanCount} 个过期 orphan，` +
        `${plugin.cache.unmarkedOrphanCount} 个未标记 orphan`,
    }),
    getLocalizedText({
      en: `  suggested: ${plugin.suggestedCommand}`,
      zh: `  建议: ${plugin.suggestedCommand}`,
    }),
    '  /plugin status',
  ]
}

function formatExtensionsStatus({
  commands,
  mcp,
  plugin,
}: {
  commands: Command[]
  mcp: McpSnapshot
  plugin: PluginStatusSummary | { error: string }
}): string {
  const skills = countSkills(commands)
  const mcpCounts = countMcp(mcp)
  return [
    getLocalizedText({
      en: `${figures.info} Extensions status (read-only)`,
      zh: `${figures.info} 扩展状态（只读）`,
    }),
    '',
    getLocalizedText({
      en: 'Skills',
      zh: 'Skills',
    }),
    getLocalizedText({
      en:
        `  visible: ${skills.total} total ` +
        `(${skills.bundled} bundled, ${skills.fileBased} file-based, ` +
        `${skills.plugin} plugin, ${skills.mcp} MCP)`,
      zh:
        `  可见: ${skills.total} 个 ` +
        `（${skills.bundled} 个内置，${skills.fileBased} 个文件，` +
        `${skills.plugin} 个 plugin，${skills.mcp} 个 MCP）`,
    }),
    '  /skills',
    '  /skills install <github-url>',
    '',
    'MCP',
    getLocalizedText({
      en:
        `  servers: ${mcpCounts.total} total, ${mcpCounts.connected} connected, ` +
        `${mcpCounts.pending} connecting, ${mcpCounts.failed} failed, ` +
        `${mcpCounts.disabled} disabled, ${mcpCounts.needsAuth} needs auth`,
      zh:
        `  servers: 共 ${mcpCounts.total} 个，${mcpCounts.connected} 个已连接，` +
        `${mcpCounts.pending} 个连接中，${mcpCounts.failed} 个失败，` +
        `${mcpCounts.disabled} 个已禁用，${mcpCounts.needsAuth} 个需要认证`,
    }),
    getLocalizedText({
      en:
        `  exposed: ${mcpCounts.tools} tools, ` +
        `${mcpCounts.prompts} prompts/skills, ${mcpCounts.resources} resources`,
      zh:
        `  暴露: ${mcpCounts.tools} 个工具，` +
        `${mcpCounts.prompts} 个 prompts/skills，${mcpCounts.resources} 个资源`,
    }),
    '  /mcp status',
    '  /mcp add playwright --scope local -- npx -y @playwright/mcp@latest',
    '',
    'Plugins',
    ...formatPluginSummary(plugin),
    '  /plugin install --dry-run <plugin@marketplace|github-url>',
    '',
    getLocalizedText({
      en: 'Copyable walkthroughs: /extensions examples',
      zh: '可复制示例：/extensions examples',
    }),
    getLocalizedText({
      en: 'This status is read-only. It does not install, reconnect, enable, disable, prune, or edit config.',
      zh: '本状态只读。它不会安装、reconnect、启用、禁用、prune 或修改配置。',
    }),
  ].join('\n')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const trimmedArgs = args?.trim()
  const mode: ExtensionMode =
    trimmedArgs === 'examples'
      ? 'examples'
      : trimmedArgs === 'status'
        ? 'status'
        : trimmedArgs === 'doctor'
          ? 'doctor'
          : trimmedArgs === 'report'
            ? 'report'
            : 'help'
  return (
    <ExtensionsHelp
      onComplete={onDone}
      mode={mode}
      commands={context.options.commands}
    />
  )
}

function ExtensionsHelp({
  onComplete,
  mode,
  commands,
}: {
  onComplete: (result?: string) => void
  mode: ExtensionMode
  commands: Command[]
}): React.ReactNode {
  const mcp = useMcpSnapshot()

  useEffect(() => {
    let cancelled = false
    async function complete(): Promise<void> {
      if (mode === 'examples') {
        onComplete(formatExtensionsExamples())
        return
      }
      if (mode === 'help') {
        onComplete(formatExtensionsHelp())
        return
      }
      const plugin = await describePluginStatus().catch(error => ({
        error: String(error),
      }))
      if (!cancelled) {
        onComplete(
          mode === 'doctor'
            ? formatExtensionsDoctor({ commands, mcp, plugin })
            : mode === 'report'
              ? formatExtensionsReport({ commands, mcp, plugin })
            : formatExtensionsStatus({ commands, mcp, plugin }),
        )
      }
    }
    void complete()
    return () => {
      cancelled = true
    }
  }, [commands, mcp, mode, onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading extension commands…',
          zh: '正在读取扩展命令…',
        })}
      </Text>
    </Box>
  )
}
