import { getOriginalCwd } from '../../bootstrap/state.js'
import { redactErrorMessage } from '../../memory-sidecar/src/redaction/redactPaths.js'
import { isBinaryInstalled } from '../../utils/binaryCheck.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { getAllLspServers, type LspConfigLoadStats } from './config.js'
import { getPendingLSPDiagnosticCount } from './LSPDiagnosticRegistry.js'
import {
  getInitializationStatus,
  getLspServerManager,
} from './manager.js'
import {
  getLspToolEnablement,
  type LspToolEnablement,
} from './settings.js'
import type { LspServerState, ScopedLspServerConfig } from './types.js'
import {
  getProjectLspConfigPath,
  getUserLspConfigPath,
  loadProjectLspConfig,
  loadUserLspConfig,
  type LspConfigLoadResult,
} from './userProjectConfig.js'

export type LspTemplate = {
  id: 'typescript' | 'rust'
  label: string
  command: string
  installHint: string
  lspServers: Record<string, ScopedLspServerConfig>
}

export type LspServerStatus = {
  name: string
  source: string
  command: string
  args: string[]
  extensions: string[]
  binaryInstalled: boolean
  state: LspServerState | 'not-started'
  healthy: boolean
  lastError?: string
  // W154-A: per-server lifecycle counters surfaced to /lsp doctor.
  // restartCount comes from LSPServerInstance.restartCount;
  // openDocuments is computed by the manager via getOpenDocumentCountByServer.
  restartCount: number
  openDocuments: number
}

export type LspBinaryProbe = {
  command: string
  /** True if the version probe exited 0 with non-empty output. */
  ok: boolean
  /** Truncated --version output (max 240 chars), or '' on failure. */
  version: string
  /** Truncated stderr / failure reason (max 240 chars). */
  detail: string
  /** True if the probe ran past its timeout (default 2500ms). */
  timedOut: boolean
}

export type LspStatusReport = {
  initialization: ReturnType<typeof getInitializationStatus>
  bareMode: boolean
  tool: LspToolEnablement
  configuredServerCount: number
  runningServerCount: number
  servers: LspServerStatus[]
  templates: Array<LspTemplate & { binaryInstalled: boolean }>
  /** Per-source counts and override information from config.ts. */
  loadStats: LspConfigLoadStats
  /** User-scope config file load result. */
  userConfig: LspConfigLoadResult
  /** Project-scope config file load result. */
  projectConfig: LspConfigLoadResult
  /** Pending LSP publishDiagnostics count from the registry. */
  pendingDiagnostics: number
  /** Original cwd from getOriginalCwd(). */
  workspaceCwd: string
  /** Per-command --version probe results (deduped by command). */
  binaryProbes: LspBinaryProbe[]
  errors: string[]
}

export type LspDoctorCheck = {
  id: string
  status: 'ok' | 'warn' | 'error'
  message: string
}

export type LspDoctorReport = LspStatusReport & {
  checks: LspDoctorCheck[]
  overall: 'ok' | 'warn' | 'error'
}

export const LSP_TEMPLATES: LspTemplate[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    command: 'typescript-language-server',
    installHint:
      'Global: npm install -g typescript typescript-language-server. Project: npm install -D typescript typescript-language-server.',
    lspServers: {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: {
          '.ts': 'typescript',
          '.tsx': 'typescriptreact',
          '.js': 'javascript',
          '.jsx': 'javascriptreact',
        },
        rootPatterns: ['package.json', 'tsconfig.json', 'jsconfig.json', '.git'],
        scope: 'dynamic',
        source: 'lsp-template:typescript',
      },
    },
  },
  {
    id: 'rust',
    label: 'Rust',
    command: 'rust-analyzer',
    installHint:
      'Run: rustup component add rust-analyzer. If rustup is not installed, install Rust toolchain from https://rustup.rs first.',
    lspServers: {
      rust: {
        command: 'rust-analyzer',
        args: [],
        extensionToLanguage: {
          '.rs': 'rust',
        },
        rootPatterns: ['Cargo.toml', '.git'],
        scope: 'dynamic',
        source: 'lsp-template:rust',
      },
    },
  },
]

const EMPTY_LOAD_STATS: LspConfigLoadStats = {
  pluginCount: 0,
  userCount: 0,
  projectCount: 0,
  overriddenByUser: [],
  overriddenByProject: [],
  errors: [],
}

const BINARY_PROBE_TIMEOUT_MS = 2500
const BINARY_PROBE_OUTPUT_CAP = 240

function truncate(value: string, cap: number = BINARY_PROBE_OUTPUT_CAP): string {
  const cleaned = value.replace(/\s+$/, '')
  if (cleaned.length <= cap) return cleaned
  return cleaned.slice(0, cap) + '…'
}

/**
 * Probe `<command> --version` with a hard timeout. Returns an
 * `LspBinaryProbe` describing the outcome — never throws. Used by
 * `/lsp doctor` to surface a fast indicator without launching a real
 * LSP session.
 */
async function probeBinaryVersion(command: string): Promise<LspBinaryProbe> {
  const proc = Bun.spawn([command, '--version'], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill('SIGKILL')
    } catch {
      // already exited
    }
  }, BINARY_PROBE_TIMEOUT_MS)

  let stdout = ''
  let stderr = ''
  try {
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    stdout = stdoutText
    stderr = stderrText
    clearTimeout(timer)
    if (timedOut) {
      return {
        command,
        ok: false,
        version: '',
        detail: 'version probe exceeded 2500ms timeout',
        timedOut: true,
      }
    }
    if (exitCode === 0 && stdout.trim().length > 0) {
      return {
        command,
        ok: true,
        version: truncate(stdout.trim()),
        detail: '',
        timedOut: false,
      }
    }
    return {
      command,
      ok: false,
      version: truncate(stdout.trim()),
      detail: truncate(stderr.trim() || `exit code ${exitCode}`),
      timedOut: false,
    }
  } catch (e) {
    clearTimeout(timer)
    return {
      command,
      ok: false,
      version: '',
      detail: truncate(errorMessage(e)),
      timedOut,
    }
  }
}

export async function collectLspStatus(): Promise<LspStatusReport> {
  const errors: string[] = []
  const initialization = getInitializationStatus()
  const tool = getLspToolEnablement()
  const manager = getLspServerManager()
  const instances = manager?.getAllServers() ?? new Map()

  let configs: Record<string, ScopedLspServerConfig> = {}
  let loadStats: LspConfigLoadStats = EMPTY_LOAD_STATS
  try {
    const result = await getAllLspServers()
    configs = result.servers
    loadStats = result.stats
    if (result.stats.errors.length > 0) {
      errors.push(...result.stats.errors)
    }
  } catch (error) {
    errors.push(`Failed to load LSP server configs: ${errorMessage(error)}`)
  }

  const servers: LspServerStatus[] = []
  for (const [name, config] of Object.entries(configs)) {
    const instance = instances.get(name)
    const binaryInstalled = await isBinaryInstalled(config.command)
    const rawLastError = instance?.lastError?.message
    servers.push({
      name,
      source: config.source,
      command: config.command,
      args: config.args ?? [],
      extensions: Object.keys(config.extensionToLanguage).sort(),
      binaryInstalled,
      state: instance?.state ?? 'not-started',
      healthy: instance?.isHealthy() ?? false,
      // W154-A: redact path / token shapes from server error messages
      // before they reach /lsp doctor. LSP servers sometimes embed the
      // user's project path or transient creds in spawn-failure errors.
      lastError: rawLastError ? redactErrorMessage(rawLastError) : undefined,
      // W154-A: lifecycle counters.
      restartCount: instance?.restartCount ?? 0,
      openDocuments: manager?.getOpenDocumentCountByServer(name) ?? 0,
    })
  }

  const templates = await Promise.all(
    LSP_TEMPLATES.map(async template => ({
      ...template,
      binaryInstalled: await isBinaryInstalled(template.command),
    })),
  )

  const userConfig = await loadUserLspConfig().catch((e): LspConfigLoadResult => ({
    servers: {},
    path: getUserLspConfigPath(),
    loaded: false,
    error: errorMessage(e),
  }))
  const projectConfig = await loadProjectLspConfig().catch(
    (e): LspConfigLoadResult => ({
      servers: {},
      path: getProjectLspConfigPath(),
      loaded: false,
      error: errorMessage(e),
    }),
  )

  let workspaceCwd = ''
  try {
    workspaceCwd = getOriginalCwd()
  } catch (e) {
    errors.push(`workspace cwd: ${errorMessage(e)}`)
  }

  // Probe --version on every unique configured-server command + every
  // template command, but only when the binary is actually on PATH.
  // Skipping missing binaries avoids spawning processes that will fail
  // immediately and avoids paying a setTimeout per server.
  const probeCommands = new Set<string>()
  for (const s of servers) {
    if (s.binaryInstalled) probeCommands.add(s.command)
  }
  for (const t of templates) {
    if (t.binaryInstalled) probeCommands.add(t.command)
  }
  const binaryProbes = await Promise.all(
    Array.from(probeCommands).map(cmd => probeBinaryVersion(cmd)),
  )

  return {
    initialization,
    bareMode: isBareMode(),
    tool,
    configuredServerCount: servers.length,
    runningServerCount: servers.filter(s => s.state === 'running').length,
    servers,
    templates,
    loadStats,
    userConfig,
    projectConfig,
    pendingDiagnostics: getPendingLSPDiagnosticCount(),
    workspaceCwd,
    binaryProbes,
    errors,
  }
}

export async function collectLspDoctor(): Promise<LspDoctorReport> {
  const report = await collectLspStatus()
  const checks: LspDoctorCheck[] = []

  checks.push({
    id: 'bare-mode',
    status: report.bareMode ? 'warn' : 'ok',
    message: report.bareMode
      ? '--bare / simple mode is active; LSP is intentionally skipped.'
      : 'Runtime is not in --bare mode.',
  })

  checks.push({
    id: 'tool-enabled',
    status: report.tool.effective ? 'ok' : 'warn',
    message: report.tool.effective
      ? 'LSP tool exposure is enabled.'
      : 'LSP tool exposure is disabled. Run /lsp enable to expose the read-only LSP tool.',
  })

  checks.push({
    id: 'manager',
    status:
      report.initialization.status === 'failed'
        ? 'error'
        : report.initialization.status === 'success'
          ? 'ok'
          : 'warn',
    message:
      report.initialization.status === 'failed'
        ? `LSP manager failed: ${report.initialization.error.message}`
        : `LSP manager status: ${report.initialization.status}.`,
  })

  checks.push({
    id: 'plugin-servers',
    status: report.configuredServerCount > 0 ? 'ok' : 'warn',
    message:
      report.configuredServerCount > 0
        ? `${report.configuredServerCount} plugin LSP server config(s) loaded.`
        : 'No plugin LSP server configs found. Use /lsp templates for TypeScript/Rust examples.',
  })

  const missingConfigured = report.servers.filter(s => !s.binaryInstalled)
  checks.push({
    id: 'configured-binaries',
    status: missingConfigured.length === 0 ? 'ok' : 'warn',
    message:
      missingConfigured.length === 0
        ? 'All configured LSP server binaries are available.'
        : `Missing configured LSP binaries: ${missingConfigured.map(s => s.command).join(', ')}.`,
  })

  const availableTemplates = report.templates.filter(t => t.binaryInstalled)
  checks.push({
    id: 'template-binaries',
    status: availableTemplates.length > 0 ? 'ok' : 'warn',
    message:
      availableTemplates.length > 0
        ? `Detected template-ready binaries: ${availableTemplates.map(t => t.command).join(', ')}.`
        : 'No TypeScript/Rust template binaries detected yet.',
  })

  // 7. user-config: load result for ~/.mossen/lsp/servers.json
  checks.push({
    id: 'user-config',
    status:
      report.userConfig.error !== null
        ? 'error'
        : report.userConfig.loaded
          ? 'ok'
          : 'warn',
    message:
      report.userConfig.error !== null
        ? `User LSP config error: ${report.userConfig.error}`
        : report.userConfig.loaded
          ? `User LSP config: ${Object.keys(report.userConfig.servers).length} server(s) at ${report.userConfig.path}.`
          : `No user LSP config at ${report.userConfig.path} (run /lsp init <template> --scope user to seed one).`,
  })

  // 8. project-config: load result for <cwd>/.mossen/lsp.json
  checks.push({
    id: 'project-config',
    status:
      report.projectConfig.error !== null
        ? 'error'
        : report.projectConfig.loaded
          ? 'ok'
          : 'warn',
    message:
      report.projectConfig.error !== null
        ? `Project LSP config error: ${report.projectConfig.error}`
        : report.projectConfig.loaded
          ? `Project LSP config: ${Object.keys(report.projectConfig.servers).length} server(s) at ${report.projectConfig.path}.`
          : `No project LSP config at ${report.projectConfig.path} (run /lsp init <template> to seed one).`,
  })

  // 9. config-precedence: information about overrides
  const overrideMsgs: string[] = []
  if (report.loadStats.overriddenByUser.length > 0) {
    overrideMsgs.push(
      `user overrode plugin: ${report.loadStats.overriddenByUser.join(', ')}`,
    )
  }
  if (report.loadStats.overriddenByProject.length > 0) {
    overrideMsgs.push(
      `project overrode plugin/user: ${report.loadStats.overriddenByProject.join(', ')}`,
    )
  }
  checks.push({
    id: 'config-precedence',
    status: 'ok',
    message:
      overrideMsgs.length > 0
        ? `Active precedence overrides — ${overrideMsgs.join('; ')}.`
        : `Counts: plugin=${report.loadStats.pluginCount}, user=${report.loadStats.userCount}, project=${report.loadStats.projectCount}; no overrides.`,
  })

  // 10. server-startable: lightweight per-server binary check (Q2 = option A).
  // Distinct from configured-binaries: this surfaces per-server detail and
  // explicitly signals the server cannot be started without doing it.
  const startable = report.servers.filter(s => s.binaryInstalled)
  const unstartable = report.servers.filter(s => !s.binaryInstalled)
  checks.push({
    id: 'server-startable',
    status:
      report.servers.length === 0
        ? 'warn'
        : unstartable.length === 0
          ? 'ok'
          : 'warn',
    message:
      report.servers.length === 0
        ? 'No configured servers to evaluate startability for.'
        : unstartable.length === 0
          ? `All ${startable.length} configured server(s) appear startable (binaries on PATH).`
          : `${unstartable.length} server(s) cannot start: ${unstartable.map(s => `${s.name}(${s.command})`).join(', ')}.`,
  })

  // 11. diagnostics-pending: LSP publishDiagnostics queue depth.
  checks.push({
    id: 'diagnostics-pending',
    status: 'ok',
    message: `Pending publishDiagnostics in registry: ${report.pendingDiagnostics}.`,
  })

  // 12. workspace-cwd: original project cwd resolves.
  checks.push({
    id: 'workspace-cwd',
    status: report.workspaceCwd ? 'ok' : 'error',
    message: report.workspaceCwd
      ? `Original cwd: ${report.workspaceCwd}.`
      : 'Original cwd is not resolvable.',
  })

  // 13. binary-version: aggregate per-command --version probe (W124).
  // Servers whose binary is not on PATH are surfaced by `configured-binaries`
  // / `server-startable` and intentionally skipped here. The doctor MUST NOT
  // launch a long LSP session — `/lsp probe` does that on demand.
  if (report.binaryProbes.length === 0) {
    checks.push({
      id: 'binary-version',
      status: 'warn',
      message:
        'No configured/template binaries available to probe. Install typescript-language-server (npm install -g typescript typescript-language-server) or rust-analyzer (rustup component add rust-analyzer).',
    })
  } else {
    const failed = report.binaryProbes.filter(p => !p.ok)
    const summarizeOk = (p: LspBinaryProbe) =>
      `${p.command} ${p.version || '(no version output)'}`
    const summarizeFail = (p: LspBinaryProbe) =>
      `${p.command} (${p.timedOut ? 'timeout' : 'failed'}: ${p.detail || 'no detail'})`
    if (failed.length === 0) {
      checks.push({
        id: 'binary-version',
        status: 'ok',
        message: `Version probe ok: ${report.binaryProbes.map(summarizeOk).join('; ')}.`,
      })
    } else {
      const okOnes = report.binaryProbes.filter(p => p.ok)
      checks.push({
        id: 'binary-version',
        status: 'warn',
        message: `Version probe issues: ${failed.map(summarizeFail).join('; ')}${okOnes.length > 0 ? `. Ok: ${okOnes.map(summarizeOk).join('; ')}` : ''}. Run /lsp probe <file> to investigate, or check installation hints in /lsp templates.`,
      })
    }
  }

  for (const message of report.errors) {
    checks.push({
      id: 'load-error',
      status: 'error',
      message,
    })
  }

  const overall = checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warn')
      ? 'warn'
      : 'ok'

  return {
    ...report,
    checks,
    overall,
  }
}

