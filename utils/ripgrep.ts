import type { ChildProcess, ExecFileException } from 'child_process'
import { execFile, spawn } from 'child_process'
import { constants, existsSync, accessSync } from 'fs'
import { opendir, readFile, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import * as path from 'path'
import picomatch from 'picomatch'
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js'
import { fileURLToPath } from 'url'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { findExecutable } from './findExecutable.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { countCharInString } from './stringUtils.js'

const __filename = fileURLToPath(import.meta.url)
// we use node:path.join instead of node:url.resolve because the former doesn't encode spaces
const __dirname = path.join(
  __filename,
  process.env.NODE_ENV === 'test' ? '../../../' : '../',
)

type RipgrepConfig = {
  mode: 'system' | 'builtin' | 'embedded'
  command: string
  args: string[]
  argv0?: string
}

export type RipgrepStatusMode = RipgrepConfig['mode'] | 'js-fallback'

type JavaScriptRipgrepOptions = {
  filesOnly: boolean
  filesWithMatches: boolean
  count: boolean
  lineNumbers: boolean
  caseInsensitive: boolean
  hidden: boolean
  pattern: string | null
  globs: string[]
  negativeGlobs: string[]
  typeFilter: string | null
}

const COMMON_POSIX_RIPGREP_PATHS = [
  '/opt/homebrew/bin/rg',
  '/usr/local/bin/rg',
  '/usr/bin/rg',
]

// JS fallback walks the tree synchronously inside the agent loop. Without a
// wall-clock fuse a stuck filesystem (network share, deep node_modules) hangs
// the entire Mossen turn indefinitely — symptom seen in W406. Bound the walk
// to 30s by default; configurable via env. Caller signals still take priority.
const JS_FALLBACK_DEFAULT_TIMEOUT_MS = 30_000

// Directory names that almost never contain user-relevant search hits but can
// blow up the walk by orders of magnitude. The JS fallback skips them
// regardless of `--hidden`; native rg already excludes most of them via its
// built-in ignore rules. Override-by-omission: explicit `--glob` that targets
// these names still matches because we only filter at directory descent time.
const JS_FALLBACK_DEFAULT_EXCLUDED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.idea',
  '.vscode-test',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.venv',
  'venv',
  'env',
  '.terraform',
  'vendor',
  'bower_components',
  '.yarn',
  '.pnpm-store',
])

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findSystemRipgrepCommand(): string | null {
  const { cmd: systemPath } = findExecutable('rg', [])
  if (systemPath !== 'rg') {
    // SECURITY: Use command name 'rg' instead of systemPath when PATH lookup
    // succeeded. This preserves the existing no-current-directory behavior.
    return 'rg'
  }

  if (process.platform !== 'win32') {
    // Electron/desktop launchers often provide a minimal PATH that omits
    // Homebrew even though rg is installed. Fall back to absolute, trusted
    // system install locations only after PATH lookup fails.
    const commonPath = COMMON_POSIX_RIPGREP_PATHS.find(isExecutableFile)
    if (commonPath) return commonPath
  }

  return null
}

function shouldUseJavaScriptRipgrepFallback(): boolean {
  if (process.env.MOSSEN_TEST_FORCE_JS_RIPGREP === '1') {
    return true
  }

  const config = getRipgrepConfig()
  return (
    !config.argv0 &&
    path.isAbsolute(config.command) &&
    !isExecutableFile(config.command)
  )
}

function parseJavaScriptRipgrepOptions(
  args: string[],
): JavaScriptRipgrepOptions {
  const options: JavaScriptRipgrepOptions = {
    filesOnly: false,
    filesWithMatches: false,
    count: false,
    lineNumbers: false,
    caseInsensitive: false,
    hidden: false,
    pattern: null,
    globs: [],
    negativeGlobs: [],
    typeFilter: null,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!

    if (arg === '--files') {
      options.filesOnly = true
      continue
    }
    if (arg === '-l') {
      options.filesWithMatches = true
      continue
    }
    if (arg === '-c') {
      options.count = true
      continue
    }
    if (arg === '-n') {
      options.lineNumbers = true
      continue
    }
    if (arg === '-i') {
      options.caseInsensitive = true
      continue
    }
    if (arg === '--hidden') {
      options.hidden = true
      continue
    }
    if (arg === '--glob') {
      const glob = args[++i]
      if (!glob) continue
      if (glob.startsWith('!')) {
        options.negativeGlobs.push(glob.slice(1))
      } else {
        options.globs.push(glob)
      }
      continue
    }
    if (arg === '--type') {
      options.typeFilter = args[++i] ?? null
      continue
    }
    if (arg === '-e') {
      options.pattern = args[++i] ?? ''
      continue
    }
    if (
      arg === '--max-columns' ||
      arg === '-A' ||
      arg === '-B' ||
      arg === '-C'
    ) {
      i++
      continue
    }
    if (
      arg === '--sort=modified' ||
      arg === '--no-ignore' ||
      arg === '-U' ||
      arg === '--multiline-dotall'
    ) {
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    if (options.pattern === null && !options.filesOnly) {
      options.pattern = arg
    }
  }

  return options
}

const TYPE_FILTER_EXTENSIONS: Record<string, string[]> = {
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  py: ['.py'],
  python: ['.py'],
  rs: ['.rs'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  json: ['.json', '.jsonc'],
  md: ['.md', '.mdx', '.markdown'],
  markdown: ['.md', '.mdx', '.markdown'],
  yml: ['.yml', '.yaml'],
  yaml: ['.yml', '.yaml'],
  toml: ['.toml'],
  css: ['.css', '.scss', '.sass', '.less'],
  html: ['.html', '.htm'],
  shell: ['.sh', '.bash', '.zsh'],
}

function createGlobMatcher(pattern: string): (relativePath: string) => boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/')
  const matcher = picomatch(normalizedPattern, {
    dot: true,
    matchBase: !normalizedPattern.includes('/'),
  })

  return relativePath => {
    const normalizedPath = relativePath.replace(/\\/g, '/')
    if (normalizedPath === normalizedPattern) return true
    if (normalizedPath.startsWith(`${normalizedPattern}/`)) return true
    return matcher(normalizedPath)
  }
}

function matchesJavaScriptRipgrepGlobs(
  relativePath: string,
  options: JavaScriptRipgrepOptions,
): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/')

  if (isExcludedByJavaScriptRipgrepGlob(normalizedPath, options)) {
    return false
  }

  if (options.globs.length === 0) {
    return true
  }

  return options.globs.some(pattern =>
    createGlobMatcher(pattern)(normalizedPath),
  )
}

function isExcludedByJavaScriptRipgrepGlob(
  relativePath: string,
  options: JavaScriptRipgrepOptions,
): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  return options.negativeGlobs.some(pattern =>
    createGlobMatcher(pattern)(normalizedPath),
  )
}

function matchesJavaScriptRipgrepType(
  filePath: string,
  typeFilter: string | null,
): boolean {
  if (!typeFilter) return true
  const extensions = TYPE_FILTER_EXTENSIONS[typeFilter]
  if (!extensions) return true
  return extensions.includes(path.extname(filePath))
}

function assertJavaScriptRipgrepNotAborted(abortSignal: AbortSignal): void {
  if (abortSignal.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError')
  }
}

function resolveJavaScriptRipgrepTimeoutMs(): number {
  const envSeconds = parseInt(
    process.env.MOSSEN_CODE_JS_RIPGREP_TIMEOUT_SECONDS || '',
    10,
  )
  if (envSeconds > 0) return envSeconds * 1000
  return JS_FALLBACK_DEFAULT_TIMEOUT_MS
}

function assertJavaScriptRipgrepDeadline(
  abortSignal: AbortSignal,
  deadlineEpochMs: number,
): void {
  assertJavaScriptRipgrepNotAborted(abortSignal)
  if (Date.now() > deadlineEpochMs) {
    throw new RipgrepTimeoutError(
      `JS ripgrep fallback exceeded ${(resolveJavaScriptRipgrepTimeoutMs() / 1000).toFixed(1)}s wall-clock budget. The fallback walks the filesystem unbounded; consider installing ripgrep, narrowing the search path, or setting MOSSEN_CODE_JS_RIPGREP_TIMEOUT_SECONDS=<seconds>.`,
      [],
    )
  }
}

function getErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

function shouldSkipJavaScriptRipgrepWalkError(error: unknown): boolean {
  const code = getErrorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

async function collectJavaScriptRipgrepFiles(
  target: string,
  options: JavaScriptRipgrepOptions,
  abortSignal: AbortSignal,
  deadlineEpochMs: number,
): Promise<string[]> {
  const root = path.resolve(target)
  const rootStat = await stat(root)
  const files: string[] = []

  async function walk(entryPath: string): Promise<void> {
    assertJavaScriptRipgrepDeadline(abortSignal, deadlineEpochMs)
    let entryStat: Awaited<ReturnType<typeof stat>>
    try {
      entryStat = await stat(entryPath)
    } catch (error) {
      if (shouldSkipJavaScriptRipgrepWalkError(error)) {
        return
      }
      throw error
    }

    if (entryStat.isFile()) {
      const relativePath = path.relative(root, entryPath) || path.basename(entryPath)
      if (
        matchesJavaScriptRipgrepGlobs(relativePath, options) &&
        matchesJavaScriptRipgrepType(entryPath, options.typeFilter)
      ) {
        files.push(entryPath)
      }
      return
    }

    if (!entryStat.isDirectory()) {
      return
    }

    let dir: Awaited<ReturnType<typeof opendir>>
    try {
      dir = await opendir(entryPath)
    } catch (error) {
      if (shouldSkipJavaScriptRipgrepWalkError(error)) {
        return
      }
      throw error
    }
    for await (const entry of dir) {
      assertJavaScriptRipgrepDeadline(abortSignal, deadlineEpochMs)
      if (!options.hidden && entry.name.startsWith('.')) {
        continue
      }
      // Always-skip heavy directories. The native rg ignores most of these
      // via gitignore + built-in defaults; the JS fallback has no such
      // luxury, so without this gate `Glob({pattern:'**/settings.json'})`
      // walks every node_modules tree in the repo.
      if (
        entry.isDirectory() &&
        JS_FALLBACK_DEFAULT_EXCLUDED_DIRS.has(entry.name)
      ) {
        continue
      }
      const childPath = path.join(entryPath, entry.name)
      const relativePath = path.relative(root, childPath) || entry.name
      if (isExcludedByJavaScriptRipgrepGlob(relativePath, options)) {
        continue
      }
      await walk(childPath)
    }
  }

  if (rootStat.isFile()) {
    return [root]
  }

  await walk(root)
  return files
}

function createJavaScriptRipgrepRegex(
  options: JavaScriptRipgrepOptions,
): RegExp {
  return new RegExp(options.pattern ?? '', options.caseInsensitive ? 'i' : '')
}

async function ripGrepJavaScriptFallback(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const options = parseJavaScriptRipgrepOptions(args)
  const deadlineEpochMs = Date.now() + resolveJavaScriptRipgrepTimeoutMs()
  const files = await collectJavaScriptRipgrepFiles(
    target,
    options,
    abortSignal,
    deadlineEpochMs,
  )

  if (options.filesOnly) {
    return files
      .sort((a, b) => a.localeCompare(b))
      .map(file => path.relative(path.resolve(target), file) || file)
  }

  const regex = createJavaScriptRipgrepRegex(options)
  const results: string[] = []
  const maxFileBytes =
    parseInt(process.env.MOSSEN_CODE_JS_RIPGREP_MAX_FILE_BYTES || '', 10) ||
    10_000_000

  for (const file of files) {
    assertJavaScriptRipgrepDeadline(abortSignal, deadlineEpochMs)
    const fileStat = await stat(file)
    if (fileStat.size > maxFileBytes) {
      continue
    }

    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }

    const lines = text.split(/\r?\n/)
    const matchingLines: string[] = []
    for (let index = 0; index < lines.length; index++) {
      regex.lastIndex = 0
      if (regex.test(lines[index]!)) {
        matchingLines.push(
          options.lineNumbers
            ? `${file}:${index + 1}:${lines[index]!}`
            : `${file}:${lines[index]!}`,
        )
      }
    }

    if (options.count) {
      if (matchingLines.length > 0) {
        results.push(`${file}:${matchingLines.length}`)
      }
      continue
    }

    if (options.filesWithMatches) {
      if (matchingLines.length > 0) {
        results.push(file)
      }
      continue
    }

    results.push(...matchingLines)
  }

  return results
}

const getRipgrepConfig = memoize((): RipgrepConfig => {
  const userWantsSystemRipgrep = isEnvDefinedFalsy(
    process.env.USE_BUILTIN_RIPGREP,
  )

  // Try system ripgrep if user wants it
  if (userWantsSystemRipgrep) {
    const systemCommand = findSystemRipgrepCommand()
    if (systemCommand) {
      return { mode: 'system', command: systemCommand, args: [] }
    }
  }

  // In bundled (native) mode, ripgrep is statically compiled into bun-internal
  // and dispatches based on argv[0]. We spawn ourselves with argv0='rg'.
  if (isInBundledMode()) {
    return {
      mode: 'embedded',
      command: process.execPath,
      args: ['--no-config'],
      argv0: 'rg',
    }
  }

  const rgRoot = path.resolve(__dirname, 'vendor', 'ripgrep')
  const command =
    process.platform === 'win32'
      ? path.resolve(rgRoot, `${process.arch}-win32`, 'rg.exe')
      : path.resolve(rgRoot, `${process.arch}-${process.platform}`, 'rg')

  if (!existsSync(command)) {
    const systemCommand = findSystemRipgrepCommand()
    if (systemCommand) {
      return { mode: 'system', command: systemCommand, args: [] }
    }
  }

  return { mode: 'builtin', command, args: [] }
})

export function ripgrepCommand(): {
  rgPath: string
  rgArgs: string[]
  argv0?: string
} {
  const config = getRipgrepConfig()
  return {
    rgPath: config.command,
    rgArgs: config.args,
    argv0: config.argv0,
  }
}

const MAX_BUFFER_SIZE = 20_000_000 // 20MB; large monorepos can have 200k+ files

/**
 * Check if an error is EAGAIN (resource temporarily unavailable).
 * This happens in resource-constrained environments (Docker, CI) when
 * ripgrep tries to spawn too many threads.
 */
function isEagainError(stderr: string): boolean {
  return (
    stderr.includes('os error 11') ||
    stderr.includes('Resource temporarily unavailable')
  )
}

/**
 * Custom error class for ripgrep timeouts.
 * This allows callers to distinguish between "no matches" and "timed out".
 */
export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

// Tool-level wall-clock fuse (P1). Wraps a search call with an outer timeout
// so a hung native rg, a deadlocked JS fallback, or any other surprise can't
// freeze the agent loop. Distinguishes timeouts (wall-clock exceeded) from
// caller aborts (user pressed Esc) so the model sees the right signal.
const TOOL_RIPGREP_DEFAULT_TIMEOUT_MS = 30_000

export function resolveToolRipgrepTimeoutMs(): number {
  const envSeconds = parseInt(
    process.env.MOSSEN_CODE_TOOL_RIPGREP_TIMEOUT_SECONDS || '',
    10,
  )
  if (envSeconds > 0) return envSeconds * 1000
  return TOOL_RIPGREP_DEFAULT_TIMEOUT_MS
}

export async function withRipgrepToolTimeout<T>(
  parentSignal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const child = new AbortController()
  const propagate = () => {
    if (!child.signal.aborted) {
      child.abort(parentSignal.reason)
    }
  }
  if (parentSignal.aborted) {
    propagate()
  } else {
    parentSignal.addEventListener('abort', propagate, { once: true })
  }

  const timeoutMs = resolveToolRipgrepTimeoutMs()
  let timeoutFired = false
  const timeoutId = setTimeout(() => {
    timeoutFired = true
    if (!child.signal.aborted) {
      child.abort(
        new RipgrepTimeoutError(
          `Search exceeded the tool-level wall-clock budget of ${(timeoutMs / 1000).toFixed(1)}s. Try a more specific path or pattern, or set MOSSEN_CODE_TOOL_RIPGREP_TIMEOUT_SECONDS=<seconds> to raise the budget.`,
          [],
        ),
      )
    }
  }, timeoutMs)

  try {
    return await fn(child.signal)
  } catch (error) {
    if (timeoutFired) {
      const partial =
        error instanceof RipgrepTimeoutError ? error.partialResults : []
      throw new RipgrepTimeoutError(
        `Search exceeded the tool-level wall-clock budget of ${(timeoutMs / 1000).toFixed(1)}s. Try a more specific path or pattern, or set MOSSEN_CODE_TOOL_RIPGREP_TIMEOUT_SECONDS=<seconds> to raise the budget.`,
        partial,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    parentSignal.removeEventListener('abort', propagate)
  }
}

function ripGrepRaw(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
  singleThread = false,
): ChildProcess {
  // NB: When running interactively, ripgrep does not require a path as its last
  // argument, but when run non-interactively, it will hang unless a path or file
  // pattern is provided

  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  // Use single-threaded mode only if explicitly requested for this call's retry
  const threadArgs = singleThread ? ['-j', '1'] : []
  const fullArgs = [...rgArgs, ...threadArgs, ...args, target]
  // Allow timeout to be configured via env var (in seconds), otherwise use platform defaults
  // WSL has severe performance penalty for file reads (3-5x slower on WSL2)
  const defaultTimeout = getPlatform() === 'wsl' ? 60_000 : 20_000
  const parsedSeconds =
    parseInt(process.env.MOSSEN_CODE_GLOB_TIMEOUT_SECONDS || '', 10) || 0
  const timeout = parsedSeconds > 0 ? parsedSeconds * 1000 : defaultTimeout

  // For embedded ripgrep, use spawn with argv0 (execFile doesn't support argv0 properly)
  if (argv0) {
    const child = spawn(rgPath, fullArgs, {
      argv0,
      signal: abortSignal,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false

    child.stdout?.on('data', (data: Buffer) => {
      if (!stdoutTruncated) {
        stdout += data.toString()
        if (stdout.length > MAX_BUFFER_SIZE) {
          stdout = stdout.slice(0, MAX_BUFFER_SIZE)
          stdoutTruncated = true
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      if (!stderrTruncated) {
        stderr += data.toString()
        if (stderr.length > MAX_BUFFER_SIZE) {
          stderr = stderr.slice(0, MAX_BUFFER_SIZE)
          stderrTruncated = true
        }
      }
    })

    // Set up timeout with SIGKILL escalation.
    // SIGTERM alone may not kill ripgrep if it's blocked in uninterruptible I/O
    // (e.g., deep filesystem traversal). If SIGTERM doesn't work within 5 seconds,
    // escalate to SIGKILL which cannot be caught or ignored.
    // On Windows, child.kill('SIGTERM') throws; use default signal.
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutId = setTimeout(() => {
      if (process.platform === 'win32') {
        child.kill()
      } else {
        child.kill('SIGTERM')
        killTimeoutId = setTimeout(c => c.kill('SIGKILL'), 5_000, child)
      }
    }, timeout)

    // On Windows, both 'close' and 'error' can fire for the same process
    // (e.g. when AbortSignal kills the child). Guard against double-callback.
    let settled = false
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      if (code === 0 || code === 1) {
        // 0 = matches found, 1 = no matches (both are success)
        callback(null, stdout, stderr)
      } else {
        const error: ExecFileException = new Error(
          `ripgrep exited with code ${code}`,
        )
        error.code = code ?? undefined
        error.signal = signal ?? undefined
        callback(error, stdout, stderr)
      }
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      const error: ExecFileException = err
      callback(error, stdout, stderr)
    })

    return child
  }

  // For non-embedded ripgrep, use execFile
  // Use SIGKILL as killSignal because SIGTERM may not terminate ripgrep
  // when it's blocked in uninterruptible filesystem I/O.
  // On Windows, SIGKILL throws; use default (undefined) which sends SIGTERM.
  return execFile(
    rgPath,
    fullArgs,
    {
      maxBuffer: MAX_BUFFER_SIZE,
      signal: abortSignal,
      timeout,
      killSignal: process.platform === 'win32' ? undefined : 'SIGKILL',
    },
    callback,
  )
}

/**
 * Stream-count lines from `rg --files` without buffering stdout.
 *
 * On large repos (e.g. 247k files, 16MB of paths), calling `ripGrep()` just
 * to read `.length` materializes the full stdout string plus a 247k-element
 * array. This counts newline bytes per chunk instead; peak memory is one
 * stream chunk (~64KB).
 *
 * Intentionally minimal: the only caller is telemetry (countFilesRoundedRg),
 * which swallows all errors. No EAGAIN retry, no stderr capture, no internal
 * timeout (callers pass AbortSignal.timeout; spawn's signal option kills rg).
 */
async function ripGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  await codesignRipgrepIfNecessary()

  if (shouldUseJavaScriptRipgrepFallback()) {
    return (await ripGrepJavaScriptFallback(args, target, abortSignal)).length
  }

  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<number>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let lines = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      lines += countCharInString(chunk, '\n')
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      settled = true
      if (code === 0 || code === 1) resolve(lines)
      else reject(new Error(`rg --files exited ${code}`))
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/**
 * Stream lines from ripgrep as they arrive, calling `onLines` per stdout chunk.
 *
 * Unlike `ripGrep()` which buffers the entire stdout, this flushes complete
 * lines as soon as each chunk arrives — first results paint while rg is still
 * walking the tree (the fzf `change:reload` pattern). Partial trailing lines
 * are carried across chunk boundaries.
 *
 * Callers that want to stop early (e.g. after N matches) should abort the
 * signal — spawn's signal option kills rg. No EAGAIN retry, no internal
 * timeout, stderr is ignored; interactive callers own recovery.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  await codesignRipgrepIfNecessary()

  if (shouldUseJavaScriptRipgrepFallback()) {
    const lines = await ripGrepJavaScriptFallback(args, target, abortSignal)
    if (lines.length > 0) onLines(lines)
    return
  }

  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<void>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
    let remainder = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const data = remainder + chunk.toString()
      const lines = data.split('\n')
      remainder = lines.pop() ?? ''
      if (lines.length) onLines(lines.map(stripCR))
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      // Abort races close — don't flush a torn tail from a killed process.
      // Promise still settles: spawn's signal option fires 'error' with
      // AbortError → reject below.
      if (abortSignal.aborted) return
      settled = true
      if (code === 0 || code === 1) {
        if (remainder) onLines([stripCR(remainder)])
        resolve()
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  await codesignRipgrepIfNecessary()

  if (shouldUseJavaScriptRipgrepFallback()) {
    return ripGrepJavaScriptFallback(args, target, abortSignal)
  }

  // Test ripgrep on first use and cache the result (fire and forget)
  void testRipgrepOnFirstUse().catch(error => {
    logError(error)
  })

  return new Promise((resolve, reject) => {
    const handleResult = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string,
      isRetry: boolean,
    ): void => {
      // Success case
      if (!error) {
        resolve(
          stdout
            .trim()
            .split('\n')
            .map(line => line.replace(/\r$/, ''))
            .filter(Boolean),
        )
        return
      }

      // Exit code 1 is normal "no matches"
      if (error.code === 1) {
        resolve([])
        return
      }

      // Critical errors that indicate ripgrep is broken, not "no matches"
      // These should be surfaced to the user rather than silently returning empty results
      const CRITICAL_ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM']
      if (CRITICAL_ERROR_CODES.includes(error.code as string)) {
        ripGrepJavaScriptFallback(args, target, abortSignal).then(resolve, reject)
        return
      }

      // If we hit EAGAIN and haven't retried yet, retry with single-threaded mode
      // Note: We only use -j 1 for this specific retry, not for future calls.
      // Persisting single-threaded mode globally caused timeouts on large repos
      // where EAGAIN was just a transient startup error.
      if (!isRetry && isEagainError(stderr)) {
        logForDebugging(
          `rg EAGAIN error detected, retrying with single-threaded mode (-j 1)`,
        )
        logMossenEvent('mossen.ripgrep.eagainRetry', {})
        ripGrepRaw(
          args,
          target,
          abortSignal,
          (retryError, retryStdout, retryStderr) => {
            handleResult(retryError, retryStdout, retryStderr, true)
          },
          true, // Force single-threaded mode for this retry only
        )
        return
      }

      // For all other errors, try to return partial results if available
      const hasOutput = stdout && stdout.trim().length > 0
      const isTimeout =
        error.signal === 'SIGTERM' ||
        error.signal === 'SIGKILL' ||
        error.code === 'ABORT_ERR'
      const isBufferOverflow =
        error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

      let lines: string[] = []
      if (hasOutput) {
        lines = stdout
          .trim()
          .split('\n')
          .map(line => line.replace(/\r$/, ''))
          .filter(Boolean)
        // Drop last line for timeouts and buffer overflow - it may be incomplete
        if (lines.length > 0 && (isTimeout || isBufferOverflow)) {
          lines = lines.slice(0, -1)
        }
      }

      logForDebugging(
        `rg error (signal=${error.signal}, code=${error.code}, stderr: ${stderr}), ${lines.length} results`,
      )

      // code 2 = ripgrep usage error (already handled); ABORT_ERR = caller
      // explicitly aborted (not an error, just a cancellation — interactive
      // callers may abort on every keystroke-after-debounce).
      if (error.code !== 2 && error.code !== 'ABORT_ERR') {
        logError(error)
      }

      // If we timed out with no results, throw an error so Mossen knows the search
      // didn't complete rather than thinking there were no matches
      if (isTimeout && lines.length === 0) {
        reject(
          new RipgrepTimeoutError(
            `Ripgrep search timed out after ${getPlatform() === 'wsl' ? 60 : 20} seconds. The search may have matched files but did not complete in time. Try searching a more specific path or pattern.`,
            lines,
          ),
        )
        return
      }

      resolve(lines)
    }

    ripGrepRaw(args, target, abortSignal, (error, stdout, stderr) => {
      handleResult(error, stdout, stderr, false)
    })
  })
}

/**
 * Count files in a directory recursively using ripgrep and round to the nearest power of 10 for privacy
 *
 * This is much more efficient than using native Node.js methods for counting files
 * in large directories since it uses ripgrep's highly optimized file traversal.
 *
 * @param path Directory path to count files in
 * @param abortSignal AbortSignal to cancel the operation
 * @param ignorePatterns Optional additional patterns to ignore (beyond .gitignore)
 * @returns Approximate file count rounded to the nearest power of 10
 */
export const countFilesRoundedRg = memoize(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    // Skip file counting if we're in the home directory to avoid triggering
    // macOS TCC permission dialogs for Desktop, Downloads, Documents, etc.
    if (path.resolve(dirPath) === path.resolve(homedir())) {
      return undefined
    }

    try {
      // Build ripgrep arguments:
      // --files: List files that would be searched (rather than searching them)
      // --count: Only print a count of matching lines for each file
      // --no-ignore-parent: Don't respect ignore files in parent directories
      // --hidden: Search hidden files and directories
      const args = ['--files', '--hidden']

      // Add ignore patterns if provided
      ignorePatterns.forEach(pattern => {
        args.push('--glob', `!${pattern}`)
      })

      const count = await ripGrepFileCount(args, dirPath, abortSignal)

      // Round to nearest power of 10 for privacy
      if (count === 0) return 0

      const magnitude = Math.floor(Math.log10(count))
      const power = Math.pow(10, magnitude)

      // Round to nearest power of 10
      // e.g., 8 -> 10, 42 -> 100, 350 -> 100, 750 -> 1000
      return Math.round(count / power) * power
    } catch (error) {
      // AbortSignal.timeout firing is expected on large/slow repos, not an error.
      if ((error as Error)?.name !== 'AbortError') logError(error)
    }
  },
  // lodash memoize's default resolver only uses the first argument.
  // ignorePatterns affect the result, so include them in the cache key.
  // abortSignal is intentionally excluded — it doesn't affect the count.
  (dirPath, _abortSignal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)

// Singleton to store ripgrep availability status
let ripgrepStatus: {
  working: boolean
  lastTested: number
  config: RipgrepConfig
} | null = null

/**
 * Get ripgrep status and configuration info
 * Returns current configuration immediately, with working status if available
 */
export function getRipgrepStatus(): {
  mode: RipgrepStatusMode
  path: string
  working: boolean | null // null if not yet tested
} {
  const config = getRipgrepConfig()
  if (shouldUseJavaScriptRipgrepFallback()) {
    return {
      mode: 'js-fallback',
      path: 'internal-js-search',
      working: true,
    }
  }
  return {
    mode: config.mode,
    path: config.command,
    working: ripgrepStatus?.working ?? null,
  }
}

/**
 * Test ripgrep availability on first use and cache the result
 */
const testRipgrepOnFirstUse = memoize(async (): Promise<void> => {
  // Already tested
  if (ripgrepStatus !== null) {
    return
  }

  // If we're going to use the JS fallback anyway (because the resolved
  // binary doesn't exist or isn't executable), don't try to spawn the
  // missing binary — that just emits a misleading ENOENT into the error
  // log every cold start. Mark fallback as the working mode and return.
  if (shouldUseJavaScriptRipgrepFallback()) {
    ripgrepStatus = {
      working: true,
      lastTested: Date.now(),
      config: getRipgrepConfig(),
    }
    return
  }

  const config = getRipgrepConfig()

  try {
    let test: { code: number; stdout: string }

    // For embedded ripgrep, use Bun.spawn with argv0
    if (config.argv0) {
      // Only Bun embeds ripgrep.
      // eslint-disable-next-line custom-rules/require-bun-typeof-guard
      const proc = Bun.spawn([config.command, '--version'], {
        argv0: config.argv0,
        stderr: 'ignore',
        stdout: 'pipe',
      })

      // Bun's ReadableStream has .text() at runtime, but TS types don't reflect it
      const [stdout, code] = await Promise.all([
        (proc.stdout as unknown as Blob).text(),
        proc.exited,
      ])
      test = {
        code,
        stdout,
      }
    } else {
      test = await execFileNoThrow(
        config.command,
        [...config.args, '--version'],
        {
          timeout: 5000,
        },
      )
    }

    const working =
      test.code === 0 && !!test.stdout && test.stdout.startsWith('ripgrep ')

    ripgrepStatus = {
      working,
      lastTested: Date.now(),
      config,
    }

    logForDebugging(
      `Ripgrep first use test: ${working ? 'PASSED' : 'FAILED'} (mode=${config.mode}, path=${config.command})`,
    )

    // Log telemetry for actual ripgrep availability
    logMossenEvent('mossen.ripgrep.availability', {
      working: working ? 1 : 0,
      using_system: config.mode === 'system' ? 1 : 0,
    })
  } catch (error) {
    ripgrepStatus = {
      working: false,
      lastTested: Date.now(),
      config,
    }
    logError(error)
  }
})

let alreadyDoneSignCheck = false
async function codesignRipgrepIfNecessary() {
  if (process.platform !== 'darwin' || alreadyDoneSignCheck) {
    return
  }

  alreadyDoneSignCheck = true

  // Only sign the standalone vendored rg binary (npm builds)
  const config = getRipgrepConfig()
  if (config.mode !== 'builtin') {
    return
  }
  const builtinPath = config.command
  if (!existsSync(builtinPath)) {
    return
  }

  // First, check to see if ripgrep is already signed
  const lines = (
    await execFileNoThrow('codesign', ['-vv', '-d', builtinPath], {
      preserveOutputOnError: false,
    })
  ).stdout.split('\n')

  const needsSigned = lines.find(line => line.includes('linker-signed'))
  if (!needsSigned) {
    return
  }

  try {
    const signResult = await execFileNoThrow('codesign', [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      builtinPath,
    ])

    if (signResult.code !== 0) {
      logError(
        new Error(
          `Failed to sign ripgrep: ${signResult.stdout} ${signResult.stderr}`,
        ),
      )
    }

    const quarantineResult = await execFileNoThrow('xattr', [
      '-d',
      'com.apple.quarantine',
      builtinPath,
    ])

    if (quarantineResult.code !== 0) {
      logError(
        new Error(
          `Failed to remove quarantine: ${quarantineResult.stdout} ${quarantineResult.stderr}`,
        ),
      )
    }
  } catch (e) {
    logError(e)
  }
}
