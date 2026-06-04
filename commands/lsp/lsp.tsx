import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  executeLspInitPlan,
  getLspInitPlan,
  type LspInitTemplateId,
} from '../../services/lsp/initPlan.js'
import {
  listLspServers,
  probeLspServer,
  restartLspServer,
  stopLspServer,
} from '../../services/lsp/serverControls.js'
import {
  collectLspDoctor,
  collectLspStatus,
  LSP_TEMPLATES,
  type LspDoctorReport,
  type LspStatusReport,
} from '../../services/lsp/status.js'
import {
  getLspToolEnablement,
  setLspToolEnabled,
} from '../../services/lsp/settings.js'
import {
  getPendingLSPDiagnosticCount,
  peekPendingLSPDiagnostics,
} from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { isBinaryInstalled } from '../../utils/binaryCheck.js'
import type { DiagnosticFile } from '../../services/diagnosticTracking.js'

function formatBool(value: boolean): string {
  return value ? 'yes' : 'no'
}

function formatToolStatus(report: LspStatusReport): string[] {
  return [
    getLocalizedText({
      zh: `LSP 工具: ${report.tool.effective ? '已启用' : '未启用'}`,
      en: `LSP tool: ${report.tool.effective ? 'enabled' : 'disabled'}`,
    }),
    `configured: ${formatBool(report.tool.configured)}`,
    `env ENABLE_LSP_TOOL: ${formatBool(report.tool.envEnabled)}`,
    getLocalizedText({
      zh: report.tool.envEnabled
        ? '注意: 环境变量 ENABLE_LSP_TOOL 正在强制启用工具。'
        : '提示: /lsp enable 会写入持久配置；ENABLE_LSP_TOOL 仍可作为兼容开关。',
      en: report.tool.envEnabled
        ? 'Note: ENABLE_LSP_TOOL is forcing the tool on.'
        : 'Tip: /lsp enable writes persistent config; ENABLE_LSP_TOOL remains supported.',
    }),
  ]
}

function formatStatus(report: LspStatusReport): string {
  const lines: string[] = []
  lines.push(
    getLocalizedText({ zh: 'LSP 状态（只读）', en: 'LSP status (read-only)' }),
  )
  lines.push(`manager: ${report.initialization.status}`)
  if (report.initialization.status === 'failed') {
    lines.push(`managerError: ${report.initialization.error.message}`)
  }
  lines.push(`bareMode: ${formatBool(report.bareMode)}`)
  lines.push(...formatToolStatus(report))
  lines.push(
    `sources: plugin=${report.loadStats.pluginCount} user=${report.loadStats.userCount} project=${report.loadStats.projectCount}`,
  )
  lines.push(`configured servers: ${report.configuredServerCount}`)
  lines.push(`running servers: ${report.runningServerCount}`)
  lines.push(`pending diagnostics: ${report.pendingDiagnostics}`)
  lines.push(`workspace cwd: ${report.workspaceCwd}`)
  lines.push(`user config:    ${report.userConfig.path}`)
  lines.push(`project config: ${report.projectConfig.path}`)

  if (report.servers.length > 0) {
    lines.push('')
    lines.push(
      getLocalizedText({ zh: '已配置 server:', en: 'Configured servers:' }),
    )
    for (const server of report.servers) {
      lines.push(
        `- ${server.name} (${server.source}) ${server.state} healthy=${formatBool(server.healthy)}`,
      )
      lines.push(
        `  command: ${server.command}${server.args.length ? ` ${server.args.join(' ')}` : ''} · binary=${formatBool(server.binaryInstalled)}`,
      )
      lines.push(`  extensions: ${server.extensions.join(', ')}`)
      if (server.lastError) lines.push(`  lastError: ${server.lastError}`)
    }
  } else {
    lines.push('')
    lines.push(
      getLocalizedText({
        zh: '当前没有 LSP server 配置。运行 /lsp templates 查看模板，或 /lsp init 初始化。',
        en: 'No LSP server configs found. Run /lsp templates for examples or /lsp init to initialize.',
      }),
    )
  }

  if (report.errors.length > 0) {
    lines.push('')
    lines.push(getLocalizedText({ zh: '加载错误:', en: 'Load errors:' }))
    for (const error of report.errors) lines.push(`- ${error}`)
  }
  return lines.join('\n')
}

function formatDoctor(report: LspDoctorReport): string {
  const lines = [
    getLocalizedText({
      zh: `LSP doctor: ${report.overall}`,
      en: `LSP doctor: ${report.overall}`,
    }),
    '',
  ]
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.id}: ${check.message}`)
  }
  // W154-A: per-server lifecycle counters surface when there is at
  // least one configured server. Skipped on cold doctor calls (no
  // servers) so the existing "no servers" diagnostic stays clean.
  // LspDoctorReport extends LspStatusReport so the `servers` array is
  // available directly on the report object.
  if (report.servers.length > 0) {
    lines.push('')
    lines.push(getLocalizedText({
      zh: 'servers (lifecycle):',
      en: 'servers (lifecycle):',
    }))
    for (const server of report.servers) {
      const detail = [
        `state=${server.state}`,
        `restartCount=${server.restartCount}`,
        `openDocuments=${server.openDocuments}`,
      ]
      if (server.lastError) detail.push(`lastError=${server.lastError}`)
      lines.push(`  ${server.name}: ${detail.join(' ')}`)
    }
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      zh: '下一步: /lsp init 写入项目级 lsp.json；/lsp servers 查看已配置；/lsp probe <file> 验证可用性；/lsp install <模板> 查看安装计划。',
      en: 'Next: /lsp init writes a project-level lsp.json; /lsp servers lists configured servers; /lsp probe <file> verifies usability; /lsp install <template> shows the install plan.',
    }),
  )
  return lines.join('\n')
}

function formatTemplates(report?: LspStatusReport): string {
  const templates =
    report?.templates ??
    LSP_TEMPLATES.map(t => ({ ...t, binaryInstalled: false }))
  const lines: string[] = [
    getLocalizedText({
      zh: 'LSP 模板（只读示例，运行 /lsp init <template> 写入项目）',
      en: 'LSP templates (read-only; run /lsp init <template> to write project config)',
    }),
    '',
  ]

  for (const template of templates) {
    lines.push(`## ${template.label} (${template.id})`)
    lines.push(`binary: ${template.command} (${formatBool(template.binaryInstalled)})`)
    lines.push(`install: ${template.installHint}`)
    lines.push('plugin.json lspServers snippet:')
    lines.push(JSON.stringify({ lspServers: template.lspServers }, null, 2))
    lines.push('')
  }

  lines.push(
    getLocalizedText({
      zh: '使用方式: 把 lspServers 放进 plugin.json 后 /reload-plugins；或直接 /lsp init typescript ｜ /lsp init rust （默认 scope=project）。',
      en: 'Usage: drop lspServers into plugin.json then /reload-plugins; or run /lsp init typescript | /lsp init rust (default scope=project).',
    }),
  )
  return lines.join('\n')
}

function formatHelp(): string {
  return [
    getLocalizedText({ zh: 'LSP 命令', en: 'LSP commands' }),
    '',
    '/lsp status',
    '/lsp doctor',
    '/lsp templates',
    '/lsp enable',
    '/lsp disable',
    '/lsp tool status',
    '/lsp init <template> [--scope project|user]',
    '/lsp init <template> [--scope project|user] --confirm <token>',
    '/lsp install <template> [--dry-run]',
    '/lsp servers',
    '/lsp probe <filePath>',
    '/lsp restart <name>',
    '/lsp stop <name>',
    '/lsp diagnostics [filePath]',
  ].join('\n')
}

type ParsedArgs = {
  positional: string[]
  flags: Record<string, string | true>
}

function parseArgs(args: string): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  const tokens = args.split(/\s+/).filter(t => t.length > 0)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (tok.startsWith('--')) {
      const key = tok.slice(2)
      const next = tokens[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(tok)
    }
  }
  return { positional, flags }
}

function isInitTemplateId(value: string): value is LspInitTemplateId {
  return value === 'typescript' || value === 'rust'
}

function isInitScope(value: string): value is 'project' | 'user' {
  return value === 'project' || value === 'user'
}

async function handleInit(parsed: ParsedArgs): Promise<string> {
  const [, templateArg] = parsed.positional
  if (!templateArg) {
    return getLocalizedText({
      zh: '用法: /lsp init <typescript|rust> [--scope project|user] [--confirm <token>]',
      en: 'Usage: /lsp init <typescript|rust> [--scope project|user] [--confirm <token>]',
    })
  }
  if (!isInitTemplateId(templateArg)) {
    return `unknown template: ${templateArg}. Available: typescript, rust.`
  }

  const scopeFlag = parsed.flags.scope
  const scope =
    typeof scopeFlag === 'string' && isInitScope(scopeFlag) ? scopeFlag : 'project'

  const confirm = parsed.flags.confirm
  if (typeof confirm === 'string' && confirm.length > 0) {
    const result = await executeLspInitPlan({ token: confirm })
    if (result.ok === true) {
      const ok = result as {
        ok: true
        targetPath: string
        serverName: string
        bytesWritten: number
      }
      return [
        getLocalizedText({
          zh: `LSP 配置已写入: ${ok.targetPath}`,
          en: `LSP config written: ${ok.targetPath}`,
        }),
        `serverName: ${ok.serverName}`,
        `bytesWritten: ${ok.bytesWritten}`,
        getLocalizedText({
          zh: '提示: 运行 /reload-plugins 或重启 Mossen 让新 server 生效。',
          en: 'Tip: run /reload-plugins or restart Mossen to pick up the new server.',
        }),
      ].join('\n')
    }
    const fail = result as { ok: false; reason: string; detail?: string }
    return [
      getLocalizedText({
        zh: 'LSP 配置写入失败。',
        en: 'LSP config write failed.',
      }),
      `reason: ${fail.reason}`,
      fail.detail ? `detail: ${fail.detail}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Dry-run: produce a plan and surface the token.
  const plan = await getLspInitPlan({ template: templateArg, scope })
  const lines: string[] = []
  lines.push(
    getLocalizedText({
      zh: `LSP init 预览（dry-run，不写盘）— template=${plan.template}, scope=${plan.scope}`,
      en: `LSP init preview (dry-run, no writes) — template=${plan.template}, scope=${plan.scope}`,
    }),
  )
  lines.push(`targetPath: ${plan.targetPath}`)
  lines.push(`willCreate: ${formatBool(plan.willCreate)}`)
  lines.push(`willMerge:  ${formatBool(plan.willMerge)}`)
  lines.push(`serverName: ${plan.serverName}`)
  if (plan.conflictsWith.length > 0) {
    lines.push(
      getLocalizedText({
        zh: `冲突 server (将被覆盖): ${plan.conflictsWith.join(', ')}`,
        en: `Conflicts (will be overwritten): ${plan.conflictsWith.join(', ')}`,
      }),
    )
  }
  if (plan.blocked !== null) {
    lines.push('')
    lines.push(`BLOCKED: ${plan.blocked}`)
    if (plan.blockedDetail) lines.push(`detail: ${plan.blockedDetail}`)
    return lines.join('\n')
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      zh: 'preview lspServers:',
      en: 'preview lspServers:',
    }),
  )
  lines.push(JSON.stringify({ lspServers: plan.preview }, null, 2))
  if (plan.token) {
    lines.push('')
    lines.push(`token: ${plan.token}`)
    lines.push(
      getLocalizedText({
        zh: `确认写盘: /lsp init ${templateArg} --scope ${scope} --confirm ${plan.token}`,
        en: `Confirm write: /lsp init ${templateArg} --scope ${scope} --confirm ${plan.token}`,
      }),
    )
    if (plan.tokenExpiresAt) {
      const remaining = Math.max(
        0,
        Math.round((plan.tokenExpiresAt - Date.now()) / 1000),
      )
      lines.push(
        getLocalizedText({
          zh: `token 有效期约 ${remaining} 秒（10 分钟 TTL）`,
          en: `token valid for ~${remaining}s (10 minute TTL)`,
        }),
      )
    }
  }
  return lines.join('\n')
}

function formatServersList(): string {
  const entries = listLspServers()
  if (entries.length === 0) {
    return getLocalizedText({
      zh: '当前 LSP manager 没有可见 server（manager 未初始化或无配置）。',
      en: 'No servers visible to the LSP manager (manager not initialized or no config).',
    })
  }
  const lines: string[] = [
    getLocalizedText({
      zh: 'LSP server 列表（来自 manager 单例）',
      en: 'LSP server list (from manager singleton)',
    }),
    '',
  ]
  for (const e of entries) {
    lines.push(
      `- ${e.name} (${e.source}) state=${e.state} healthy=${formatBool(e.healthy)} restarts=${e.restartCount}`,
    )
    lines.push(`  command: ${e.command}`)
    if (e.startedAt) lines.push(`  startedAt: ${e.startedAt}`)
    if (e.lastError) lines.push(`  lastError: ${e.lastError}`)
  }
  return lines.join('\n')
}

async function handleProbe(parsed: ParsedArgs): Promise<string> {
  const [, filePath] = parsed.positional
  if (!filePath) {
    return getLocalizedText({
      zh: '用法: /lsp probe <filePath>',
      en: 'Usage: /lsp probe <filePath>',
    })
  }
  const result = await probeLspServer({ filePath })
  const lines: string[] = []
  lines.push(`probe: ${result.ok ? 'ok' : 'failed'}`)
  lines.push(`file:           ${result.filePath}`)
  lines.push(`file exists:    ${result.fileExists ? 'yes' : 'no'}`)
  lines.push(`matched server: ${result.serverName ?? '(none)'}`)
  lines.push(`source:         ${result.serverSource ?? '(unknown)'}`)
  if (result.serverCommand) {
    const argSuffix = result.serverArgs.length > 0 ? ` ${result.serverArgs.join(' ')}` : ''
    lines.push(`command:        ${result.serverCommand}${argSuffix}`)
  }
  lines.push(`binary status:  ${result.binaryInstalled ? 'installed' : 'missing on PATH'}`)
  lines.push(
    `documentSymbol: ${result.documentSymbolCount === null ? 'skipped' : `${result.documentSymbolCount} top-level`}`,
  )
  lines.push(`diagnostics:    ${result.diagnosticsCount}`)
  lines.push(`totalMs:        ${result.totalMs}`)
  if (result.error) lines.push(`error:          ${result.error}`)
  if (result.suggestedFiles.length > 0) {
    lines.push('suggestedFiles:')
    for (const file of result.suggestedFiles) {
      lines.push(`  - ${file}`)
    }
  }
  lines.push('')
  lines.push('steps:')
  for (const step of result.steps) {
    lines.push(
      `  [${step.status}] ${step.name} (${step.durationMs}ms)${step.detail ? ` — ${step.detail}` : ''}`,
    )
  }
  if (result.recommendedActions.length > 0) {
    lines.push('')
    lines.push(
      getLocalizedText({
        zh: 'recommendedActions:',
        en: 'recommendedActions:',
      }),
    )
    for (const action of result.recommendedActions) {
      lines.push(`  - ${action}`)
    }
  }
  return lines.join('\n')
}

type ControlOk = { ok: true; name: string; state: string }
type ControlFail = { ok: false; name: string; reason: string; detail?: string }

// W154-A: `/lsp install <template>` is intentionally read-only in this
// wave. It surfaces the install plan (template installHint + binary
// status + recommended commands the operator can run) without
// spawning any installer process. `--confirm` is rejected with a
// clear message so a future wave that wires real install can take
// over the same flag without changing the dry-run shape. Real
// install (spawn package manager) is a separate Allen-pending wave.
async function handleInstall(parsed: ParsedArgs): Promise<string> {
  const id = parsed.positional[1]
  if (!id || !isInitTemplateId(id)) {
    return getLocalizedText({
      zh: '用法: /lsp install <typescript|rust> [--dry-run]',
      en: 'Usage: /lsp install <typescript|rust> [--dry-run]',
    })
  }

  if (parsed.flags.confirm !== undefined) {
    return getLocalizedText({
      zh: '/lsp install --confirm 暂未启用 — 真实安装需要运行环境的包管理器执行权限，已计划在后续 wave 由 Allen 拍板后接入。当前请使用 --dry-run（默认）查看安装计划，按 installHint 手动执行。',
      en: '/lsp install --confirm is not yet enabled — real install requires package-manager execution and is scheduled for a later wave once Allen approves. Use --dry-run (default) to view the install plan and run the commands manually.',
    })
  }

  const template = LSP_TEMPLATES.find(t => t.id === id)
  if (!template) {
    return getLocalizedText({
      zh: `未知 LSP 模板: ${id}`,
      en: `unknown LSP template: ${id}`,
    })
  }

  const binaryInstalled = await isBinaryInstalled(template.command)
  const lines: string[] = [
    getLocalizedText({
      zh: `LSP install plan (dry-run) — ${template.label}`,
      en: `LSP install plan (dry-run) — ${template.label}`,
    }),
    '',
    `template:        ${template.id}`,
    `binary command:  ${template.command}`,
    `binary on PATH:  ${formatBool(binaryInstalled)}`,
    '',
    getLocalizedText({
      zh: '推荐操作:',
      en: 'recommended commands:',
    }),
    `  ${template.installHint}`,
    '',
  ]

  if (binaryInstalled) {
    lines.push(getLocalizedText({
      zh: `已检测到 ${template.command} 在 PATH 上 — 无需重装。运行 /lsp init ${template.id} 写入项目配置；运行 /lsp probe <filePath> 验证 server 启动。`,
      en: `${template.command} already on PATH — no install needed. Run /lsp init ${template.id} to write the project config; run /lsp probe <filePath> to verify server startup.`,
    }))
  } else {
    lines.push(getLocalizedText({
      zh: `未检测到 ${template.command}。按 installHint 手动安装后，再运行 /lsp install ${template.id} 复核状态，或 /lsp doctor 查看完整诊断。`,
      en: `${template.command} not on PATH. Install via installHint above, then re-run /lsp install ${template.id} to recheck, or /lsp doctor for the full diagnostic.`,
    }))
  }

  lines.push('')
  lines.push(getLocalizedText({
    zh: '注: 本命令为只读 dry-run；不会修改 PATH、不会触发任何包管理器。--confirm 暂未启用。',
    en: 'Note: this command is read-only dry-run; PATH and package managers are untouched. --confirm is not yet enabled.',
  }))

  return lines.join('\n')
}

async function handleRestart(parsed: ParsedArgs): Promise<string> {
  const [, name] = parsed.positional
  if (!name) {
    return getLocalizedText({
      zh: '用法: /lsp restart <name>',
      en: 'Usage: /lsp restart <name>',
    })
  }
  const result = await restartLspServer(name)
  if (result.ok === true) {
    const ok = result as ControlOk
    return `restarted ${ok.name}: state=${ok.state}`
  }
  const fail = result as ControlFail
  return [
    `restart failed: ${fail.name}`,
    `reason: ${fail.reason}`,
    fail.detail ? `detail: ${fail.detail}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function handleStop(parsed: ParsedArgs): Promise<string> {
  const [, name] = parsed.positional
  if (!name) {
    return getLocalizedText({
      zh: '用法: /lsp stop <name>',
      en: 'Usage: /lsp stop <name>',
    })
  }
  const result = await stopLspServer(name)
  if (result.ok === true) {
    const ok = result as ControlOk
    return `stopped ${ok.name}: state=${ok.state}`
  }
  const fail = result as ControlFail
  return [
    `stop failed: ${fail.name}`,
    `reason: ${fail.reason}`,
    fail.detail ? `detail: ${fail.detail}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatDiagnostics(parsed: ParsedArgs): string {
  const pending = getPendingLSPDiagnosticCount()
  const [, filePath] = parsed.positional
  const requestedUri = typeof filePath === 'string' && filePath.length > 0
    ? pathToFileURL(resolve(filePath)).href
    : undefined
  const pendingEntries = peekPendingLSPDiagnostics({ fileUri: requestedUri })
  const lines: string[] = [
    getLocalizedText({
      zh: 'LSP 诊断队列',
      en: 'LSP diagnostics queue',
    }),
    `pending: ${pending}`,
  ]
  if (typeof filePath === 'string' && filePath.length > 0) {
    lines.push(`requested file: ${filePath}`)
    lines.push(`requested uri:  ${requestedUri}`)
  } else {
    lines.push(getLocalizedText({
      zh: '说明: 该计数来自 LSPDiagnosticRegistry，是 LSP 服务器异步推送的待派发数量；正常会很快被消化。',
      en: 'Note: count comes from LSPDiagnosticRegistry — pending publishDiagnostics waiting for delivery; usually drains quickly.',
    }))
  }

  if (pendingEntries.length === 0) {
    lines.push('')
    lines.push(getLocalizedText({
      zh: requestedUri
        ? '没有该文件的待处理 LSP 诊断。可运行 /lsp probe <file> 触发一次真实 LSP 检查。'
        : '没有待处理 LSP 诊断。可运行 /lsp probe <file> 触发一次真实 LSP 检查。',
      en: requestedUri
        ? 'No pending LSP diagnostics for this file. Run /lsp probe <file> to trigger a real LSP check.'
        : 'No pending LSP diagnostics. Run /lsp probe <file> to trigger a real LSP check.',
    }))
    return lines.join('\n')
  }

  lines.push('')
  lines.push(getLocalizedText({ zh: '待处理诊断:', en: 'pending diagnostics:' }))
  for (const entry of pendingEntries) {
    lines.push(`server: ${entry.serverName}`)
    for (const file of entry.files) {
      lines.push(...formatDiagnosticFile(file))
    }
  }
  return lines.join('\n')
}

function formatDiagnosticFile(file: DiagnosticFile): string[] {
  const lines: string[] = []
  lines.push(`  file: ${file.uri}`)
  for (const diag of file.diagnostics.slice(0, 10)) {
    const start = diag.range?.start
    const line = typeof start?.line === 'number' ? start.line + 1 : '?'
    const character = typeof start?.character === 'number' ? start.character + 1 : '?'
    const source = diag.source ? ` source=${diag.source}` : ''
    const code = diag.code ? ` code=${diag.code}` : ''
    lines.push(`    [${diag.severity}] ${line}:${character}${source}${code} — ${diag.message}`)
  }
  if (file.diagnostics.length > 10) {
    lines.push(`    ... ${file.diagnostics.length - 10} more diagnostic(s) omitted`)
  }
  return lines
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<null> {
  const trimmed = (args ?? '').trim()
  const lowered = trimmed.toLowerCase()

  if (!trimmed || lowered === 'help' || lowered === '--help' || lowered === '-h') {
    onDone(formatHelp(), { display: 'system' })
    return null
  }

  if (lowered === 'status') {
    onDone(formatStatus(await collectLspStatus()), { display: 'system' })
    return null
  }

  if (lowered === 'doctor') {
    onDone(formatDoctor(await collectLspDoctor()), { display: 'system' })
    return null
  }

  if (lowered === 'templates' || lowered === 'template') {
    onDone(formatTemplates(await collectLspStatus()), { display: 'system' })
    return null
  }

  if (lowered === 'tool status' || lowered === 'tool') {
    const report = await collectLspStatus()
    onDone(formatToolStatus(report).join('\n'), { display: 'system' })
    return null
  }

  if (lowered === 'enable') {
    const status = setLspToolEnabled(true)
    onDone(
      [
        getLocalizedText({
          zh: 'LSP 只读工具已启用。',
          en: 'Read-only LSP tool enabled.',
        }),
        `configured: ${formatBool(status.configured)}`,
        `env ENABLE_LSP_TOOL: ${formatBool(status.envEnabled)}`,
        getLocalizedText({
          zh: '下一步: 运行 /lsp status 或 /lsp doctor；若当前模型仍看不到 LSP 工具，请重启 Mossen。',
          en: 'Next: run /lsp status or /lsp doctor; restart Mossen if the current model still cannot see the LSP tool.',
        }),
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  if (lowered === 'disable') {
    const before = getLspToolEnablement()
    const status = setLspToolEnabled(false)
    const lines = [
      getLocalizedText({
        zh: 'LSP 持久工具开关已关闭。',
        en: 'Persistent LSP tool switch disabled.',
      }),
      `configured: ${formatBool(status.configured)}`,
      `env ENABLE_LSP_TOOL: ${formatBool(status.envEnabled)}`,
    ]
    if (before.envEnabled || status.envEnabled) {
      lines.push(
        getLocalizedText({
          zh: '注意: ENABLE_LSP_TOOL 环境变量仍会强制启用工具；请取消该环境变量后重启。',
          en: 'Note: ENABLE_LSP_TOOL still forces the tool on; unset it and restart to fully disable.',
        }),
      )
    }
    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // Sub-commands with positional args from here on.
  const parsed = parseArgs(trimmed)
  const head = (parsed.positional[0] ?? '').toLowerCase()

  if (head === 'init') {
    onDone(await handleInit(parsed), { display: 'system' })
    return null
  }

  if (head === 'servers' || head === 'list') {
    onDone(formatServersList(), { display: 'system' })
    return null
  }

  if (head === 'probe') {
    onDone(await handleProbe(parsed), { display: 'system' })
    return null
  }

  if (head === 'install') {
    onDone(await handleInstall(parsed), { display: 'system' })
    return null
  }

  if (head === 'restart') {
    onDone(await handleRestart(parsed), { display: 'system' })
    return null
  }

  if (head === 'stop') {
    onDone(await handleStop(parsed), { display: 'system' })
    return null
  }

  if (head === 'diagnostics' || head === 'diag') {
    onDone(formatDiagnostics(parsed), { display: 'system' })
    return null
  }

  onDone(formatHelp(), { display: 'system' })
  return null
}
