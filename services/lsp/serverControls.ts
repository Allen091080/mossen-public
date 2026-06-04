/**
 * services/lsp/serverControls.ts
 *
 * Read-only-ish wrappers around the LSP server manager singleton, exposing a
 * narrow control surface for daily-coding closure (W123):
 *   - listLspServers()    — enumerate configured/running servers
 *   - stopLspServer()     — idempotent stop by name
 *   - restartLspServer()  — restart by name (start when stopped/error)
 *   - probeLspServer()    — non-destructive end-to-end smoke for a given file
 *
 * All functions operate on the singleton returned by getLspServerManager().
 * They never throw across the public boundary; failures surface as structured
 * result objects so callers (slash command, protocol layer) can render them.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { Dirent } from 'fs'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { isBinaryInstalled } from '../../utils/binaryCheck.js'
import { errorMessage } from '../../utils/errors.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { getPendingLSPDiagnosticCount } from './LSPDiagnosticRegistry.js'
import type { LSPServerInstance } from './LSPServerInstance.js'
import { getLspServerManager } from './manager.js'

export type LspServerListEntry = {
  name: string
  command: string
  source: string
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'not-started'
  healthy: boolean
  pid: number | null
  lastError: string | null
  startedAt: string | null
  restartCount: number
}

export type LspServerControlResult =
  | { ok: true; name: string; state: string }
  | {
      ok: false
      name: string
      reason:
        | 'manager-not-initialized'
        | 'server-not-found'
        | 'not-running'
        | 'stop-failed'
        | 'start-failed'
      detail?: string
    }

export type LspProbeStepName =
  | 'manager-ready'
  | 'server-resolved'
  | 'server-started'
  | 'didOpen'
  | 'documentSymbol'
  | 'hover'
  | 'shutdown'

export type LspProbeStep = {
  name: LspProbeStepName
  status: 'ok' | 'skip' | 'error'
  durationMs: number
  detail?: string
}

export type LspProbeResult = {
  ok: boolean
  serverName: string | null
  /** Config source the matched server came from (e.g. `project:/.../lsp.json`). */
  serverSource: string | null
  /** Server command resolved by the manager. */
  serverCommand: string | null
  /** Server args resolved by the manager. */
  serverArgs: string[]
  /** Whether the server's binary was found on PATH at probe time. */
  binaryInstalled: boolean
  /** Whether the probed file exists before didOpen. */
  fileExists: boolean
  /** Nearby same-basename candidates when the requested file is missing. */
  suggestedFiles: string[]
  filePath: string
  steps: LspProbeStep[]
  /** Count of returned documentSymbol items (top level only; null on skip). */
  documentSymbolCount: number | null
  /** Cumulative count of pending publishDiagnostics observed at probe end. */
  diagnosticsCount: number
  totalMs: number
  error: string | null
  /** Operator-friendly suggestions surfaced when the probe was not fully ok. */
  recommendedActions: string[]
}

/**
 * Read-only listing of all configured/running LSP servers. Never throws.
 */
export function listLspServers(): LspServerListEntry[] {
  const manager = getLspServerManager()
  if (!manager) {
    return []
  }

  const entries: LspServerListEntry[] = []
  let servers: Map<string, LSPServerInstance>
  try {
    servers = manager.getAllServers()
  } catch {
    return []
  }

  for (const [name, instance] of servers.entries()) {
    // W146.2 P2-10: pre-W146.2 every getter was wrapped in its own try
    // even though `instance.state`, `instance.config?.command`,
    // `instance.startTime` etc. are simple field accesses that do not
    // throw. The only call that can realistically throw is
    // `instance.isHealthy()`, which we still guard. Everything else
    // uses `??` fallbacks and trusts the type signature.
    let healthy = false
    try {
      healthy = instance.isHealthy()
    } catch {
      healthy = false
    }
    const startTime = instance.startTime
    entries.push({
      name,
      command: instance.config?.command ?? '',
      source: instance.config?.source ?? '',
      state: instance.state ?? 'not-started',
      healthy,
      // LSPServerInstance does not expose a public pid getter — keep null
      // rather than reaching into private fields and breaking encapsulation.
      pid: null,
      lastError: instance.lastError ? instance.lastError.message : null,
      startedAt: startTime ? startTime.toISOString() : null,
      restartCount: instance.restartCount ?? 0,
    })
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return entries
}

/**
 * Stop a server by name. Idempotent — already-stopped servers return ok:true.
 */
export async function stopLspServer(
  name: string,
): Promise<LspServerControlResult> {
  const manager = getLspServerManager()
  if (!manager) {
    return { ok: false, name, reason: 'manager-not-initialized' }
  }

  const server = manager.getAllServers().get(name)
  if (!server) {
    return { ok: false, name, reason: 'server-not-found' }
  }

  if (server.state === 'stopped') {
    return { ok: true, name, state: 'stopped' }
  }

  try {
    await server.stop()
  } catch (err) {
    return {
      ok: false,
      name,
      reason: 'stop-failed',
      detail: errorMessage(err),
    }
  }

  return { ok: true, name, state: server.state }
}

/**
 * Restart a server by name. start() when stopped/error, restart() otherwise.
 */
export async function restartLspServer(
  name: string,
): Promise<LspServerControlResult> {
  const manager = getLspServerManager()
  if (!manager) {
    return { ok: false, name, reason: 'manager-not-initialized' }
  }

  const server = manager.getAllServers().get(name)
  if (!server) {
    return { ok: false, name, reason: 'server-not-found' }
  }

  try {
    if (server.state === 'stopped' || server.state === 'error') {
      await server.start()
    } else {
      await server.restart()
    }
  } catch (err) {
    return {
      ok: false,
      name,
      reason: 'start-failed',
      detail: errorMessage(err),
    }
  }

  return { ok: true, name, state: server.state }
}

/**
 * Probe end-to-end: ensureStarted, didOpen, documentSymbol, hover.
 *
 * Non-destructive: leaves the server running. documentSymbol/hover are best-
 * effort and degrade to `skip` on servers that don't implement them.
 */
export async function probeLspServer(input: {
  filePath: string
  cwd?: string
}): Promise<LspProbeResult> {
  const baseCwd = input.cwd ?? safeGetOriginalCwd()
  const absoluteFilePath = path.resolve(baseCwd, input.filePath)

  const steps: LspProbeStep[] = []
  const probeStart = Date.now()

  let serverName: string | null = null
  let serverSource: string | null = null
  let serverCommand: string | null = null
  let serverArgs: string[] = []
  let binaryInstalled = false
  let fileExists = false
  let suggestedFiles: string[] = []
  let documentSymbolCount: number | null = null
  let firstErrorMessage: string | null = null

  const recordError = (msg: string) => {
    if (!firstErrorMessage) firstErrorMessage = msg
  }

  const buildResult = (
    args: { ok: boolean; error: string | null },
  ): LspProbeResult => {
    return finalize({
      ok: args.ok,
      serverName,
      serverSource,
      serverCommand,
      serverArgs,
      binaryInstalled,
      fileExists,
      suggestedFiles,
      filePath: absoluteFilePath,
      steps,
      probeStart,
      error: args.error,
      documentSymbolCount,
    })
  }

  // 1. manager-ready
  const managerStart = Date.now()
  const manager = getLspServerManager()
  if (!manager) {
    steps.push({
      name: 'manager-ready',
      status: 'error',
      durationMs: Date.now() - managerStart,
      detail: 'LSP manager singleton not initialized',
    })
    recordError('LSP manager singleton not initialized')
    return buildResult({ ok: false, error: firstErrorMessage })
  }
  steps.push({
    name: 'manager-ready',
    status: 'ok',
    durationMs: Date.now() - managerStart,
  })

  // 2. server-resolved
  const resolveStart = Date.now()
  let resolved: ReturnType<NonNullable<typeof manager>['getServerForFile']> | undefined
  try {
    resolved = manager.getServerForFile(absoluteFilePath)
  } catch (err) {
    steps.push({
      name: 'server-resolved',
      status: 'error',
      durationMs: Date.now() - resolveStart,
      detail: errorMessage(err),
    })
    recordError(errorMessage(err))
    return buildResult({ ok: false, error: firstErrorMessage })
  }
  if (!resolved) {
    const ext = path.extname(absoluteFilePath) || '(no extension)'
    const detail = `no LSP server registered for extension ${ext}`
    steps.push({
      name: 'server-resolved',
      status: 'error',
      durationMs: Date.now() - resolveStart,
      detail,
    })
    recordError(detail)
    return buildResult({ ok: false, error: firstErrorMessage })
  }
  serverName = resolved.name
  serverSource = resolved.config.source
  serverCommand = resolved.config.command
  serverArgs = resolved.config.args ?? []
  try {
    binaryInstalled = await isBinaryInstalled(serverCommand)
  } catch {
    binaryInstalled = false
  }
  steps.push({
    name: 'server-resolved',
    status: 'ok',
    durationMs: Date.now() - resolveStart,
    detail: serverName,
  })

  // W133: fail fast on path typos before launching a language server.
  // The common dogfood case was `/mian/index.ts` vs `/main/index.ts`;
  // starting tsserver just to discover ENOENT made the UX feel "stuck".
  fileExists = await fileReadable(absoluteFilePath)
  if (!fileExists) {
    suggestedFiles = await findNearbyFiles(absoluteFilePath, baseCwd)
    const msg = `ENOENT: no such file or directory, open '${absoluteFilePath}'`
    steps.push({
      name: 'server-started',
      status: 'skip',
      durationMs: 0,
      detail: 'file missing; server not started',
    })
    steps.push({
      name: 'didOpen',
      status: 'error',
      durationMs: 0,
      detail: msg,
    })
    recordError(msg)
    return buildResult({ ok: false, error: firstErrorMessage })
  }

  // 3. server-started
  const startStart = Date.now()
  try {
    await manager.ensureServerStarted(absoluteFilePath)
  } catch (err) {
    steps.push({
      name: 'server-started',
      status: 'error',
      durationMs: Date.now() - startStart,
      detail: errorMessage(err),
    })
    recordError(errorMessage(err))
    return buildResult({ ok: false, error: firstErrorMessage })
  }
  steps.push({
    name: 'server-started',
    status: 'ok',
    durationMs: Date.now() - startStart,
  })

  // 4. didOpen
  const didOpenStart = Date.now()
  try {
    const content = await fs.readFile(absoluteFilePath, 'utf8')
    await manager.openFile(absoluteFilePath, content)
    steps.push({
      name: 'didOpen',
      status: 'ok',
      durationMs: Date.now() - didOpenStart,
    })
  } catch (err) {
    const msg = errorMessage(err)
    steps.push({
      name: 'didOpen',
      status: 'error',
      durationMs: Date.now() - didOpenStart,
      detail: msg,
    })
    recordError(msg)
    return buildResult({ ok: false, error: firstErrorMessage })
  }

  const uri = pathToFileURL(absoluteFilePath).href

  // 5. documentSymbol — best-effort; servers without support → skip
  const symStart = Date.now()
  try {
    const symResult = await manager.sendRequest(
      absoluteFilePath,
      'textDocument/documentSymbol',
      { textDocument: { uri } },
    )
    if (symResult === undefined || symResult === null) {
      documentSymbolCount = 0
      steps.push({
        name: 'documentSymbol',
        status: 'skip',
        durationMs: Date.now() - symStart,
        detail: 'server returned no result',
      })
    } else {
      const count = Array.isArray(symResult) ? symResult.length : 0
      documentSymbolCount = count
      steps.push({
        name: 'documentSymbol',
        status: 'ok',
        durationMs: Date.now() - symStart,
        detail: `${count} top-level symbol(s)`,
      })
    }
  } catch (err) {
    steps.push({
      name: 'documentSymbol',
      status: 'skip',
      durationMs: Date.now() - symStart,
      detail: errorMessage(err),
    })
  }

  // 6. hover — best-effort; servers without support → skip
  const hoverStart = Date.now()
  try {
    const hoverResult = await manager.sendRequest(
      absoluteFilePath,
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 0, character: 0 },
      },
    )
    if (hoverResult === undefined || hoverResult === null) {
      steps.push({
        name: 'hover',
        status: 'skip',
        durationMs: Date.now() - hoverStart,
        detail: 'server returned no result',
      })
    } else {
      steps.push({
        name: 'hover',
        status: 'ok',
        durationMs: Date.now() - hoverStart,
      })
    }
  } catch (err) {
    steps.push({
      name: 'hover',
      status: 'skip',
      durationMs: Date.now() - hoverStart,
      detail: errorMessage(err),
    })
  }

  // 7. shutdown — intentionally not stopping; probe is non-destructive.
  steps.push({
    name: 'shutdown',
    status: 'skip',
    durationMs: 0,
    detail: 'probe leaves server running',
  })

  return buildResult({ ok: true, error: null })
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function safeGetOriginalCwd(): string {
  try {
    return getOriginalCwd()
  } catch {
    return process.cwd()
  }
}

async function fileReadable(filePath: string): Promise<boolean> {
  try {
    const info = await fs.stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

async function findNearbyFiles(
  missingPath: string,
  cwd: string,
): Promise<string[]> {
  const targetBase = path.basename(missingPath).toLowerCase()
  if (!targetBase) return []
  const nearest = await nearestExistingDir(path.dirname(missingPath), cwd)
  if (!nearest) return []
  const candidates: string[] = []
  await collectSameBasenameFiles({
    dir: nearest,
    targetBase,
    out: candidates,
    depth: 0,
    maxDepth: 5,
    maxFiles: 2000,
  })
  return candidates
    .sort((a, b) => {
      const aScore = pathDistanceScore(missingPath, a)
      const bScore = pathDistanceScore(missingPath, b)
      if (aScore !== bScore) return aScore - bScore
      return a.length - b.length
    })
    .slice(0, 5)
}

async function nearestExistingDir(
  startDir: string,
  cwd: string,
): Promise<string | null> {
  let current = path.resolve(startDir)
  const stop = path.parse(path.resolve(cwd)).root
  for (let i = 0; i < 12; i += 1) {
    try {
      const info = await fs.stat(current)
      if (info.isDirectory()) return current
    } catch {
      // keep walking upward
    }
    const parent = path.dirname(current)
    if (parent === current || current === stop) break
    current = parent
  }
  return null
}

async function collectSameBasenameFiles(args: {
  dir: string
  targetBase: string
  out: string[]
  depth: number
  maxDepth: number
  maxFiles: number
}): Promise<void> {
  if (args.depth > args.maxDepth || args.out.length >= args.maxFiles) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(args.dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (args.out.length >= args.maxFiles) return
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') {
      continue
    }
    const full = path.join(args.dir, entry.name)
    if (entry.isFile()) {
      if (entry.name.toLowerCase() === args.targetBase) args.out.push(full)
    } else if (entry.isDirectory()) {
      await collectSameBasenameFiles({
        ...args,
        dir: full,
        depth: args.depth + 1,
      })
    }
  }
}

function pathDistanceScore(a: string, b: string): number {
  const left = a.split(path.sep)
  const right = b.split(path.sep)
  let common = 0
  while (common < left.length && common < right.length && left[common] === right[common]) {
    common += 1
  }
  return (left.length - common) + (right.length - common)
}

function finalize(args: {
  ok: boolean
  serverName: string | null
  serverSource: string | null
  serverCommand: string | null
  serverArgs: string[]
  binaryInstalled: boolean
  fileExists: boolean
  suggestedFiles: string[]
  filePath: string
  steps: LspProbeStep[]
  probeStart: number
  error: string | null
  documentSymbolCount: number | null
}): LspProbeResult {
  // ok=true requires manager-ready, server-resolved, server-started, didOpen
  // all to be 'ok'. documentSymbol/hover may be 'skip' without breaking ok.
  const required: LspProbeStepName[] = [
    'manager-ready',
    'server-resolved',
    'server-started',
    'didOpen',
  ]
  let ok = args.ok
  if (ok) {
    for (const reqName of required) {
      const step = args.steps.find(s => s.name === reqName)
      if (!step || step.status !== 'ok') {
        ok = false
        break
      }
    }
  }

  // Sum durations (round to integer) for totalMs. Fall back to wall clock
  // if the sum is implausibly small.
  const summed = args.steps.reduce(
    (acc, s) => acc + Math.max(0, Math.round(s.durationMs)),
    0,
  )
  const wall = Math.max(0, Math.round(Date.now() - args.probeStart))
  const totalMs = summed > 0 ? summed : wall

  let error = args.error
  if (!ok && !error) {
    const firstNonSkipError = args.steps.find(s => s.status === 'error')
    error = firstNonSkipError?.detail ?? 'probe failed'
  }
  if (ok) error = null

  // Round per-step durationMs to int for stable wire output.
  const steps = args.steps.map(s => ({
    ...s,
    durationMs: Math.max(0, Math.round(s.durationMs)),
  }))

  // Synthesize operator-friendly suggestions. Stable order: missing-binary →
  // server-resolved-error → start/didOpen failures → success-but-empty.
  const recommendedActions: string[] = []
  const serverResolved = args.steps.find(s => s.name === 'server-resolved')
  const startStep = args.steps.find(s => s.name === 'server-started')
  const didOpenStep = args.steps.find(s => s.name === 'didOpen')
  const symStep = args.steps.find(s => s.name === 'documentSymbol')

  // W146.2 P2-13: each recommended action now goes through getLocalizedText
  // so zh users see Chinese guidance instead of raw English. Keep the
  // English copy verbatim (smoke contracts pin specific phrases like
  // "no LSP server registered"). Surface symbol/server names as plain
  // interpolations so they stay identical across locales.
  if (
    serverResolved?.status === 'error' &&
    typeof serverResolved.detail === 'string' &&
    serverResolved.detail.startsWith('no LSP server registered')
  ) {
    recommendedActions.push(getLocalizedText({
      en: 'Run /lsp templates for example configs and /lsp init <typescript|rust> --scope project to seed a project lsp.json for this file extension.',
      zh: '运行 /lsp templates 查看示例配置，再用 /lsp init <typescript|rust> --scope project 为该扩展名播种项目 lsp.json。',
    }))
  }
  if (args.serverName && !args.binaryInstalled) {
    recommendedActions.push(getLocalizedText({
      en: `Server '${args.serverName}' command '${args.serverCommand}' is not on PATH — install per /lsp templates installHint, then /reload-plugins (for plugin scope) or rerun the probe.`,
      zh: `服务器 '${args.serverName}' 的命令 '${args.serverCommand}' 不在 PATH 上 — 按 /lsp templates 的 installHint 安装，再 /reload-plugins (插件域) 或重跑 probe。`,
    }))
  }
  if (startStep?.status === 'error') {
    recommendedActions.push(getLocalizedText({
      en: `/lsp restart ${args.serverName ?? '<name>'} after addressing the install/binary issue, or /lsp stop ${args.serverName ?? '<name>'} to drop the failed instance.`,
      zh: `先解决安装/二进制问题，再 /lsp restart ${args.serverName ?? '<name>'}；或者 /lsp stop ${args.serverName ?? '<name>'} 丢弃失败实例。`,
    }))
  }
  if (didOpenStep?.status === 'error') {
    if (!args.fileExists) {
      const suffix = args.suggestedFiles.length > 0
        ? ` Did you mean: ${args.suggestedFiles.slice(0, 5).join(', ')}`
        : ''
      const zhSuffix = args.suggestedFiles.length > 0
        ? ` 是否要打开: ${args.suggestedFiles.slice(0, 5).join(', ')}`
        : ''
      recommendedActions.push(getLocalizedText({
        en: `File does not exist. Check path spelling/case and rerun /lsp probe with an existing file.${suffix}`,
        zh: `文件不存在。检查拼写/大小写后用一个真实文件重新 /lsp probe。${zhSuffix}`,
      }))
    }
    recommendedActions.push(getLocalizedText({
      en: 'Check the file is readable (size, permissions) and that the LSP server supports the document language; rerun probe.',
      zh: '确认文件可读 (大小、权限)，且 LSP server 支持该语言后重跑 probe。',
    }))
  }
  if (
    ok &&
    symStep?.status === 'ok' &&
    typeof args.documentSymbolCount === 'number' &&
    args.documentSymbolCount === 0
  ) {
    recommendedActions.push(getLocalizedText({
      en: 'documentSymbol returned 0 items — probe used the file you supplied; pick a file with declarations to validate richer responses.',
      zh: 'documentSymbol 返回 0 项 — probe 用了你提供的文件；选一个含声明的文件来验证更丰富的响应。',
    }))
  }

  let diagnosticsCount = 0
  try {
    diagnosticsCount = getPendingLSPDiagnosticCount()
  } catch {
    diagnosticsCount = 0
  }

  return {
    ok,
    serverName: args.serverName,
    serverSource: args.serverSource,
    serverCommand: args.serverCommand,
    serverArgs: args.serverArgs,
    binaryInstalled: args.binaryInstalled,
    fileExists: args.fileExists,
    suggestedFiles: args.suggestedFiles,
    filePath: args.filePath,
    steps,
    documentSymbolCount: args.documentSymbolCount,
    diagnosticsCount,
    totalMs,
    error,
    recommendedActions,
  }
}
